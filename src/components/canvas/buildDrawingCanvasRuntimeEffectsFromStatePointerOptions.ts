import type { UseDrawingCanvasRuntimeEffectsHandlersOptions } from './useDrawingCanvasRuntimeEffectsHandlers';
import type { UseDrawingCanvasRuntimeEffectsFromStateOptions } from './useDrawingCanvasRuntimeEffectsFromState.types';

type BuildArgs = UseDrawingCanvasRuntimeEffectsFromStateOptions;

export const buildDrawingCanvasRuntimeEffectsFromStatePointerOptions = ({
  state,
  interactionRuntime,
}: BuildArgs): UseDrawingCanvasRuntimeEffectsHandlersOptions['pointerUtilsOptions'] => ({
  canvasBounds: state.canvasBounds,
  activeCanvasShape: state.activeCanvasShape,
  canvasRef: state.canvasRef,
  canvasOffsetX: state.canvasOffsetX,
  canvasOffsetY: state.canvasOffsetY,
  canvasZoom: state.canvasZoom,
  project: state.project,
  viewTransformRef: interactionRuntime.viewTransformRef,
});

export const buildDrawingCanvasRuntimeEffectsFromStateShapeEditorOptions = ({
  state,
}: BuildArgs): UseDrawingCanvasRuntimeEffectsHandlersOptions['shapeEditorBridgeOptions'] => ({
  setCanvasShapeDraft: state.setCanvasShapeDraft,
  setNeedsRedraw: state.setNeedsRedraw,
  canvasShapeEditor: state.canvasShapeEditor,
  canvasBounds: state.canvasBounds,
  canvasRef: state.canvasRef,
  canvasShapeEditRef: state.canvasShapeEditRef,
  freehandPointsRef: state.freehandPointsRef,
});
