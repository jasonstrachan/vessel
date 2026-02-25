import { useEffect, type MutableRefObject } from 'react';

interface UseDrawingPlaybackLifecycleEffectsOptions {
  startPlaybackRef: MutableRefObject<((reason?: string) => void) | null>;
  startContinuousColorCycleAnimation: (reason?: string) => void;
  cancelDeferredOverlayRender: () => void;
}

export const useDrawingPlaybackLifecycleEffects = ({
  startPlaybackRef,
  startContinuousColorCycleAnimation,
  cancelDeferredOverlayRender,
}: UseDrawingPlaybackLifecycleEffectsOptions) => {
  useEffect(() => {
    startPlaybackRef.current = startContinuousColorCycleAnimation;
    return () => {
      startPlaybackRef.current = null;
    };
  }, [startPlaybackRef, startContinuousColorCycleAnimation]);

  useEffect(() => {
    return () => {
      cancelDeferredOverlayRender();
    };
  }, [cancelDeferredOverlayRender]);
};
