import type { DrawingCanvasRuntimeStateBundle } from './useDrawingCanvasRuntimeStateBundle';
import { useDrawingCanvasRuntimeInteractionHandlersStage } from './useDrawingCanvasRuntimeInteractionHandlersStage';
import { useDrawingCanvasRuntimeRenderStage } from './useDrawingCanvasRuntimeRenderStage';
import { useDrawingCanvasRuntimeVisualStage } from './useDrawingCanvasRuntimeVisualStage';

interface UseDrawingCanvasRuntimeSetupStagesOptions {
  state: DrawingCanvasRuntimeStateBundle;
  showFeedback?: (message: string) => void;
}

export const useDrawingCanvasRuntimeSetupStages = ({
  state,
  showFeedback,
}: UseDrawingCanvasRuntimeSetupStagesOptions) => {
  const {
    visualRuntime,
    handlerBrushRuntime,
    brushRuntime,
    shapeBrushRuntime,
    colorCycleRuntime,
  } = useDrawingCanvasRuntimeVisualStage({
    state,
  });

  const renderRuntime = useDrawingCanvasRuntimeRenderStage({
    state,
    colorCycleManagerRef: colorCycleRuntime.colorCycleManagerRef,
  });

  const { interactionRuntime, handlersRuntime } =
    useDrawingCanvasRuntimeInteractionHandlersStage({
      state,
      showFeedback,
      brushRuntime: handlerBrushRuntime,
      renderRuntime,
    });

  return {
    visualRuntime,
    brushRuntime,
    shapeBrushRuntime,
    renderRuntime,
    interactionRuntime,
    handlersRuntime,
    colorCycleRuntime,
  };
};
