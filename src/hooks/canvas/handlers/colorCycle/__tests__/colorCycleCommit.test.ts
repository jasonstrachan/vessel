import {
  commitBrushHistory,
  commitColorCycleLayerStroke,
  commitRasterOverlay,
  scheduleDeferredColorCycleSaveWithState,
} from '@/hooks/canvas/handlers/colorCycle/colorCycleCommit';
import { TEMP_SAMPLE_SLOT } from '@/constants/colorCycle';
import { setOverlaySeededFromLayer } from '@/hooks/canvas/utils/overlaySeedState';
import { finalizeMarkGradientSession } from '@/hooks/canvas/utils/colorCycleMarkSession';
import { useAppStore } from '@/stores/useAppStore';
import type { ColorCycleSerializedState } from '@/history/helpers/colorCycle';
import type { Layer } from '@/types';

jest.mock('@/hooks/canvas/utils/colorCycleMarkSession', () => ({
  finalizeMarkGradientSession: jest.fn(),
}));

const createLayer = (): Layer =>
  ({
    id: 'layer-1',
    name: 'Layer 1',
    visible: true,
    opacity: 1,
    order: 0,
    imageData: null,
    colorCycleData: null,
    layerType: 'normal',
    framebuffer: document.createElement('canvas'),
  }) as unknown as Layer;

const makeCommittedLayerDocument = (slot: number) => ({
  read: () => ({
    snapshot: {
      width: 8,
      height: 8,
      paintBuffer: new Uint8Array(64).fill(1).buffer,
      gradientIdBuffer: new Uint8Array(64).fill(slot).buffer,
      gradientDefIdBuffer: new Uint16Array(64).buffer,
      hasContent: true,
    },
    version: 1,
  }),
});

const makeCommittedBrush = (slot: number) => ({
  commitCurrentStroke: jest.fn(),
  finalizeCurrentStroke: jest.fn(),
  setGradientSlotStops: jest.fn(),
  bindGradientDefIdToSlot: jest.fn(),
  commitToLayer: jest.fn(),
  renderDirectToCanvas: jest.fn(),
  getColorCycleLayerDocument: jest.fn(() => makeCommittedLayerDocument(slot)),
});

describe('commitRasterOverlay', () => {
  it('reuses the same temp canvas across calls', async () => {
    const captureCanvasToActiveLayer = jest.fn().mockResolvedValue(undefined);
    const deps = {
      project: { width: 16, height: 16 },
      captureCanvasToActiveLayer,
      scheduleHistoryCommit: jest.fn().mockResolvedValue(undefined),
      withTiming: async <T,>(_label: string, task: () => Promise<T> | T): Promise<T> => task(),
    };

    const options = {
      layer: createLayer(),
      overlayCanvas: null,
      beforeImage: null,
      beforeColorState: null,
      historyAction: 'brush' as const,
      historyDescription: 'test',
      tool: 'brush',
      skipHistory: true,
    };

    await commitRasterOverlay(options, deps);
    await commitRasterOverlay(options, deps);

    expect(captureCanvasToActiveLayer).toHaveBeenCalledTimes(2);
    const firstCanvas = captureCanvasToActiveLayer.mock.calls[0]?.[0];
    const secondCanvas = captureCanvasToActiveLayer.mock.calls[1]?.[0];
    expect(firstCanvas).toBe(secondCanvas);
  });

  it('seeds temp canvas from framebuffer before overlay merge', async () => {
    const layer = createLayer();
    layer.imageData = new ImageData(new Uint8ClampedArray([
      255, 255, 255, 255,
      255, 255, 255, 255,
      255, 255, 255, 255,
      255, 255, 255, 255,
    ]), 2, 2);
    layer.framebuffer.width = 2;
    layer.framebuffer.height = 2;
    const fbCtx = layer.framebuffer.getContext('2d') as CanvasRenderingContext2D | null;
    fbCtx?.putImageData(new ImageData(new Uint8ClampedArray([
      0, 0, 255, 255,
      0, 0, 255, 255,
      0, 0, 255, 255,
      0, 0, 255, 255,
    ]), 2, 2), 0, 0);

    const overlay = document.createElement('canvas');
    overlay.width = 2;
    overlay.height = 2;
    const overlayCtx = overlay.getContext('2d');
    overlayCtx?.putImageData(new ImageData(new Uint8ClampedArray([
      255, 0, 0, 255,
      0, 0, 0, 0,
      0, 0, 0, 0,
      0, 0, 0, 0,
    ]), 2, 2), 0, 0);

    const drawImageSpy = jest.spyOn(CanvasRenderingContext2D.prototype, 'drawImage');
    const captureCanvasToActiveLayer = jest.fn().mockResolvedValue(undefined);

    await commitRasterOverlay(
      {
        layer,
        overlayCanvas: overlay,
        beforeImage: null,
        beforeColorState: null,
        historyAction: 'brush',
        historyDescription: 'test',
        tool: 'brush',
        skipHistory: true,
      },
      {
        project: { width: 2, height: 2 },
        captureCanvasToActiveLayer,
        scheduleHistoryCommit: jest.fn().mockResolvedValue(undefined),
        withTiming: async <T,>(_label: string, task: () => Promise<T> | T): Promise<T> => task(),
      }
    );

    expect(captureCanvasToActiveLayer).toHaveBeenCalledTimes(1);
    expect(drawImageSpy).toHaveBeenCalled();
    expect(drawImageSpy.mock.calls[0]?.[0]).toBe(layer.framebuffer);
    drawImageSpy.mockRestore();
  });

  it('uses replace capture mode when overlay is seeded from active layer', async () => {
    const layer = createLayer();
    layer.framebuffer.width = 2;
    layer.framebuffer.height = 2;

    const overlay = document.createElement('canvas');
    overlay.width = 2;
    overlay.height = 2;
    const overlayCtx = overlay.getContext('2d');
    overlayCtx?.fillRect(0, 0, 2, 2);
    setOverlaySeededFromLayer(overlay, true);

    const captureCanvasToActiveLayer = jest.fn().mockResolvedValue(undefined);
    await commitRasterOverlay(
      {
        layer,
        overlayCanvas: overlay,
        beforeImage: null,
        beforeColorState: null,
        historyAction: 'brush',
        historyDescription: 'test',
        tool: 'brush',
        skipHistory: true,
      },
      {
        project: { width: 2, height: 2 },
        captureCanvasToActiveLayer,
        scheduleHistoryCommit: jest.fn().mockResolvedValue(undefined),
        withTiming: async <T,>(_label: string, task: () => Promise<T> | T): Promise<T> => task(),
      }
    );

    expect(captureCanvasToActiveLayer).toHaveBeenCalledWith(
      expect.any(HTMLCanvasElement),
      undefined,
      { mode: 'replace' }
    );
  });

  it('routes stroke commit binding through the brush committed-state seam', async () => {
    const layer = createLayer();
    const canvas = document.createElement('canvas');
    canvas.width = 8;
    canvas.height = 8;
    layer.layerType = 'color-cycle';
    layer.colorCycleData = {
      canvas,
      hasContent: true,
      gradient: [],
      gradientDefStore: [
        {
          id: 22,
          kind: 'linear',
          stops: [
            { position: 0, color: '#081018' },
            { position: 0.5, color: '#506070' },
            { position: 1, color: '#c0d0e0' },
          ],
          hash: 'hash-sampled',
          source: 'sampled',
          createdAtMs: 1,
          slot: 6,
          speedCps: 0.3,
        },
      ],
    } as Layer['colorCycleData'];

    const updateLayer = jest.fn();
    const setCcGradientSampleCount = jest.fn();
    const getStateSpy = jest.spyOn(useAppStore, 'getState');
    getStateSpy.mockReturnValue({
      layers: [layer],
      updateLayer,
      setCcGradientSampleCount,
      colorCyclePlayback: { desiredPlaying: true, suspendDepth: 0 },
    } as unknown as ReturnType<typeof useAppStore.getState>);

    (finalizeMarkGradientSession as jest.Mock).mockReturnValue({
      markId: 'mark-1',
      layerId: layer.id,
      markKind: 'stroke',
      gradientKind: 'linear',
      source: 'manual',
      frozenStopsStored: [
        { position: 0, color: '#000000' },
        { position: 1, color: '#ffffff' },
      ],
      frozenHash: 'hash-1',
      binding: { kind: 'def', defId: 21, slot: 5 },
      speedCps: 0.2,
    });

    const brush = makeCommittedBrush(5);

    await commitColorCycleLayerStroke(
      {
        layer,
        drawingCanvas: canvas,
        brushSettings: {
          opacity: 0.75,
        } as never,
        project: { width: 8, height: 8 },
        strokeBoundingBox: null,
        captureRoi: { x: 1, y: 2, width: 3, height: 4 },
        strokeCapturePadding: 0,
        roiPadding: 0,
        enableCaptureRoi: true,
      },
      {
        getBrushForLayer: () => brush as never,
        bindBrushToCanvas: jest.fn(),
        markLayerHasContent: jest.fn(),
        perfMark: jest.fn(),
        perfMeasure: jest.fn(),
        startFinalizeVisibleTimer: jest.fn(),
        endFinalizeVisibleTimer: jest.fn(),
        dispatchFrameUpdate: jest.fn(),
      }
    );

    expect(brush.finalizeCurrentStroke).toHaveBeenCalledWith(layer.id);
    expect(brush.commitCurrentStroke).not.toHaveBeenCalled();
    expect(brush.bindGradientDefIdToSlot).toHaveBeenCalledWith(
      layer.id,
      21,
      5,
      { minX: 1, minY: 2, width: 3, height: 4 },
      null
    );
    expect(brush.commitToLayer).toHaveBeenCalledWith(canvas, layer.id, 0.75);
    expect(setCcGradientSampleCount).not.toHaveBeenCalled();

    getStateSpy.mockRestore();
  });

  it('allocates a new def id when commit binding collides with a different frozen hash', async () => {
    const layer = createLayer();
    const canvas = document.createElement('canvas');
    canvas.width = 8;
    canvas.height = 8;
    layer.layerType = 'color-cycle';
    layer.colorCycleData = {
      canvas,
      hasContent: true,
      gradient: [],
      nextGradientDefId: 23,
      gradientDefStore: [
        {
          id: 22,
          kind: 'linear',
          stops: [
            { position: 0, color: '#081018' },
            { position: 1, color: '#c0d0e0' },
          ],
          hash: 'hash-old',
          source: 'manual',
          createdAtMs: 1,
          slot: 6,
          speedCps: 0.3,
        },
      ],
    } as Layer['colorCycleData'];

    const updateLayer = jest.fn();
    const setCcGradientSampleCount = jest.fn();
    const getStateSpy = jest.spyOn(useAppStore, 'getState');
    getStateSpy.mockReturnValue({
      layers: [layer],
      updateLayer,
      setCcGradientSampleCount,
      colorCyclePlayback: { desiredPlaying: true, suspendDepth: 0 },
    } as unknown as ReturnType<typeof useAppStore.getState>);

    (finalizeMarkGradientSession as jest.Mock).mockReturnValue({
      markId: 'mark-1',
      layerId: layer.id,
      markKind: 'stroke',
      gradientKind: 'linear',
      source: 'manual',
      frozenStopsStored: [
        { position: 0, color: '#000000' },
        { position: 1, color: '#ffffff' },
      ],
      frozenHash: 'hash-new',
      binding: { kind: 'def', defId: 22, slot: 6 },
      speedCps: 0.5,
    });

    const brush = makeCommittedBrush(6);

    await commitColorCycleLayerStroke(
      {
        layer,
        drawingCanvas: canvas,
        brushSettings: {
          opacity: 1,
        } as never,
        project: { width: 8, height: 8 },
        strokeBoundingBox: null,
        captureRoi: { x: 1, y: 2, width: 3, height: 4 },
        strokeCapturePadding: 0,
        roiPadding: 0,
        enableCaptureRoi: true,
      },
      {
        getBrushForLayer: () => brush as never,
        bindBrushToCanvas: jest.fn(),
        markLayerHasContent: jest.fn(),
        perfMark: jest.fn(),
        perfMeasure: jest.fn(),
        startFinalizeVisibleTimer: jest.fn(),
        endFinalizeVisibleTimer: jest.fn(),
        dispatchFrameUpdate: jest.fn(),
      }
    );

    expect(brush.bindGradientDefIdToSlot).toHaveBeenCalledWith(
      layer.id,
      23,
      6,
      { minX: 1, minY: 2, width: 3, height: 4 },
      null
    );
    expect(brush.renderDirectToCanvas).toHaveBeenCalledWith(canvas, layer.id);
    expect(updateLayer).toHaveBeenCalledWith(
      layer.id,
      {
        colorCycleData: expect.objectContaining({
          nextGradientDefId: 24,
          gradientDefStore: [
            expect.objectContaining({
              id: 22,
              hash: 'hash-old',
            }),
            expect.objectContaining({
              id: 23,
              hash: 'hash-new',
              slot: 6,
              speedCps: 0.5,
            }),
          ],
        }),
      }
    );

    getStateSpy.mockRestore();
  });

  it('rebinds sampled stroke commits across the full layer to prevent temp-slot leakage', async () => {
    const layer = createLayer();
    const canvas = document.createElement('canvas');
    canvas.width = 8;
    canvas.height = 8;
    layer.layerType = 'color-cycle';
    layer.colorCycleData = {
      canvas,
      hasContent: true,
      gradient: [],
      gradientDefStore: [
        {
          id: 22,
          kind: 'linear',
          stops: [
            { position: 0, color: '#081018' },
            { position: 0.5, color: '#506070' },
            { position: 1, color: '#c0d0e0' },
          ],
          hash: 'hash-sampled',
          source: 'sampled',
          createdAtMs: 1,
          slot: 6,
          speedCps: 0.3,
        },
      ],
    } as Layer['colorCycleData'];

    const updateLayer = jest.fn();
    const setCcGradientSampleCount = jest.fn();
    const getStateSpy = jest.spyOn(useAppStore, 'getState');
    getStateSpy.mockReturnValue({
      layers: [layer],
      updateLayer,
      setCcGradientSampleCount,
      colorCyclePlayback: { desiredPlaying: true, suspendDepth: 0 },
    } as unknown as ReturnType<typeof useAppStore.getState>);

    (finalizeMarkGradientSession as jest.Mock).mockReturnValue({
      markId: 'mark-sampled',
      layerId: layer.id,
      markKind: 'stroke',
      gradientKind: 'linear',
      source: 'sampled',
      frozenStopsStored: [
        { position: 0, color: '#102030' },
        { position: 1, color: '#90a0b0' },
      ],
      frozenHash: 'hash-sampled',
      binding: { kind: 'def', defId: 22, slot: 6 },
      speedCps: 0.3,
      seamProfile: 'soft',
    });

    const brush = makeCommittedBrush(6);

    await commitColorCycleLayerStroke(
      {
        layer,
        drawingCanvas: canvas,
        brushSettings: {
          opacity: 1,
        } as never,
        project: { width: 8, height: 8 },
        strokeBoundingBox: null,
        captureRoi: { x: 2, y: 3, width: 2, height: 2 },
        strokeCapturePadding: 0,
        roiPadding: 0,
        enableCaptureRoi: true,
      },
      {
        getBrushForLayer: () => brush as never,
        bindBrushToCanvas: jest.fn(),
        markLayerHasContent: jest.fn(),
        perfMark: jest.fn(),
        perfMeasure: jest.fn(),
        startFinalizeVisibleTimer: jest.fn(),
        endFinalizeVisibleTimer: jest.fn(),
        dispatchFrameUpdate: jest.fn(),
      }
    );

    expect(brush.setGradientSlotStops).toHaveBeenCalledWith(
      layer.id,
      6,
      [
        { position: 0, color: '#102030' },
        { position: 1, color: '#90a0b0' },
      ],
      'soft'
    );
    expect(brush.bindGradientDefIdToSlot).toHaveBeenCalledWith(
      layer.id,
      22,
      6,
      undefined,
      TEMP_SAMPLE_SLOT
    );
    expect(brush.renderDirectToCanvas).toHaveBeenCalledWith(canvas, layer.id);
    expect(updateLayer).toHaveBeenCalledWith(
      layer.id,
      {
        colorCycleData: expect.objectContaining({
          gradient: [
            expect.objectContaining({ position: 0, color: '#081018' }),
            expect.objectContaining({ position: 0.5, color: '#506070' }),
            expect.objectContaining({ position: 1, color: '#c0d0e0' }),
          ],
          paintSlot: 6,
          isAnimating: true,
          slotPalettes: [
            {
              slot: 6,
              seamProfile: 'soft',
              stops: [
                expect.objectContaining({ position: 0, color: '#081018' }),
                expect.objectContaining({ position: 0.5, color: '#506070' }),
                expect.objectContaining({ position: 1, color: '#c0d0e0' }),
              ],
            },
          ],
        }),
      },
      { skipColorCycleSync: true }
    );
    expect(setCcGradientSampleCount).toHaveBeenCalledWith(0);

    getStateSpy.mockRestore();
  });
});

describe('scheduleDeferredColorCycleSaveWithState', () => {
  it('anchors shape history before a later canonical generation can enter the deferred pipeline', async () => {
    let livePixelVersion = 12;
    const captureColorCycleBrushState = jest.fn((captureLayerId: string) => {
      expect(captureLayerId).toBe('layer-1');
      return {
        pixelVersion: livePixelVersion,
        layers: [],
      } as unknown as ColorCycleSerializedState;
    });
    const scheduleDeferredColorCycleSave = jest.fn(async (options: {
      afterColorState?: ColorCycleSerializedState;
    }) => {
      livePixelVersion = 13;
      const resolvedAfterState = options.afterColorState ?? captureColorCycleBrushState('layer-1');
      expect(resolvedAfterState?.pixelVersion).toBe(12);
    });

    const canvas = document.createElement('canvas');
    canvas.width = 2;
    canvas.height = 2;

    await scheduleDeferredColorCycleSaveWithState(
      {
        layerId: 'layer-1',
        canvas,
        beforeColorState: null,
        actionType: 'fill',
        description: 'CC Shape Linear',
        tool: 'brush',
      },
      {
        scheduleDeferredColorCycleSave,
        captureColorCycleBrushState,
        perfMark: jest.fn(),
        perfMeasure: jest.fn(),
        debugTime: jest.fn(),
        debugTimeEnd: jest.fn(),
      }
    );

    expect(captureColorCycleBrushState).toHaveBeenCalledWith('layer-1');
    expect(scheduleDeferredColorCycleSave).toHaveBeenCalledWith(
      expect.objectContaining({
        layerId: 'layer-1',
        afterColorState: expect.objectContaining({
          pixelVersion: 12,
        }),
        actionType: 'fill',
        description: 'CC Shape Linear',
      })
    );
  });
});

describe('commitBrushHistory', () => {
  it('captures color-cycle after-state before enqueueing deferred brush saves', async () => {
    const scheduleDeferredColorCycleSave = jest.fn(async () => undefined);
    const afterColorState = {
      layers: [
        {
          layerId: 'layer-1',
          strokeData: {
            strokeCounter: 2,
          },
        },
      ],
    } as unknown as ColorCycleSerializedState;
    const captureColorCycleBrushState = jest.fn(() => afterColorState);
    const canvas = document.createElement('canvas');
    canvas.width = 2;
    canvas.height = 2;

    await commitBrushHistory(
      {
        activeLayerId: 'layer-1',
        layerBeforeImage: null,
        layerBeforeColorState: null,
        actionType: 'brush',
        description: 'CC Brush',
        tool: 'brush',
        shouldSkipBitmapDelta: true,
        shouldDeferColorCycleSave: true,
        deferredLayerCanvas: canvas,
        strokeCaptureRoi: { x: 0, y: 0, width: 2, height: 2 },
      },
      {
        scheduleDeferredColorCycleSave,
        scheduleHistoryCommit: jest.fn(async () => undefined),
        captureColorCycleBrushState,
        perfMark: jest.fn(),
        perfMeasure: jest.fn(),
        debugTime: jest.fn(),
        debugTimeEnd: jest.fn(),
        debugVerbose: jest.fn(),
      }
    );

    expect(captureColorCycleBrushState).toHaveBeenCalledWith('layer-1');
    expect(scheduleDeferredColorCycleSave).toHaveBeenCalledWith(
      expect.objectContaining({
        layerId: 'layer-1',
        afterColorState,
        actionType: 'brush',
        description: 'CC Brush',
      })
    );
  });
});
