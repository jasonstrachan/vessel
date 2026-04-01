import {
  BAYER_8x8_MATRIX,
  BLUE_NOISE_16x16,
  VOID_CLUSTER_8x8,
  type DitherAlgorithm,
  type PatternStyle,
} from '@/utils/ditherAlgorithms';

export type FlatInkCount = 2 | 3 | 4;

type BinaryTile = {
  width: number;
  height: number;
  data: Uint8Array;
};

type SierraLiteTileBank = {
  toneBands: BinaryTile[];
};

type FlatInkSet = {
  indices: number[];
};

export type FlatPatternFillOptions = {
  algorithm: DitherAlgorithm;
  patternStyle?: PatternStyle;
  tone: number;
  gridW: number;
  gridH: number;
  fillBackground: boolean;
  baseOffset: number;
  phaseX: number;
  phaseY: number;
  inkCount: FlatInkCount;
  writeCellIndex: (cellIdx: number, index: number) => void;
};

const SIERRA_LITE_TILE_SOURCE_SIZE = 48;
const SIERRA_LITE_TILE_SIZE = 12;
const SIERRA_LITE_THRESHOLD = 0.5;

export const SIERRA_LITE_TONE_BANDS = 5;

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

const indexFromNormalized = (pos: number, baseOffset: number): number => {
  const raw = Math.round(clamp01(pos) * 254);
  const shifted = (raw + baseOffset) % 255;
  return Math.max(1, Math.min(255, shifted + 1));
};

const resolveOrderedThreshold = (
  algorithm: DitherAlgorithm,
  patternStyle: PatternStyle | undefined,
  x: number,
  y: number
): number => {
  if (algorithm === 'bayer') {
    return BAYER_8x8_MATRIX[y & 7][x & 7];
  }
  if (algorithm === 'blue-noise') {
    return BLUE_NOISE_16x16[y & 15][x & 15];
  }
  if (algorithm === 'void-and-cluster') {
    return VOID_CLUSTER_8x8[y & 7][x & 7];
  }

  const style = patternStyle ?? 'dots';
  switch (style) {
    case 'lines':
      return ((x + y) & 1) === 0 ? 0.3 : 0.7;
    case 'vertical-lines':
      return (x & 1) === 0 ? 0.3 : 0.7;
    case 'horizontal-lines':
      return (y & 1) === 0 ? 0.3 : 0.7;
    case 'crosshatch':
      return (((x & 1) + (y & 1)) * 0.25) + 0.25;
    case 'diagonal':
      return (((x + y) & 3) + 0.5) / 4;
    case 'tone-adaptive':
      return 0.5 + (BAYER_8x8_MATRIX[y & 7][x & 7] - 0.5) * 0.55;
    case 'dots':
    default:
      return BAYER_8x8_MATRIX[y & 7][x & 7];
  }
};

export const resolveToneBand = (tone: number): number => {
  const clamped = Math.max(0, Math.min(1, tone));
  return Math.min(4, Math.floor(clamped * SIERRA_LITE_TONE_BANDS));
};

export const resolveFlatInkCountForBand = (band: number): FlatInkCount => {
  if (band <= 0 || band >= SIERRA_LITE_TONE_BANDS - 1) {
    return 2;
  }
  if (band === 2) {
    return 4;
  }
  return 3;
};

const buildFlatAnchorIndices = (baseOffset: number): number[] => [
  indexFromNormalized(0, baseOffset),
  indexFromNormalized(0.25, baseOffset),
  indexFromNormalized(0.5, baseOffset),
  indexFromNormalized(0.75, baseOffset),
  indexFromNormalized(254 / 255, baseOffset),
];

export const resolveFlatInkSetForBand = (
  band: number,
  inkCount: FlatInkCount,
  baseOffset: number
): FlatInkSet => {
  const anchors = buildFlatAnchorIndices(baseOffset);
  const clampedBand = Math.max(0, Math.min(anchors.length - 1, band | 0));
  const maxStart = anchors.length - inkCount;
  const centeredStart = Math.round(clampedBand - ((inkCount - 1) / 2));
  const start = Math.max(0, Math.min(maxStart, centeredStart));
  return {
    indices: anchors.slice(start, start + inkCount),
  };
};

const stableSelector = (x: number, y: number, band: number): number => {
  const sx = x >> 1;
  const sy = y >> 1;
  let hash = (sx * 73856093) ^ (sy * 19349663) ^ (band * 83492791);
  hash ^= hash >>> 13;
  return hash >>> 0;
};

const sampleTile = (
  tile: BinaryTile,
  x: number,
  y: number,
  phaseX: number,
  phaseY: number
): 0 | 1 => {
  const tx = ((x + phaseX) % tile.width + tile.width) % tile.width;
  const ty = ((y + phaseY) % tile.height + tile.height) % tile.height;
  return tile.data[ty * tile.width + tx] as 0 | 1;
};

export const resolveFlatInkIndex = (
  bit: 0 | 1,
  x: number,
  y: number,
  band: number,
  inkSet: FlatInkSet
): number => {
  const { indices } = inkSet;
  if (indices.length <= 1) {
    return indices[0] ?? 0;
  }
  if (indices.length === 2) {
    return bit === 0 ? indices[0] : indices[1];
  }

  const selector = stableSelector(x, y, band);
  if (indices.length === 3) {
    const candidates = bit === 0 ? indices.slice(0, 2) : indices.slice(1);
    return candidates[selector % candidates.length];
  }

  const candidates = bit === 0 ? indices.slice(0, 2) : indices.slice(2);
  return candidates[selector % candidates.length];
};

const cropCenterTile = (source: Uint8Array, sourceSize: number, tileSize: number): BinaryTile => {
  const start = Math.floor((sourceSize - tileSize) / 2);
  const data = new Uint8Array(tileSize * tileSize);
  for (let y = 0; y < tileSize; y += 1) {
    const srcOffset = (start + y) * sourceSize + start;
    data.set(source.subarray(srcOffset, srcOffset + tileSize), y * tileSize);
  }
  return {
    width: tileSize,
    height: tileSize,
    data,
  };
};

const buildSierraLiteTile = (tone: number): BinaryTile => {
  const size = SIERRA_LITE_TILE_SOURCE_SIZE;
  const values = new Uint8Array(size * size);
  const errors = new Float32Array(size * size);

  for (let y = 0; y < size; y += 1) {
    const serpentine = (y & 1) === 1;
    const start = serpentine ? size - 1 : 0;
    const end = serpentine ? -1 : size;
    const step = serpentine ? -1 : 1;

    for (let x = start; x !== end; x += step) {
      const idx = y * size + x;
      const value = clamp01(tone + errors[idx]);
      const bit = value >= SIERRA_LITE_THRESHOLD ? 1 : 0;
      values[idx] = bit;
      const err = value - bit;
      if (err === 0) {
        continue;
      }

      if (!serpentine) {
        if (x + 1 < size) {
          errors[idx + 1] += err * 0.5;
        }
        if (y + 1 < size) {
          if (x - 1 >= 0) {
            errors[idx + size - 1] += err * 0.25;
          }
          errors[idx + size] += err * 0.25;
        }
      } else {
        if (x - 1 >= 0) {
          errors[idx - 1] += err * 0.5;
        }
        if (y + 1 < size) {
          if (x + 1 < size) {
            errors[idx + size + 1] += err * 0.25;
          }
          errors[idx + size] += err * 0.25;
        }
      }
    }
  }

  return cropCenterTile(values, size, SIERRA_LITE_TILE_SIZE);
};

const buildSierraLiteTileBank = (): SierraLiteTileBank => ({
  toneBands: [
    buildSierraLiteTile(0.10),
    buildSierraLiteTile(0.30),
    buildSierraLiteTile(0.50),
    buildSierraLiteTile(0.70),
    buildSierraLiteTile(0.90),
  ],
});

let cachedSierraLiteTileBank: SierraLiteTileBank | null = null;

export const getSierraLiteTileBank = (): SierraLiteTileBank => {
  if (!cachedSierraLiteTileBank) {
    cachedSierraLiteTileBank = buildSierraLiteTileBank();
  }
  return cachedSierraLiteTileBank;
};

const fillSierraLiteFlatPatternMode = ({
  tone,
  gridW,
  gridH,
  fillBackground,
  baseOffset,
  phaseX,
  phaseY,
  inkCount,
  writeCellIndex,
}: Omit<FlatPatternFillOptions, 'algorithm' | 'patternStyle'>): void => {
  const band = resolveToneBand(tone);
  const tile = getSierraLiteTileBank().toneBands[band];
  const inkSet = resolveFlatInkSetForBand(band, inkCount, baseOffset);

  for (let y = 0; y < gridH; y += 1) {
    const rowOffset = y * gridW;
    for (let x = 0; x < gridW; x += 1) {
      const bit = sampleTile(tile, x, y, phaseX, phaseY);
      const index = !fillBackground && bit === 0
        ? 0
        : resolveFlatInkIndex(bit, x, y, band, inkSet);
      writeCellIndex(rowOffset + x, index);
    }
  }
};

const fillOrderedFlatPatternMode = ({
  algorithm,
  patternStyle,
  tone,
  gridW,
  gridH,
  fillBackground,
  baseOffset,
  phaseX,
  phaseY,
  inkCount,
  writeCellIndex,
}: FlatPatternFillOptions): void => {
  const band = resolveToneBand(tone);
  const inkSet = resolveFlatInkSetForBand(band, inkCount, baseOffset);

  for (let y = 0; y < gridH; y += 1) {
    const rowOffset = y * gridW;
    for (let x = 0; x < gridW; x += 1) {
      const bit = tone >= resolveOrderedThreshold(algorithm, patternStyle, x + phaseX, y + phaseY) ? 1 : 0;
      const index = !fillBackground && bit === 0
        ? 0
        : resolveFlatInkIndex(bit, x, y, band, inkSet);
      writeCellIndex(rowOffset + x, index);
    }
  }
};

export const fillFlatPatternMode = (options: FlatPatternFillOptions): void => {
  if (options.algorithm === 'sierra-lite') {
    fillSierraLiteFlatPatternMode(options);
    return;
  }
  fillOrderedFlatPatternMode(options);
};
