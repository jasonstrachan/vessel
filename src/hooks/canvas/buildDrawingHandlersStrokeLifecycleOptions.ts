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
  brushRuntime: RuntimeBridgeArgs['strokeLifecycleOptions']['startRuntimeOptions']['brushRuntime'];
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
  brushRuntime,
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
    brushRuntime,
    userBrushEngine,
    shapeRuntime,
    brushToolRuntime,
    colorCycleRuntime,
  }),
  strokeRuntimeOptions: buildDrawingHandlersStrokeRuntimeOptions({
    project,
    storeRef,
    brushRuntime: brushRuntime as RuntimeBridgeArgs['strokeLifecycleOptions']['strokeRuntimeOptions']['brushRuntime'],
    userBrushEngine,
    shapeRuntime,
    brushToolRuntime,
    colorCycleRuntime,
  }),
});
