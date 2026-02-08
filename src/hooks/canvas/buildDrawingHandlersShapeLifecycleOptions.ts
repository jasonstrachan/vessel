import { buildDrawingHandlersShapeAuxOptions } from '@/hooks/canvas/buildDrawingHandlersShapeAuxOptions';
import { buildDrawingHandlersShapeRuntimeOptions } from '@/hooks/canvas/buildDrawingHandlersShapeRuntimeOptions';
import type {
  RuntimeBridgeArgs,
  UseDrawingHandlersRuntimeSetupBridgeOptions,
} from '@/hooks/canvas/useDrawingHandlersRuntimeSetupBridge.types';

interface BuildDrawingHandlersShapeLifecycleOptions {
  project: UseDrawingHandlersRuntimeSetupBridgeOptions['project'];
  storeRef: UseDrawingHandlersRuntimeSetupBridgeOptions['storeRef'];
  sampleColorAt: UseDrawingHandlersRuntimeSetupBridgeOptions['sampleColorAt'];
  isBusyRef: UseDrawingHandlersRuntimeSetupBridgeOptions['isBusyRef'];
  shapeMode: UseDrawingHandlersRuntimeSetupBridgeOptions['shapeMode'];
  toolsRef: UseDrawingHandlersRuntimeSetupBridgeOptions['toolsRef'];
  captureCanvasToActiveLayer: UseDrawingHandlersRuntimeSetupBridgeOptions['captureCanvasToActiveLayer'];
  withTiming: UseDrawingHandlersRuntimeSetupBridgeOptions['withTiming'];
  debugTime: UseDrawingHandlersRuntimeSetupBridgeOptions['debugTime'];
  debugTimeEnd: UseDrawingHandlersRuntimeSetupBridgeOptions['debugTimeEnd'];
  brushEngine: UseDrawingHandlersRuntimeSetupBridgeOptions['brushEngine'];
  shapeRuntime: UseDrawingHandlersRuntimeSetupBridgeOptions['shapeRuntime'];
  brushToolRuntime: UseDrawingHandlersRuntimeSetupBridgeOptions['brushToolRuntime'];
  colorCycleRuntime: UseDrawingHandlersRuntimeSetupBridgeOptions['colorCycleRuntime'];
}

export const buildDrawingHandlersShapeLifecycleOptions = ({
  project,
  storeRef,
  sampleColorAt,
  isBusyRef,
  shapeMode,
  toolsRef,
  captureCanvasToActiveLayer,
  withTiming,
  debugTime,
  debugTimeEnd,
  brushEngine,
  shapeRuntime,
  brushToolRuntime,
  colorCycleRuntime,
}: BuildDrawingHandlersShapeLifecycleOptions): RuntimeBridgeArgs['shapeLifecycleOptions'] => ({
  shapeAuxOptions: buildDrawingHandlersShapeAuxOptions({
    project,
    storeRef,
    shapeRuntime,
    brushToolRuntime,
  }),
  shapeRuntimeOptions: buildDrawingHandlersShapeRuntimeOptions({
    project,
    storeRef,
    sampleColorAt,
    isBusyRef,
    shapeMode,
    toolsRef,
    captureCanvasToActiveLayer,
    withTiming,
    debugTime,
    debugTimeEnd,
    brushEngine,
    shapeRuntime,
    brushToolRuntime,
    colorCycleRuntime,
  }),
});
