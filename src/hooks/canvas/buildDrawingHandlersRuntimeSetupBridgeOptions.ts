import type { useDrawingBrushToolRuntime } from '@/hooks/canvas/useDrawingBrushToolRuntime';
import type { useDrawingHandlersColorCycleBridge } from '@/hooks/canvas/useDrawingHandlersColorCycleBridge';
import type { useDrawingHandlersRuntimeSetupBridge } from '@/hooks/canvas/useDrawingHandlersRuntimeSetupBridge';
import type { useDrawingShapeRuntimeBridge } from '@/hooks/canvas/useDrawingShapeRuntimeBridge';
import type { useDrawingHandlerRefs } from '@/hooks/canvas/useDrawingHandlerRefs';
import type { useDrawingHandlersStoreState } from '@/hooks/canvas/useDrawingHandlersStoreState';
import type { useBrushEngineSimplified } from '@/hooks/useBrushEngineSimplified';
import type { useUserBrushEngine } from '@/hooks/useUserBrushEngine';

type RuntimeSetupOptions = Parameters<typeof useDrawingHandlersRuntimeSetupBridge>[0];
type DrawingHandlerRefs = ReturnType<typeof useDrawingHandlerRefs>;
type StoreState = ReturnType<typeof useDrawingHandlersStoreState>;

interface BuildDrawingHandlersRuntimeSetupBridgeOptionsArgs {
  refs: DrawingHandlerRefs;
  isPointerDownRef: DrawingHandlerRefs['isPointerDownRef'];
  project: { width: number; height: number } | null;
  storeRef: StoreState['storeRef'];
  sampleColorAt?: (x: number, y: number) => string;
  isBusyRef?: RuntimeSetupOptions['isBusyRef'];
  shapeMode: StoreState['shapeMode'];
  toolsRef: StoreState['toolsRef'];
  captureCanvasToActiveLayer: StoreState['captureCanvasToActiveLayer'];
  withTiming: RuntimeSetupOptions['withTiming'];
  debugTime: RuntimeSetupOptions['debugTime'];
  debugTimeEnd: RuntimeSetupOptions['debugTimeEnd'];
  debugVerbose: RuntimeSetupOptions['debugVerbose'];
  brushEngine: ReturnType<typeof useBrushEngineSimplified>;
  userBrushEngine: ReturnType<typeof useUserBrushEngine>;
  shapeRuntime: ReturnType<typeof useDrawingShapeRuntimeBridge>;
  brushToolRuntime: ReturnType<typeof useDrawingBrushToolRuntime>;
  colorCycleRuntime: ReturnType<typeof useDrawingHandlersColorCycleBridge>;
  feedbackMessageRef: DrawingHandlerRefs['feedbackMessageRef'];
}

export const buildDrawingHandlersRuntimeSetupBridgeOptions = ({
  refs,
  isPointerDownRef,
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
  debugVerbose,
  brushEngine,
  userBrushEngine,
  shapeRuntime,
  brushToolRuntime,
  colorCycleRuntime,
  feedbackMessageRef,
}: BuildDrawingHandlersRuntimeSetupBridgeOptionsArgs): RuntimeSetupOptions => ({
  refs,
  isPointerDownRef,
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
  debugVerbose,
  brushEngine,
  userBrushEngine,
  shapeRuntime,
  brushToolRuntime,
  colorCycleRuntime,
  feedbackMessageRef,
});
