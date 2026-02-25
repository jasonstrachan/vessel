import type { UseDrawingCanvasRuntimeEffectsHandlersOptions } from './useDrawingCanvasRuntimeEffectsHandlers';
import type { UseDrawingCanvasRuntimeEffectsFromStateOptions } from './useDrawingCanvasRuntimeEffectsFromState.types';
import { isColorCyclePlaybackActive } from './drawingCanvasRuntimeEffectsFromStateShared';

type BuildArgs = UseDrawingCanvasRuntimeEffectsFromStateOptions;

export const buildDrawingCanvasRuntimeEffectsFromStateKeyboardArgs = ({
  state,
  renderRuntime,
  interactionRuntime,
  toolStateMachine,
  drawingHandlers,
  brushEngine,
  animationRuntime,
  cancelActiveOperations,
  finalizeActiveShape,
  draw,
}: BuildArgs): UseDrawingCanvasRuntimeEffectsHandlersOptions['keyboardArgs'] => ({
  refs: {
    canvasRef: state.canvasRef,
    viewTransformRef: interactionRuntime.viewTransformRef,
  },
  state: {
    toolStateMachine,
    drawingHandlers,
    brushEngine,
    layers: state.layers,
    activeLayerId: state.activeLayerId,
    tools: state.tools,
    isColorCyclePlaybackActive,
    stateMachine: interactionRuntime.stateMachine,
    canvasShapeEditor: state.canvasShapeEditor,
    colorAdjustActive: state.colorAdjustActive,
    crop: state.crop,
    floatingPaste: state.floatingPaste,
    previousTool: state.previousTool,
  },
  actions: {
    switchTool: state.switchTool,
    undo: state.undo,
    redo: state.redo,
    wrappedStartAnimation: animationRuntime.wrappedStartAnimation,
    setNeedsRedraw: state.setNeedsRedraw,
    cancelActiveOperations,
    interactionDispatch: interactionRuntime.interactionDispatch,
    commitCanvasShape: state.commitCanvasShape,
    cancelCanvasShapeEdit: state.cancelCanvasShapeEdit,
    applyColorAdjust: state.applyColorAdjust,
    commitCrop: state.commitCrop,
    finalizeActiveShape,
    commitFloatingPaste: state.commitFloatingPaste,
    draw,
    cancelColorAdjust: state.cancelColorAdjust,
    cancelCrop: state.cancelCrop,
  },
  render: {
    compositeCanvasDirtyRef: state.compositeCanvasDirtyRef,
    rebuildStaticComposite: renderRuntime.rebuildStaticComposite,
  },
});
