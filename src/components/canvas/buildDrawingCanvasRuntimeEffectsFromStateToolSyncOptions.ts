import type { UseDrawingCanvasRuntimeEffectsHandlersOptions } from './useDrawingCanvasRuntimeEffectsHandlers';
import type { UseDrawingCanvasRuntimeEffectsFromStateOptions } from './useDrawingCanvasRuntimeEffectsFromState.types';

type BuildArgs = UseDrawingCanvasRuntimeEffectsFromStateOptions;

export const buildDrawingCanvasRuntimeEffectsFromStateToolSyncOptions = ({
  state,
  visualRuntime,
  interactionRuntime,
  cancelActiveOperations,
  draw,
  setCursorStyle,
}: BuildArgs): UseDrawingCanvasRuntimeEffectsHandlersOptions['toolSyncOptions'] => ({
  currentTool: state.tools.currentTool,
  previousToolRef: interactionRuntime.previousToolRef,
  lastStateMachineToolRef: interactionRuntime.lastStateMachineToolRef,
  setCanvasStateMachineTool: interactionRuntime.setCanvasStateMachineTool,
  defaultCursorStyle: visualRuntime.defaultCursorStyle,
  isPointerInsideCanvas: visualRuntime.isPointerInsideCanvas,
  setShowBrushCursor: state.setShowBrushCursor,
  setCursorStyle,
  cancelActiveOperations,
  interactionDispatch: interactionRuntime.interactionDispatch,
  forceCanvasIdle: interactionRuntime.forceCanvasIdle,
  canvasRef: state.canvasRef,
  draw,
  viewTransformRef: interactionRuntime.viewTransformRef,
});
