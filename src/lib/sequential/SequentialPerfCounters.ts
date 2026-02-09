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
};

const LOG_INTERVAL_MS = 1000;
const LOGGING_ENABLED =
  process.env.NODE_ENV !== 'production' && process.env.NODE_ENV !== 'test';

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
};

let lastLogAtMs = 0;

const nowMs = (): number =>
  typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();

const logCountersIfNeeded = (): void => {
  if (!LOGGING_ENABLED) {
    return;
  }
  const now = nowMs();
  if (now - lastLogAtMs < LOG_INTERVAL_MS) {
    return;
  }
  lastLogAtMs = now;
  console.debug('[SequentialPerf]', {
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
    },
  });
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
