import { getErrorDiffusionKernel, isErrorDiffusionAlgorithm, type StampDitherConfig } from './strokeStampDither/coverage';
import { getImageTileResolverCacheKey, type StampDitherRuntime } from './strokeStampDither/runtime';
import { getStampDitherTile, hashStampDitherCellNoise, resolveStampDitherBaseSize, STAMP_DITHER_BUCKETS, STAMP_DITHER_FLAT_BUCKET } from './strokeStampDither/tile';

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

export const resolveCcPencilPressure = (pressure: number, sensitivity = 50): number =>
  Math.pow(clamp01(Number.isFinite(pressure) ? pressure : 0.5), (270 - 200 * clamp01(sensitivity / 100)) / 100);

export const resolveCcPencilSize = (size: number, pressure: number, sensitivity = 50): number =>
  Math.max(1, size * (0.65 + 0.35 * resolveCcPencilPressure(pressure, sensitivity)));

export type CcPencilMask = { tile: Uint8Array; size: number; accepts: (x: number, y: number) => boolean };
// A fixed Sierra Lite half-tone supplies the paper structure. Rank each half
// independently so pressure reveals nested pores without reseeding the paper.
const sierraGrainCache = new WeakMap<StampDitherRuntime['imageTileResolverIds'], Map<string, Float32Array>>();
const getSierraGrain = (runtime: StampDitherRuntime, size: number, diversity?: number): Float32Array => {
  let grains = sierraGrainCache.get(runtime.imageTileResolverIds);
  if (!grains) {
    grains = new Map();
    sierraGrainCache.set(runtime.imageTileResolverIds, grains);
  }
  const key = `${size}|${diversity}`;
  const cached = grains.get(key);
  if (cached) return cached;
  const texture = getStampDitherTile(runtime, STAMP_DITHER_FLAT_BUCKET, 1, size, 'sierra-lite', 'dots', undefined, diversity);
  const grain = new Float32Array(texture.length);
  const ranks = Array.from({ length: texture.length }, (_, index) => index);
  const noise = Float32Array.from(ranks, (index) => hashStampDitherCellNoise(0, index % size, Math.floor(index / size)));
  ranks.sort((a, b) => texture[a] - texture[b] || noise[a] - noise[b] || a - b);
  const split = ranks.findIndex((index) => texture[index] !== 0);
  for (let rank = 0; rank < ranks.length; rank += 1) {
    grain[ranks[rank]] = rank < split
      ? 0.5 * (rank + 0.5) / split
      : 0.5 + 0.5 * (rank - split + 0.5) / (ranks.length - split);
  }
  if (grains.size >= 16) grains.delete(grains.keys().next().value!);
  grains.set(key, grain);
  return grain;
};
const cache = new WeakMap<StampDitherRuntime['imageTileResolverIds'], Map<string, CcPencilMask>>();

export const getCcPencilMask = ({
  runtime, config, pressure, sensitivity = 50,
}: {
  runtime: StampDitherRuntime;
  config: StampDitherConfig;
  pressure: number;
  sensitivity?: number;
}): CcPencilMask => {
  const scale = Math.max(1, Math.min(64, Math.round(Number.isFinite(config.pixelSize) ? config.pixelSize : 1)));
  const baseSize = resolveStampDitherBaseSize(scale);
  const level = Math.round(resolveCcPencilPressure(pressure, sensitivity) * (STAMP_DITHER_BUCKETS - 1));
  const coverage = level === STAMP_DITHER_FLAT_BUCKET ? 0.5 : level / (STAMP_DITHER_BUCKETS - 1);
  const resolverKey = getImageTileResolverCacheKey(runtime, config.imageTileThresholdResolver);
  const key = `${config.algorithm}|${config.patternStyle}|${resolverKey}|${config.diversity}|${scale}|${level}`;
  let masks = cache.get(runtime.imageTileResolverIds);
  if (!masks) {
    masks = new Map();
    cache.set(runtime.imageTileResolverIds, masks);
  }
  const cached = masks.get(key);
  if (cached) return cached;

  let base: Uint8Array;
  if (level === 0 || level === STAMP_DITHER_BUCKETS - 1) {
    base = new Uint8Array(baseSize * baseSize).fill(level === 0 ? 0 : 1);
  } else if (config.algorithm === 'sierra-lite') {
    base = Uint8Array.from(getSierraGrain(runtime, baseSize, config.diversity), (value) => Number(value < coverage));
  } else if (isErrorDiffusionAlgorithm(config.algorithm)) {
    // Use the selected diffusion kernel, rather than the stamp preview's noise fallback.
    const kernel = getErrorDiffusionKernel(config.algorithm);
    const values = new Float32Array(baseSize * baseSize).fill(coverage);
    base = new Uint8Array(values.length);
    for (let y = 0; y < baseSize; y += 1) {
      const direction = kernel.serpentine && y % 2 ? -1 : 1;
      for (let step = 0; step < baseSize; step += 1) {
        const x = direction === 1 ? step : baseSize - 1 - step;
        const index = y * baseSize + x;
        const value = clamp01(values[index]);
        base[index] = value >= 0.5 ? 1 : 0;
        const error = (value - base[index]) * kernel.errorScale;
        for (const tap of kernel.taps) {
          const nx = x + tap.dx * direction, ny = y + tap.dy;
          if (nx >= 0 && nx < baseSize && ny < baseSize) {
            values[ny * baseSize + nx] += error * tap.weight / kernel.divisor;
          }
        }
      }
    }
  } else {
    const texture = getStampDitherTile(runtime, level, 1, baseSize, config.algorithm,
      config.patternStyle ?? 'dots', config.imageTileThresholdResolver, config.diversity);
    base = Uint8Array.from(texture, (value) => config.algorithm === 'pattern'
      ? (value !== 0 ? 1 : 0)
      : (value <= Math.round(coverage * 255) ? 1 : 0));
  }
  const size = baseSize * scale;
  const tile = new Uint8Array(size * size);
  for (let y = 0; y < size; y += 1) for (let x = 0; x < size; x += 1) {
    tile[y * size + x] = base[Math.floor(y / scale) * baseSize + Math.floor(x / scale)];
  }
  const mask = { tile, size, accepts: (x: number, y: number) => {
    const px = ((Math.floor(x) % size) + size) % size;
    const py = ((Math.floor(y) % size) + size) % size;
    return tile[py * size + px] !== 0;
  } };
  // Res can reach 64 px; cap retained bytes as well as pressure levels.
  let retainedBytes = 0;
  for (const value of masks.values()) retainedBytes += value.tile.byteLength;
  while (masks.size > 0 && (masks.size >= 64 || retainedBytes + tile.byteLength > 8 * 1024 * 1024)) {
    const oldestKey = masks.keys().next().value!;
    retainedBytes -= masks.get(oldestKey)!.tile.byteLength;
    masks.delete(oldestKey);
  }
  masks.set(key, mask);
  return mask;
};
