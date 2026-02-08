import { useRef } from 'react';

export const useDrawingCanvasAnimationState = () => {
  const suspendedForNonCCActiveLayerRef = useRef(false);
  const pausedAnimationForPanRef = useRef(false);
  const managerRunningRef = useRef(false);

  return {
    suspendedForNonCCActiveLayerRef,
    pausedAnimationForPanRef,
    managerRunningRef,
  };
};
