type SequentialPerfCountersSnapshot = {
  flushCount: number;
  flushEvents: number;
  flushMs: number;
  appendCount: number;
  appendEvents: number;
  appendMs: number;
  materializeCount: number;
  materializeEvents: number;
  materializeMs: number;
  frameCacheHits: number;
  frameCacheMisses: number;
  frameCacheEntries: number;
  patchAttempts: number;
  patchApplied: number;
  patchFallbacks: number;
  patchAppliedRunPatch: number;
  patchCollapsedToBandPatch: number;
  patchCollapsedToFullPatch: number;
  patchFallbackException: number;
  temporalDistributionEvents: number;
  temporalDistributionBuckets: number;
  temporalDistributionCaptures: number;
  temporalDistributionSplitCaptures: number;
  temporalDistributionLastReason: string;
  temporalDistributionLastSmear: number;
  temporalDistributionLastInputStamps: number;
  temporalDistributionLastBucketCount: number;
};

export type SequentialPatchOutcomeReason =
  | 'applied_run_patch'
  | 'collapsed_to_band_patch'
  | 'collapsed_to_full_patch'
  | 'fallback_exception';

type SequentialPerfPublicSnapshot = {
  flush: { count: number; events: number; ms: number };
  append: { count: number; events: number; ms: number };
  materialize: { count: number; events: number; ms: number };
  frameCache: { hits: number; misses: number; entries: number };
  patching: {
    attempts: number;
    applied: number;
    fallbacks: number;
    reasons: Record<SequentialPatchOutcomeReason, number>;
  };
  temporalDistribution: {
    events: number;
    buckets: number;
    captures: number;
    splitCaptures: number;
    avgBucketsPerCapture: number;
    lastReason: string;
    lastSmear: number;
    lastInputStamps: number;
    lastBucketCount: number;
  };
};

declare global {
  interface Window {
    __lastSequentialPerf?: SequentialPerfPublicSnapshot;
  }
}

const LOG_INTERVAL_MS = 1000;
const DEBUG_STORAGE_KEY = 'vessel:debug:sequentialPerf';

const isSequentialPerfLoggingEnabled = (): boolean => {
  if (process.env.NODE_ENV === 'production' || process.env.NODE_ENV === 'test') {
    return false;
  }
  if (typeof window === 'undefined') {
    return false;
  }
  try {
    if ((window as unknown as { __VesselDebugSequentialPerf?: boolean }).__VesselDebugSequentialPerf === true) {
      return true;
    }
    return window.localStorage.getItem(DEBUG_STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
};

const counters: SequentialPerfCountersSnapshot = {
  flushCount: 0,
  flushEvents: 0,
  flushMs: 0,
  appendCount: 0,
  appendEvents: 0,
  appendMs: 0,
  materializeCount: 0,
  materializeEvents: 0,
  materializeMs: 0,
  frameCacheHits: 0,
  frameCacheMisses: 0,
  frameCacheEntries: 0,
  patchAttempts: 0,
  patchApplied: 0,
  patchFallbacks: 0,
  patchAppliedRunPatch: 0,
  patchCollapsedToBandPatch: 0,
  patchCollapsedToFullPatch: 0,
  patchFallbackException: 0,
  temporalDistributionEvents: 0,
  temporalDistributionBuckets: 0,
  temporalDistributionCaptures: 0,
  temporalDistributionSplitCaptures: 0,
  temporalDistributionLastReason: 'init',
  temporalDistributionLastSmear: 0,
  temporalDistributionLastInputStamps: 0,
  temporalDistributionLastBucketCount: 0,
};

let lastLogAtMs = 0;

const buildPublicSnapshot = (): SequentialPerfPublicSnapshot => ({
  flush: {
    count: counters.flushCount,
    events: counters.flushEvents,
    ms: Number(counters.flushMs.toFixed(2)),
  },
  append: {
    count: counters.appendCount,
    events: counters.appendEvents,
    ms: Number(counters.appendMs.toFixed(2)),
  },
  materialize: {
    count: counters.materializeCount,
    events: counters.materializeEvents,
    ms: Number(counters.materializeMs.toFixed(2)),
  },
  frameCache: {
    hits: counters.frameCacheHits,
    misses: counters.frameCacheMisses,
    entries: counters.frameCacheEntries,
  },
  patching: {
    attempts: counters.patchAttempts,
    applied: counters.patchApplied,
    fallbacks: counters.patchFallbacks,
    reasons: {
      applied_run_patch: counters.patchAppliedRunPatch,
      collapsed_to_band_patch: counters.patchCollapsedToBandPatch,
      collapsed_to_full_patch: counters.patchCollapsedToFullPatch,
      fallback_exception: counters.patchFallbackException,
    },
  },
  temporalDistribution: {
    events: counters.temporalDistributionEvents,
    buckets: counters.temporalDistributionBuckets,
    captures: counters.temporalDistributionCaptures,
    splitCaptures: counters.temporalDistributionSplitCaptures,
    avgBucketsPerCapture:
      counters.temporalDistributionCaptures > 0
        ? Number(
            (
              counters.temporalDistributionBuckets /
              counters.temporalDistributionCaptures
            ).toFixed(2)
          )
        : 0,
    lastReason: counters.temporalDistributionLastReason,
    lastSmear: Number(counters.temporalDistributionLastSmear.toFixed(2)),
    lastInputStamps: counters.temporalDistributionLastInputStamps,
    lastBucketCount: counters.temporalDistributionLastBucketCount,
  },
});

if (typeof window !== 'undefined' && !window.__lastSequentialPerf) {
  window.__lastSequentialPerf = buildPublicSnapshot();
}

const nowMs = (): number =>
  typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();

const logCountersIfNeeded = (): void => {
  const payload = buildPublicSnapshot();
  if (typeof window !== 'undefined') {
    window.__lastSequentialPerf = payload;
  }
  if (!isSequentialPerfLoggingEnabled()) {
    return;
  }
  const now = nowMs();
  if (now - lastLogAtMs < LOG_INTERVAL_MS) {
    return;
  }
  lastLogAtMs = now;
  console.log('[SequentialPerf]', payload);
};

export const recordSequentialFlushPerf = ({
  events,
  durationMs,
}: {
  events: number;
  durationMs: number;
}): void => {
  counters.flushCount += 1;
  counters.flushEvents += Math.max(0, Math.round(events));
  counters.flushMs += Math.max(0, durationMs);
  logCountersIfNeeded();
};

export const recordSequentialAppendPerf = ({
  events,
  durationMs,
}: {
  events: number;
  durationMs: number;
}): void => {
  counters.appendCount += 1;
  counters.appendEvents += Math.max(0, Math.round(events));
  counters.appendMs += Math.max(0, durationMs);
  logCountersIfNeeded();
};

export const recordSequentialMaterializePerf = ({
  events,
  durationMs,
}: {
  events: number;
  durationMs: number;
}): void => {
  counters.materializeCount += 1;
  counters.materializeEvents += Math.max(0, Math.round(events));
  counters.materializeMs += Math.max(0, durationMs);
  logCountersIfNeeded();
};

export const setSequentialFrameCacheSnapshot = ({
  hits,
  misses,
  entries,
}: {
  hits: number;
  misses: number;
  entries: number;
}): void => {
  counters.frameCacheHits = Math.max(0, Math.round(hits));
  counters.frameCacheMisses = Math.max(0, Math.round(misses));
  counters.frameCacheEntries = Math.max(0, Math.round(entries));
  logCountersIfNeeded();
};

export const recordSequentialPatchOutcome = ({
  attempts,
  applied,
  fallbacks,
}: {
  attempts: number;
  applied: number;
  fallbacks: number;
}): void => {
  counters.patchAttempts += Math.max(0, Math.round(attempts));
  counters.patchApplied += Math.max(0, Math.round(applied));
  counters.patchFallbacks += Math.max(0, Math.round(fallbacks));
  logCountersIfNeeded();
};

export const recordSequentialPatchReason = (reason: SequentialPatchOutcomeReason): void => {
  switch (reason) {
    case 'applied_run_patch':
      counters.patchAppliedRunPatch += 1;
      break;
    case 'collapsed_to_band_patch':
      counters.patchCollapsedToBandPatch += 1;
      break;
    case 'collapsed_to_full_patch':
      counters.patchCollapsedToFullPatch += 1;
      break;
    case 'fallback_exception':
      counters.patchFallbackException += 1;
      break;
    default:
      break;
  }
  logCountersIfNeeded();
};

export const recordSequentialTemporalDistributionPerf = ({
  events,
  buckets,
  splitCapture,
  reason,
  smear,
  inputStamps,
}: {
  events: number;
  buckets: number;
  splitCapture: boolean;
  reason: string;
  smear: number;
  inputStamps: number;
}): void => {
  counters.temporalDistributionEvents += Math.max(0, Math.round(events));
  counters.temporalDistributionBuckets += Math.max(0, Math.round(buckets));
  counters.temporalDistributionCaptures += 1;
  if (splitCapture) {
    counters.temporalDistributionSplitCaptures += 1;
  }
  counters.temporalDistributionLastReason = reason;
  counters.temporalDistributionLastSmear = Number.isFinite(smear) ? smear : 0;
  counters.temporalDistributionLastInputStamps = Math.max(0, Math.round(inputStamps));
  counters.temporalDistributionLastBucketCount = Math.max(0, Math.round(buckets));
  logCountersIfNeeded();
};
