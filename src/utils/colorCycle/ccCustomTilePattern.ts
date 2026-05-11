import type { CcCustomTilePattern } from '@/types';

export type CcCustomTilePatternRuntime = {
  id: string;
  width: number;
  height: number;
  data: Uint8ClampedArray;
};

export type CcCustomTilePatternSettings = {
  patternTileId?: string | null;
  patternTileScale?: number | null;
  patternTileInvert?: boolean | null;
  patternTileThreshold?: number | null;
  patternTileOffsetX?: number | null;
  patternTileOffsetY?: number | null;
};

type RuntimeCacheEntry = {
  signature: string;
  runtime: CcCustomTilePatternRuntime | null;
};

const runtimeCache = new Map<string, RuntimeCacheEntry>();

const mod = (value: number, modulo: number): number => ((value % modulo) + modulo) % modulo;

export const encodeRgbaToBase64 = (rgba: Uint8ClampedArray | Uint8Array): string => {
  let binary = '';
  for (let i = 0; i < rgba.length; i += 1) {
    binary += String.fromCharCode(rgba[i]);
  }
  if (typeof btoa === 'function') {
    return btoa(binary);
  }
  const maybeBuffer = (globalThis as typeof globalThis & {
    Buffer?: { from: (value: string, encoding: 'binary') => { toString: (encoding: 'base64') => string } };
  }).Buffer;
  if (maybeBuffer) {
    return maybeBuffer.from(binary, 'binary').toString('base64');
  }
  throw new Error('No base64 encoder available');
};

export const decodeRgbaBase64 = (base64: string): Uint8ClampedArray | null => {
  try {
    let binary = '';
    if (typeof atob === 'function') {
      binary = atob(base64);
    } else {
      const maybeBuffer = (globalThis as typeof globalThis & {
        Buffer?: { from: (value: string, encoding: 'base64') => { toString: (encoding: 'binary') => string } };
      }).Buffer;
      if (!maybeBuffer) {
        return null;
      }
      binary = maybeBuffer.from(base64, 'base64').toString('binary');
    }
    const bytes = new Uint8ClampedArray(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i) & 0xff;
    }
    return bytes;
  } catch {
    return null;
  }
};

export const normalizeCcCustomTilePattern = (
  pattern: CcCustomTilePattern
): CcCustomTilePattern | null => {
  const width = Math.floor(pattern.width);
  const height = Math.floor(pattern.height);
  if (width < 1 || height < 1) {
    return null;
  }
  if (width !== pattern.width || height !== pattern.height) {
    return null;
  }
  const decoded = decodeRgbaBase64(pattern.rgbaBase64);
  if (!decoded || decoded.length !== width * height * 4) {
    return null;
  }
  return {
    id: String(pattern.id || `tile_${Date.now()}`),
    name: String(pattern.name || 'Tile'),
    width,
    height,
    rgbaBase64: pattern.rgbaBase64,
    createdAt: Number.isFinite(pattern.createdAt) ? pattern.createdAt : Date.now(),
    updatedAt: Number.isFinite(pattern.updatedAt) ? pattern.updatedAt : Date.now(),
  };
};

export const toCcCustomTileRuntime = (
  pattern: CcCustomTilePattern | undefined | null
): CcCustomTilePatternRuntime | null => {
  if (!pattern) {
    return null;
  }
  const signature = [
    pattern.width,
    pattern.height,
    pattern.updatedAt,
    pattern.rgbaBase64,
  ].join(':');
  const cached = runtimeCache.get(pattern.id);
  if (cached && cached.signature === signature) {
    return cached.runtime;
  }
  const normalized = normalizeCcCustomTilePattern(pattern);
  if (!normalized) {
    runtimeCache.set(pattern.id, { signature, runtime: null });
    return null;
  }
  const decoded = decodeRgbaBase64(normalized.rgbaBase64);
  if (!decoded) {
    runtimeCache.set(pattern.id, { signature, runtime: null });
    return null;
  }
  const runtime: CcCustomTilePatternRuntime = {
    id: normalized.id,
    width: normalized.width,
    height: normalized.height,
    data: decoded,
  };
  runtimeCache.set(pattern.id, { signature, runtime });
  return runtime;
};

export const clearCcCustomTilePatternCache = (id?: string): void => {
  if (id) {
    runtimeCache.delete(id);
    return;
  }
  runtimeCache.clear();
};

export const resolveCcCustomTileThreshold = (
  tile: CcCustomTilePatternRuntime,
  x: number,
  y: number,
  settings: CcCustomTilePatternSettings = {}
): number => {
  const scale = Math.max(1, Math.round(settings.patternTileScale ?? 1));
  const offsetX = Math.round(settings.patternTileOffsetX ?? 0);
  const offsetY = Math.round(settings.patternTileOffsetY ?? 0);
  const tileX = mod(Math.floor((x + offsetX) / scale), tile.width);
  const tileY = mod(Math.floor((y + offsetY) / scale), tile.height);
  const idx = (tileY * tile.width + tileX) * 4;
  const r = tile.data[idx] ?? 255;
  const g = tile.data[idx + 1] ?? 255;
  const b = tile.data[idx + 2] ?? 255;
  const a = tile.data[idx + 3] ?? 0;
  const alpha = a / 255;
  const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  let threshold = alpha * luminance + (1 - alpha);
  if (settings.patternTileInvert) {
    threshold = 1 - threshold;
  }
  const cutoff = settings.patternTileThreshold;
  if (Number.isFinite(cutoff)) {
    const normalizedCutoff = Math.max(0, Math.min(1, Number(cutoff)));
    threshold = threshold >= normalizedCutoff ? 1 : 0;
  }
  return Math.max(0, Math.min(1, threshold));
};

export const createCcCustomTileThresholdResolver = (
  patterns: readonly CcCustomTilePattern[] | undefined,
  settings: CcCustomTilePatternSettings
): ((x: number, y: number) => number | null) | null => {
  const tileId = settings.patternTileId;
  if (!tileId) {
    return null;
  }
  const tile = toCcCustomTileRuntime(patterns?.find((pattern) => pattern.id === tileId));
  if (!tile) {
    return null;
  }
  const snapshot = { ...settings };
  return (x, y) => resolveCcCustomTileThreshold(tile, x, y, snapshot);
};

export const makeCcCustomTilePattern = ({
  name,
  imageData,
}: {
  name: string;
  imageData: ImageData;
}): CcCustomTilePattern => {
  const width = Math.floor(imageData.width);
  const height = Math.floor(imageData.height);
  if (width < 1 || height < 1) {
    throw new Error('Tile pattern must be at least 1px in each dimension.');
  }
  const rgba = imageData.data;
  const now = Date.now();
  return {
    id: `cc_tile_${now}_${Math.random().toString(36).slice(2, 8)}`,
    name,
    width,
    height,
    rgbaBase64: encodeRgbaToBase64(rgba),
    createdAt: now,
    updatedAt: now,
  };
};
