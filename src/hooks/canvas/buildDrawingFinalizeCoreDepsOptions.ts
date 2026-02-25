import {
  buildDrawingFinalizeCommitStrokeHistoryDepsArgs,
  buildDrawingFinalizeDepsArgs,
} from '@/hooks/canvas/buildDrawingFinalizeCoreDepsArgs';
import type { useFinalizeCoreDeps } from '@/hooks/canvas/useFinalizeCoreDeps';
import type { UseDrawingFinalizeRuntimeArgs } from '@/hooks/canvas/useDrawingFinalizeRuntime.types';

type FinalizeCoreDepsOptions = Parameters<typeof useFinalizeCoreDeps>[0];

interface BuildDrawingFinalizeCoreDepsOptions {
  refs: UseDrawingFinalizeRuntimeArgs['refs'];
  storeRef: UseDrawingFinalizeRuntimeArgs['storeRef'];
  scheduleDeferredColorCycleSave: UseDrawingFinalizeRuntimeArgs['scheduleDeferredColorCycleSave'];
  scheduleHistoryCommit: UseDrawingFinalizeRuntimeArgs['scheduleHistoryCommit'];
  perfMark: UseDrawingFinalizeRuntimeArgs['perfMark'];
  perfMeasure: UseDrawingFinalizeRuntimeArgs['perfMeasure'];
  debugTime: UseDrawingFinalizeRuntimeArgs['debugTime'];
  debugTimeEnd: UseDrawingFinalizeRuntimeArgs['debugTimeEnd'];
  debugVerbose: UseDrawingFinalizeRuntimeArgs['debugVerbose'];
  commitRasterOverlay: UseDrawingFinalizeRuntimeArgs['commitRasterOverlay'];
  logError: UseDrawingFinalizeRuntimeArgs['logError'];
}

export const buildDrawingFinalizeCoreDepsOptions = ({
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
}: BuildDrawingFinalizeCoreDepsOptions): FinalizeCoreDepsOptions => ({
  commitStrokeHistoryDepsArgs: buildDrawingFinalizeCommitStrokeHistoryDepsArgs({
    scheduleDeferredColorCycleSave,
    scheduleHistoryCommit,
    perfMark,
    perfMeasure,
    debugTime,
    debugTimeEnd,
    debugVerbose,
  }),
  finalizeDepsArgs: buildDrawingFinalizeDepsArgs({
    refs,
    storeRef,
    commitRasterOverlay,
    logError,
  }),
});
