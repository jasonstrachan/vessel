import { useEffect, useRef } from 'react';

interface UseDrawingCanvasColorCycleCallbackRefsOptions {
  startContinuousColorCycleAnimation: (reason?: string) => void;
  stopContinuousColorCycleAnimation: (reason?: string) => void;
  showFeedback?: (message: string) => void;
  setFeedbackCallback?: ((callback: (message: string) => void) => void) | null;
}

export const useDrawingCanvasColorCycleCallbackRefs = ({
  startContinuousColorCycleAnimation,
  stopContinuousColorCycleAnimation,
  showFeedback,
  setFeedbackCallback,
}: UseDrawingCanvasColorCycleCallbackRefsOptions) => {
  const startAnimationRef = useRef<((reason?: string) => void) | null>(startContinuousColorCycleAnimation);
  const stopAnimationRef = useRef<((reason?: string) => void) | null>(stopContinuousColorCycleAnimation);

  useEffect(() => {
    startAnimationRef.current = startContinuousColorCycleAnimation;
  }, [startContinuousColorCycleAnimation]);

  useEffect(() => {
    stopAnimationRef.current = stopContinuousColorCycleAnimation;
  }, [stopContinuousColorCycleAnimation]);

  useEffect(() => {
    if (showFeedback && setFeedbackCallback) {
      setFeedbackCallback(showFeedback);
    }
  }, [showFeedback, setFeedbackCallback]);

  return {
    startAnimationRef,
    stopAnimationRef,
  };
};
