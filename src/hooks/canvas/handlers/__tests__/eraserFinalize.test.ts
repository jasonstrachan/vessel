import { finalizeEraserStroke } from '@/hooks/canvas/handlers/eraserFinalize';
import type { LayerHistoryPayload } from '@/history/helpers/layerHistory';
import type { Layer } from '@/types';

const createLayer = (id: string): Layer =>
  ({
    id,
    layerType: 'normal',
  } as unknown as Layer);

const getFirstHistoryPayload = (commitSpy: jest.Mock): LayerHistoryPayload =>
  commitSpy.mock.calls[0][0] as LayerHistoryPayload;

describe('finalizeEraserStroke history ROI alignment', () => {
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
});
