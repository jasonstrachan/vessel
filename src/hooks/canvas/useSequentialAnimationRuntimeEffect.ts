import { getAppStoreState } from '@/stores/appStoreAccess';
import { useEffect, useRef } from 'react';
import { useFeatureFlag } from '@/config/featureFlags';
import {
  dispatchSequentialAnimationFrameUpdate,
} from '@/hooks/canvas/handlers/animation/animationRuntime';
import {
  getPlaybackRuntimeController,
} from '@/runtime/playback/PlaybackRuntimeController';
import {
  advanceSequentialTransport,
  frameAtSequentialTime,
  getSequentialFrameCursor,
  resetSequentialFrameCursorFromState,
} from '@/runtime/playback/sequentialFrameCursor';
import {
  flushBufferedSequentialEvents,
  getBufferedSequentialPendingPayloadBytes,
  noteSequentialCaptureActivity,
} from '@/hooks/canvas/handlers/sequential/sequentialCapture';
import { setSequentialFrameCacheSnapshot } from '@/lib/sequential/SequentialPerfCounters';
import { getSequentialLayerRendererStats } from '@/lib/sequential/SequentialLayerRenderer';
import { logError } from '@/utils/debug';
import {
  selectSequentialCaptureActive,
  selectSequentialPlaybackActive,
  useAppStore,
  type AppState,
} from '@/stores/useAppStore';

interface UseSequentialAnimationRuntimeEffectOptions {
  storeRef: React.MutableRefObject<AppState>;
}

const SEQUENTIAL_METRICS_SAMPLE_MS = 250;
const SEQUENTIAL_CAPTURE_CHECKPOINT_FLUSH_MS = 1000;
const SEQUENTIAL_CAPTURE_CHECKPOINT_MAX_FLUSH_MS = 4000;
const SEQUENTIAL_CAPTURE_CHECKPOINT_MIN_PENDING_BYTES = 64 * 1024;
const MAX_SEQUENTIAL_REALTIME_DELTA_MS = 1000;
const SEQUENTIAL_FRAME_UI_PUBLISH_MS = 200;

const hasSequentialRuntimeState = (
  state: Partial<AppState> | null | undefined
): state is AppState => {
  if (!state) {
    return false;
  }
  return (
    typeof state === 'object' &&
    !!state.sequentialRecord &&
    Array.isArray(state.layers) &&
    typeof state.setSequentialCaptureActive === 'function' &&
    typeof state.publishSequentialFrame === 'function' &&
    typeof state.recordSequentialRuntimeTick === 'function' &&
    typeof state.stepSequentialFrame === 'function'
  );
};

export const useSequentialAnimationRuntimeEffect = ({
  storeRef,
}: UseSequentialAnimationRuntimeEffectOptions) => {
  const sequentialRecordModeEnabled = useFeatureFlag('enableSequentialRecordMode');
  const lastMetricsSampleMsRef = useRef(-Infinity);
  const lastCheckpointFlushMsRef = useRef(-Infinity);
  const lastCaptureActiveRef = useRef(false);
  const lastFrameUiPublishMsRef = useRef(-Infinity);

  const dispatchClearOverlay = () => {
    try {
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('cc:clear-overlay'));
      }
    } catch {
      // no-op
    }
  };

  useEffect(() => {
    const playbackController = getPlaybackRuntimeController();
    if (!sequentialRecordModeEnabled) {
      flushBufferedSequentialEvents({ state: getAppStoreState() });
      noteSequentialCaptureActivity({ isActive: false });
      lastCaptureActiveRef.current = false;
      dispatchClearOverlay();
      const state = getAppStoreState() as Partial<AppState>;
      if (hasSequentialRuntimeState(state) && state.sequentialRecord.isCaptureActive) {
        state.setSequentialCaptureActive(false);
      }
      return;
    }

    const unsubscribe = useAppStore.subscribe((state) => {
      if (!hasSequentialRuntimeState(state)) {
        return;
      }
      const captureActive = selectSequentialCaptureActive(state);
      if (!captureActive) {
        flushBufferedSequentialEvents({ state });
        lastCheckpointFlushMsRef.current = -Infinity;
      }
      if (lastCaptureActiveRef.current && !captureActive) {
        dispatchClearOverlay();
      }
      lastCaptureActiveRef.current = captureActive;
      if (state.sequentialRecord.isCaptureActive !== captureActive) {
        state.setSequentialCaptureActive(captureActive);
      }
      noteSequentialCaptureActivity({ isActive: captureActive });

      const shouldRun = selectSequentialPlaybackActive(state) || captureActive;
      if (shouldRun) {
        playbackController.sync(state, 'sequential-store-sync');
      } else {
        lastCheckpointFlushMsRef.current = -Infinity;
      }
    });

    const initialState = storeRef.current as Partial<AppState>;
    if (!hasSequentialRuntimeState(initialState)) {
      return () => {
        unsubscribe();
        lastCheckpointFlushMsRef.current = -Infinity;
      };
    }
    const initialCaptureActive = selectSequentialCaptureActive(initialState);
    resetSequentialFrameCursorFromState(initialState);
    if (initialState.sequentialRecord.isCaptureActive !== initialCaptureActive) {
      initialState.setSequentialCaptureActive(initialCaptureActive);
    }
    noteSequentialCaptureActivity({ isActive: initialCaptureActive });
    if (selectSequentialPlaybackActive(initialState) || initialCaptureActive) {
      playbackController.sync(initialState, 'sequential-startup');
    }

    return () => {
      unsubscribe();
      lastCheckpointFlushMsRef.current = -Infinity;
      flushBufferedSequentialEvents({ state: getAppStoreState() });
      noteSequentialCaptureActivity({ isActive: false });
      lastCaptureActiveRef.current = false;
      dispatchClearOverlay();
    };
  }, [sequentialRecordModeEnabled, storeRef]);

  useEffect(() => {
    if (!sequentialRecordModeEnabled) {
      return;
    }

    const playbackController = getPlaybackRuntimeController();
    const unregister = playbackController.registerAnimationConsumer((_timestampMs, deltaMs) => {
      try {
        const timestampMs = Number.isFinite(_timestampMs) ? _timestampMs : Date.now();
        const state = getAppStoreState() as Partial<AppState>;
        if (!hasSequentialRuntimeState(state)) {
          return;
        }
        const playbackActive = selectSequentialPlaybackActive(state);
        const captureActiveNow = selectSequentialCaptureActive(state);
        const shouldAdvanceFrames = playbackActive || captureActiveNow;
        if (!shouldAdvanceFrames) {
          lastCheckpointFlushMsRef.current = -Infinity;
          lastFrameUiPublishMsRef.current = -Infinity;
          flushBufferedSequentialEvents({ state });
          if (lastCaptureActiveRef.current) {
            dispatchClearOverlay();
          }
          lastCaptureActiveRef.current = false;
          if (state.sequentialRecord.isCaptureActive) {
            state.setSequentialCaptureActive(false);
          }
          noteSequentialCaptureActivity({ isActive: false });
          return;
        }
        const tickStart =
          typeof performance !== 'undefined' && typeof performance.now === 'function'
            ? performance.now()
            : Date.now();
        const safeDeltaMs =
          deltaMs > MAX_SEQUENTIAL_REALTIME_DELTA_MS ? 0 : Math.max(0, deltaMs);
        const activeSequentialLayer = state.layers.find(
          (layer) => layer.id === state.activeLayerId && layer.layerType === 'sequential',
        );
        const sourceFps = activeSequentialLayer?.sequentialData?.fps ?? state.sequentialRecord.fps;
        const sourceFrameCount =
          activeSequentialLayer?.sequentialData?.frameCount ?? state.sequentialRecord.frameCount;
        const previousCursor = getSequentialFrameCursor();
        const cursor = advanceSequentialTransport({
          deltaMs: safeDeltaMs,
          sourceFps,
          sourceFrameCount,
          timestampMs,
        });
        const activeFrameChanged = cursor.frame !== previousCursor.frame;
        const presentationFrameChanged = state.layers.some((layer) => {
          if (
            layer.layerType !== 'sequential' ||
            !layer.sequentialData ||
            (layer.visible === false && layer.id !== state.activeLayerId)
          ) {
            return false;
          }
          return frameAtSequentialTime({
            clipTimeMs: previousCursor.timeMs,
            clipFps: layer.sequentialData.fps,
            clipFrameCount: layer.sequentialData.frameCount,
          }) !== frameAtSequentialTime({
            clipTimeMs: cursor.timeMs,
            clipFps: layer.sequentialData.fps,
            clipFrameCount: layer.sequentialData.frameCount,
          });
        });
        const shouldPublishFrameToStore =
          activeFrameChanged && (
            timestampMs - lastFrameUiPublishMsRef.current >= SEQUENTIAL_FRAME_UI_PUBLISH_MS ||
            captureActiveNow
          );
        if (
          shouldPublishFrameToStore &&
          state.sequentialRecord.currentFrame !== cursor.frame
        ) {
          state.publishSequentialFrame(cursor.frame, sourceFrameCount);
          lastFrameUiPublishMsRef.current = timestampMs;
        }

        const nextState = getAppStoreState() as Partial<AppState>;
        if (!hasSequentialRuntimeState(nextState)) {
          return;
        }
        const captureActive = selectSequentialCaptureActive(nextState);
        if (lastCaptureActiveRef.current && !captureActive) {
          dispatchClearOverlay();
        }
        lastCaptureActiveRef.current = captureActive;
        if (nextState.sequentialRecord.isCaptureActive !== captureActive) {
          nextState.setSequentialCaptureActive(captureActive);
        }
        noteSequentialCaptureActivity({ isActive: captureActive });

        if (presentationFrameChanged) {
          try {
            if (captureActive && typeof window !== 'undefined') {
              window.dispatchEvent(new CustomEvent('cc:clear-overlay'));
            }
          } catch {
            // no-op
          }
          dispatchSequentialAnimationFrameUpdate({
            frameIndex: getSequentialFrameCursor().frame,
            advancedFrames: activeFrameChanged ? 1 : 0,
          });
        }

        if (
          captureActive
        ) {
          const elapsedSinceFlush = timestampMs - lastCheckpointFlushMsRef.current;
          const pendingPayloadBytes = getBufferedSequentialPendingPayloadBytes();
          const shouldFlushForSafety =
            elapsedSinceFlush >= SEQUENTIAL_CAPTURE_CHECKPOINT_MAX_FLUSH_MS;
          const shouldFlushForPayload =
            elapsedSinceFlush >= SEQUENTIAL_CAPTURE_CHECKPOINT_FLUSH_MS &&
            pendingPayloadBytes >= SEQUENTIAL_CAPTURE_CHECKPOINT_MIN_PENDING_BYTES;
          if (shouldFlushForSafety || shouldFlushForPayload) {
            flushBufferedSequentialEvents({ state: nextState, preserveLivePreview: true });
            lastCheckpointFlushMsRef.current = timestampMs;
          }
        }

        const tickEnd =
          typeof performance !== 'undefined' && typeof performance.now === 'function'
            ? performance.now()
            : Date.now();
        if (timestampMs - lastMetricsSampleMsRef.current >= SEQUENTIAL_METRICS_SAMPLE_MS) {
          lastMetricsSampleMsRef.current = timestampMs;
          nextState.recordSequentialRuntimeTick(Math.max(0, tickEnd - tickStart));
          const cacheStats = getSequentialLayerRendererStats();
          setSequentialFrameCacheSnapshot({
            entries: cacheStats.entries,
            hits: cacheStats.hits,
            misses: cacheStats.misses,
          });
          nextState.setSequentialFrameCacheStats({
            frameCacheEntries: cacheStats.entries,
            frameCacheHits: cacheStats.hits,
            frameCacheMisses: cacheStats.misses,
          });
        }
      } catch (error) {
        lastCheckpointFlushMsRef.current = -Infinity;
        logError('[useSequentialAnimationRuntimeEffect] runtime tick failed', error);
      }
    });

    return () => {
      unregister();
      lastMetricsSampleMsRef.current = -Infinity;
      lastCheckpointFlushMsRef.current = -Infinity;
      lastFrameUiPublishMsRef.current = -Infinity;
      lastCaptureActiveRef.current = false;
    };
  }, [sequentialRecordModeEnabled]);
};
