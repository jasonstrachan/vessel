import { createColorCycleStrokeCommitDeps } from '@/hooks/canvas/handlers/colorCycle/colorCycleStrokeCommit';
import {
  createFinalizeColorCycleBrushBaseDeps,
} from '@/hooks/canvas/handlers/colorCycle/colorCycleFinalizeDeps';

export const createFinalizeBrushFlowDeps = ({
  storeRef,
  brushEngine,
  drawingCanvasHasContent,
  colorCycleAnimationRef,
  brushSamplingPreviewActiveRef,
  autoSamplePointsRef,
  autoSampleLastUpdateRef,
  autoSampleLastAppliedHashRef,
  finalizeInProgressRef,
  computeAutoSampleStops,
  clearBrushSamplingPreview,
  getBrushForLayer,
  getEffectiveColorCyclePlaying,
  startPlaybackRef,
  bindBrushToCanvas,
  perfMark,
  perfMeasure,
  startFinalizeVisibleTimer,
  endFinalizeVisibleTimer,
  dispatchColorCycleFrameUpdate,
  ccLog,
}: {
  storeRef: Parameters<typeof createColorCycleStrokeCommitDeps>[0]['storeRef'];
  brushEngine: Parameters<typeof createFinalizeColorCycleBrushBaseDeps>[0]['brushEngine'];
  drawingCanvasHasContent: Parameters<typeof createFinalizeColorCycleBrushBaseDeps>[0]['drawingCanvasHasContent'];
  colorCycleAnimationRef: Parameters<typeof createFinalizeColorCycleBrushBaseDeps>[0]['colorCycleAnimationRef'];
  brushSamplingPreviewActiveRef: Parameters<typeof createFinalizeColorCycleBrushBaseDeps>[0]['brushSamplingPreviewActiveRef'];
  autoSamplePointsRef: Parameters<typeof createFinalizeColorCycleBrushBaseDeps>[0]['autoSamplePointsRef'];
  autoSampleLastUpdateRef: Parameters<typeof createFinalizeColorCycleBrushBaseDeps>[0]['autoSampleLastUpdateRef'];
  autoSampleLastAppliedHashRef: Parameters<typeof createFinalizeColorCycleBrushBaseDeps>[0]['autoSampleLastAppliedHashRef'];
  finalizeInProgressRef: NonNullable<
    Parameters<typeof createFinalizeColorCycleBrushBaseDeps>[0]['finalizeInProgressRef']
  >;
  computeAutoSampleStops: Parameters<typeof createFinalizeColorCycleBrushBaseDeps>[0]['computeAutoSampleStops'];
  clearBrushSamplingPreview: Parameters<typeof createFinalizeColorCycleBrushBaseDeps>[0]['clearBrushSamplingPreview'];
  getBrushForLayer: Parameters<typeof createFinalizeColorCycleBrushBaseDeps>[0]['getBrushForLayer'];
  getEffectiveColorCyclePlaying: Parameters<typeof createFinalizeColorCycleBrushBaseDeps>[0]['getEffectiveColorCyclePlaying'];
  startPlaybackRef: Parameters<typeof createFinalizeColorCycleBrushBaseDeps>[0]['startPlaybackRef'];
  bindBrushToCanvas: Parameters<typeof createColorCycleStrokeCommitDeps>[0]['bindBrushToCanvas'];
  perfMark: Parameters<typeof createColorCycleStrokeCommitDeps>[0]['perfMark'];
  perfMeasure: Parameters<typeof createColorCycleStrokeCommitDeps>[0]['perfMeasure'];
  startFinalizeVisibleTimer: Parameters<typeof createColorCycleStrokeCommitDeps>[0]['startFinalizeVisibleTimer'];
  endFinalizeVisibleTimer: Parameters<typeof createColorCycleStrokeCommitDeps>[0]['endFinalizeVisibleTimer'];
  dispatchColorCycleFrameUpdate: Parameters<typeof createColorCycleStrokeCommitDeps>[0]['dispatchColorCycleFrameUpdate'];
  ccLog: Parameters<typeof createColorCycleStrokeCommitDeps>[0]['ccLog'];
}) => ({
  finalizeColorCycleBrushBaseDeps: createFinalizeColorCycleBrushBaseDeps({
    storeRef,
    brushEngine,
    drawingCanvasHasContent,
    colorCycleAnimationRef,
    brushSamplingPreviewActiveRef,
    autoSamplePointsRef,
    autoSampleLastUpdateRef,
    autoSampleLastAppliedHashRef,
    finalizeInProgressRef,
    computeAutoSampleStops,
    clearBrushSamplingPreview,
    getBrushForLayer,
    getEffectiveColorCyclePlaying,
    startPlaybackRef,
  }),
  colorCycleCommitDeps: createColorCycleStrokeCommitDeps({
    storeRef,
    getBrushForLayer,
    bindBrushToCanvas,
    perfMark,
    perfMeasure,
    startFinalizeVisibleTimer,
    endFinalizeVisibleTimer,
    dispatchColorCycleFrameUpdate,
    ccLog,
  }),
});
