import type React from 'react';
import {
  createFinalizeBusyLock,
} from '@/hooks/canvas/handlers/finalizeBusyLock';
import {
  resolveFinalizeEntryContext,
  type PendingEraserTool,
} from '@/hooks/canvas/handlers/finalizeEntryContext';
import {
  runFinalizePrelude,
} from '@/hooks/canvas/handlers/finalizePrelude';
import type {
  FinalizeAfterQueueDispatcher,
  RunFinalizeAfterQueueDeps,
} from '@/hooks/canvas/handlers/finalizeAfterQueue';
import type { FinalizeOptionsInput } from '@/hooks/canvas/handlers/finalizeOptions';
import type { AppState } from '@/stores/useAppStore';
import type { CaptureRegion } from '@/hooks/canvas/utils/captureRegions';
import type { CanvasSnapshot, Tool } from '@/types';

export const runFinalizeExecution = async ({
  isBusyRef,
  strokeBatchRef,
  processBatchedStrokes,
  colorCyclePixelQueue,
  isCCLayerSnapshot,
  isCCBrushSnapshot,
  pendingEraserTool,
  eraserToolRef,
  eraserRoiRef,
  snapshot,
  finalizeTool,
  project,
  overlayHasContent,
  captureRegionOverride,
  skipSave,
  historyActionOverride,
  historyDescriptionOverride,
  runIdleAsync,
  finalizeAfterQueueDispatcher,
  finalizeAfterQueueDeps,
}: {
  isBusyRef: React.MutableRefObject<boolean> | undefined;
  strokeBatchRef: Parameters<typeof runFinalizePrelude>[0]['strokeBatchRef'];
  processBatchedStrokes: Parameters<typeof runFinalizePrelude>[0]['processBatchedStrokes'];
  colorCyclePixelQueue: Parameters<typeof runFinalizePrelude>[0]['colorCyclePixelQueue'];
  isCCLayerSnapshot: boolean;
  isCCBrushSnapshot: boolean;
  pendingEraserTool: Parameters<typeof runFinalizePrelude>[0]['pendingEraserTool'];
  eraserToolRef: Parameters<typeof runFinalizePrelude>[0]['eraserToolRef'];
  eraserRoiRef: Parameters<typeof runFinalizePrelude>[0]['eraserRoiRef'];
  snapshot: AppState;
  finalizeTool: Tool | 'eraser';
  project: { width: number; height: number } | null;
  overlayHasContent: boolean;
  captureRegionOverride: CaptureRegion | null;
  skipSave: boolean;
  historyActionOverride?: CanvasSnapshot['actionType'];
  historyDescriptionOverride?: string;
  runIdleAsync: (callback: () => Promise<void>) => Promise<void>;
  finalizeAfterQueueDispatcher: FinalizeAfterQueueDispatcher;
  finalizeAfterQueueDeps: RunFinalizeAfterQueueDeps;
}): Promise<void> => {
  const { release: releaseBusyLock } = createFinalizeBusyLock(isBusyRef);

  try {
    const { shouldAwaitQueueIdle } = await runFinalizePrelude({
      strokeBatchRef,
      processBatchedStrokes,
      colorCyclePixelQueue,
      isCCLayerSnapshot,
      isCCBrushSnapshot,
      pendingEraserTool,
      eraserToolRef,
      eraserRoiRef,
    });
    const finalizeAfterQueue = async () => {
      await finalizeAfterQueueDispatcher({
        snapshot,
        finalizeTool,
        project,
        overlayHasContent,
        captureRegionOverride,
        skipSave,
        historyActionOverride,
        historyDescriptionOverride,
        releaseBusyLock,
      }, finalizeAfterQueueDeps);
    };

    if (shouldAwaitQueueIdle) {
      await runIdleAsync(finalizeAfterQueue);
    } else {
      await finalizeAfterQueue();
    }
  } finally {
    // Always release busy lock even when finalize prelude/dispatch throws.
    releaseBusyLock();
  }
};

export type RunFinalizeExecutionArgs = Parameters<typeof runFinalizeExecution>[0];

export type FinalizeExecutionDispatchArgs = {
  isCCLayerSnapshot: boolean;
  isCCBrushSnapshot: boolean;
  pendingEraserTool: RunFinalizeExecutionArgs['pendingEraserTool'];
  snapshot: AppState;
  finalizeTool: Tool | 'eraser';
  project: { width: number; height: number } | null;
  overlayHasContent: boolean;
  captureRegionOverride: CaptureRegion | null;
  skipSave: boolean;
  historyActionOverride?: CanvasSnapshot['actionType'];
  historyDescriptionOverride?: string;
  finalizeAfterQueueDeps: RunFinalizeExecutionArgs['finalizeAfterQueueDeps'];
};

export type FinalizeExecutionDispatcher = (
  args: FinalizeExecutionDispatchArgs
) => RunFinalizeExecutionArgs;

export const createFinalizeExecutionDispatcher = ({
  isBusyRef,
  strokeBatchRef,
  processBatchedStrokes,
  colorCyclePixelQueue,
  eraserToolRef,
  eraserRoiRef,
  runIdleAsync,
  finalizeAfterQueueDispatcher,
}: {
  isBusyRef: RunFinalizeExecutionArgs['isBusyRef'];
  strokeBatchRef: RunFinalizeExecutionArgs['strokeBatchRef'];
  processBatchedStrokes: RunFinalizeExecutionArgs['processBatchedStrokes'];
  colorCyclePixelQueue: RunFinalizeExecutionArgs['colorCyclePixelQueue'];
  eraserToolRef: RunFinalizeExecutionArgs['eraserToolRef'];
  eraserRoiRef: RunFinalizeExecutionArgs['eraserRoiRef'];
  runIdleAsync: RunFinalizeExecutionArgs['runIdleAsync'];
  finalizeAfterQueueDispatcher: RunFinalizeExecutionArgs['finalizeAfterQueueDispatcher'];
}): FinalizeExecutionDispatcher => ({
  isCCLayerSnapshot,
  isCCBrushSnapshot,
  pendingEraserTool,
  snapshot,
  finalizeTool,
  project,
  overlayHasContent,
  captureRegionOverride,
  skipSave,
  historyActionOverride,
  historyDescriptionOverride,
  finalizeAfterQueueDeps,
}) => ({
  isBusyRef,
  strokeBatchRef,
  processBatchedStrokes,
  colorCyclePixelQueue,
  isCCLayerSnapshot,
  isCCBrushSnapshot,
  pendingEraserTool,
  eraserToolRef,
  eraserRoiRef,
  snapshot,
  finalizeTool,
  project,
  overlayHasContent,
  captureRegionOverride,
  skipSave,
  historyActionOverride,
  historyDescriptionOverride,
  runIdleAsync,
  finalizeAfterQueueDispatcher,
  finalizeAfterQueueDeps,
});

export const runFinalizeDrawingLifecycle = async ({
  executionArgs,
  finalizeDrawingCleanup,
  setPointerDown,
  logError,
}: {
  executionArgs: RunFinalizeExecutionArgs;
  finalizeDrawingCleanup: () => Promise<void>;
  setPointerDown: (isDown: boolean) => void;
  logError: (message: string, error: unknown) => void;
}): Promise<void> => {
  try {
    await runFinalizeExecution(executionArgs);
  } catch (error) {
    logError('Error during finalization:', error);
  } finally {
    await finalizeDrawingCleanup();
    setPointerDown(false);
  }
};

type FinalizeDrawingInput = boolean | FinalizeOptionsInput<CanvasSnapshot['actionType'], CaptureRegion>;

export type FinalizeDrawingDispatcherDeps = {
  storeRef: React.MutableRefObject<AppState>;
  drawingCanvasRef: React.MutableRefObject<HTMLCanvasElement | null>;
  isBusyRef: React.MutableRefObject<boolean> | undefined;
  project: { width: number; height: number } | null;
  isEraserV2: boolean;
  drawingCanvasHasContent: React.MutableRefObject<boolean>;
  eraserToolRef: React.MutableRefObject<PendingEraserTool | null>;
  endMaskHealingStroke: () => void;
  finalizeExecutionDispatcher: FinalizeExecutionDispatcher;
  finalizeAfterQueueDeps: RunFinalizeAfterQueueDeps;
  finalizeDrawingCleanup: () => Promise<void>;
  setPointerDown: (isDown: boolean) => void;
  logError: (message: string, error: unknown) => void;
};

export type FinalizeDrawingDispatcher = (
  skipSaveOrOptions?: FinalizeDrawingInput
) => Promise<void>;

export const createFinalizeDrawingDispatcher = ({
  storeRef,
  drawingCanvasRef,
  isBusyRef,
  project,
  isEraserV2,
  drawingCanvasHasContent,
  eraserToolRef,
  endMaskHealingStroke,
  finalizeExecutionDispatcher,
  finalizeAfterQueueDeps,
  finalizeDrawingCleanup,
  setPointerDown,
  logError,
}: FinalizeDrawingDispatcherDeps): FinalizeDrawingDispatcher => async (skipSaveOrOptions) => {
  const snapshot = storeRef.current;
  const entryContext = resolveFinalizeEntryContext({
    skipSaveOrOptions,
    snapshot,
    hasCanvas: Boolean(drawingCanvasRef.current),
    busy: isBusyRef?.current ?? false,
    project,
    isEraserV2,
    drawingCanvasHasContent: drawingCanvasHasContent.current,
    eraserToolRef,
    endMaskHealingStroke,
  });
  if (!entryContext) {
    return;
  }

  const {
    options,
    skipSave,
    historyActionOverride,
    historyDescriptionOverride,
    isCCLayerSnapshot,
    isCCBrushSnapshot,
    overlayHasContent,
    finalizeTool,
    pendingEraserTool,
  } = entryContext;

  await runFinalizeDrawingLifecycle({
    executionArgs: finalizeExecutionDispatcher({
      isCCLayerSnapshot,
      isCCBrushSnapshot,
      pendingEraserTool,
      snapshot,
      finalizeTool,
      project,
      overlayHasContent,
      captureRegionOverride: options.captureRegionOverride ?? null,
      skipSave,
      historyActionOverride,
      historyDescriptionOverride,
      finalizeAfterQueueDeps,
    }),
    finalizeDrawingCleanup,
    setPointerDown,
    logError,
  });
};
