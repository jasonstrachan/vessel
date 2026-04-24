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
      latest.ccLog('sync effect trigger', {
        reason,
        playing,
        activeRef: latest.continuousColorCycleAnimationActiveRef.current,
        startingRef: latest.startingColorCycleAnimationRef.current,
        desiredPlaying: latest.storeRef.current.colorCyclePlayback?.desiredPlaying ?? false,
        suspendDepth: latest.storeRef.current.colorCyclePlayback?.suspendDepth ?? 0,
        lastReason: latest.storeRef.current.colorCyclePlayback?.lastReason ?? null,
      });
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
      latestRef.current.ccLog('sync effect observed effectivePlaying change', {
        prev: previous,
        next,
        desiredPlaying: state.colorCyclePlayback?.desiredPlaying ?? false,
        suspendDepth: state.colorCyclePlayback?.suspendDepth ?? 0,
        lastReason: state.colorCyclePlayback?.lastReason ?? null,
      });
      previous = next;
      runSync(next, 'store-sync');
    });

    return () => unsubscribe();
  }, []);
};
