import { buildDrawingHandlersFinalizeContextOptions } from '@/hooks/canvas/buildDrawingHandlersFinalizeContextOptions';
import { buildDrawingHandlersFinalizeStageRuntimeOptions } from '@/hooks/canvas/buildDrawingHandlersFinalizeStageRuntimeOptions';
import type {
  RuntimeBridgeArgs,
  UseDrawingHandlersRuntimeSetupBridgeOptions,
} from '@/hooks/canvas/useDrawingHandlersRuntimeSetupBridge.types';

interface BuildDrawingHandlersFinalizeRuntimeOptions {
  project: UseDrawingHandlersRuntimeSetupBridgeOptions['project'];
  storeRef: UseDrawingHandlersRuntimeSetupBridgeOptions['storeRef'];
  isBusyRef: UseDrawingHandlersRuntimeSetupBridgeOptions['isBusyRef'];
  captureCanvasToActiveLayer: UseDrawingHandlersRuntimeSetupBridgeOptions['captureCanvasToActiveLayer'];
  withTiming: UseDrawingHandlersRuntimeSetupBridgeOptions['withTiming'];
  debugTime: UseDrawingHandlersRuntimeSetupBridgeOptions['debugTime'];
  debugTimeEnd: UseDrawingHandlersRuntimeSetupBridgeOptions['debugTimeEnd'];
  debugVerbose: UseDrawingHandlersRuntimeSetupBridgeOptions['debugVerbose'];
  brushRuntime: RuntimeBridgeArgs['finalizeRuntimeOptions']['runtimeOptions']['brushRuntime'];
  userBrushEngine: UseDrawingHandlersRuntimeSetupBridgeOptions['userBrushEngine'];
  brushToolRuntime: UseDrawingHandlersRuntimeSetupBridgeOptions['brushToolRuntime'];
  colorCycleRuntime: UseDrawingHandlersRuntimeSetupBridgeOptions['colorCycleRuntime'];
}

export const buildDrawingHandlersFinalizeRuntimeOptions = ({
  project,
  storeRef,
  isBusyRef,
  captureCanvasToActiveLayer,
  withTiming,
  debugTime,
  debugTimeEnd,
  debugVerbose,
  brushRuntime,
  userBrushEngine,
  brushToolRuntime,
  colorCycleRuntime,
}: BuildDrawingHandlersFinalizeRuntimeOptions): RuntimeBridgeArgs['finalizeRuntimeOptions'] => ({
  contextOptions: buildDrawingHandlersFinalizeContextOptions({
    storeRef,
    isBusyRef,
    captureCanvasToActiveLayer,
    withTiming,
    debugTime,
    debugTimeEnd,
    brushToolRuntime,
    colorCycleRuntime,
  }),
  runtimeOptions: buildDrawingHandlersFinalizeStageRuntimeOptions({
    project,
    storeRef,
    isBusyRef,
    debugTime,
    debugTimeEnd,
    debugVerbose,
    brushRuntime,
    userBrushEngine,
    brushToolRuntime,
    colorCycleRuntime,
  }),
});
