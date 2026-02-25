import { buildDrawingHandlersStrokeRuntimeOptions } from '@/hooks/canvas/buildDrawingHandlersStrokeRuntimeOptions';
import { buildDrawingHandlersStrokeStartRuntimeOptions } from '@/hooks/canvas/buildDrawingHandlersStrokeStartRuntimeOptions';
import type {
  RuntimeBridgeArgs,
  UseDrawingHandlersRuntimeSetupBridgeOptions,
} from '@/hooks/canvas/useDrawingHandlersRuntimeSetupBridge.types';

interface BuildDrawingHandlersStrokeLifecycleOptions {
  project: UseDrawingHandlersRuntimeSetupBridgeOptions['project'];
  storeRef: UseDrawingHandlersRuntimeSetupBridgeOptions['storeRef'];
  sampleColorAt: UseDrawingHandlersRuntimeSetupBridgeOptions['sampleColorAt'];
  debugVerbose: UseDrawingHandlersRuntimeSetupBridgeOptions['debugVerbose'];
  brushEngine: UseDrawingHandlersRuntimeSetupBridgeOptions['brushEngine'];
  userBrushEngine: UseDrawingHandlersRuntimeSetupBridgeOptions['userBrushEngine'];
  shapeRuntime: UseDrawingHandlersRuntimeSetupBridgeOptions['shapeRuntime'];
  brushToolRuntime: UseDrawingHandlersRuntimeSetupBridgeOptions['brushToolRuntime'];
  colorCycleRuntime: UseDrawingHandlersRuntimeSetupBridgeOptions['colorCycleRuntime'];
}

export const buildDrawingHandlersStrokeLifecycleOptions = ({
  project,
  storeRef,
  sampleColorAt,
  debugVerbose,
  brushEngine,
  userBrushEngine,
  shapeRuntime,
  brushToolRuntime,
  colorCycleRuntime,
}: BuildDrawingHandlersStrokeLifecycleOptions): RuntimeBridgeArgs['strokeLifecycleOptions'] => ({
  startRuntimeOptions: buildDrawingHandlersStrokeStartRuntimeOptions({
    project,
    storeRef,
    sampleColorAt,
    debugVerbose,
    brushEngine,
    userBrushEngine,
    shapeRuntime,
    brushToolRuntime,
    colorCycleRuntime,
  }),
  strokeRuntimeOptions: buildDrawingHandlersStrokeRuntimeOptions({
    project,
    storeRef,
    brushEngine,
    userBrushEngine,
    shapeRuntime,
    brushToolRuntime,
    colorCycleRuntime,
  }),
});
