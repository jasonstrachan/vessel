import { useAppStore } from '@/stores/useAppStore';
import type { Layer } from '@/types';
import { useDrawingCanvasAnimationRuntime } from './useDrawingCanvasAnimationRuntime';
import { useDrawingCanvasColorCycleCallbackRefs } from './useDrawingCanvasColorCycleCallbackRefs';
import { useDrawingCanvasColorCycleLayerSuspension } from './useDrawingCanvasColorCycleLayerSuspension';
import { useDrawingCanvasViewportTracking } from './useDrawingCanvasViewportTracking';

type AnimationRuntimeOptions = Parameters<typeof useDrawingCanvasAnimationRuntime>[0];

export interface UseDrawingCanvasColorCycleAnimationBridgeOptions {
  startContinuousColorCycleAnimation: (reason?: string) => void;
  stopContinuousColorCycleAnimation: (reason?: string) => void;
  showFeedback?: (message: string) => void;
  setFeedbackCallback?: ((callback: (message: string) => void) => void) | null;
  activeLayerId: string | null;
  layers: Layer[];
  wrapperRef: React.RefObject<HTMLDivElement | null>;
  setCanvasViewport: (viewport: { left: number; top: number; width: number; height: number }) => void;
  suspendedForNonCCActiveLayerRef: React.MutableRefObject<boolean>;
  managerRunningRef: AnimationRuntimeOptions['managerRunningRef'];
  colorCycleManagerRef: AnimationRuntimeOptions['colorCycleManagerRef'];
  canvasRef: AnimationRuntimeOptions['canvasRef'];
  drawRef: AnimationRuntimeOptions['drawRef'];
  viewTransformRef: AnimationRuntimeOptions['viewTransformRef'];
  pausedAnimationForPanRef: AnimationRuntimeOptions['pausedAnimationForPanRef'];
  updateColorCycleGradientRef: AnimationRuntimeOptions['updateColorCycleGradientRef'];
  setColorCycleFlowModeRef: AnimationRuntimeOptions['setColorCycleFlowModeRef'];
}

export const useDrawingCanvasColorCycleAnimationBridge = ({
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
}: UseDrawingCanvasColorCycleAnimationBridgeOptions) => {
  const setColorCycleRuntimeHandlers = useAppStore((state) => state.setColorCycleRuntimeHandlers);
  const { startAnimationRef, stopAnimationRef } = useDrawingCanvasColorCycleCallbackRefs({
    startContinuousColorCycleAnimation,
    stopContinuousColorCycleAnimation,
    showFeedback,
    setFeedbackCallback,
  });

  useDrawingCanvasViewportTracking({
    wrapperRef,
    setCanvasViewport,
  });

  const {
    wrappedStartAnimation,
    pauseAnimationForPan,
    resumeAnimationAfterPan,
  } = useDrawingCanvasAnimationRuntime({
    startAnimationRef,
    stopAnimationRef,
    managerRunningRef,
    colorCycleManagerRef,
    canvasRef,
    drawRef,
    viewTransformRef,
    pausedAnimationForPanRef,
    setColorCycleRuntimeHandlers,
    updateColorCycleGradientRef,
    setColorCycleFlowModeRef,
  });

  useDrawingCanvasColorCycleLayerSuspension({
    activeLayerId,
    layers,
    suspendedForNonCCActiveLayerRef,
  });

  return {
    wrappedStartAnimation,
    pauseAnimationForPan,
    resumeAnimationAfterPan,
  };
};
