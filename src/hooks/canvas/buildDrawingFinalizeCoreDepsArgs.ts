import { clearFinalizeOverlayIfNeeded } from '@/hooks/canvas/handlers/finalizeOverlayClear';
import { captureColorCycleBrushState } from '@/history/helpers/colorCycle';
import type { useFinalizeCoreDeps } from '@/hooks/canvas/useFinalizeCoreDeps';
import type { UseDrawingFinalizeRuntimeArgs } from '@/hooks/canvas/useDrawingFinalizeRuntime.types';

type FinalizeCoreDepsArgs = Parameters<typeof useFinalizeCoreDeps>[0];

interface BuildDrawingFinalizeCommitStrokeHistoryDepsArgsOptions {
  scheduleDeferredColorCycleSave: UseDrawingFinalizeRuntimeArgs['scheduleDeferredColorCycleSave'];
  scheduleHistoryCommit: UseDrawingFinalizeRuntimeArgs['scheduleHistoryCommit'];
  perfMark: UseDrawingFinalizeRuntimeArgs['perfMark'];
  perfMeasure: UseDrawingFinalizeRuntimeArgs['perfMeasure'];
  debugTime: UseDrawingFinalizeRuntimeArgs['debugTime'];
  debugTimeEnd: UseDrawingFinalizeRuntimeArgs['debugTimeEnd'];
  debugVerbose: UseDrawingFinalizeRuntimeArgs['debugVerbose'];
}

interface BuildDrawingFinalizeDepsArgsOptions {
  refs: UseDrawingFinalizeRuntimeArgs['refs'];
  storeRef: UseDrawingFinalizeRuntimeArgs['storeRef'];
  commitRasterOverlay: UseDrawingFinalizeRuntimeArgs['commitRasterOverlay'];
  logError: UseDrawingFinalizeRuntimeArgs['logError'];
}

export const buildDrawingFinalizeCommitStrokeHistoryDepsArgs = ({
  scheduleDeferredColorCycleSave,
  scheduleHistoryCommit,
  perfMark,
  perfMeasure,
  debugTime,
  debugTimeEnd,
  debugVerbose,
}: BuildDrawingFinalizeCommitStrokeHistoryDepsArgsOptions): FinalizeCoreDepsArgs['commitStrokeHistoryDepsArgs'] => ({
  scheduleDeferredColorCycleSave,
  scheduleHistoryCommit,
  captureColorCycleBrushState,
  perfMark,
  perfMeasure,
  debugTime,
  debugTimeEnd,
  debugVerbose,
});

export const buildDrawingFinalizeDepsArgs = ({
  refs,
  storeRef,
  commitRasterOverlay,
  logError,
}: BuildDrawingFinalizeDepsArgsOptions): FinalizeCoreDepsArgs['finalizeDepsArgs'] => ({
  clearFinalizeOverlayIfNeeded,
  logError,
  drawingCtxRef: refs.drawingCtxRef,
  drawingCanvasRef: refs.drawingCanvasRef,
  storeRef,
  shapePointsRef: refs.shapePointsRef,
  commitRasterOverlay,
});
