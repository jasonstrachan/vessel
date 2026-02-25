import type { useFinalizeCoreDeps } from '@/hooks/canvas/useFinalizeCoreDeps';
import type { useFinalizeFlowDeps } from '@/hooks/canvas/useFinalizeFlowDeps';
import type { useFinalizeDrawingHandlers } from '@/hooks/canvas/useFinalizeDrawingHandlers';
import type { useFinalizeContextDeps } from '@/hooks/canvas/useFinalizeContextDeps';
import type { useDrawingHandlerRefs } from '@/hooks/canvas/useDrawingHandlerRefs';

type DrawingHandlerRefs = ReturnType<typeof useDrawingHandlerRefs>;
type FinalizeDrawingArgs = Parameters<typeof useFinalizeDrawingHandlers>[0];
type FinalizeCoreArgs = Parameters<typeof useFinalizeCoreDeps>[0];
export type FinalizeFlowArgs = Parameters<typeof useFinalizeFlowDeps>[0];
type FinalizeDrawingCleanupDeps = ReturnType<typeof useFinalizeContextDeps>['finalizeDrawingCleanupDeps'];
type BaseFinalizeAfterQueueDepsArgs = Pick<
  FinalizeDrawingArgs['finalizeAfterQueueDepsArgs'],
  'finalizeLayerCaptureContextDeps' | 'finalizeEraserStrokeDeps' | 'finalizeBrushContextDeps'
>;

export type UseDrawingFinalizeRuntimeArgs = {
  refs: DrawingHandlerRefs;
  storeRef: FinalizeCoreArgs['finalizeDepsArgs']['storeRef'];
  project: FinalizeDrawingArgs['finalizeDrawingDispatcherArgs']['project'];
  brushEngine: unknown;
  userBrushEngine: FinalizeFlowArgs['finalizeAfterQueueDispatcherArgs']['userBrushEngine'];
  scheduleDeferredColorCycleSave: FinalizeCoreArgs['commitStrokeHistoryDepsArgs']['scheduleDeferredColorCycleSave'];
  scheduleHistoryCommit: FinalizeCoreArgs['commitStrokeHistoryDepsArgs']['scheduleHistoryCommit'];
  perfMark: FinalizeCoreArgs['commitStrokeHistoryDepsArgs']['perfMark'];
  perfMeasure: FinalizeCoreArgs['commitStrokeHistoryDepsArgs']['perfMeasure'];
  debugTime: FinalizeCoreArgs['commitStrokeHistoryDepsArgs']['debugTime'];
  debugTimeEnd: FinalizeCoreArgs['commitStrokeHistoryDepsArgs']['debugTimeEnd'];
  debugVerbose: FinalizeCoreArgs['commitStrokeHistoryDepsArgs']['debugVerbose'];
  commitRasterOverlay: FinalizeCoreArgs['finalizeDepsArgs']['commitRasterOverlay'];
  logError: FinalizeCoreArgs['finalizeDepsArgs']['logError'];
  endStrokeSession: FinalizeFlowArgs['finalizeAfterQueueDispatcherArgs']['endStrokeSession'];
  applyFinalizeLostEdge: FinalizeFlowArgs['finalizeAfterQueueDispatcherArgs']['applyFinalizeLostEdge'];
  getBrushForLayer: FinalizeFlowArgs['finalizeBrushFlowDepsArgs']['getBrushForLayer'];
  getEffectiveColorCyclePlaying: FinalizeFlowArgs['finalizeBrushFlowDepsArgs']['getEffectiveColorCyclePlaying'];
  computeAutoSampleStops: FinalizeFlowArgs['finalizeBrushFlowDepsArgs']['computeAutoSampleStops'];
  clearBrushSamplingPreview: FinalizeFlowArgs['finalizeBrushFlowDepsArgs']['clearBrushSamplingPreview'];
  startFinalizeVisibleTimer: FinalizeFlowArgs['finalizeBrushFlowDepsArgs']['startFinalizeVisibleTimer'];
  endFinalizeVisibleTimer: FinalizeFlowArgs['finalizeBrushFlowDepsArgs']['endFinalizeVisibleTimer'];
  ccLog: FinalizeFlowArgs['finalizeBrushFlowDepsArgs']['ccLog'];
  baseFinalizeAfterQueueDepsArgs: BaseFinalizeAfterQueueDepsArgs;
  finalizeDrawingCleanupDeps: FinalizeDrawingCleanupDeps;
  isBusyRef: FinalizeDrawingArgs['finalizeExecutionDispatcherArgs']['isBusyRef'];
  processBatchedStrokes: FinalizeDrawingArgs['finalizeExecutionDispatcherArgs']['processBatchedStrokes'];
  endMaskHealingStroke: FinalizeDrawingArgs['finalizeDrawingDispatcherArgs']['endMaskHealingStroke'];
  setPointerDown: FinalizeDrawingArgs['finalizeDrawingDispatcherArgs']['setPointerDown'];
};
