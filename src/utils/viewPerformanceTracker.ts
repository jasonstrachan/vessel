type SessionType = 'pan' | 'zoom' | 'draw';

interface SessionStats {
  samples: number;
  total: number;
  max: number;
  min: number;
  lastDurations: number[];
}

interface SessionSummary extends SessionStats {
  average: number;
}

const DEFAULT_STATS: SessionStats = {
  samples: 0,
  total: 0,
  max: 0,
  min: Number.POSITIVE_INFINITY,
  lastDurations: []
};

const LAST_SAMPLE_HISTORY = 30;

class ViewPerformanceTracker {
  private readonly stats = new Map<SessionType, SessionStats>();
  private readonly activeSessions = new Set<SessionType>();
  private readonly monitoringEnabled = process.env.NODE_ENV !== 'production';
  private debugLogging = false;

  startSession(type: SessionType): void {
    if (!this.monitoringEnabled) return;
    this.activeSessions.add(type);
  }

  endSession(type: SessionType): void {
    if (!this.monitoringEnabled) return;
    if (!this.activeSessions.has(type)) return;
    this.activeSessions.delete(type);
    this.logSummary(type);
  }

  enableDebugLogging(enabled: boolean): void {
    this.debugLogging = enabled;
    if (!enabled) {
      this.reset();
    }
  }

  record(type: SessionType, durationMs: number): void {
    if (!this.monitoringEnabled) return;

    const entry = this.getOrCreateStats(type);
    entry.samples += 1;
    entry.total += durationMs;
    entry.max = Math.max(entry.max, durationMs);
    entry.min = Math.min(entry.min, durationMs);
    entry.lastDurations.push(durationMs);
    if (entry.lastDurations.length > LAST_SAMPLE_HISTORY) {
      entry.lastDurations.shift();
    }
  }

  getSummary(type: SessionType): SessionSummary | null {
    const entry = this.stats.get(type);
    if (!entry || entry.samples === 0) {
      return null;
    }
    return {
      ...entry,
      average: entry.total / entry.samples
    };
  }

  getAllSummaries(): Record<SessionType, SessionSummary> {
    const summaries: Partial<Record<SessionType, SessionSummary>> = {};
    (['pan', 'zoom', 'draw'] as SessionType[]).forEach((type) => {
      const summary = this.getSummary(type);
      if (summary) {
        summaries[type] = summary;
      }
    });
    return summaries as Record<SessionType, SessionSummary>;
  }

  reset(type?: SessionType): void {
    if (!this.monitoringEnabled) return;
    if (type) {
      this.stats.delete(type);
      return;
    }
    this.stats.clear();
  }

  private getOrCreateStats(type: SessionType): SessionStats {
    let entry = this.stats.get(type);
    if (!entry) {
      entry = { ...DEFAULT_STATS, lastDurations: [] };
      this.stats.set(type, entry);
    }
    return entry;
  }

  private logSummary(type: SessionType): void {
    if (!this.debugLogging) return;
    const summary = this.getSummary(type);
    if (!summary) return;
    const { samples, average, max, min, lastDurations } = summary;
    const last = lastDurations.length > 0 ? lastDurations[lastDurations.length - 1] : 0;
    console.info(
      `[ViewPerformanceTracker] ${type.toUpperCase()} frames — samples: ${samples}, avg: ${average.toFixed(
        2
      )}ms, last: ${last.toFixed(2)}ms, max: ${max.toFixed(2)}ms, min: ${min.toFixed(2)}ms`
    );
  }
}

export const viewPerformanceTracker = new ViewPerformanceTracker();
viewPerformanceTracker.enableDebugLogging(false);

if (process.env.NODE_ENV !== 'production') {
  (globalThis as typeof globalThis & { vesselViewPerf?: ViewPerformanceTracker }).vesselViewPerf =
    viewPerformanceTracker;
}
