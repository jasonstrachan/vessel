import { buildDrawingCanvasRuntimeAnimationStageArgs } from './buildDrawingCanvasRuntimeAnimationStageArgs';
import { buildDrawingCanvasRuntimeDrawStageArgs } from './buildDrawingCanvasRuntimeDrawStageArgs';
import type { DrawingCanvasRuntimeStateBundle } from './useDrawingCanvasRuntimeStateBundle';
import { useDrawingCanvasRuntimeAnimationStage } from './useDrawingCanvasRuntimeAnimationStage';
import { useDrawingCanvasRuntimeDrawStage } from './useDrawingCanvasRuntimeDrawStage';
import { useDrawingCanvasRuntimeSetupStages } from './useDrawingCanvasRuntimeSetupStages';

interface UseDrawingCanvasRuntimeOrchestrationOptions {
  state: DrawingCanvasRuntimeStateBundle;
  showFeedback?: (message: string) => void;
}

export const useDrawingCanvasRuntimeOrchestration = ({
  state,
  showFeedback,
}: UseDrawingCanvasRuntimeOrchestrationOptions) => {
  const {
    canvasRef,
    wrapperRef,
    brushCursorHandleRef,
    layers,
    activeLayerId,
    setCanvasViewport,
    drawRef,
    isZoomingRef,
    devicePixelRatioRef,
  } = state;

  const setup =
    useDrawingCanvasRuntimeSetupStages({
      state,
      showFeedback,
    });

  const animationRuntime = useDrawingCanvasRuntimeAnimationStage(
    buildDrawingCanvasRuntimeAnimationStageArgs({
      state: {
        canvasRef,
        wrapperRef,
        layers,
        activeLayerId,
        setCanvasViewport,
        drawRef,
      },
      setup: {
        handlersRuntime: setup.handlersRuntime,
        interactionRuntime: setup.interactionRuntime,
        colorCycleRuntime: setup.colorCycleRuntime,
      },
      showFeedback,
    })
  );

  const draw = useDrawingCanvasRuntimeDrawStage(
    buildDrawingCanvasRuntimeDrawStageArgs({
      state: {
        drawRef,
        canvasRef,
        isZoomingRef,
        devicePixelRatioRef,
      },
      setup: {
        renderRuntime: setup.renderRuntime,
        handlersRuntime: setup.handlersRuntime,
        interactionRuntime: setup.interactionRuntime,
      },
    })
  );

  return {
    visualRuntime: setup.visualRuntime,
    renderRuntime: setup.renderRuntime,
    interactionRuntime: setup.interactionRuntime,
    handlersRuntime: setup.handlersRuntime,
    animationRuntime,
    brushEngine: setup.brushEngine,
    draw,
    brushCursorHandleRef,
  };
};
