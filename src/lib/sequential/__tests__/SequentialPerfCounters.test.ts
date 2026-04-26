import {
  getSequentialPerfSnapshot,
  recordSequentialAppendPerf,
  recordSequentialFlushPerf,
  recordSequentialPatchOutcome,
  recordSequentialPatchReason,
  recordSequentialPresentationCopyPerf,
  resetSequentialPerfCounters,
  setSequentialFrameCacheSnapshot,
} from '@/lib/sequential/SequentialPerfCounters';

describe('SequentialPerfCounters', () => {
  beforeEach(() => {
    resetSequentialPerfCounters();
  });

  it('records sequential runtime metrics for diagnostics', () => {
    recordSequentialFlushPerf({ events: 2, durationMs: 4 });
    recordSequentialFlushPerf({ events: 4, durationMs: 8 });
    recordSequentialAppendPerf({ events: 3, durationMs: 6 });
    recordSequentialPresentationCopyPerf({ tiles: 5, durationMs: 2 });
    recordSequentialPatchOutcome({ attempts: 2, applied: 1, fallbacks: 1 });
    recordSequentialPatchReason('fallback_exception');
    setSequentialFrameCacheSnapshot({ entries: 7, hits: 11, misses: 13 });

    const snapshot = getSequentialPerfSnapshot();
    expect(snapshot.flushEvents).toBe(6);
    expect(snapshot.flushCount).toBe(2);
    expect(snapshot.flushAvgMs).toBe(6);
    expect(snapshot.appendEvents).toBe(3);
    expect(snapshot.presentationCopyTiles).toBe(5);
    expect(snapshot.patchAttempts).toBe(2);
    expect(snapshot.patchReasons.fallback_exception).toBe(1);
    expect(snapshot.frameCacheEntries).toBe(7);
    expect(snapshot.frameCacheHits).toBe(11);
    expect(snapshot.frameCacheMisses).toBe(13);
  });
});
