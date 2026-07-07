import type { buildDrawingHandlersRuntimeSetupBridgeOptions } from '@/hooks/canvas/buildDrawingHandlersRuntimeSetupBridgeOptions';
import type { useDrawingBrushToolRuntime } from '@/hooks/canvas/useDrawingBrushToolRuntime';
import type { useDrawingHandlersColorCycleBridge } from '@/hooks/canvas/useDrawingHandlersColorCycleBridge';
import type { UseDrawingHandlersRuntimeStagesOptions } from '@/hooks/canvas/useDrawingHandlersRuntimeStages.types';
import type { useDrawingShapeRuntimeBridge } from '@/hooks/canvas/useDrawingShapeRuntimeBridge';
import type { useDrawingHandlerRefs } from '@/hooks/canvas/useDrawingHandlerRefs';
import type { useDrawingHandlersStoreState } from '@/hooks/canvas/useDrawingHandlersStoreState';
import type { useUserBrushEngine } from '@/hooks/useUserBrushEngine';

type RuntimeSetupBridgeBuilderArgs = Parameters<typeof buildDrawingHandlersRuntimeSetupBridgeOptions>[0];
type DrawingHandlerRefs = ReturnType<typeof useDrawingHandlerRefs>;
type StoreState = ReturnType<typeof useDrawingHandlersStoreState>;

interface BuildDrawingHandlersRuntimeStagesSetupArgsOptions {
  options: UseDrawingHandlersRuntimeStagesOptions;
  refs: DrawingHandlerRefs;
  storeRef: StoreState['storeRef'];
  shapeMode: StoreState['shapeMode'];
  toolsRef: StoreState['toolsRef'];
  captureCanvasToActiveLayer: StoreState['captureCanvasToActiveLayer'];
  strokeBrushRuntime: RuntimeSetupBridgeBuilderArgs['strokeBrushRuntime'];
  finalizeBrushRuntime: RuntimeSetupBridgeBuilderArgs['finalizeBrushRuntime'];
  shapeBrushRuntime: RuntimeSetupBridgeBuilderArgs['shapeBrushRuntime'];
  playbackBrushRuntime: RuntimeSetupBridgeBuilderArgs['playbackBrushRuntime'];
  userBrushEngine: ReturnType<typeof useUserBrushEngine>;
  shapeRuntime: ReturnType<typeof useDrawingShapeRuntimeBridge>;
  brushToolRuntime: ReturnType<typeof useDrawingBrushToolRuntime>;
  colorCycleRuntime: ReturnType<typeof useDrawingHandlersColorCycleBridge>;
}

export const buildDrawingHandlersRuntimeStagesSetupArgs = ({
  options,
  refs,
  storeRef,
  shapeMode,
  toolsRef,
  captureCanvasToActiveLayer,
  strokeBrushRuntime,
  finalizeBrushRuntime,
  shapeBrushRuntime,
  playbackBrushRuntime,
  userBrushEngine,
  shapeRuntime,
  brushToolRuntime,
  colorCycleRuntime,
}: BuildDrawingHandlersRuntimeStagesSetupArgsOptions): RuntimeSetupBridgeBuilderArgs => ({
  refs,
  isPointerDownRef: refs.isPointerDownRef,
  project: options.project,
  storeRef,
  sampleColorAt: options.sampleColorAt,
  isBusyRef: options.isBusyRef,
  shapeMode,
  toolsRef,
  captureCanvasToActiveLayer,
  withTiming: options.perf.withTiming,
  debugTime: options.perf.debugTime,
  debugTimeEnd: options.perf.debugTimeEnd,
  debugVerbose: options.perf.debugVerbose,
  strokeBrushRuntime,
  finalizeBrushRuntime,
  shapeBrushRuntime,
  playbackBrushRuntime,
  userBrushEngine,
  shapeRuntime,
  brushToolRuntime,
  colorCycleRuntime,
  feedbackMessageRef: refs.feedbackMessageRef,
});
