import { finalizeEraserStroke } from '@/hooks/canvas/handlers/eraserFinalize';
import type { LayerHistoryPayload } from '@/history/helpers/layerHistory';
import historyManager from '@/history/historyService';
import { clearSequentialLayerRendererAll, getSequentialLayerRenderCanvas } from '@/lib/sequential/SequentialLayerRenderer';
import { useAppStore } from '@/stores/useAppStore';
import { BrushShape, type Layer } from '@/types';
import { createDefaultLayerAlignment } from '@/utils/layoutDefaults';

const createLayer = (id: string): Layer =>
  ({
    id,
    layerType: 'normal',
  } as unknown as Layer);

const getFirstHistoryPayload = (commitSpy: jest.Mock): LayerHistoryPayload =>
  commitSpy.mock.calls[0][0] as LayerHistoryPayload;

describe('finalizeEraserStroke history ROI alignment', () => {
  beforeEach(() => {
    historyManager.clear();
    clearSequentialLayerRendererAll();
  });

  it('uses capture ROI when before-image snapshot matches capture ROI dimensions', async () => {
    const scheduleHistoryCommit = jest.fn(async () => undefined);
    const captureCanvasToActiveLayer = jest.fn(async () => undefined);

    await finalizeEraserStroke(
      {
        activeLayer: createLayer('layer-1'),
        activeLayerId: 'layer-1',
        drawingCanvas: { width: 64, height: 64 } as HTMLCanvasElement,
        layerBeforeImage: new ImageData(10, 10),
        layerBeforeColorState: null,
        captureRoi: { x: 20, y: 20, width: 10, height: 10 },
        eraserRoi: { x: 22, y: 22, width: 8, height: 8 },
        isEraserV2: true,
        skipSave: false,
      },
      {
        captureCanvasToActiveLayer,
        scheduleHistoryCommit,
        withTiming: async (_label, task) => task(),
        logError: jest.fn(),
      }
    );

    const payload = getFirstHistoryPayload(scheduleHistoryCommit as unknown as jest.Mock);
    expect(payload.bitmapRoi).toEqual({ x: 20, y: 20, width: 10, height: 10 });
  });

  it('drops bitmap ROI when before-image dimensions match neither ROI', async () => {
    const scheduleHistoryCommit = jest.fn(async () => undefined);

    await finalizeEraserStroke(
      {
        activeLayer: createLayer('layer-2'),
        activeLayerId: 'layer-2',
        drawingCanvas: { width: 64, height: 64 } as HTMLCanvasElement,
        layerBeforeImage: new ImageData(9, 9),
        layerBeforeColorState: null,
        captureRoi: { x: 20, y: 20, width: 10, height: 10 },
        eraserRoi: { x: 22, y: 22, width: 8, height: 8 },
        isEraserV2: true,
        skipSave: false,
      },
      {
        captureCanvasToActiveLayer: jest.fn(async () => undefined),
        scheduleHistoryCommit,
        withTiming: async (_label, task) => task(),
        logError: jest.fn(),
      }
    );

    const payload = getFirstHistoryPayload(scheduleHistoryCommit as unknown as jest.Mock);
    expect(payload.bitmapRoi).toBeUndefined();
  });

  it('awaits eraser history commit before finalize resolves', async () => {
    let releaseCommit: () => void = () => undefined;
    const commitGate = new Promise<void>((resolve) => {
      releaseCommit = () => resolve();
    });
    const scheduleHistoryCommit = jest.fn(
      () => commitGate
    );

    let finalizeResolved = false;
    const finalizePromise = finalizeEraserStroke(
      {
        activeLayer: createLayer('layer-3'),
        activeLayerId: 'layer-3',
        drawingCanvas: { width: 64, height: 64 } as HTMLCanvasElement,
        layerBeforeImage: new ImageData(8, 8),
        layerBeforeColorState: null,
        captureRoi: { x: 1, y: 1, width: 8, height: 8 },
        eraserRoi: { x: 1, y: 1, width: 8, height: 8 },
        isEraserV2: true,
        skipSave: false,
      },
      {
        captureCanvasToActiveLayer: jest.fn(async () => undefined),
        scheduleHistoryCommit,
        withTiming: async (_label, task) => task(),
        logError: jest.fn(),
      }
    ).then(() => {
      finalizeResolved = true;
    });

    for (let i = 0; i < 5 && scheduleHistoryCommit.mock.calls.length === 0; i += 1) {
      await Promise.resolve();
    }
    expect(scheduleHistoryCommit).toHaveBeenCalledTimes(1);
    expect(finalizeResolved).toBe(false);

    releaseCommit();
    await finalizePromise;
    expect(finalizeResolved).toBe(true);
  });

  it('commits sequential eraser edits as undoable frame events', async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 4;
    canvas.height = 4;

    const layer: Layer = {
      id: 'layer-seq',
      name: 'Sequence',
      visible: true,
      opacity: 1,
      blendMode: 'source-over',
      locked: false,
      order: 0,
      imageData: null,
      framebuffer: canvas,
      alignment: createDefaultLayerAlignment(),
      layerType: 'sequential',
      sequentialData: {
        frameCount: 1,
        fps: 12,
        durationMs: 83,
        events: [
          {
            id: 'event-before',
            layerId: 'layer-seq',
            strokeId: 'stroke-before',
            timestampMs: 0,
            frameIndex: 0,
            brush: {
              tool: 'brush',
              brushShape: BrushShape.SQUARE,
              size: 4,
              opacity: 1,
              blendMode: 'source-over',
              rotation: 0,
              spacing: 1,
              color: '#000000',
            },
            stamps: [{ x: 2, y: 2, pressure: 1, rotation: 0, size: 4, alpha: 1 }],
          },
        ],
      },
    };

    useAppStore.setState((state) => ({
      ...state,
      project: state.project
        ? { ...state.project, width: 4, height: 4, layers: [layer] }
        : state.project,
      layers: [layer],
      activeLayerId: layer.id,
      sequentialRecord: {
        ...state.sequentialRecord,
        currentFrame: 0,
      },
      history: {
        ...state.history,
        undoStack: [],
        redoStack: [],
      },
    }));

    const drawingCanvas = document.createElement('canvas');
    drawingCanvas.width = 4;
    drawingCanvas.height = 4;
    const beforeCanvas = getSequentialLayerRenderCanvas({
      layer,
      width: 4,
      height: 4,
      frameIndex: 0,
      holdPreviousOnEmptyFrames: false,
    });
    const drawingCtx = drawingCanvas.getContext('2d', { willReadFrequently: true });
    expect(beforeCanvas).not.toBeNull();
    expect(drawingCtx).not.toBeNull();
    drawingCtx!.drawImage(beforeCanvas as CanvasImageSource, 0, 0);
    drawingCtx!.clearRect(1, 1, 1, 1);

    const committed = await finalizeEraserStroke(
      {
        activeLayer: layer,
        activeLayerId: layer.id,
        drawingCanvas,
        layerBeforeImage: null,
        layerBeforeColorState: null,
        captureRoi: { x: 1, y: 1, width: 1, height: 1 },
        eraserRoi: { x: 1, y: 1, width: 1, height: 1 },
        isEraserV2: false,
        skipSave: false,
      },
      {
        captureCanvasToActiveLayer: jest.fn(async () => undefined),
        scheduleHistoryCommit: jest.fn(async () => undefined),
        withTiming: async (_label, task) => task(),
        logError: jest.fn(),
      }
    );

    expect(committed).toBe(true);
    const afterFinalize = useAppStore.getState().layers.find((entry) => entry.id === layer.id);
    expect(afterFinalize?.sequentialData?.events).toHaveLength(2);
    expect(historyManager.entries()).toHaveLength(1);
    const renderedAfterFinalize = getSequentialLayerRenderCanvas({
      layer: afterFinalize!,
      width: 4,
      height: 4,
      frameIndex: 0,
      holdPreviousOnEmptyFrames: false,
    });
    const renderedCtx = renderedAfterFinalize?.getContext('2d', { willReadFrequently: true });
    expect(renderedCtx).toBeTruthy();
    if (!renderedCtx || !('getImageData' in renderedCtx)) {
      throw new Error('Expected a 2d rendering context with getImageData');
    }
    expect(renderedCtx.getImageData(1, 1, 1, 1).data[3]).toBe(0);

    await useAppStore.getState().undo();
    const afterUndo = useAppStore.getState().layers.find((entry) => entry.id === layer.id);
    expect(afterUndo?.sequentialData?.events).toHaveLength(1);
  });
});
