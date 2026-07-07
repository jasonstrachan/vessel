import { BAYER_8x8_MATRIX, BLUE_NOISE_16x16, VOID_CLUSTER_8x8 } from '@/utils/ditherAlgorithms';
import type { PatternStyle } from '@/utils/ditherAlgorithms';
import {
  resolveCcPatternThreshold,
  withCcImageTileThresholdResolver,
} from '@/utils/colorCycle/ccPatternThreshold';

import { getImageTileResolverCacheKey, type StampDitherRuntime } from './runtime';

export const STAMP_DITHER_BUCKETS = 64;
const STAMP_DITHER_TILE_BASE_MIN = 64;
const STAMP_DITHER_TILE_BASE_MAX = 128;
const STAMP_DITHER_TILE_TARGET = 128;

export const hashStampDitherCellNoise = (seed: number, cellX: number, cellY: number): number => {
  let h = seed ^ Math.imul(cellX + 1, 0x27d4eb2d) ^ Math.imul(cellY + 1, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h ^= h >>> 12;
  return (h >>> 0) / 4294967295;
};

export const resolveStampDitherBaseSize = (tileScale: number): number => {
  const scale = Math.max(1, Math.floor(tileScale));
  const raw = Math.ceil(STAMP_DITHER_TILE_TARGET / scale);
  const clamped = Math.max(STAMP_DITHER_TILE_BASE_MIN, Math.min(STAMP_DITHER_TILE_BASE_MAX, raw));
  const rounded = Math.ceil(clamped / 8) * 8;
  return Math.max(STAMP_DITHER_TILE_BASE_MIN, Math.min(STAMP_DITHER_TILE_BASE_MAX, rounded));
};

export const resolveStampDitherTileSample = (
  tile: Uint8Array,
  tileSize: number,
  worldX: number,
  worldY: number,
  originX: number,
  originY: number,
  seed: number,
): number => {
  const size = Math.max(1, Math.floor(tileSize));
  const relX = worldX - originX;
  const relY = worldY - originY;
  const blockX = Math.floor(relX / size);
  const blockY = Math.floor(relY / size);
  let h = seed ^ Math.imul(blockX + 1, 0x27d4eb2d) ^ Math.imul(blockY + 1, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h ^= h >>> 12;
  const flipX = (h & 1) === 1;
  const flipY = (h & 2) === 2;
  const swap = (h & 4) === 4;
  const offsetX = (h >>> 3) % size;
  const offsetY = (h >>> 19) % size;

  let x = ((relX % size) + size) % size;
  let y = ((relY % size) + size) % size;
  x = (x + offsetX) % size;
  y = (y + offsetY) % size;
  if (swap) {
    const tmp = x;
    x = y;
    y = tmp;
  }
  if (flipX) x = size - 1 - x;
  if (flipY) y = size - 1 - y;

  const idx = (y * size + x) % tile.length;
  return tile[idx] ? 0.0 : 1.0;
};

const buildBaseStampDitherTile = (
  bucket: number,
  baseSize: number,
  algo: string,
  pattern: PatternStyle,
  imageTileThresholdResolver?: (x: number, y: number) => number | null,
): Uint8Array => {
  const tileSize = Math.max(1, Math.floor(baseSize));
  const clampedBucket = Math.max(0, Math.min(STAMP_DITHER_BUCKETS - 1, bucket));
  const coverage = clampedBucket / Math.max(1, STAMP_DITHER_BUCKETS - 1);
  if (algo === 'pattern') {
    const result = new Uint8Array(tileSize * tileSize);
    for (let y = 0; y < tileSize; y += 1) {
      for (let x = 0; x < tileSize; x += 1) {
        const patternValue = withCcImageTileThresholdResolver(
          imageTileThresholdResolver,
          () => resolveCcPatternThreshold(pattern, x, y, coverage),
        );
        result[y * tileSize + x] = patternValue <= coverage ? 1 : 0;
      }
    }
    return result;
  }
  const result = new Uint8Array(tileSize * tileSize);
  const toByte = (value: number) => Math.max(0, Math.min(255, Math.round(value * 255)));
  const fillFromMatrix = (matrix: number[][]) => {
    const matrixSize = matrix.length;
    for (let y = 0; y < tileSize; y += 1) {
      const row = matrix[y % matrixSize];
      for (let x = 0; x < tileSize; x += 1) {
        const threshold = row[x % matrixSize];
        result[y * tileSize + x] = toByte(threshold);
      }
    }
  };

  if (algo === 'bayer') {
    fillFromMatrix(BAYER_8x8_MATRIX);
    return result;
  }
  if (algo === 'blue-noise') {
    fillFromMatrix(BLUE_NOISE_16x16);
    return result;
  }
  if (algo === 'void-and-cluster') {
    fillFromMatrix(VOID_CLUSTER_8x8);
    return result;
  }
  const noiseSeed = 0x9e3779b9 ^ (clampedBucket << 8) ^ tileSize;
  for (let y = 0; y < tileSize; y += 1) {
    for (let x = 0; x < tileSize; x += 1) {
      result[y * tileSize + x] = toByte(hashStampDitherCellNoise(noiseSeed, x, y));
    }
  }
  return result;
};

const scaleStampDitherTile = (base: Uint8Array, scale: number, baseSize: number): Uint8Array => {
  if (scale <= 1) {
    return base;
  }
  const baseTileSize = Math.max(1, Math.floor(baseSize));
  const scaledSize = baseTileSize * scale;
  const scaled = new Uint8Array(scaledSize * scaledSize);
  for (let y = 0; y < scaledSize; y += 1) {
    const baseY = Math.floor(y / scale);
    for (let x = 0; x < scaledSize; x += 1) {
      const baseX = Math.floor(x / scale);
      const baseIdx = baseY * baseTileSize + baseX;
      scaled[y * scaledSize + x] = base[baseIdx];
    }
  }
  return scaled;
};

const getBaseStampDitherTile = (
  runtime: StampDitherRuntime,
  bucket: number,
  baseSize: number,
  algoOverride: string,
  patternOverride: PatternStyle,
  imageTileThresholdResolver?: (x: number, y: number) => number | null,
): Uint8Array => {
  const normalizedBucket = Math.max(0, Math.min(STAMP_DITHER_BUCKETS - 1, bucket | 0));
  const algo = algoOverride;
  const pattern = patternOverride;
  const sizeKey = Math.max(1, Math.floor(baseSize));
  const imageTileKey = pattern === 'image-tile'
    ? getImageTileResolverCacheKey(runtime, imageTileThresholdResolver)
    : 'none';
  const cacheKey = `${algo}|${pattern}|${imageTileKey}|${normalizedBucket}|${sizeKey}`;
  let tile = runtime.baseTiles.get(cacheKey);
  if (!tile) {
    tile = buildBaseStampDitherTile(
      normalizedBucket,
      sizeKey,
      algo,
      pattern,
      imageTileThresholdResolver,
    );
    runtime.baseTiles.set(cacheKey, tile);
  }
  return tile;
};

export const getStampDitherTile = (
  runtime: StampDitherRuntime,
  bucket: number,
  overrideScale: number,
  baseSize: number,
  algoOverride: string,
  patternOverride: PatternStyle,
  imageTileThresholdResolver?: (x: number, y: number) => number | null,
): Uint8Array => {
  const normalizedBucket = Math.max(0, Math.min(STAMP_DITHER_BUCKETS - 1, bucket | 0));
  const algo = algoOverride;
  const pattern = patternOverride;
  const scale = Math.max(1, Math.floor(overrideScale));
  const sizeKey = Math.max(1, Math.floor(baseSize));
  const imageTileKey = pattern === 'image-tile'
    ? getImageTileResolverCacheKey(runtime, imageTileThresholdResolver)
    : 'none';
  const cacheKey = `${algo}|${pattern}|${imageTileKey}|${normalizedBucket}|${sizeKey}|${scale}`;
  let tile = runtime.tiles.get(cacheKey);
  if (!tile) {
    const baseTile = getBaseStampDitherTile(
      runtime,
      normalizedBucket,
      sizeKey,
      algo,
      pattern,
      imageTileThresholdResolver,
    );
    tile = scale === 1 ? baseTile : scaleStampDitherTile(baseTile, scale, sizeKey);
    runtime.tiles.set(cacheKey, tile);
  }
  return tile;
};
