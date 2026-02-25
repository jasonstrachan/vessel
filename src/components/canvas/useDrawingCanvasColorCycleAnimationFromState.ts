import type { UseDrawingCanvasColorCycleAnimationBridgeOptions } from './useDrawingCanvasColorCycleAnimationBridge';
import { useDrawingCanvasColorCycleAnimationRuntime } from './useDrawingCanvasColorCycleAnimationRuntime';

type UseDrawingCanvasColorCycleAnimationFromStateOptions =
  UseDrawingCanvasColorCycleAnimationBridgeOptions;

export const useDrawingCanvasColorCycleAnimationFromState = ({
  startContinuousColorCycleAnimation,
  stopContinuousColorCycleAnimation,
  showFeedback,
  setFeedbackCallback,
  activeLayerId,
  layers,
  wrapperRef,
  setCanvasViewport,
  suspendedForNonCCActiveLayerRef,
  managerRunningRef,
  colorCycleManagerRef,
  canvasRef,
  drawRef,
  viewTransformRef,
  pausedAnimationForPanRef,
  updateColorCycleGradientRef,
  setColorCycleFlowModeRef,
}: UseDrawingCanvasColorCycleAnimationFromStateOptions) =>
  useDrawingCanvasColorCycleAnimationRuntime({
    controls: {
      startContinuousColorCycleAnimation,
      stopContinuousColorCycleAnimation,
      showFeedback,
      setFeedbackCallback,
    },
    layerState: {
      activeLayerId,
      layers,
      suspendedForNonCCActiveLayerRef,
    },
    viewportState: {
      wrapperRef,
      setCanvasViewport,
    },
    runtimeState: {
      managerRunningRef,
      colorCycleManagerRef,
      canvasRef,
      drawRef,
      viewTransformRef,
      pausedAnimationForPanRef,
      updateColorCycleGradientRef,
      setColorCycleFlowModeRef,
    },
  });
