export type SequentialPatchOutcomeReason =
  | 'applied_run_patch'
  | 'collapsed_to_band_patch'
  | 'collapsed_to_full_patch'
  | 'fallback_exception';

export interface SequentialPerfSnapshot {
  flushEvents: number;
  flushCount: number;
  flushLastMs: number;
  flushAvgMs: number;
  appendEvents: number;
  appendCount: number;
  appendLastMs: number;
  appendAvgMs: number;
  materializeEvents: number;
  materializeCount: number;
  materializeLastMs: number;
  materializeAvgMs: number;
  presentationCopyCount: number;
  presentationCopyLastMs: number;
  presentationCopyAvgMs: number;
  presentationCopyTiles: number;
  frameCacheHits: number;
  frameCacheMisses: number;
  frameCacheEntries: number;
  patchAttempts: number;
  patchApplied: number;
  patchFallbacks: number;
  patchReasons: Record<SequentialPatchOutcomeReason, number>;
  temporalDistributionEvents: number;
  temporalDistributionSplits: number;
}

const createInitialPatchReasons = (): Record<SequentialPatchOutcomeReason, number> => ({
  applied_run_patch: 0,
  collapsed_to_band_patch: 0,
  collapsed_to_full_patch: 0,
  fallback_exception: 0,
});

const createInitialSnapshot = (): SequentialPerfSnapshot => ({
  flushEvents: 0,
  flushCount: 0,
  flushLastMs: 0,
  flushAvgMs: 0,
  appendEvents: 0,
  appendCount: 0,
  appendLastMs: 0,
  appendAvgMs: 0,
  materializeEvents: 0,
  materializeCount: 0,
  materializeLastMs: 0,
  materializeAvgMs: 0,
  presentationCopyCount: 0,
  presentationCopyLastMs: 0,
  presentationCopyAvgMs: 0,
  presentationCopyTiles: 0,
  frameCacheHits: 0,
  frameCacheMisses: 0,
  frameCacheEntries: 0,
  patchAttempts: 0,
  patchApplied: 0,
  patchFallbacks: 0,
  patchReasons: createInitialPatchReasons(),
  temporalDistributionEvents: 0,
  temporalDistributionSplits: 0,
});

let snapshot: SequentialPerfSnapshot = createInitialSnapshot();

const updateAverage = (previousAvg: number, count: number, nextMs: number): number =>
  previousAvg + (nextMs - previousAvg) / Math.max(1, count);

export const recordSequentialFlushPerf = (args: {
  events: number;
  durationMs: number;
}): void => {
  snapshot.flushCount += 1;
  snapshot.flushEvents += Math.max(0, Math.round(args.events));
  snapshot.flushLastMs = Math.max(0, args.durationMs);
  snapshot.flushAvgMs = updateAverage(
    snapshot.flushAvgMs,
    snapshot.flushCount,
    snapshot.flushLastMs
  );
};

export const recordSequentialAppendPerf = (args: {
  events: number;
  durationMs: number;
}): void => {
  snapshot.appendCount += 1;
  snapshot.appendEvents += Math.max(0, Math.round(args.events));
  snapshot.appendLastMs = Math.max(0, args.durationMs);
  snapshot.appendAvgMs = updateAverage(
    snapshot.appendAvgMs,
    snapshot.appendCount,
    snapshot.appendLastMs
  );
};

export const recordSequentialMaterializePerf = (args: {
  events: number;
  durationMs: number;
}): void => {
  snapshot.materializeCount += 1;
  snapshot.materializeEvents += Math.max(0, Math.round(args.events));
  snapshot.materializeLastMs = Math.max(0, args.durationMs);
  snapshot.materializeAvgMs = updateAverage(
    snapshot.materializeAvgMs,
    snapshot.materializeCount,
    snapshot.materializeLastMs
  );
};

export const setSequentialFrameCacheSnapshot = (args: {
  hits: number;
  misses: number;
  entries: number;
}): void => {
  snapshot.frameCacheHits = Math.max(0, Math.round(args.hits));
  snapshot.frameCacheMisses = Math.max(0, Math.round(args.misses));
  snapshot.frameCacheEntries = Math.max(0, Math.round(args.entries));
};

export const recordSequentialPresentationCopyPerf = (args: {
  tiles: number;
  durationMs: number;
}): void => {
  snapshot.presentationCopyCount += 1;
  snapshot.presentationCopyTiles += Math.max(0, Math.round(args.tiles));
  snapshot.presentationCopyLastMs = Math.max(0, args.durationMs);
  snapshot.presentationCopyAvgMs = updateAverage(
    snapshot.presentationCopyAvgMs,
    snapshot.presentationCopyCount,
    snapshot.presentationCopyLastMs
  );
};

export const recordSequentialPatchOutcome = (args: {
  attempts: number;
  applied: number;
  fallbacks: number;
}): void => {
  snapshot.patchAttempts += Math.max(0, Math.round(args.attempts));
  snapshot.patchApplied += Math.max(0, Math.round(args.applied));
  snapshot.patchFallbacks += Math.max(0, Math.round(args.fallbacks));
};

export const recordSequentialPatchReason = (reason: SequentialPatchOutcomeReason): void => {
  snapshot.patchReasons[reason] += 1;
};

export const recordSequentialTemporalDistributionPerf = (args: {
  events: number;
  buckets: number;
  splitCapture: boolean;
  reason: string;
  smear: number;
  inputStamps: number;
}): void => {
  snapshot.temporalDistributionEvents += Math.max(0, Math.round(args.events));
  if (args.splitCapture) {
    snapshot.temporalDistributionSplits += 1;
  }
};

export const getSequentialPerfSnapshot = (): SequentialPerfSnapshot => ({
  ...snapshot,
  patchReasons: { ...snapshot.patchReasons },
});

export const resetSequentialPerfCounters = (): void => {
  snapshot = createInitialSnapshot();
};
