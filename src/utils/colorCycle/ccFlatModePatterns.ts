import {
  BAYER_8x8_MATRIX,
  BLUE_NOISE_16x16,
  VOID_CLUSTER_8x8,
  type DitherAlgorithm,
  type PatternStyle,
} from '@/utils/ditherAlgorithms';

export type FlatInkCount = 2;

type FlatInkSet = {
  indices: [number, number];
};

export type FlatPatternFillOptions = {
  algorithm: DitherAlgorithm;
  patternStyle?: PatternStyle;
  tone: number;
  toneByCell?: Uint8Array;
  flatMixByBand?: readonly number[];
  flatBandOverride?: number;
  spread?: number;
  gridW: number;
  gridH: number;
  activeMask?: Uint8Array;
  fillBackground: boolean;
  baseOffset: number;
  phaseX: number;
  phaseY: number;
  writeCellIndex: (cellIdx: number, index: number) => void;
};

const SIERRA_LITE_TONE_BANDS = 5;
const SIERRA_LITE_THRESHOLD = 0.5;
const FLAT_BAND_CENTERS: [number, number, number, number, number] = [26, 77, 128, 179, 230];
const DEFAULT_FLAT_PAIR_HALF_SPREAD = 4;
const MIN_FLAT_PAIR_HALF_SPREAD = 1;
const MAX_FLAT_PAIR_HALF_SPREAD = 24;
const MIN_FLAT_PAIR_DISTANCE = MIN_FLAT_PAIR_HALF_SPREAD * 2;
const MAX_FLAT_PAIR_DISTANCE = MAX_FLAT_PAIR_HALF_SPREAD * 2;

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

const shiftPaletteIndex = (index: number, baseOffset: number): number => {
  const zeroBased = Math.max(0, Math.min(254, index - 1));
  const shifted = (zeroBased + baseOffset) % 255;
  return Math.max(1, Math.min(255, shifted + 1));
};

export const resolveToneBand = (tone: number): number => {
  const clamped = clamp01(tone);
  return Math.min(SIERRA_LITE_TONE_BANDS - 1, Math.floor(clamped * SIERRA_LITE_TONE_BANDS));
};

export const resolveFlatInkCountForBand = (band?: number): FlatInkCount => {
  void band;
  return 2;
};

const resolveFlatPairHalfSpread = (spreadPercent?: number): number => {
  if (!Number.isFinite(spreadPercent)) {
    return DEFAULT_FLAT_PAIR_HALF_SPREAD;
  }
  const clamped = Math.max(0, Math.min(100, spreadPercent ?? 0));
  return MIN_FLAT_PAIR_HALF_SPREAD + Math.round(
    (clamped / 100) * (MAX_FLAT_PAIR_HALF_SPREAD - MIN_FLAT_PAIR_HALF_SPREAD)
  );
};

export const resolveFlatInkSetForBand = (
  band: number,
  _inkCount: FlatInkCount,
  baseOffset: number,
  spreadPercent?: number
): FlatInkSet => {
  const clampedBand = Math.max(0, Math.min(FLAT_BAND_CENTERS.length - 1, band | 0));
  const center = FLAT_BAND_CENTERS[clampedBand];
  const half = resolveFlatPairHalfSpread(spreadPercent);
  const low = shiftPaletteIndex(Math.max(1, center - half), baseOffset);
  const high = shiftPaletteIndex(Math.min(255, center + half), baseOffset);

  return {
    indices: [low, high],
  };
};

export const resolveFlatPairDistance = (band: number, spreadPercent?: number): number => {
  const [low, high] = resolveFlatInkSetForBand(band, 2, 0, spreadPercent).indices;
  return Math.max(1, high - low);
};

export const resolveFlatPairContrastStrength = (distance: number): number => {
  const clampedDistance = Math.max(MIN_FLAT_PAIR_DISTANCE, Math.min(MAX_FLAT_PAIR_DISTANCE, distance));
  return clamp01(
    (clampedDistance - MIN_FLAT_PAIR_DISTANCE) /
    Math.max(1, MAX_FLAT_PAIR_DISTANCE - MIN_FLAT_PAIR_DISTANCE)
  );
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

const resolveCellTone = (
  tone: number,
  toneByCell: Uint8Array | undefined,
  cellIdx: number
): number => {
  if (!toneByCell) {
    return clamp01(tone);
  }
  return clamp01((toneByCell[cellIdx] ?? 0) / 255);
};

const resolveBandMixAmount = (
  band: number,
  fallbackTone: number,
  flatMixByBand?: readonly number[]
): number => {
  if (!flatMixByBand || flatMixByBand.length <= 0) {
    return clamp01(fallbackTone);
  }
  const clampedBand = Math.max(0, Math.min(flatMixByBand.length - 1, band | 0));
  return clamp01(flatMixByBand[clampedBand] ?? fallbackTone);
};

const fillOrderedFlatPatternMode = ({
  algorithm,
  patternStyle,
  tone,
  toneByCell,
  spread,
  gridW,
  gridH,
  activeMask,
  fillBackground,
  baseOffset,
  phaseX,
  phaseY,
  writeCellIndex,
}: FlatPatternFillOptions): void => {
  for (let y = 0; y < gridH; y += 1) {
    const rowOffset = y * gridW;
    for (let x = 0; x < gridW; x += 1) {
      const cellIdx = rowOffset + x;
      if (activeMask && !activeMask[cellIdx]) {
        continue;
      }
      const cellTone = resolveCellTone(tone, toneByCell, cellIdx);
      const band = resolveToneBand(cellTone);
      const inkSet = resolveFlatInkSetForBand(band, 2, baseOffset, spread);
      const bit =
        cellTone >= resolveOrderedThreshold(algorithm, patternStyle, x + phaseX, y + phaseY) ? 1 : 0;
      const index = !fillBackground && bit === 0
        ? 0
        : (bit === 0 ? inkSet.indices[0] : inkSet.indices[1]);
      writeCellIndex(cellIdx, index);
    }
  }
};

const fillSierraLiteFlatPatternMode = ({
  tone,
  toneByCell,
  flatMixByBand,
  flatBandOverride,
  spread,
  gridW,
  gridH,
  activeMask,
  fillBackground,
  baseOffset,
  writeCellIndex,
}: Omit<FlatPatternFillOptions, 'algorithm' | 'patternStyle' | 'phaseX' | 'phaseY'>): void => {
  const errors = new Float32Array(gridW * gridH);

  for (let y = 0; y < gridH; y += 1) {
    const serpentine = (y & 1) === 1;
    const start = serpentine ? gridW - 1 : 0;
    const end = serpentine ? -1 : gridW;
    const step = serpentine ? -1 : 1;

    for (let x = start; x !== end; x += step) {
      const idx = y * gridW + x;
      if (activeMask && !activeMask[idx]) {
        continue;
      }

      const baseTone = resolveCellTone(tone, toneByCell, idx);
      const band = Number.isFinite(flatBandOverride)
        ? Math.max(0, Math.min(SIERRA_LITE_TONE_BANDS - 1, Math.floor(flatBandOverride as number)))
        : resolveToneBand(baseTone);
      const inkSet = resolveFlatInkSetForBand(band, 2, baseOffset, spread);
      const mixAmount = resolveBandMixAmount(band, baseTone, flatMixByBand);
      const value = clamp01(mixAmount + errors[idx]);
      const bit: 0 | 1 = value >= SIERRA_LITE_THRESHOLD ? 1 : 0;
      const qErr = value - bit;

      const index = !fillBackground && bit === 0
        ? 0
        : (bit === 0 ? inkSet.indices[0] : inkSet.indices[1]);

      writeCellIndex(idx, index);

      if (!serpentine) {
        if (x + 1 < gridW && (!activeMask || activeMask[idx + 1])) {
          errors[idx + 1] += qErr * 0.5;
        }
        if (y + 1 < gridH) {
          if (x - 1 >= 0 && (!activeMask || activeMask[idx + gridW - 1])) {
            errors[idx + gridW - 1] += qErr * 0.25;
          }
          if (!activeMask || activeMask[idx + gridW]) {
            errors[idx + gridW] += qErr * 0.25;
          }
        }
      } else {
        if (x - 1 >= 0 && (!activeMask || activeMask[idx - 1])) {
          errors[idx - 1] += qErr * 0.5;
        }
        if (y + 1 < gridH) {
          if (x + 1 < gridW && (!activeMask || activeMask[idx + gridW + 1])) {
            errors[idx + gridW + 1] += qErr * 0.25;
          }
          if (!activeMask || activeMask[idx + gridW]) {
            errors[idx + gridW] += qErr * 0.25;
          }
        }
      }
    }
  }
};

export const fillFlatPatternMode = (options: FlatPatternFillOptions): void => {
  if (options.algorithm === 'sierra-lite') {
    fillSierraLiteFlatPatternMode({
      tone: options.tone,
      toneByCell: options.toneByCell,
      flatMixByBand: options.flatMixByBand,
      flatBandOverride: options.flatBandOverride,
      spread: options.spread,
      gridW: options.gridW,
      gridH: options.gridH,
      activeMask: options.activeMask,
      fillBackground: options.fillBackground,
      baseOffset: options.baseOffset,
      writeCellIndex: options.writeCellIndex,
    });
    return;
  }

  fillOrderedFlatPatternMode(options);
};
