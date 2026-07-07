import { buildDrawingFinalizeAfterQueueDispatcherArgs } from '@/hooks/canvas/buildDrawingFinalizeAfterQueueDispatcherArgs';
import { buildDrawingFinalizeBrushFlowDepsArgs } from '@/hooks/canvas/buildDrawingFinalizeBrushFlowDepsArgs';
import type { useFinalizeFlowDeps } from '@/hooks/canvas/useFinalizeFlowDeps';
import type { FinalizeFlowArgs, UseDrawingFinalizeRuntimeArgs } from '@/hooks/canvas/useDrawingFinalizeRuntime.types';

type FinalizeFlowDepsOptions = Parameters<typeof useFinalizeFlowDeps>[0];

interface BuildDrawingFinalizeFlowDepsOptions {
  refs: UseDrawingFinalizeRuntimeArgs['refs'];
  storeRef: UseDrawingFinalizeRuntimeArgs['storeRef'];
  brushRuntime: UseDrawingFinalizeRuntimeArgs['brushRuntime'];
  userBrushEngine: UseDrawingFinalizeRuntimeArgs['userBrushEngine'];
  cancelAnimationFrameSafe: FinalizeFlowArgs['finalizeAfterQueueDispatcherArgs']['cancelAnimationFrameSafe'];
  endStrokeSession: UseDrawingFinalizeRuntimeArgs['endStrokeSession'];
  applyFinalizeLostEdge: UseDrawingFinalizeRuntimeArgs['applyFinalizeLostEdge'];
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

export const buildDrawingFinalizeFlowDepsOptions = ({
  refs,
  storeRef,
  brushRuntime,
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
}: BuildDrawingFinalizeFlowDepsOptions): FinalizeFlowDepsOptions => ({
  finalizeAfterQueueDispatcherArgs: buildDrawingFinalizeAfterQueueDispatcherArgs({
    refs,
    brushRuntime,
    userBrushEngine,
    cancelAnimationFrameSafe,
    endStrokeSession,
    applyFinalizeLostEdge,
  }),
  finalizeBrushFlowDepsArgs: buildDrawingFinalizeBrushFlowDepsArgs({
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
  }),
});
