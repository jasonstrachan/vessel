import { useEffect, useRef } from 'react';
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
  const latestRef = useRef({
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
  });

  latestRef.current = {
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
  };

  useEffect(() => {
    const runSync = (playing: boolean, reason: 'startup' | 'store-sync') => {
      const latest = latestRef.current;
      const syncPlayback = createDrawingPlaybackSync({
        startContinuousColorCycleAnimation: latest.startContinuousColorCycleAnimation,
        stopContinuousColorCycleAnimation: latest.stopContinuousColorCycleAnimation,
        storeRef: latest.storeRef,
        continuousColorCycleAnimationActiveRef: latest.continuousColorCycleAnimationActiveRef,
        startingColorCycleAnimationRef: latest.startingColorCycleAnimationRef,
        skipStartLogAtRef: latest.skipStartLogAtRef,
        skipStopLogAtRef: latest.skipStopLogAtRef,
        skipCcLogThrottleMs: latest.skipCcLogThrottleMs,
        ccLog: latest.ccLog,
      });
      syncPlayback(playing, reason);
    };

    let previous = latestRef.current.getEffectiveColorCyclePlaying();
    runSync(previous, 'startup');

    const unsubscribe = useAppStore.subscribe((state) => {
      const next = selectEffectiveColorCyclePlaying(state);
      if (next === previous) {
        return;
      }
      previous = next;
      runSync(next, 'store-sync');
    });

    return () => unsubscribe();
  }, []);
};
