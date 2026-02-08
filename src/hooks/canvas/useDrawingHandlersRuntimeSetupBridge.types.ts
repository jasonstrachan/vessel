import type { useDrawingBrushToolRuntime } from '@/hooks/canvas/useDrawingBrushToolRuntime';
import type { useDrawingHandlersColorCycleBridge } from '@/hooks/canvas/useDrawingHandlersColorCycleBridge';
import type { useDrawingHandlersRuntimeBridge } from '@/hooks/canvas/useDrawingHandlersRuntimeBridge';
import type { useDrawingShapeRuntimeBridge } from '@/hooks/canvas/useDrawingShapeRuntimeBridge';
import type { useDrawingStrokeLifecycleRuntimeBridge } from '@/hooks/canvas/useDrawingStrokeLifecycleRuntimeBridge';

export type RuntimeBridgeArgs = Parameters<typeof useDrawingHandlersRuntimeBridge>[0];
export type StrokeStartRuntimeOptions =
  Parameters<typeof useDrawingStrokeLifecycleRuntimeBridge>[0]['startRuntimeOptions'];
export type StrokeRuntimeOptions =
  Parameters<typeof useDrawingStrokeLifecycleRuntimeBridge>[0]['strokeRuntimeOptions'];
export type FinalizeRuntimeOptions = RuntimeBridgeArgs['finalizeRuntimeOptions']['runtimeOptions'];
type ShapeRuntimeBridge = ReturnType<typeof useDrawingShapeRuntimeBridge>;
type BrushToolRuntime = ReturnType<typeof useDrawingBrushToolRuntime>;
type ColorCycleRuntime = ReturnType<typeof useDrawingHandlersColorCycleBridge>;

export interface UseDrawingHandlersRuntimeSetupBridgeOptions {
  refs: RuntimeBridgeArgs['refs'];
  isPointerDownRef: RuntimeBridgeArgs['isPointerDownRef'];
  project: RuntimeBridgeArgs['strokeLifecycleOptions']['startRuntimeOptions']['project'];
  storeRef: RuntimeBridgeArgs['strokeLifecycleOptions']['startRuntimeOptions']['storeRef'];
  sampleColorAt: RuntimeBridgeArgs['strokeLifecycleOptions']['startRuntimeOptions']['sampleColorAt'];
  isBusyRef: RuntimeBridgeArgs['finalizeRuntimeOptions']['contextOptions']['isBusyRef'];
  shapeMode: RuntimeBridgeArgs['shapeLifecycleOptions']['shapeRuntimeOptions']['shapeMode'];
  toolsRef: RuntimeBridgeArgs['shapeLifecycleOptions']['shapeRuntimeOptions']['toolsRef'];
  captureCanvasToActiveLayer: RuntimeBridgeArgs['finalizeRuntimeOptions']['contextOptions']['captureCanvasToActiveLayer'];
  withTiming: RuntimeBridgeArgs['finalizeRuntimeOptions']['contextOptions']['withTiming'];
  debugTime: RuntimeBridgeArgs['finalizeRuntimeOptions']['contextOptions']['debugTime'];
  debugTimeEnd: RuntimeBridgeArgs['finalizeRuntimeOptions']['contextOptions']['debugTimeEnd'];
  debugVerbose: StrokeStartRuntimeOptions['debugVerbose'];
  brushEngine: StrokeStartRuntimeOptions['brushEngine'];
  userBrushEngine: StrokeStartRuntimeOptions['userBrushEngine'];
  shapeRuntime: ShapeRuntimeBridge;
  brushToolRuntime: BrushToolRuntime;
  colorCycleRuntime: ColorCycleRuntime;
  feedbackMessageRef: RuntimeBridgeArgs['playbackHandlersOptions']['feedbackMessageRef'];
}

export type UseDrawingHandlersRuntimeSetupBridgeResult = ReturnType<
  typeof useDrawingHandlersRuntimeBridge
>;
