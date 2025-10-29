import { GradientPalette, GradientStop } from '@/lib/GradientPalette';
import { cacheLog } from '@/utils/devLog';
import { performanceMonitor } from '@/utils/performanceMonitor';

export interface PaletteHandle {
  key: string;
  size: number;
  rgba: Uint8ClampedArray;
  rgbaByteLength: number;
  uint32: Uint32Array;
  stopIndices: Uint8Array;
}

export type PaletteCacheEventType = 'hit' | 'miss';

export interface PaletteCacheEvent {
  type: PaletteCacheEventType;
  key: string;
  size: number;
  timestamp: number;
}

export interface PaletteCacheStats {
  hits: number;
  misses: number;
  hitRate: number;
  lastEvent?: PaletteCacheEvent;
}

export interface PaletteRequest {
  palette?: GradientPalette;
  stops?: GradientStop[];
  size?: number;
}

type PaletteCacheEntry = {
  handle: PaletteHandle;
};

const DEFAULT_SIZE = 256;
const cache = new Map<string, PaletteCacheEntry>();
const listeners = new Set<(event: PaletteCacheEvent) => void>();
const stats: { hits: number; misses: number; lastEvent?: PaletteCacheEvent } = {
  hits: 0,
  misses: 0,
};
const LOG_SAMPLE_INTERVAL = 50;

function now(): number {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now();
  }
  return Date.now();
}

function notify(event: PaletteCacheEvent): void {
  stats.lastEvent = event;
  for (const listener of listeners) {
    try {
      listener(event);
    } catch (error) {
      cacheLog.warn('palette metrics listener error', { error });
    }
  }

  // Intentionally mute verbose logging to avoid noise in development consoles.
  // Stats remain accessible via performanceMonitor.getMetrics() if needed.
}

function recordEvent(type: PaletteCacheEventType, key: string, size: number): void {
  const event: PaletteCacheEvent = {
    type,
    key,
    size,
    timestamp: now(),
  };

  if (type === 'hit') {
    stats.hits += 1;
    performanceMonitor.recordCacheHit();
  } else {
    stats.misses += 1;
    performanceMonitor.recordCacheMiss();
  }

  notify(event);
}

function resetStats(): void {
  stats.hits = 0;
  stats.misses = 0;
  stats.lastEvent = undefined;
}

function normalizeColor(color: GradientStop['color']): string {
  if (typeof color === 'string') {
    return color.toLowerCase();
  }
  const r = Math.max(0, Math.min(255, Math.round(color.r)));
  const g = Math.max(0, Math.min(255, Math.round(color.g)));
  const b = Math.max(0, Math.min(255, Math.round(color.b)));
  return `rgb(${r},${g},${b})`;
}

function buildKey(stops: GradientStop[], size: number): string {
  const canonical = stops.map((stop) => ({
    p: Number(stop.position.toFixed(6)),
    c: normalizeColor(stop.color),
  }));
  return JSON.stringify({ size, stops: canonical });
}

function packToUint32(rgba: Uint8ClampedArray, size: number): Uint32Array {
  const count = Math.floor(rgba.length / 4);
  const target = new Uint32Array(count || size);
  for (let i = 0; i < target.length; i++) {
    const idx = i * 4;
    const r = rgba[idx];
    const g = rgba[idx + 1];
    const b = rgba[idx + 2];
    const a = rgba[idx + 3];
    target[i] = (a << 24) | (b << 16) | (g << 8) | r;
  }
  return target;
}

function packStopIndices(stops: GradientStop[], paletteSize: number): Uint8Array {
  if (!stops.length) {
    return new Uint8Array(0);
  }

  const map = new Uint8Array(stops.length);
  const span = Math.max(1, Math.min(255, paletteSize));

  for (let i = 0; i < stops.length; i++) {
    const stop = stops[i];
    const rawPos = typeof stop.position === 'number' && Number.isFinite(stop.position) ? stop.position : 0;
    const clamped = Math.max(0, Math.min(1, rawPos));
    const scaled = Math.round(clamped * (span - 1)) + 1;
    map[i] = Math.max(1, Math.min(255, scaled));
  }

  return map;
}

function resolveStops(request: PaletteRequest, palette: GradientPalette): GradientStop[] {
  if (request.stops && request.stops.length > 0) {
    return request.stops;
  }
  return palette.getGradientStops();
}

function resolvePalette(request: PaletteRequest): GradientPalette {
  if (request.palette) {
    return request.palette;
  }
  if (request.stops && request.stops.length > 0) {
    return new GradientPalette(request.stops);
  }
  return GradientPalette.createDefault();
}

export function ensurePalette(request: PaletteRequest = {}): PaletteHandle {
  const palette = resolvePalette(request);
  const size = request.size ?? DEFAULT_SIZE;
  const stops = resolveStops(request, palette);
  const key = buildKey(stops, size);
  const cached = cache.get(key);
  if (cached) {
    recordEvent('hit', key, cached.handle.rgbaByteLength);
    return cached.handle;
  }

  const rgba = palette.getPaletteColors();
  const uint32 = packToUint32(rgba, size);
  const stopIndices = packStopIndices(stops, rgba.length / 4);
  const handle: PaletteHandle = {
    key,
    size,
    rgba,
    rgbaByteLength: rgba.byteLength,
    uint32,
    stopIndices,
  };
  cache.set(key, { handle });
  recordEvent('miss', key, handle.rgbaByteLength);
  return handle;
}

export function invalidatePalette(request: PaletteRequest): void {
  const palette = resolvePalette(request);
  const size = request.size ?? DEFAULT_SIZE;
  const stops = resolveStops(request, palette);
  const key = buildKey(stops, size);
  cache.delete(key);
}

export function clearPaletteCache(): void {
  cache.clear();
  resetStats();
}

export function subscribeToPaletteMetrics(listener: (event: PaletteCacheEvent) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getPaletteCacheStats(): PaletteCacheStats {
  const total = stats.hits + stats.misses;
  return {
    hits: stats.hits,
    misses: stats.misses,
    hitRate: total ? stats.hits / total : 0,
    lastEvent: stats.lastEvent,
  };
}
