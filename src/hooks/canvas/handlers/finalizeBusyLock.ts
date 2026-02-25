import type React from 'react';

export type BusyLockState = {
  release: () => void;
};

export const createFinalizeBusyLock = (
  isBusyRef?: React.MutableRefObject<boolean>
): BusyLockState => {
  if (isBusyRef) {
    isBusyRef.current = true;
  }
  let busyReleased = false;
  const release = () => {
    if (busyReleased) {
      return;
    }
    if (isBusyRef) {
      isBusyRef.current = false;
    }
    busyReleased = true;
  };

  return { release };
};
