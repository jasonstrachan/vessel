import { bindBrushToCanvas } from '@/hooks/canvas/handlers/colorCycle/colorCycleSurface';
import { dispatchColorCycleFrameUpdate } from '@/hooks/canvas/handlers/colorCycle/scheduleRecompose';
import type {
  FinalizeFlowArgs,
  UseDrawingFinalizeRuntimeArgs,
} from '@/hooks/canvas/useDrawingFinalizeRuntime.types';

interface BuildDrawingFinalizeBrushFlowDepsArgsOptions {
  refs: UseDrawingFinalizeRuntimeArgs['refs'];
  storeRef: UseDrawingFinalizeRuntimeArgs['storeRef'];
  brushRuntime: FinalizeColorCycleRuntime;
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

type FinalizeColorCycleRuntime = FinalizeFlowArgs['finalizeBrushFlowDepsArgs']['brushRuntime'];

export const buildDrawingFinalizeBrushFlowDepsArgs = ({
  refs,
  storeRef,
  brushRuntime,
  computeAutoSampleStops,
  clearBrushSamplingPreview,
  getBrushForLayer,
  getEffectiveColorCyclePlaying,
  perfMark,
  perfMeasure,
  startFinalizeVisibleTimer,
  endFinalizeVisibleTimer,
  ccLog,
}: BuildDrawingFinalizeBrushFlowDepsArgsOptions): FinalizeFlowArgs['finalizeBrushFlowDepsArgs'] => {
  return {
    storeRef,
    brushRuntime: {
      endColorCycleStroke: () => brushRuntime.endColorCycleStroke(),
      renderColorCycle: (ctx, applyOpacity) => brushRuntime.renderColorCycle(ctx, applyOpacity),
      updateColorCycleGradient: (stops) => brushRuntime.updateColorCycleGradient?.(stops),
    },
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
  };
};
