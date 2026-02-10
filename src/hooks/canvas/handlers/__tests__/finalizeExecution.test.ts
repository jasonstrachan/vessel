import { runFinalizeExecution } from '@/hooks/canvas/handlers/finalizeExecution';
import type { AppState } from '@/stores/useAppStore';

describe('runFinalizeExecution', () => {
  const createState = (): AppState => {
    return {
      sequentialRecord: {} as AppState['sequentialRecord'],
    } as AppState;
  };

  it('releases busy lock when finalize dispatcher throws', async () => {
    const isBusyRef = { current: false };

    await expect(
      runFinalizeExecution({
        isBusyRef,
        strokeBatchRef: { current: [] },
        processBatchedStrokes: jest.fn(),
        colorCyclePixelQueue: { current: null },
        isCCLayerSnapshot: false,
        isCCBrushSnapshot: false,
        pendingEraserTool: null,
        eraserToolRef: { current: null },
        eraserRoiRef: { current: null },
        snapshot: createState(),
        finalizeTool: 'brush',
        project: { width: 16, height: 16 },
        overlayHasContent: true,
        captureRegionOverride: null,
        skipSave: false,
        historyActionOverride: undefined,
        historyDescriptionOverride: undefined,
        runIdleAsync: async (callback) => callback(),
        finalizeAfterQueueDispatcher: async () => {
          throw new Error('boom');
        },
        finalizeAfterQueueDeps: {} as Parameters<typeof runFinalizeExecution>[0]['finalizeAfterQueueDeps'],
      })
    ).rejects.toThrow('boom');

    expect(isBusyRef.current).toBe(false);
  });
});
