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
  const { visualRuntime, brushEngine, colorCycleRuntime } = useDrawingCanvasRuntimeVisualStage({
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
      brushEngine,
      renderRuntime,
    });

  return {
    visualRuntime,
    brushEngine,
    renderRuntime,
    interactionRuntime,
    handlersRuntime,
    colorCycleRuntime,
  };
};
