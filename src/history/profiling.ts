import type { HistoryDelta, HistoryEntry } from './actionTypes';

interface ColorCycleMetrics {
  sampleCount: number;
  totalBytes: number;
  maxBytes: number;
  lastBytes: number;
  totalTiles: number;
  maxTiles: number;
  lastEntryId: string | null;
  lastLayerId: string | null;
}

const metrics: ColorCycleMetrics = {
  sampleCount: 0,
  totalBytes: 0,
  maxBytes: 0,
  lastBytes: 0,
  totalTiles: 0,
  maxTiles: 0,
  lastEntryId: null,
  lastLayerId: null,
};

const shouldProfileEntry = (entry: HistoryEntry): boolean =>
  entry.deltas.some((delta) => delta._tag === 'color-cycle-stroke' || delta._tag === 'color-cycle-stroke-patch');

const computeEntryBytes = (entry: HistoryEntry): number =>
  typeof entry.meta?.approxBytes === 'number'
    ? entry.meta.approxBytes
    : entry.deltas.reduce((sum, delta) => sum + (delta.approxBytes ?? 0), 0);

const extractTileCount = (delta: HistoryDelta): number => {
  if ('tileCount' in delta) {
    const tileCount = (delta as { tileCount?: unknown }).tileCount;
    if (typeof tileCount === 'number' && Number.isFinite(tileCount)) {
      return tileCount;
    }
  }
  return 0;
};

export const recordHistoryEntryMetrics = (entry: HistoryEntry): void => {
  if (process.env.NODE_ENV === 'production') {
    return;
  }
  if (!shouldProfileEntry(entry)) {
    return;
  }

  const approxBytes = computeEntryBytes(entry);
  const tileCount = entry.deltas.reduce(
    (sum, delta) => sum + extractTileCount(delta),
    0,
  );

  metrics.sampleCount += 1;
  metrics.totalBytes += approxBytes;
  metrics.maxBytes = Math.max(metrics.maxBytes, approxBytes);
  metrics.lastBytes = approxBytes;
  metrics.totalTiles += tileCount;
  metrics.maxTiles = Math.max(metrics.maxTiles, tileCount);
  metrics.lastEntryId = entry.id;
  metrics.lastLayerId = typeof entry.meta?.layerId === 'string' ? (entry.meta.layerId as string) : null;

};

export const getColorCycleHistoryMetrics = (): Readonly<{
  samples: number;
  averageBytes: number;
  maxBytes: number;
  lastBytes: number;
  averageTiles: number;
  maxTiles: number;
  lastEntryId: string | null;
  lastLayerId: string | null;
}> => {
  const samples = metrics.sampleCount;
  return {
    samples,
    averageBytes: samples > 0 ? metrics.totalBytes / samples : 0,
    maxBytes: metrics.maxBytes,
    lastBytes: metrics.lastBytes,
    averageTiles: samples > 0 ? metrics.totalTiles / samples : 0,
    maxTiles: metrics.maxTiles,
    lastEntryId: metrics.lastEntryId,
    lastLayerId: metrics.lastLayerId,
  };
};

export const resetColorCycleHistoryMetrics = (): void => {
  metrics.sampleCount = 0;
  metrics.totalBytes = 0;
  metrics.maxBytes = 0;
  metrics.lastBytes = 0;
  metrics.totalTiles = 0;
  metrics.maxTiles = 0;
  metrics.lastEntryId = null;
  metrics.lastLayerId = null;
};

declare global {
  interface Window {
    __vesselHistoryMetrics?: Record<string, unknown>;
  }
  interface WorkerGlobalScope {
    __vesselHistoryMetrics?: Record<string, unknown>;
  }
}

if (process.env.NODE_ENV !== 'production') {
  const globalScope = globalThis as typeof globalThis & {
    __vesselHistoryMetrics?: Record<string, unknown>;
  };
  const bucket = globalScope.__vesselHistoryMetrics ?? {};
  bucket.colorCycleHistory = {
    get: getColorCycleHistoryMetrics,
    reset: resetColorCycleHistoryMetrics,
  };
  globalScope.__vesselHistoryMetrics = bucket;
}
