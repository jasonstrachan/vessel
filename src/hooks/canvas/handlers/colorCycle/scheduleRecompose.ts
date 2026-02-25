import type React from 'react';

export type RecomposeRegion = { x: number; y: number; width: number; height: number };

export const dispatchColorCycleFrameUpdate = (detail?: {
  onlyActiveLayer?: boolean;
  roi?: RecomposeRegion;
}): void => {
  if (typeof window === 'undefined') {
    return;
  }
  try {
    if (detail) {
      window.dispatchEvent(new CustomEvent('colorCycleFrameUpdate', { detail }));
      return;
    }
    window.dispatchEvent(new CustomEvent('colorCycleFrameUpdate'));
  } catch {}
};

export const scheduleRecompose = (
  pendingRecomposeRef: React.MutableRefObject<boolean>,
  roi?: RecomposeRegion
): void => {
  if (typeof window === 'undefined') {
    return;
  }
  if (pendingRecomposeRef.current) {
    return;
  }

  const dispatch = () => {
    pendingRecomposeRef.current = false;
    dispatchColorCycleFrameUpdate({ onlyActiveLayer: true, roi });
  };

  pendingRecomposeRef.current = true;
  if (typeof window.requestAnimationFrame === 'function') {
    window.requestAnimationFrame(dispatch);
  } else {
    dispatch();
  }
};

export const createScheduleRecomposeDispatcher = (
  pendingRecomposeRef: React.MutableRefObject<boolean>
): ((roi?: RecomposeRegion) => void) => (roi?: RecomposeRegion) => {
  scheduleRecompose(pendingRecomposeRef, roi);
};
