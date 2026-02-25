import { bindBrushToCanvas } from '@/hooks/canvas/handlers/colorCycle/colorCycleSurface';
import { dispatchColorCycleFrameUpdate } from '@/hooks/canvas/handlers/colorCycle/scheduleRecompose';
import type {
  FinalizeFlowArgs,
  UseDrawingFinalizeRuntimeArgs,
} from '@/hooks/canvas/useDrawingFinalizeRuntime.types';

interface BuildDrawingFinalizeBrushFlowDepsArgsOptions {
  refs: UseDrawingFinalizeRuntimeArgs['refs'];
  storeRef: UseDrawingFinalizeRuntimeArgs['storeRef'];
  brushEngine: UseDrawingFinalizeRuntimeArgs['brushEngine'];
  computeAutoSampleStops: UseDrawingFinalizeRuntimeArgs['computeAutoSampleStops'];
  clearBrushSamplingPreview: UseDrawingFinalizeRuntimeArgs['clearBrushSamplingPreview'];
  getBrushForLayer: UseDrawingFinalizeRuntimeArgs['getBrushForLayer'];
  getEffectiveColorCyclePlaying: UseDrawingFinalizeRuntimeArgs['getEffectiveColorCyclePlaying'];
  perfMark: UseDrawingFinalizeRuntimeArgs['perfMark'];
  perfMeasure: UseDrawingFinalizeRuntimeArgs['perfMeasure'];
  startFinalizeVisibleTimer: UseDrawingFinalizeRuntimeArgs['startFinalizeVisibleTimer'];
  endFinalizeVisibleTimer: UseDrawingFinalizeRuntimeArgs['endFinalizeVisibleTimer'];
  ccLog: UseDrawingFinalizeRuntimeArgs['ccLog'];
}

export const buildDrawingFinalizeBrushFlowDepsArgs = ({
  refs,
  storeRef,
  brushEngine,
  computeAutoSampleStops,
  clearBrushSamplingPreview,
  getBrushForLayer,
  getEffectiveColorCyclePlaying,
  perfMark,
  perfMeasure,
  startFinalizeVisibleTimer,
  endFinalizeVisibleTimer,
  ccLog,
}: BuildDrawingFinalizeBrushFlowDepsArgsOptions): FinalizeFlowArgs['finalizeBrushFlowDepsArgs'] => ({
  storeRef,
  brushEngine: brushEngine as FinalizeFlowArgs['finalizeBrushFlowDepsArgs']['brushEngine'],
  drawingCanvasHasContent: refs.drawingCanvasHasContent,
  colorCycleAnimationRef: refs.colorCycleAnimationRef,
  brushSamplingPreviewActiveRef: refs.brushSamplingPreviewActiveRef,
  autoSamplePointsRef: refs.autoSamplePointsRef,
  autoSampleLastUpdateRef: refs.autoSampleLastUpdateRef,
  autoSampleLastAppliedHashRef: refs.autoSampleLastAppliedHashRef,
  finalizeInProgressRef: refs.finalizeInProgressRef,
  computeAutoSampleStops,
  clearBrushSamplingPreview,
  getBrushForLayer,
  getEffectiveColorCyclePlaying,
  startPlaybackRef: refs.startPlaybackRef,
  bindBrushToCanvas,
  perfMark,
  perfMeasure,
  startFinalizeVisibleTimer,
  endFinalizeVisibleTimer,
  dispatchColorCycleFrameUpdate,
  ccLog,
});
