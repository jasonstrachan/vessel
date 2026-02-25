import type { DrawingCanvasRuntimeStateBundle } from './useDrawingCanvasRuntimeStateBundle';
import type { useDrawingCanvasRuntimeSetupStages } from './useDrawingCanvasRuntimeSetupStages';
import { useDrawingCanvasColorCycleAnimationFromState } from './useDrawingCanvasColorCycleAnimationFromState';
import { useDrawingCanvasAnimationState } from './useDrawingCanvasAnimationState';

type SetupStages = ReturnType<typeof useDrawingCanvasRuntimeSetupStages>;

interface UseDrawingCanvasRuntimeAnimationStageOptions {
  state: Pick<
    DrawingCanvasRuntimeStateBundle,
    'canvasRef' | 'wrapperRef' | 'layers' | 'activeLayerId' | 'setCanvasViewport' | 'drawRef'
  >;
  setup: Pick<SetupStages, 'handlersRuntime' | 'interactionRuntime' | 'colorCycleRuntime'>;
  showFeedback?: (message: string) => void;
}

export const useDrawingCanvasRuntimeAnimationStage = ({
  state,
  setup,
  showFeedback,
}: UseDrawingCanvasRuntimeAnimationStageOptions) => {
  const { suspendedForNonCCActiveLayerRef, pausedAnimationForPanRef, managerRunningRef } =
    useDrawingCanvasAnimationState();

  return useDrawingCanvasColorCycleAnimationFromState({
    startContinuousColorCycleAnimation: setup.handlersRuntime.drawingHandlers
      .startContinuousColorCycleAnimation,
    stopContinuousColorCycleAnimation: setup.handlersRuntime.drawingHandlers
      .stopContinuousColorCycleAnimation,
    showFeedback,
    setFeedbackCallback: setup.handlersRuntime.drawingHandlers.setFeedbackCallback,
    activeLayerId: state.activeLayerId,
    layers: state.layers,
    wrapperRef: state.wrapperRef,
    setCanvasViewport: state.setCanvasViewport,
    suspendedForNonCCActiveLayerRef,
    managerRunningRef,
    colorCycleManagerRef: setup.colorCycleRuntime.colorCycleManagerRef,
    canvasRef: state.canvasRef,
    drawRef: state.drawRef,
    viewTransformRef: setup.interactionRuntime.viewTransformRef,
    pausedAnimationForPanRef,
    updateColorCycleGradientRef: setup.colorCycleRuntime.updateColorCycleGradientRef,
    setColorCycleFlowModeRef: setup.colorCycleRuntime.setColorCycleFlowModeRef,
  });
};
