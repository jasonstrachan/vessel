import type { PaletteMapEntry } from '@/workers/colorCycleFillTypes';

const COLOR_CYCLE_FILL_WORKER_AREA = 240_000;

export const nowMs = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

export const createYieldController = () => {
  let sliceStart = nowMs();
  return async (iteration: number) => {
    if ((iteration & 0x3f) !== 0) {
      return;
    }
    const now = nowMs();
    if (now - sliceStart > 8) {
      await new Promise<void>(resolve => setTimeout(resolve, 0));
      sliceStart = nowMs();
    }
  };
};

export const resolveBrushSizeBucket = (size: number): number => {
  if (!Number.isFinite(size) || size <= 0) return 0;
  return Math.max(1, 1 << Math.floor(Math.log2(size)));
};

export type RestoreOpts = {
  mode?: 'normal' | 'history';
  preservePaintBuffer?: boolean;
};

export const shouldUseFillWorker = (width: number, height: number) => {
  if (typeof window === 'undefined') {
    return false;
  }
  const area = width * height;
  if (area < COLOR_CYCLE_FILL_WORKER_AREA) {
    return false;
  }
  const cores = (navigator as Navigator & { hardwareConcurrency?: number }).hardwareConcurrency ?? 4;
  return cores <= 12 || area >= COLOR_CYCLE_FILL_WORKER_AREA * 2;
};

export const paletteEntriesFromMap = (map: Map<string, number>): PaletteMapEntry[] => {
  return Array.from(map.entries()).map(([key, index]) => {
    const parts = key.split(',').map((value) => Number(value));
    const [r, g, b] = parts as [number, number, number];
    return { rgb: [r, g, b], index };
  });
};
