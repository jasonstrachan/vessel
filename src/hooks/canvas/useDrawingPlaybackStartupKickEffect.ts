import { useEffect, type MutableRefObject } from 'react';

interface UseDrawingPlaybackStartupKickEffectOptions {
  project: { width: number; height: number } | null;
  ensureOverlayInitialized: () => boolean;
  getEffectiveColorCyclePlaying: () => boolean;
  startupKickDoneRef: MutableRefObject<boolean>;
  startContinuousColorCycleAnimation: (reason?: string) => void;
}

export const useDrawingPlaybackStartupKickEffect = ({
  project,
  ensureOverlayInitialized,
  getEffectiveColorCyclePlaying,
  startupKickDoneRef,
  startContinuousColorCycleAnimation,
}: UseDrawingPlaybackStartupKickEffectOptions) => {
  useEffect(() => {
    if (!project) {
      return;
    }
    if (typeof window === 'undefined') {
      return;
    }
    const ready = ensureOverlayInitialized();
    if (!ready) {
      return;
    }
    const isPlaying = getEffectiveColorCyclePlaying();
    if (isPlaying && !startupKickDoneRef.current) {
      startupKickDoneRef.current = true;
      Promise.resolve().then(() => {
        startContinuousColorCycleAnimation('store-sync');
      });
    }
  }, [
    project,
    ensureOverlayInitialized,
    getEffectiveColorCyclePlaying,
    startupKickDoneRef,
    startContinuousColorCycleAnimation,
  ]);
};
