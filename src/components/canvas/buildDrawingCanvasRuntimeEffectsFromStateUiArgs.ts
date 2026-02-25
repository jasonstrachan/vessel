import type { UseDrawingCanvasRuntimeEffectsHandlersOptions } from './useDrawingCanvasRuntimeEffectsHandlers';
import type { UseDrawingCanvasRuntimeEffectsFromStateOptions } from './useDrawingCanvasRuntimeEffectsFromState.types';

type BuildArgs = UseDrawingCanvasRuntimeEffectsFromStateOptions;

export const buildDrawingCanvasRuntimeEffectsFromStateUiArgs = ({
  state,
  visualRuntime,
  interactionRuntime,
  draw,
  setCursorStyle,
}: BuildArgs): UseDrawingCanvasRuntimeEffectsHandlersOptions['uiArgs'] => ({
  cursorEffectsOptions: {
    defaultCursorStyle: visualRuntime.defaultCursorStyle,
    isDraggingFloatingPaste: state.isDraggingFloatingPaste,
    setCursorStyle,
    mode: interactionRuntime.stateMachine.state.mode,
  },
  uiEffectsOptions: {
    selectionStart: state.selectionStart,
    selectionEnd: state.selectionEnd,
    floatingPaste: state.floatingPaste,
    setMarchingAntsOffset: state.setMarchingAntsOffset,
    canvasRef: state.canvasRef,
    draw,
    viewTransformRef: interactionRuntime.viewTransformRef,
    defaultCursorStyle: visualRuntime.defaultCursorStyle,
    isPointerInsideCanvas: visualRuntime.isPointerInsideCanvas,
    setCursorStyle,
    setShowBrushCursor: state.setShowBrushCursor,
    wrapperRef: state.wrapperRef,
    mode: interactionRuntime.stateMachine.state.mode,
    canvasZoom: state.canvasZoom,
    canvasOffsetX: state.canvasOffsetX,
    canvasOffsetY: state.canvasOffsetY,
    needsRedraw: state.needsRedraw,
  },
  resizeCenterOptions: {
    canvasRef: state.canvasRef,
    wrapperRef: state.wrapperRef,
    overlayCanvasRef: state.overlayCanvasRef,
    devicePixelRatioRef: state.devicePixelRatioRef,
    drawRef: state.drawRef,
    viewTransformRef: interactionRuntime.viewTransformRef,
    hasCenteredRef: state.hasCenteredRef,
    project: state.project,
    setCanvasDimensions: state.setCanvasDimensions,
    setPan: interactionRuntime.setPan,
  },
});
