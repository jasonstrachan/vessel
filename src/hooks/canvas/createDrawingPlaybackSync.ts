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
  return (playing: boolean, reason: CCReason) => {
    if (playing) {
      let allAnimating = false;
      try {
        const st = storeRef.current;
        const ccLayers = st.layers.filter((layer) => layer.layerType === 'color-cycle');
        allAnimating = ccLayers.length > 0 && ccLayers.every((layer) => !!layer.colorCycleData?.isAnimating);
      } catch {
        // no-op
      }
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
    try {
      const st = storeRef.current;
      anyAnimating = st.layers.some(
        (layer) => layer.layerType === 'color-cycle' && !!layer.colorCycleData?.isAnimating
      );
    } catch {
      // no-op
    }

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
