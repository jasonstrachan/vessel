import { selectColorCycleSuspendDepth, type CCReason } from '@/stores/useAppStore';
import { logDrawingPlaybackSkipWithThrottle } from '@/hooks/canvas/logDrawingPlaybackSkipWithThrottle';
import type { DrawingPlaybackSyncCoreOptions } from '@/hooks/canvas/useDrawingPlaybackSyncEffect.types';

export const createDrawingPlaybackSync = ({
  startContinuousColorCycleAnimation,
  stopContinuousColorCycleAnimation,
  storeRef,
  continuousColorCycleAnimationActiveRef,
  startingColorCycleAnimationRef,
  skipStartLogAtRef,
  skipStopLogAtRef,
  skipCcLogThrottleMs,
  ccLog,
}: DrawingPlaybackSyncCoreOptions) => {
  const summarizeLayers = () => {
    try {
      return storeRef.current.layers
        .filter((layer) => layer.layerType === 'color-cycle')
        .map((layer) => ({
          id: layer.id.slice(-6),
          isAnimating: !!layer.colorCycleData?.isAnimating,
          mode: layer.colorCycleData?.mode ?? null,
        }));
    } catch {
      return [];
    }
  };

  return (playing: boolean, reason: CCReason) => {
    if (playing) {
      let allAnimating = false;
      let playbackSnapshot:
        | {
            desiredPlaying: boolean;
            suspendDepth: number;
            lastReason: string | null | undefined;
          }
        | undefined;
      try {
        const st = storeRef.current;
        const ccLayers = st.layers.filter((layer) => layer.layerType === 'color-cycle');
        allAnimating = ccLayers.length > 0 && ccLayers.every((layer) => !!layer.colorCycleData?.isAnimating);
        playbackSnapshot = {
          desiredPlaying: st.colorCyclePlayback.desiredPlaying,
          suspendDepth: st.colorCyclePlayback.suspendDepth,
          lastReason: st.colorCyclePlayback.lastReason,
        };
      } catch {
        // no-op
      }
      ccLog('sync playback -> start decision', {
        reason,
        playing,
        allAnimating,
        activeRef: continuousColorCycleAnimationActiveRef.current,
        startingRef: startingColorCycleAnimationRef.current,
        playback: playbackSnapshot,
        layers: summarizeLayers(),
      });
      if (!continuousColorCycleAnimationActiveRef.current && !startingColorCycleAnimationRef.current) {
        try {
          const st = storeRef.current;
          const suspendDepth = selectColorCycleSuspendDepth(st);
          if (suspendDepth > 0) {
            st.forceResumeColorCycle('toolbar');
            ccLog('forceResumeColorCycle(toolbar) due to suspend depth', { depth: suspendDepth });
          }
        } catch {
          // no-op
        }
        startContinuousColorCycleAnimation(reason);
      } else {
        logDrawingPlaybackSkipWithThrottle({
          reason,
          lastLogAtRef: skipStartLogAtRef,
          throttleMs: skipCcLogThrottleMs,
          ccLog,
          label: 'skip startContinuousColorCycleAnimation (already running)',
          payload: { reason, allAnimating },
        });
      }
      return;
    }

    let anyAnimating = false;
    let playbackSnapshot:
      | {
          desiredPlaying: boolean;
          suspendDepth: number;
          lastReason: string | null | undefined;
        }
      | undefined;
    try {
      const st = storeRef.current;
      anyAnimating = st.layers.some(
        (layer) => layer.layerType === 'color-cycle' && !!layer.colorCycleData?.isAnimating
      );
      playbackSnapshot = {
        desiredPlaying: st.colorCyclePlayback.desiredPlaying,
        suspendDepth: st.colorCyclePlayback.suspendDepth,
        lastReason: st.colorCyclePlayback.lastReason,
      };
    } catch {
      // no-op
    }

    ccLog('sync playback -> stop decision', {
      reason,
      playing,
      anyAnimating,
      activeRef: continuousColorCycleAnimationActiveRef.current,
      startingRef: startingColorCycleAnimationRef.current,
      playback: playbackSnapshot,
      layers: summarizeLayers(),
    });

    if (
      anyAnimating ||
      continuousColorCycleAnimationActiveRef.current ||
      startingColorCycleAnimationRef.current
    ) {
      stopContinuousColorCycleAnimation(reason);
      return;
    }

    logDrawingPlaybackSkipWithThrottle({
      reason,
      lastLogAtRef: skipStopLogAtRef,
      throttleMs: skipCcLogThrottleMs,
      ccLog,
      label: 'skip stopContinuousColorCycleAnimation (already stopped)',
      payload: { reason, anyAnimating },
    });
  };
};
