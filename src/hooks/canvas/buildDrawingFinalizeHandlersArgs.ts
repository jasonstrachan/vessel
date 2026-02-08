import { FF } from '@/config/ccFeatureFlags';
import { runIdleAsync } from '@/hooks/canvas/utils/idle';
import type { useFinalizeDrawingHandlers } from '@/hooks/canvas/useFinalizeDrawingHandlers';
import type { UseDrawingFinalizeRuntimeArgs } from '@/hooks/canvas/useDrawingFinalizeRuntime.types';

type FinalizeDrawingHandlersArgs = Parameters<typeof useFinalizeDrawingHandlers>[0];

interface BuildDrawingFinalizeHandlersArgsOptions {
  refs: UseDrawingFinalizeRuntimeArgs['refs'];
  storeRef: UseDrawingFinalizeRuntimeArgs['storeRef'];
  project: UseDrawingFinalizeRuntimeArgs['project'];
  isBusyRef: UseDrawingFinalizeRuntimeArgs['isBusyRef'];
  processBatchedStrokes: UseDrawingFinalizeRuntimeArgs['processBatchedStrokes'];
  endMaskHealingStroke: UseDrawingFinalizeRuntimeArgs['endMaskHealingStroke'];
  setPointerDown: UseDrawingFinalizeRuntimeArgs['setPointerDown'];
  logError: UseDrawingFinalizeRuntimeArgs['logError'];
  finalizeDrawingCleanupDeps: UseDrawingFinalizeRuntimeArgs['finalizeDrawingCleanupDeps'];
  baseFinalizeAfterQueueDepsArgs: UseDrawingFinalizeRuntimeArgs['baseFinalizeAfterQueueDepsArgs'];
  finalizeColorCycleBrushBaseDeps: FinalizeDrawingHandlersArgs['finalizeAfterQueueDepsArgs']['finalizeColorCycleBrushBaseDeps'];
  colorCycleCommitDeps: FinalizeDrawingHandlersArgs['finalizeAfterQueueDepsArgs']['colorCycleCommitDeps'];
  finalizeRasterFallbackDeps: FinalizeDrawingHandlersArgs['finalizeAfterQueueDepsArgs']['finalizeRasterFallbackDeps'];
  finalizePostCommitDeps: FinalizeDrawingHandlersArgs['finalizeAfterQueueDepsArgs']['finalizePostCommitDeps'];
  finalizeAfterQueueDispatcher: FinalizeDrawingHandlersArgs['finalizeAfterQueueDispatcher'];
}

export const buildDrawingFinalizeHandlersArgs = ({
  refs,
  storeRef,
  project,
  isBusyRef,
  processBatchedStrokes,
  endMaskHealingStroke,
  setPointerDown,
  logError,
  finalizeDrawingCleanupDeps,
  baseFinalizeAfterQueueDepsArgs,
  finalizeColorCycleBrushBaseDeps,
  colorCycleCommitDeps,
  finalizeRasterFallbackDeps,
  finalizePostCommitDeps,
  finalizeAfterQueueDispatcher,
}: BuildDrawingFinalizeHandlersArgsOptions): FinalizeDrawingHandlersArgs => ({
  finalizeAfterQueueDepsArgs: {
    ...baseFinalizeAfterQueueDepsArgs,
    finalizeColorCycleBrushBaseDeps,
    colorCycleCommitDeps,
    finalizeRasterFallbackDeps,
    finalizePostCommitDeps,
  },
  finalizeAfterQueueDispatcher,
  finalizeExecutionDispatcherArgs: {
    isBusyRef,
    strokeBatchRef: refs.strokeBatchRef,
    processBatchedStrokes,
    colorCyclePixelQueue: refs.colorCyclePixelQueue,
    eraserToolRef: refs.eraserToolRef,
    eraserRoiRef: refs.eraserRoiRef,
    runIdleAsync,
  },
  finalizeDrawingDispatcherArgs: {
    storeRef,
    drawingCanvasRef: refs.drawingCanvasRef,
    isBusyRef,
    project,
    isEraserV2: FF.ERASER_V2,
    drawingCanvasHasContent: refs.drawingCanvasHasContent,
    eraserToolRef: refs.eraserToolRef,
    endMaskHealingStroke,
    finalizeDrawingCleanupDeps,
    setPointerDown,
    logError,
  },
});
