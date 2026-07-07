import type { DrawingCanvasRuntimeStateBundle } from './useDrawingCanvasRuntimeStateBundle';
import type { useDrawingCanvasRuntimeRenderStage } from './useDrawingCanvasRuntimeRenderStage';
import type { useDrawingCanvasRuntimeVisualStage } from './useDrawingCanvasRuntimeVisualStage';
import { useDrawingCanvasHandlersRuntimeSetup } from './useDrawingCanvasHandlersRuntimeSetup';
import { useDrawingCanvasInteractionRuntime } from './useDrawingCanvasInteractionRuntime';

type RenderRuntime = ReturnType<typeof useDrawingCanvasRuntimeRenderStage>;
type VisualRuntime = ReturnType<typeof useDrawingCanvasRuntimeVisualStage>;

interface UseDrawingCanvasRuntimeInteractionHandlersStageOptions {
  state: DrawingCanvasRuntimeStateBundle;
  showFeedback?: (message: string) => void;
  brushRuntime: VisualRuntime['handlerBrushRuntime'];
  renderRuntime: RenderRuntime;
}

export const useDrawingCanvasRuntimeInteractionHandlersStage = ({
  state,
  showFeedback,
  brushRuntime,
  renderRuntime,
}: UseDrawingCanvasRuntimeInteractionHandlersStageOptions) => {
  const interactionRuntime = useDrawingCanvasInteractionRuntime({
    viewport: {
      canvasZoom: state.canvasZoom,
      canvasOffsetX: state.canvasOffsetX,
      canvasOffsetY: state.canvasOffsetY,
      currentTool: state.tools.currentTool,
    },
    cursor: {
      setCanvasOffset: state.setCanvasOffset,
    },
  });

  const handlersRuntime = useDrawingCanvasHandlersRuntimeSetup({
    base: {
      sampleColorAtPosition: renderRuntime.sampleColorAtPosition,
      sampleColorsAlongLine: renderRuntime.sampleColorsAlongLine,
      project: state.project,
      panScreenToWorld: interactionRuntime.pan.screenToWorld,
      viewTransformRef: interactionRuntime.viewTransformRef,
      canvasRef: state.canvasElementRef,
      isBusyRef: state.isBusyRef,
      interactionDispatch: interactionRuntime.interactionDispatch,
      stateMachine: interactionRuntime.stateMachine,
      tools: state.tools,
      brushRuntime,
    },
    runtime: {
      compositeCanvasDirtyRef: state.compositeCanvasDirtyRef,
      rebuildStaticComposite: renderRuntime.rebuildStaticComposite,
      setNeedsRedraw: state.setNeedsRedraw,
      overlayCanvasRef: state.overlayCanvasRef,
    },
    shapeEditor: {
      canvasShapeEditor: state.canvasShapeEditor,
      showFeedback,
      canvasShapeEditRef: state.canvasShapeEditRef,
      freehandPointsRef: state.freehandPointsRef,
    },
  });

  return { interactionRuntime, handlersRuntime };
};
