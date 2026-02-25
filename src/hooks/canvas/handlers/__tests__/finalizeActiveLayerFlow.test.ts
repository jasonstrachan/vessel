import { runFinalizeActiveLayerFlow } from '@/hooks/canvas/handlers/finalizeActiveLayerFlow';
import type { AppState } from '@/stores/useAppStore';
import type { Layer } from '@/types';

describe('runFinalizeActiveLayerFlow', () => {
  it('uses eraser ROI override for v2 eraser capture and history commit', async () => {
    const eraserRoi = { x: 10, y: 12, width: 14, height: 9 };
    const captureCanvasToActiveLayer = jest.fn(async () => undefined);
    const scheduleHistoryCommit = jest.fn(async () => undefined);
    const prepareStrokeCapture = jest.fn(async (args: { captureRegionOverride?: typeof eraserRoi | null }) => ({
      captureRoi: args.captureRegionOverride ?? undefined,
      layerBeforeImage: new ImageData(eraserRoi.width, eraserRoi.height),
    }));

    const activeLayer = {
      id: 'layer-1',
      layerType: 'normal',
      imageData: new ImageData(64, 64),
    } as unknown as Layer;

    const drawingCanvas = {
      width: 64,
      height: 64,
      getContext: () => null,
    } as unknown as HTMLCanvasElement;

    await runFinalizeActiveLayerFlow(
      {
        currentState: {
          activeLayerId: activeLayer.id,
          tools: { currentTool: 'eraser' },
        } as unknown as AppState,
        activeLayer,
        currentTool: 'eraser',
        drawingCanvas,
        strokeBeforeImageRef: { current: null },
        strokeBeforeColorStateRef: { current: null },
        activeStrokeSessionRef: { current: null },
        endStrokeSession: jest.fn(),
        maxIntervalMs: 120,
        project: { width: 64, height: 64 },
        overlayHasContent: true,
        strokeBoundingBox: null,
        strokeCapturePadding: 0,
        roiPadding: 0,
        engineStrokeBounds: null,
        lastStrokePoint: { x: 20, y: 20 },
        captureRegionOverride: null,
        skipSave: false,
        historyActionOverride: undefined,
        historyDescriptionOverride: undefined,
        isEraserV2: true,
        eraserRoiRef: { current: eraserRoi },
        applyFinalizeLostEdge: jest.fn(),
        drawingCanvasRef: { current: drawingCanvas },
        drawingCtxRef: { current: null },
        drawingCanvasHasContent: { current: true },
        releaseBusyLock: jest.fn(),
      },
      {
        finalizeLayerCaptureContextDeps: {
          buildStrokeCoalescePayload: () => undefined,
          prepareStrokeCapture,
        },
        finalizeEraserStrokeDeps: {
          captureCanvasToActiveLayer,
          scheduleHistoryCommit,
          withTiming: async (_label, task) => task(),
          logError: jest.fn(),
        },
        finalizeBrushContextDeps: {} as never,
        finalizeColorCycleBrushBaseDeps: {} as never,
        colorCycleCommitDeps: {} as never,
        finalizeRasterFallbackDeps: {} as never,
        finalizePostCommitDeps: {} as never,
      }
    );

    expect(prepareStrokeCapture).toHaveBeenCalledWith(
      expect.objectContaining({
        captureRegionOverride: eraserRoi,
      })
    );
    expect(captureCanvasToActiveLayer).toHaveBeenCalledWith(
      drawingCanvas,
      eraserRoi,
      { mode: 'replace' }
    );
    expect(scheduleHistoryCommit).toHaveBeenCalledWith(
      expect.objectContaining({
        bitmapRoi: eraserRoi,
      })
    );
  });
});
