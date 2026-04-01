import {
  commitColorCycleLayerStroke,
  commitRasterOverlay,
} from '@/hooks/canvas/handlers/colorCycle/colorCycleCommit';
import { TEMP_SAMPLE_SLOT } from '@/constants/colorCycle';
import { setOverlaySeededFromLayer } from '@/hooks/canvas/utils/overlaySeedState';
import { finalizeMarkGradientSession } from '@/hooks/canvas/utils/colorCycleMarkSession';
import { useAppStore } from '@/stores/useAppStore';
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
      gradientDefStore: [],
    } as Layer['colorCycleData'];

    const updateLayer = jest.fn();
    const setCcGradientSampleCount = jest.fn();
    const getStateSpy = jest.spyOn(useAppStore, 'getState');
    getStateSpy.mockReturnValue({
      layers: [layer],
      updateLayer,
      setCcGradientSampleCount,
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

    const commitCommittedLayerState = jest.fn();
    const brush = {
      commitCurrentStroke: jest.fn(),
      setGradientSlotStops: jest.fn(),
      commitCommittedLayerState,
      getCommittedDimensions: jest.fn(() => ({ width: 8, height: 8 })),
      getCommittedIndexData: jest.fn(() => new Uint8Array(64).fill(1)),
      getCommittedGradientIdData: jest.fn(() => new Uint8Array(64).fill(5)),
      getCommittedPaletteRGBABySlot: jest.fn(() => []),
    };

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

    expect(commitCommittedLayerState).toHaveBeenCalledWith({
      layerId: layer.id,
      targetCanvas: canvas,
      opacity: 0.75,
      binding: {
        defId: 21,
        slot: 5,
        bbox: { minX: 1, minY: 2, width: 3, height: 4 },
        previewSlot: null,
      },
    });
    expect(setCcGradientSampleCount).not.toHaveBeenCalled();

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
      gradientDefStore: [],
    } as Layer['colorCycleData'];

    const updateLayer = jest.fn();
    const setCcGradientSampleCount = jest.fn();
    const getStateSpy = jest.spyOn(useAppStore, 'getState');
    getStateSpy.mockReturnValue({
      layers: [layer],
      updateLayer,
      setCcGradientSampleCount,
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
    });

    const commitCommittedLayerState = jest.fn();
    const brush = {
      commitCurrentStroke: jest.fn(),
      setGradientSlotStops: jest.fn(),
      commitCommittedLayerState,
      getCommittedDimensions: jest.fn(() => ({ width: 8, height: 8 })),
      getCommittedIndexData: jest.fn(() => new Uint8Array(64).fill(1)),
      getCommittedGradientIdData: jest.fn(() => new Uint8Array(64).fill(6)),
      getCommittedPaletteRGBABySlot: jest.fn(() => []),
    };

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

    expect(commitCommittedLayerState).toHaveBeenCalledWith({
      layerId: layer.id,
      targetCanvas: canvas,
      opacity: 1,
      binding: {
        defId: 22,
        slot: 6,
        bbox: undefined,
        previewSlot: TEMP_SAMPLE_SLOT,
      },
    });
    expect(setCcGradientSampleCount).toHaveBeenCalledWith(0);

    getStateSpy.mockRestore();
  });
});
