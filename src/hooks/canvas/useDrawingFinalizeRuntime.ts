import { useFinalizeCoreDeps } from '@/hooks/canvas/useFinalizeCoreDeps';
import { useFinalizeFlowDeps } from '@/hooks/canvas/useFinalizeFlowDeps';
import { useFinalizeDrawingHandlers } from '@/hooks/canvas/useFinalizeDrawingHandlers';
import { buildDrawingFinalizeCoreDepsOptions } from '@/hooks/canvas/buildDrawingFinalizeCoreDepsOptions';
import { buildDrawingFinalizeFlowDepsOptions } from '@/hooks/canvas/buildDrawingFinalizeFlowDepsOptions';
import { buildDrawingFinalizeHandlersArgs } from '@/hooks/canvas/buildDrawingFinalizeHandlersArgs';
import { getCancelAnimationFrameSafe } from '@/hooks/canvas/getCancelAnimationFrameSafe';
import type { FinalizeFlowArgs, UseDrawingFinalizeRuntimeArgs } from '@/hooks/canvas/useDrawingFinalizeRuntime.types';

export const useDrawingFinalizeRuntime = ({
  refs,
  storeRef,
  project,
  brushEngine,
  userBrushEngine,
  scheduleDeferredColorCycleSave,
  scheduleHistoryCommit,
  perfMark,
  perfMeasure,
  debugTime,
  debugTimeEnd,
  debugVerbose,
  commitRasterOverlay,
  logError,
  endStrokeSession,
  applyFinalizeLostEdge,
  getBrushForLayer,
  getEffectiveColorCyclePlaying,
  computeAutoSampleStops,
  clearBrushSamplingPreview,
  startFinalizeVisibleTimer,
  endFinalizeVisibleTimer,
  ccLog,
  baseFinalizeAfterQueueDepsArgs,
  finalizeDrawingCleanupDeps,
  isBusyRef,
  processBatchedStrokes,
  endMaskHealingStroke,
  setPointerDown,
}: UseDrawingFinalizeRuntimeArgs) => {
  const cancelAnimationFrameSafe: FinalizeFlowArgs['finalizeAfterQueueDispatcherArgs']['cancelAnimationFrameSafe'] =
    getCancelAnimationFrameSafe();

  const { finalizePostCommitDeps, finalizeRasterFallbackDeps } = useFinalizeCoreDeps(
    buildDrawingFinalizeCoreDepsOptions({
      refs,
      storeRef,
      scheduleDeferredColorCycleSave,
      scheduleHistoryCommit,
      perfMark,
      perfMeasure,
      debugTime,
      debugTimeEnd,
      debugVerbose,
      commitRasterOverlay,
      logError,
    })
  );

  const {
    finalizeAfterQueueDispatcher,
    finalizeColorCycleBrushBaseDeps,
    colorCycleCommitDeps,
  } = useFinalizeFlowDeps(
    buildDrawingFinalizeFlowDepsOptions({
      refs,
      storeRef,
      brushEngine,
      userBrushEngine,
      cancelAnimationFrameSafe,
      endStrokeSession,
      applyFinalizeLostEdge,
      computeAutoSampleStops,
      clearBrushSamplingPreview,
      getBrushForLayer,
      getEffectiveColorCyclePlaying,
      perfMark,
      perfMeasure,
      startFinalizeVisibleTimer,
      endFinalizeVisibleTimer,
      ccLog,
    })
  );

  return useFinalizeDrawingHandlers(
    buildDrawingFinalizeHandlersArgs({
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
    })
  );
};
