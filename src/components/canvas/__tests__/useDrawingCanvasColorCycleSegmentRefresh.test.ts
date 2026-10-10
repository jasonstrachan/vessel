import { act, renderHook } from '@testing-library/react';

import { DEFAULT_INTERLACE_SETTINGS } from '@/lib/interlace/interlaceSettings';
import { refreshLayerCCSurface } from '@/hooks/useBrushEngineSimplified';
import type { ColorCycleBrushManager } from '@/stores/colorCycleBrushManager';
import type { CompositeSegment } from '@/stores/slices/layersSlice';
import type { Layer } from '@/types';
import { useAppStore } from '@/stores/useAppStore';
import { useDrawingCanvasColorCycleSegmentRefresh } from '../useDrawingCanvasColorCycleSegmentRefresh';

jest.mock('@/hooks/useBrushEngineSimplified', () => ({
  refreshLayerCCSurface: jest.fn(),
}));

const mockRefreshLayerCCSurface = jest.mocked(refreshLayerCCSurface);

const makeLayer = (id: string, isAnimating = true) => ({
  id,
  layerType: 'color-cycle',
  colorCycleData: {
    isAnimating,
    mode: 'brush',
  },
}) as Layer;

const makeSegment = (layerId: string): CompositeSegment => ({
  kind: 'color-cycle',
  id: `cc:${layerId}`,
  layerId,
  blendMode: 'source-over',
  opacity: 1,
});

const renderRefreshHook = ({
  layers,
  segments,
  manager,
}: {
  layers: Layer[];
  segments: CompositeSegment[];
  manager: ColorCycleBrushManager;
}) => renderHook(() => useDrawingCanvasColorCycleSegmentRefresh({
  layers,
  compositeSegmentsVersion: 1,
  getCompositeSegmentsSnapshot: () => segments,
  layerMapRef: { current: new Map() },
  compositeSegmentsRef: { current: [] },
  pendingColorCycleRefreshRef: { current: false },
  colorCycleBrushManagerRef: { current: manager },
}));

describe('useDrawingCanvasColorCycleSegmentRefresh', () => {
  beforeEach(() => {
    useAppStore.setState((state) => ({
      colorCyclePlayback: { ...state.colorCyclePlayback, desiredPlaying: true, suspendDepth: 0 },
    }));
    mockRefreshLayerCCSurface.mockReset();
    mockRefreshLayerCCSurface.mockImplementation(() => document.createElement('canvas'));
  });

  it('honours global pause and suspension even when the layer animation flag is stale', () => {
    let playing = false;
    const surfaceBrush = {
      isPlaying: () => playing,
      startAnimation: jest.fn(() => { playing = true; }),
      stopAnimation: jest.fn(() => { playing = false; }),
      presentCurrentFrameToCanvas: jest.fn(),
    };
    const manager = {
      getSurfaceBrush: () => surfaceBrush,
      getInitBrush: () => null,
    } as unknown as ColorCycleBrushManager;
    useAppStore.getState().pauseColorCycle('toolbar');
    const view = renderRefreshHook({
      layers: [makeLayer('paused-layer', true)],
      segments: [makeSegment('paused-layer')],
      manager,
    });
    expect(surfaceBrush.startAnimation).not.toHaveBeenCalled();
    view.rerender();
    expect(surfaceBrush.startAnimation).not.toHaveBeenCalled();
    act(() => useAppStore.getState().playColorCycle('toolbar'));
    expect(playing).toBe(true);
    act(() => useAppStore.getState().pauseColorCycle('toolbar'));
    expect(playing).toBe(false);
    act(() => {
      useAppStore.getState().suspendColorCycle('shape-preview');
      useAppStore.getState().playColorCycle('toolbar');
    });
    expect(playing).toBe(false);
    expect(surfaceBrush.startAnimation).toHaveBeenCalledTimes(1);
    view.unmount();
  });

  it('binds frame publication before starting every restored layer runtime', () => {
    const calls: string[] = [];
    const surfaceBrush = {
      isPlaying: () => false,
      startAnimation: jest.fn(() => calls.push('start')),
      presentCurrentFrameToCanvas: jest.fn(),
    };
    const initBrush = {
      applySettings: jest.fn(),
      endStroke: jest.fn(),
      setOnFrameRendered: jest.fn(() => calls.push('bind')),
    };
    const manager = {
      getSurfaceBrush: jest.fn(() => surfaceBrush),
      getInitBrush: jest.fn(() => initBrush),
    } as unknown as ColorCycleBrushManager;

    renderRefreshHook({
      layers: [makeLayer('restored-layer')],
      segments: [makeSegment('restored-layer')],
      manager,
    });

    expect(initBrush.setOnFrameRendered).toHaveBeenCalledTimes(1);
    expect(surfaceBrush.startAnimation).toHaveBeenCalledTimes(1);
    expect(calls).toEqual(['bind', 'start']);
  });

  it('continues presenting later layers when one presenter fails', () => {
    const firstPresenter = jest.fn(() => {
      throw new Error('detached canvas');
    });
    const secondPresenter = jest.fn();
    const brushes = new Map([
      ['first-layer', { isPlaying: () => false, presentCurrentFrameToCanvas: firstPresenter }],
      ['second-layer', { isPlaying: () => false, presentCurrentFrameToCanvas: secondPresenter }],
    ]);
    const manager = {
      getSurfaceBrush: jest.fn((layerId: string) => brushes.get(layerId) ?? null),
      getInitBrush: jest.fn(() => null),
    } as unknown as ColorCycleBrushManager;

    renderRefreshHook({
      layers: [makeLayer('first-layer', false), makeLayer('second-layer', false)],
      segments: [makeSegment('first-layer'), makeSegment('second-layer')],
      manager,
    });

    expect(firstPresenter).toHaveBeenCalledTimes(1);
    expect(secondPresenter).toHaveBeenCalledTimes(1);
  });

  it('does not republish color-cycle canvases for a static-only segment update', () => {
    const presenter = jest.fn();
    const surfaceBrush = {
      isPlaying: () => false,
      presentCurrentFrameToCanvas: presenter,
    };
    const manager = {
      getSurfaceBrush: jest.fn(() => surfaceBrush),
      getInitBrush: jest.fn(() => null),
    } as unknown as ColorCycleBrushManager;
    const layers = [makeLayer('cc-layer', false)];
    let segments: CompositeSegment[] = [makeSegment('cc-layer')];
    const layerMapRef = { current: new Map<string, Layer>() };
    const compositeSegmentsRef = { current: [] as CompositeSegment[] };
    const pendingColorCycleRefreshRef = { current: false };
    const colorCycleBrushManagerRef = { current: manager };
    const getCompositeSegmentsSnapshot = () => segments;
    const { rerender } = renderHook(({ version }) => (
      useDrawingCanvasColorCycleSegmentRefresh({
        layers,
        compositeSegmentsVersion: version,
        getCompositeSegmentsSnapshot,
        layerMapRef,
        compositeSegmentsRef,
        pendingColorCycleRefreshRef,
        colorCycleBrushManagerRef,
      })
    ), { initialProps: { version: 1 } });
    expect(presenter).toHaveBeenCalledTimes(1);

    presenter.mockClear();
    segments = [
      {
        kind: 'static',
        id: 'static-updated',
        layerIds: ['normal-layer'],
        includeBackground: false,
        orderRange: { start: 0, end: 0 },
        canvas: document.createElement('canvas'),
        bitmap: null,
        dirty: false,
      },
      makeSegment('cc-layer'),
    ];
    rerender({ version: 2 });

    expect(compositeSegmentsRef.current).toBe(segments);
    expect(presenter).not.toHaveBeenCalled();
  });
});


describe('interlace color-cycle member publication', () => {
  beforeEach(() => {
    useAppStore.setState((state) => ({
      colorCyclePlayback: { ...state.colorCyclePlayback, desiredPlaying: false, suspendDepth: 0 },
    }));
    mockRefreshLayerCCSurface.mockReset();
    mockRefreshLayerCCSurface.mockImplementation(() => document.createElement('canvas'));
  });

  const interlace = (layerIds: string[]): CompositeSegment => ({
    kind: 'interlace', id: 'interlace:test', groupId: 'group', layerIds,
    settings: DEFAULT_INTERLACE_SETTINGS,
  });

  it('publishes raw current-frame surfaces for CC members and respects requested member IDs', () => {
    const first = makeLayer('first', false);
    const second = makeLayer('second', false);
    const normal = { id: 'normal', layerType: 'normal' } as Layer;
    const firstCanvas = document.createElement('canvas');
    const secondCanvas = document.createElement('canvas');
    const firstPresenter = jest.fn();
    const secondPresenter = jest.fn();
    const firstDirect = jest.fn();
    const secondDirect = jest.fn();
    const brushes = new Map([
      ['first', { isPlaying: () => false, presentCurrentFrameToCanvas: firstPresenter, renderDirectToCanvas: firstDirect }],
      ['second', { isPlaying: () => false, presentCurrentFrameToCanvas: secondPresenter, renderDirectToCanvas: secondDirect }],
    ]);
    const getSurfaceBrush = jest.fn((id: string) => brushes.get(id) ?? null);
    const manager = { getSurfaceBrush, getInitBrush: () => null } as unknown as ColorCycleBrushManager;
    mockRefreshLayerCCSurface.mockImplementation((_brush, id) => id === 'first' ? firstCanvas : secondCanvas);
    const view = renderRefreshHook({ layers: [first, normal, second], segments: [interlace(['first', 'normal', 'second'])], manager });

    // These canvases feed a compositor that applies coverage. Forced direct
    // rendering would bake erase coverage into them a second time.
    expect(firstPresenter).toHaveBeenCalledWith(firstCanvas, 'first');
    expect(secondPresenter).toHaveBeenCalledWith(secondCanvas, 'second');
    expect(getSurfaceBrush).not.toHaveBeenCalledWith('normal');
    expect(firstDirect).not.toHaveBeenCalled();
    expect(secondDirect).not.toHaveBeenCalled();
    firstPresenter.mockClear();
    secondPresenter.mockClear();
    act(() => { view.result.current.refreshColorCycleSegments({ sourceLayerIds: ['second'] }); });
    expect(firstPresenter).not.toHaveBeenCalled();
    expect(secondPresenter).toHaveBeenCalledTimes(1);
    expect(secondPresenter).toHaveBeenCalledWith(secondCanvas, 'second');
    view.unmount();
  });

  it('binds grouped CC frame publication and obeys global play/pause/suspension', () => {
    const calls: string[] = [];
    let playing = false;
    const brush = {
      isPlaying: () => playing,
      startAnimation: jest.fn(() => { playing = true; calls.push('start'); }),
      stopAnimation: jest.fn(() => { playing = false; }),
      presentCurrentFrameToCanvas: jest.fn(),
    };
    const initBrush = {
      applySettings: jest.fn(), endStroke: jest.fn(),
      setOnFrameRendered: jest.fn(() => calls.push('bind')),
    };
    const manager = {
      getSurfaceBrush: () => brush, getInitBrush: () => initBrush,
    } as unknown as ColorCycleBrushManager;
    const view = renderRefreshHook({ layers: [makeLayer('grouped')], segments: [interlace(['grouped'])], manager });
    expect(initBrush.setOnFrameRendered).toHaveBeenCalled();
    expect(playing).toBe(false);
    act(() => useAppStore.getState().playColorCycle('toolbar'));
    expect(playing).toBe(true);
    expect(calls.indexOf('bind')).toBeLessThan(calls.indexOf('start'));
    act(() => useAppStore.getState().pauseColorCycle('toolbar'));
    expect(playing).toBe(false);
    act(() => {
      useAppStore.getState().suspendColorCycle('shape-preview');
      useAppStore.getState().playColorCycle('toolbar');
    });
    expect(playing).toBe(false);
    expect(brush.startAnimation).toHaveBeenCalledTimes(1);
    view.unmount();
  });
});
