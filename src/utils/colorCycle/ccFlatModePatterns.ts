import {
  BAYER_8x8_MATRIX,
  BLUE_NOISE_16x16,
  VOID_CLUSTER_8x8,
  type DitherAlgorithm,
  type PatternStyle,
} from '@/utils/ditherAlgorithms';
import {
  resolveCcPatternThreshold,
  withCcImageTileThresholdResolver,
} from '@/utils/colorCycle/ccPatternThreshold';
import { resolveSierraLiteBinaryField } from '@/lib/colorCycle/gobletPlaybackMath';
export type FlatInkCount = 2;

type FlatInkSet = {
  indices: [number, number];
};

export type FlatPatternFillOptions = {
  algorithm: DitherAlgorithm;
  patternStyle?: PatternStyle;
  tone: number;
  /** Optional motif coverage signal, independent from flat ink selection. */
  motifTone?: number;
  flatPosition?: number;
  flatBand?: number;
  flatLowIndex?: number;
  flatHighIndex?: number;
  flatMix?: number;
  flatMixByBand?: readonly number[];
  flatSeed?: number;
  ditherPatternDiversity?: number;
  spread?: number;
  gridW: number;
  gridH: number;
  activeMask?: Uint8Array;
  fillBackground: boolean;
  baseOffset: number;
  phaseX: number;
  phaseY: number;
  imageTileThresholdResolver?: (x: number, y: number) => number | null;
  writeCellIndex: (cellIdx: number, index: number) => void;
  debugCollector?: (info: {
    baseMix: number;
    lowIdx: number;
    highIdx: number;
  }) => void;
};

const SIERRA_LITE_TONE_BANDS = 5;
const SIERRA_LITE_MIN_MIX = 0.08;
const SIERRA_LITE_MAX_MIX = 0.92;
const FLAT_BAND_CENTERS: [number, number, number, number, number] = [26, 77, 128, 179, 230];
const DEFAULT_FLAT_PAIR_HALF_SPREAD = 32;
const MIN_FLAT_PAIR_HALF_SPREAD = 2;
const MAX_FLAT_PAIR_HALF_SPREAD = 96;
const MIN_FLAT_PAIR_DISTANCE = MIN_FLAT_PAIR_HALF_SPREAD * 2;
const MAX_FLAT_PAIR_DISTANCE = MAX_FLAT_PAIR_HALF_SPREAD * 2;

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

const wrapPaletteIndex = (index: number): number => {
  const zeroBased = Math.round(index) - 1;
  return ((zeroBased % 255) + 255) % 255 + 1;
};

const shiftPaletteIndex = (index: number, baseOffset: number): number => {
  const zeroBased = Math.max(0, Math.min(254, index - 1));
  const shifted = (zeroBased + baseOffset) % 255;
  return Math.max(1, Math.min(255, shifted + 1));
};

export const resolveToneBand = (tone: number): number => {
  const clamped = clamp01(tone);
  return Math.min(SIERRA_LITE_TONE_BANDS - 1, Math.floor(clamped * SIERRA_LITE_TONE_BANDS));
};

export const resolveFlatInkCountForBand = (): FlatInkCount => 2;

const resolveFlatPairHalfSpread = (spreadPercent?: number): number => {
  if (!Number.isFinite(spreadPercent)) {
    return DEFAULT_FLAT_PAIR_HALF_SPREAD;
  }
  const clamped = Math.max(0, Math.min(100, spreadPercent ?? 0));
  const eased = Math.pow(clamped / 100, 1.8);
  return MIN_FLAT_PAIR_HALF_SPREAD + Math.round(
    eased * (MAX_FLAT_PAIR_HALF_SPREAD - MIN_FLAT_PAIR_HALF_SPREAD)
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

export const resolveFlatInkSetForPosition = (
  position: number,
  _inkCount: FlatInkCount,
  baseOffset: number,
  spreadPercent?: number
): FlatInkSet => {
  const clampedPosition = clamp01(position);
  const center = Math.max(1, Math.min(255, Math.round(clampedPosition * 254) + 1));
  const half = resolveFlatPairHalfSpread(spreadPercent);
  const low = shiftPaletteIndex(Math.max(1, center - half), baseOffset);
  const high = shiftPaletteIndex(Math.min(255, center + half), baseOffset);

  return {
    indices: [low, high],
  };
};

export const resolveFlatCycleInkSetForPosition = (
  position: number,
  _inkCount: FlatInkCount,
  baseOffset: number,
  spreadPercent?: number
): FlatInkSet => {
  const clampedPosition = clamp01(position);
  const center = Math.max(1, Math.min(255, Math.round(clampedPosition * 254) + 1));
  const half = resolveFlatPairHalfSpread(spreadPercent);
  const low = shiftPaletteIndex(wrapPaletteIndex(center - half), baseOffset);
  const high = shiftPaletteIndex(wrapPaletteIndex(center + half), baseOffset);

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
  y: number,
  tone?: number,
  imageTileThresholdResolver?: (x: number, y: number) => number | null
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

  return withCcImageTileThresholdResolver(
    imageTileThresholdResolver,
    () => resolveCcPatternThreshold(patternStyle, x, y, tone)
  );
};

const resolveBandMixAmount = (
  band: number,
  flatPosition: number | undefined,
  flatMix: number | undefined,
  flatMixByBand?: readonly number[],
  spreadPercent?: number
): number => {
  if (Number.isFinite(flatMix)) {
    const raw = clamp01(flatMix as number);
    return Math.max(SIERRA_LITE_MIN_MIX, Math.min(SIERRA_LITE_MAX_MIX, raw));
  }
  if (flatMixByBand && flatMixByBand.length > 0) {
    const clampedBand = Math.max(0, Math.min(flatMixByBand.length - 1, band | 0));
    const raw = clamp01(flatMixByBand[clampedBand] ?? 0.5);
    return Math.max(SIERRA_LITE_MIN_MIX, Math.min(SIERRA_LITE_MAX_MIX, raw));
  }
  if (Number.isFinite(flatPosition)) {
    const clampedPosition = clamp01(flatPosition as number);
    const sampledIndex = 1 + clampedPosition * 254;
    const center = Math.max(1, Math.min(255, Math.round(clampedPosition * 254) + 1));
    const half = resolveFlatPairHalfSpread(spreadPercent);
    const low = Math.max(1, center - half);
    const high = Math.min(255, center + half);
    const span = Math.max(1, high - low);
    const raw = clamp01((sampledIndex - low) / span);
    return Math.max(SIERRA_LITE_MIN_MIX, Math.min(SIERRA_LITE_MAX_MIX, raw));
  }
  return 0.5;
};

const fillOrderedFlatPatternMode = ({
  algorithm,
  patternStyle,
  tone,
  motifTone,
  flatPosition,
  flatBand,
  flatLowIndex,
  flatHighIndex,
  flatMix,
  flatMixByBand,
  spread,
  gridW,
  gridH,
  activeMask,
  fillBackground,
  baseOffset,
  phaseX,
  phaseY,
  imageTileThresholdResolver,
  writeCellIndex,
}: FlatPatternFillOptions): void => {
  const band = Number.isFinite(flatBand)
    ? Math.max(0, Math.min(SIERRA_LITE_TONE_BANDS - 1, Math.floor(flatBand as number)))
    : resolveToneBand(Number.isFinite(flatPosition) ? (flatPosition as number) : tone);
  const inkSet = Number.isFinite(flatLowIndex) && Number.isFinite(flatHighIndex)
    ? {
        indices: [flatLowIndex as number, flatHighIndex as number] as [number, number],
      }
    : Number.isFinite(flatPosition)
    ? resolveFlatInkSetForPosition(flatPosition as number, 2, baseOffset, spread)
    : resolveFlatInkSetForBand(band, 2, baseOffset, spread);
  const orderedMix = resolveBandMixAmount(
    band,
    flatPosition,
    flatMix,
    flatMixByBand,
    spread
  );
  const hasMotifTone = typeof motifTone === 'number' && Number.isFinite(motifTone);
  const resolvedMotifTone = hasMotifTone
    ? clamp01(motifTone)
    : orderedMix;
  const adaptiveTone = hasMotifTone
    ? resolvedMotifTone
    : Number.isFinite(flatPosition)
    ? (flatPosition as number)
    : tone;

  for (let y = 0; y < gridH; y += 1) {
    const rowOffset = y * gridW;
    for (let x = 0; x < gridW; x += 1) {
      const cellIdx = rowOffset + x;
      if (activeMask && !activeMask[cellIdx]) {
        continue;
      }
      const bit =
        resolvedMotifTone >= resolveOrderedThreshold(
          algorithm,
          patternStyle,
          x + phaseX,
          y + phaseY,
          adaptiveTone,
          imageTileThresholdResolver
        ) ? 1 : 0;
      const index = !fillBackground && bit === 0
        ? 0
        : (bit === 0 ? inkSet.indices[0] : inkSet.indices[1]);
      writeCellIndex(cellIdx, index);
    }
  }
};

const fillSierraLiteFlatPatternMode = ({
  tone,
  flatPosition,
  flatBand,
  flatLowIndex,
  flatHighIndex,
  flatMix,
  flatMixByBand,
  flatSeed,
  ditherPatternDiversity,
  spread,
  gridW,
  gridH,
  activeMask,
  fillBackground,
  baseOffset,
  phaseX,
  phaseY,
  writeCellIndex,
  debugCollector,
}: Omit<FlatPatternFillOptions, 'algorithm' | 'patternStyle'>): void => {
  const isSampledFlat =
    Number.isFinite(flatLowIndex) &&
    Number.isFinite(flatHighIndex) &&
    Number.isFinite(flatMix);
  const resolvedBand = isSampledFlat
    ? -1
    : Number.isFinite(flatBand)
    ? Math.max(0, Math.min(SIERRA_LITE_TONE_BANDS - 1, Math.floor(flatBand as number)))
    : resolveToneBand(Number.isFinite(flatPosition) ? (flatPosition as number) : tone);
  const inkSet = isSampledFlat
    ? {
        indices: [flatLowIndex as number, flatHighIndex as number] as [number, number],
      }
    : Number.isFinite(flatPosition)
    ? resolveFlatInkSetForPosition(flatPosition as number, 2, baseOffset, spread)
    : resolveFlatInkSetForBand(resolvedBand, 2, baseOffset, spread);
  const patternBand = isSampledFlat ? -1 : resolvedBand;
  const diversity01 = clamp01((ditherPatternDiversity ?? 100) / 100);
  const resolvedMix = isSampledFlat
    ? clamp01(flatMix as number)
    : resolveBandMixAmount(resolvedBand, flatPosition, flatMix, flatMixByBand, spread);
  const mixStrength = diversity01 * diversity01;
  const baseMix = 0.5 + (resolvedMix - 0.5) * mixStrength;
  const lowIdx = inkSet.indices[0] & 255;
  const highIdx = inkSet.indices[1] & 255;
  const shapeSeed = (flatSeed ?? 0) >>> 0;
  debugCollector?.({
    baseMix,
    lowIdx,
    highIdx,
  });
  const bits = resolveSierraLiteBinaryField({
    width: gridW,
    height: gridH,
    mix: resolvedMix,
    seed: shapeSeed,
    phaseX,
    phaseY,
    identityKey: isSampledFlat ? 0 : patternBand,
    lowKey: lowIdx,
    highKey: highIdx,
    diversity: diversity01,
    activeMask,
  });
  bits.forEach((bit, index) => {
    if (activeMask && !activeMask[index]) {
      return;
    }
    writeCellIndex(
      index,
      !fillBackground && bit === 0
        ? 0
        : (bit === 0 ? inkSet.indices[0] : inkSet.indices[1]),
    );
  });

};

export const fillFlatPatternMode = (options: FlatPatternFillOptions): void => {
  if (options.algorithm === 'sierra-lite') {
    fillSierraLiteFlatPatternMode({
      tone: options.tone,
      flatPosition: options.flatPosition,
      flatBand: options.flatBand,
      flatLowIndex: options.flatLowIndex,
      flatHighIndex: options.flatHighIndex,
      flatMix: options.flatMix,
      flatMixByBand: options.flatMixByBand,
      flatSeed: options.flatSeed,
      ditherPatternDiversity: options.ditherPatternDiversity,
      spread: options.spread,
      gridW: options.gridW,
      gridH: options.gridH,
      activeMask: options.activeMask,
      fillBackground: options.fillBackground,
      baseOffset: options.baseOffset,
      phaseX: options.phaseX,
      phaseY: options.phaseY,
      writeCellIndex: options.writeCellIndex,
    });
    return;
  }

  fillOrderedFlatPatternMode(options);
};
