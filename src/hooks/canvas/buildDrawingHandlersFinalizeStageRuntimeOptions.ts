import { ccLog } from '@/debug/ccDebug';
import { perfMark, perfMeasure } from '@/utils/perf/ccPerfProbe';
import { logError } from '@/utils/debug';
import type {
  FinalizeRuntimeOptions,
  RuntimeBridgeArgs,
  UseDrawingHandlersRuntimeSetupBridgeOptions,
} from '@/hooks/canvas/useDrawingHandlersRuntimeSetupBridge.types';

interface BuildDrawingHandlersFinalizeStageRuntimeOptions {
  project: UseDrawingHandlersRuntimeSetupBridgeOptions['project'];
  storeRef: UseDrawingHandlersRuntimeSetupBridgeOptions['storeRef'];
  isBusyRef: UseDrawingHandlersRuntimeSetupBridgeOptions['isBusyRef'];
  debugTime: UseDrawingHandlersRuntimeSetupBridgeOptions['debugTime'];
  debugTimeEnd: UseDrawingHandlersRuntimeSetupBridgeOptions['debugTimeEnd'];
  debugVerbose: UseDrawingHandlersRuntimeSetupBridgeOptions['debugVerbose'];
  brushEngine: UseDrawingHandlersRuntimeSetupBridgeOptions['brushEngine'];
  userBrushEngine: UseDrawingHandlersRuntimeSetupBridgeOptions['userBrushEngine'];
  brushToolRuntime: UseDrawingHandlersRuntimeSetupBridgeOptions['brushToolRuntime'];
  colorCycleRuntime: UseDrawingHandlersRuntimeSetupBridgeOptions['colorCycleRuntime'];
}

export const buildDrawingHandlersFinalizeStageRuntimeOptions = ({
  project,
  storeRef,
  isBusyRef,
  debugTime,
  debugTimeEnd,
  debugVerbose,
  brushEngine,
  userBrushEngine,
  brushToolRuntime,
  colorCycleRuntime,
}: BuildDrawingHandlersFinalizeStageRuntimeOptions): RuntimeBridgeArgs['finalizeRuntimeOptions']['runtimeOptions'] => ({
  storeRef,
  project,
  brushEngine: brushEngine as FinalizeRuntimeOptions['brushEngine'],
  userBrushEngine: userBrushEngine as unknown as FinalizeRuntimeOptions['userBrushEngine'],
  scheduleDeferredColorCycleSave: colorCycleRuntime.scheduleDeferredColorCycleSave,
  scheduleHistoryCommit: colorCycleRuntime.scheduleHistoryCommit,
  perfMark,
  perfMeasure,
  debugTime,
  debugTimeEnd,
  debugVerbose,
  commitRasterOverlay: colorCycleRuntime.commitRasterOverlay,
  logError,
  endStrokeSession: brushToolRuntime.endStrokeSession,
  getBrushForLayer: colorCycleRuntime.getBrushForLayer,
  getEffectiveColorCyclePlaying: colorCycleRuntime.getEffectiveColorCyclePlaying,
  computeAutoSampleStops: colorCycleRuntime.computeAutoSampleStops,
  clearBrushSamplingPreview: colorCycleRuntime.clearBrushSamplingPreview,
  ccLog,
  isBusyRef,
  endMaskHealingStroke: brushToolRuntime.endMaskHealingStroke,
});
