import { useEffect } from 'react';
import {
  selectEffectiveColorCyclePlaying,
  useAppStore,
} from '@/stores/useAppStore';
import { createDrawingPlaybackSync } from '@/hooks/canvas/createDrawingPlaybackSync';
import type { UseDrawingPlaybackSyncEffectOptions } from '@/hooks/canvas/useDrawingPlaybackSyncEffect.types';

export const useDrawingPlaybackSyncEffect = ({
  startContinuousColorCycleAnimation,
  stopContinuousColorCycleAnimation,
  getEffectiveColorCyclePlaying,
  storeRef,
  continuousColorCycleAnimationActiveRef,
  startingColorCycleAnimationRef,
  skipStartLogAtRef,
  skipStopLogAtRef,
  skipCcLogThrottleMs,
  ccLog,
}: UseDrawingPlaybackSyncEffectOptions) => {
  useEffect(() => {
    let previous = getEffectiveColorCyclePlaying();
    const syncPlayback = createDrawingPlaybackSync({
      startContinuousColorCycleAnimation,
      stopContinuousColorCycleAnimation,
      storeRef,
      continuousColorCycleAnimationActiveRef,
      startingColorCycleAnimationRef,
      skipStartLogAtRef,
      skipStopLogAtRef,
      skipCcLogThrottleMs,
      ccLog,
    });

    syncPlayback(previous, 'startup');

    const unsubscribe = useAppStore.subscribe((state) => {
      const next = selectEffectiveColorCyclePlaying(state);
      if (next === previous) {
        return;
      }
      previous = next;
      syncPlayback(next, 'store-sync');
    });

    return () => {
      unsubscribe();
    };
  }, [
    startContinuousColorCycleAnimation,
    stopContinuousColorCycleAnimation,
    getEffectiveColorCyclePlaying,
    storeRef,
    continuousColorCycleAnimationActiveRef,
    startingColorCycleAnimationRef,
    skipStartLogAtRef,
    skipStopLogAtRef,
    skipCcLogThrottleMs,
    ccLog,
  ]);
};
