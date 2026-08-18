import { renderHook } from '@testing-library/react';

import { refreshLayerCCSurface } from '@/hooks/useBrushEngineSimplified';
import type { ColorCycleBrushManager } from '@/stores/colorCycleBrushManager';
import type { CompositeSegment } from '@/stores/slices/layersSlice';
import type { Layer } from '@/types';
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
    mockRefreshLayerCCSurface.mockReset();
    mockRefreshLayerCCSurface.mockImplementation(() => document.createElement('canvas'));
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
