import { useEffect, useRef } from 'react';
import { useFeatureFlag } from '@/config/featureFlags';
import {
  dispatchGlobalAnimationFrameUpdate,
  getSharedAnimationRuntime,
} from '@/hooks/canvas/handlers/animation/animationRuntime';
import {
  flushBufferedSequentialEvents,
  getBufferedSequentialPendingPayloadBytes,
  noteSequentialCaptureActivity,
} from '@/hooks/canvas/handlers/sequential/sequentialCapture';
import {
  createSequentialPayloadBudgetRuntime,
  readSequentialProjectPayloadBytes,
} from '@/lib/sequential/SequentialPayloadBudget';
import { setSequentialFrameCacheSnapshot } from '@/lib/sequential/SequentialPerfCounters';
import { getSequentialLayerRendererStats } from '@/lib/sequential/SequentialLayerRenderer';
import { logError } from '@/utils/debug';
import { MAX_CC_LAYER_SPEED_SCALE, MIN_CC_LAYER_SPEED_SCALE } from '@/constants/colorCycle';
import {
  selectSequentialCaptureActive,
  selectSequentialPlaybackActive,
  useAppStore,
  type AppState,
} from '@/stores/useAppStore';

interface UseSequentialAnimationRuntimeEffectOptions {
  storeRef: React.MutableRefObject<AppState>;
}

interface SequentialPerfProbeSnapshot {
  isPlaybackActive: boolean;
  isCaptureActive: boolean;
  currentFrame: number;
  frameCount: number;
  fps: number;
  timeSmear: number;
  metrics: AppState['sequentialRecord']['metrics'];
  sequentialPayloadBytes: number;
  sequentialLayerCount: number;
}

interface SequentialPerfProbeSummary {
  sampleCount: number;
  avgTickMsMean: number;
  lastTickMsMax: number;
  payloadBytesMax: number;
  cacheEntriesMax: number;
  cacheHitRateAtLastSample: number;
  finalFrame: number;
  frameCount: number;
}

interface SequentialPerfProbeApi {
  getSnapshot: () => SequentialPerfProbeSnapshot;
  resetMetrics: () => void;
  printSnapshot: () => SequentialPerfProbeSnapshot;
  recordSample: () => SequentialPerfProbeSnapshot;
  getSamples: () => SequentialPerfProbeSnapshot[];
  clearSamples: () => void;
  summarizeSamples: () => SequentialPerfProbeSummary;
}

const payloadBudgetRuntime = createSequentialPayloadBudgetRuntime();
const SEQUENTIAL_METRICS_SAMPLE_MS = 250;
const SEQUENTIAL_CAPTURE_CHECKPOINT_FLUSH_MS = 1000;
const SEQUENTIAL_CAPTURE_CHECKPOINT_MAX_FLUSH_MS = 4000;
const SEQUENTIAL_CAPTURE_CHECKPOINT_MIN_PENDING_BYTES = 64 * 1024;

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
    typeof state.recordSequentialRuntimeTick === 'function' &&
    typeof state.stepSequentialFrame === 'function'
  );
};

const installSequentialPerfProbe = (): (() => void) => {
  if (process.env.NODE_ENV === 'production') {
    return () => {};
  }

  const globalScope = globalThis as typeof globalThis & {
    vesselSequentialPerf?: SequentialPerfProbeApi;
  };

  const getSnapshot = (): SequentialPerfProbeSnapshot => {
    const state = useAppStore.getState();
    const sequentialLayers = state.layers.filter(
      (layer) => layer.layerType === 'sequential' && !!layer.sequentialData
    );

    return {
      isPlaybackActive: selectSequentialPlaybackActive(state),
      isCaptureActive: selectSequentialCaptureActive(state),
      currentFrame: state.sequentialRecord.currentFrame,
      frameCount: state.sequentialRecord.frameCount,
      fps: state.sequentialRecord.fps,
      timeSmear: state.sequentialRecord.timeSmear,
      metrics: state.sequentialRecord.metrics,
      sequentialPayloadBytes: readSequentialProjectPayloadBytes({
        layers: state.layers,
        runtime: payloadBudgetRuntime,
      }),
      sequentialLayerCount: sequentialLayers.length,
    };
  };

  const samples: SequentialPerfProbeSnapshot[] = [];
  const recordSample = (): SequentialPerfProbeSnapshot => {
    const snapshot = getSnapshot();
    samples.push(snapshot);
    return snapshot;
  };

  const summarizeSamples = (): SequentialPerfProbeSummary => {
    if (samples.length === 0) {
      const snapshot = getSnapshot();
      const totalCacheOps = snapshot.metrics.frameCacheHits + snapshot.metrics.frameCacheMisses;
      return {
        sampleCount: 0,
        avgTickMsMean: 0,
        lastTickMsMax: 0,
        payloadBytesMax: snapshot.sequentialPayloadBytes,
        cacheEntriesMax: snapshot.metrics.frameCacheEntries,
        cacheHitRateAtLastSample: totalCacheOps > 0 ? snapshot.metrics.frameCacheHits / totalCacheOps : 0,
        finalFrame: snapshot.currentFrame,
        frameCount: snapshot.frameCount,
      };
    }

    let avgTickMsAccumulator = 0;
    let lastTickMsMax = 0;
    let payloadBytesMax = 0;
    let cacheEntriesMax = 0;
    for (let i = 0; i < samples.length; i += 1) {
      const sample = samples[i];
      avgTickMsAccumulator += sample.metrics.avgTickMs;
      lastTickMsMax = Math.max(lastTickMsMax, sample.metrics.lastTickMs);
      payloadBytesMax = Math.max(payloadBytesMax, sample.sequentialPayloadBytes);
      cacheEntriesMax = Math.max(cacheEntriesMax, sample.metrics.frameCacheEntries);
    }

    const lastSample = samples[samples.length - 1];
    const totalCacheOps = lastSample.metrics.frameCacheHits + lastSample.metrics.frameCacheMisses;

    return {
      sampleCount: samples.length,
      avgTickMsMean: avgTickMsAccumulator / samples.length,
      lastTickMsMax,
      payloadBytesMax,
      cacheEntriesMax,
      cacheHitRateAtLastSample: totalCacheOps > 0 ? lastSample.metrics.frameCacheHits / totalCacheOps : 0,
      finalFrame: lastSample.currentFrame,
      frameCount: lastSample.frameCount,
    };
  };

  const api: SequentialPerfProbeApi = {
    getSnapshot,
    resetMetrics: () => {
      useAppStore.getState().resetSequentialRuntimeMetrics();
    },
    printSnapshot: () => {
      const snapshot = getSnapshot();
      console.log('[vesselSequentialPerf]', snapshot);
      return snapshot;
    },
    recordSample,
    getSamples: () => [...samples],
    clearSamples: () => {
      samples.length = 0;
    },
    summarizeSamples,
  };

  globalScope.vesselSequentialPerf = api;

  return () => {
    if (globalScope.vesselSequentialPerf === api) {
      delete globalScope.vesselSequentialPerf;
    }
  };
};

export const useSequentialAnimationRuntimeEffect = ({
  storeRef,
}: UseSequentialAnimationRuntimeEffectOptions) => {
  const sequentialRecordModeEnabled = useFeatureFlag('enableSequentialRecordMode');
  const accumMsRef = useRef(0);
  const lastMetricsSampleMsRef = useRef(-Infinity);
  const lastCheckpointFlushMsRef = useRef(-Infinity);
  const lastCaptureActiveRef = useRef(false);

  const dispatchClearOverlay = () => {
    try {
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('cc:clear-overlay'));
      }
    } catch {
      // no-op
    }
  };

  useEffect(() => installSequentialPerfProbe(), []);

  useEffect(() => {
    const runtime = getSharedAnimationRuntime();
    if (!sequentialRecordModeEnabled) {
      accumMsRef.current = 0;
      flushBufferedSequentialEvents({ state: useAppStore.getState() });
      noteSequentialCaptureActivity({ isActive: false });
      lastCaptureActiveRef.current = false;
      dispatchClearOverlay();
      const state = useAppStore.getState() as Partial<AppState>;
      if (hasSequentialRuntimeState(state) && state.sequentialRecord.isCaptureActive) {
        state.setSequentialCaptureActive(false);
      }
      return;
    }

    const unsubscribe = useAppStore.subscribe((state) => {
      if (!hasSequentialRuntimeState(state)) {
        accumMsRef.current = 0;
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
        runtime.start();
      } else {
        accumMsRef.current = 0;
        lastCheckpointFlushMsRef.current = -Infinity;
      }
    });

    const initialState = storeRef.current as Partial<AppState>;
    if (!hasSequentialRuntimeState(initialState)) {
      return () => {
        unsubscribe();
        accumMsRef.current = 0;
        lastCheckpointFlushMsRef.current = -Infinity;
      };
    }
    const initialCaptureActive = selectSequentialCaptureActive(initialState);
    if (initialState.sequentialRecord.isCaptureActive !== initialCaptureActive) {
      initialState.setSequentialCaptureActive(initialCaptureActive);
    }
    noteSequentialCaptureActivity({ isActive: initialCaptureActive });
    if (selectSequentialPlaybackActive(initialState) || initialCaptureActive) {
      runtime.start();
    }

    return () => {
      unsubscribe();
      accumMsRef.current = 0;
      lastCheckpointFlushMsRef.current = -Infinity;
      flushBufferedSequentialEvents({ state: useAppStore.getState() });
      noteSequentialCaptureActivity({ isActive: false });
      lastCaptureActiveRef.current = false;
      dispatchClearOverlay();
    };
  }, [sequentialRecordModeEnabled, storeRef]);

  useEffect(() => {
    if (!sequentialRecordModeEnabled) {
      return;
    }

    const runtime = getSharedAnimationRuntime();
    const unregister = runtime.register((_timestampMs, deltaMs) => {
      try {
        const timestampMs = Number.isFinite(_timestampMs) ? _timestampMs : Date.now();
        const state = useAppStore.getState() as Partial<AppState>;
        if (!hasSequentialRuntimeState(state)) {
          accumMsRef.current = 0;
          return;
        }
        const playbackActive = selectSequentialPlaybackActive(state);
        const captureActiveNow = selectSequentialCaptureActive(state);
        const shouldAdvanceFrames = playbackActive || captureActiveNow;
        if (!shouldAdvanceFrames) {
          accumMsRef.current = 0;
          lastCheckpointFlushMsRef.current = -Infinity;
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
        const fps = Math.max(1, state.sequentialRecord.fps);
        const sliderScaleRaw = state.tools?.brushSettings?.colorCycleLayerSpeedScale;
        const sliderScale = Number.isFinite(sliderScaleRaw)
          ? Math.max(
              MIN_CC_LAYER_SPEED_SCALE,
              Math.min(MAX_CC_LAYER_SPEED_SCALE, sliderScaleRaw as number)
            )
          : 1;
        const playbackScale = playbackActive ? sliderScale : 1;
        const frameDurationMs = 1000 / (fps * playbackScale);

        let advancedFrames = 0;
        if (shouldAdvanceFrames) {
          accumMsRef.current += Math.max(0, deltaMs);
          if (accumMsRef.current >= frameDurationMs) {
            state.stepSequentialFrame(1);
            accumMsRef.current -= frameDurationMs;
            advancedFrames = 1;
          }
        }

        const nextState = useAppStore.getState() as Partial<AppState>;
        if (!hasSequentialRuntimeState(nextState)) {
          accumMsRef.current = 0;
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

        if (advancedFrames > 0) {
          try {
            if (captureActive && typeof window !== 'undefined') {
              window.dispatchEvent(new CustomEvent('cc:clear-overlay'));
            }
          } catch {
            // no-op
          }
          dispatchGlobalAnimationFrameUpdate();
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
            flushBufferedSequentialEvents({ state: nextState });
            lastCheckpointFlushMsRef.current = timestampMs;
          }
        }

        const tickEnd =
          typeof performance !== 'undefined' && typeof performance.now === 'function'
            ? performance.now()
            : Date.now();
        nextState.recordSequentialRuntimeTick(Math.max(0, tickEnd - tickStart));

        if (timestampMs - lastMetricsSampleMsRef.current >= SEQUENTIAL_METRICS_SAMPLE_MS) {
          lastMetricsSampleMsRef.current = timestampMs;
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
        accumMsRef.current = 0;
        lastCheckpointFlushMsRef.current = -Infinity;
        logError('[useSequentialAnimationRuntimeEffect] runtime tick failed', error);
      }
    });

    return () => {
      unregister();
      accumMsRef.current = 0;
      lastMetricsSampleMsRef.current = -Infinity;
      lastCheckpointFlushMsRef.current = -Infinity;
      lastCaptureActiveRef.current = false;
    };
  }, [sequentialRecordModeEnabled]);
};
