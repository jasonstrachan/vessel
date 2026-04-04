import {
  BAYER_8x8_MATRIX,
  BLUE_NOISE_16x16,
  VOID_CLUSTER_8x8,
  type DitherAlgorithm,
  type PatternStyle,
} from '@/utils/ditherAlgorithms';
import { ccLog } from '@/utils/colorCycle/ccDebug';

export type FlatInkCount = 2;

type FlatInkSet = {
  indices: [number, number];
};

export type FlatPatternFillOptions = {
  algorithm: DitherAlgorithm;
  patternStyle?: PatternStyle;
  tone: number;
  flatPosition?: number;
  flatBand?: number;
  flatLowIndex?: number;
  flatHighIndex?: number;
  flatMix?: number;
  flatMixByBand?: readonly number[];
  flatSeed?: number;
  spread?: number;
  gridW: number;
  gridH: number;
  activeMask?: Uint8Array;
  fillBackground: boolean;
  baseOffset: number;
  phaseX: number;
  phaseY: number;
  writeCellIndex: (cellIdx: number, index: number) => void;
  debugCollector?: (info: {
    baseMix: number;
    lowIdx: number;
    highIdx: number;
  }) => void;
};

const SIERRA_LITE_TONE_BANDS = 5;
const SIERRA_LITE_THRESHOLD = 0.5;
const SIERRA_LITE_MIN_MIX = 0.08;
const SIERRA_LITE_MAX_MIX = 0.92;
const FLAT_BAND_CENTERS: [number, number, number, number, number] = [26, 77, 128, 179, 230];
const DEFAULT_FLAT_PAIR_HALF_SPREAD = 4;
const MIN_FLAT_PAIR_HALF_SPREAD = 1;
const MAX_FLAT_PAIR_HALF_SPREAD = 63;
const PALETTE_CYCLE_SIZE = 255;
const MIN_FLAT_PAIR_DISTANCE = 0;
const MAX_FLAT_PAIR_DISTANCE = Math.floor(PALETTE_CYCLE_SIZE / 2);

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

const shiftPaletteIndex = (index: number, baseOffset: number): number => {
  const zeroBased = Math.max(0, Math.min(254, index - 1));
  const shifted = (zeroBased + baseOffset) % PALETTE_CYCLE_SIZE;
  return Math.max(1, Math.min(255, shifted + 1));
};

const wrapPaletteIndex = (index: number): number => {
  const zeroBased = ((Math.round(index) - 1) % PALETTE_CYCLE_SIZE + PALETTE_CYCLE_SIZE) % PALETTE_CYCLE_SIZE;
  return zeroBased + 1;
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
  return MIN_FLAT_PAIR_HALF_SPREAD + Math.round(
    (clamped / 100) * (MAX_FLAT_PAIR_HALF_SPREAD - MIN_FLAT_PAIR_HALF_SPREAD)
  );
};

const resolveFlatPairGap = (spreadPercent?: number): number => {
  if (!Number.isFinite(spreadPercent)) {
    return DEFAULT_FLAT_PAIR_HALF_SPREAD * 2;
  }
  const clamped = Math.max(0, Math.min(100, spreadPercent ?? 0));
  return Math.floor((clamped / 100) * MAX_FLAT_PAIR_DISTANCE);
};

const resolveFlatInkPairFromRepresentativeTone = (
  representativeTone: number,
  baseOffset: number,
  spreadPercent?: number
): FlatInkSet => {
  const center = Math.max(1, Math.min(255, Math.round(representativeTone)));
  const gap = resolveFlatPairGap(spreadPercent);
  const low = shiftPaletteIndex(
    wrapPaletteIndex(center - Math.floor(gap / 2)),
    baseOffset
  );
  const high = shiftPaletteIndex(
    wrapPaletteIndex(center + Math.ceil(gap / 2)),
    baseOffset
  );

  return {
    indices: [low, high],
  };
};

export const resolveFlatInkSetForBand = (
  band: number,
  _inkCount: FlatInkCount,
  baseOffset: number,
  spreadPercent?: number
): FlatInkSet => {
  const clampedBand = Math.max(0, Math.min(FLAT_BAND_CENTERS.length - 1, band | 0));
  return resolveFlatInkPairFromRepresentativeTone(
    FLAT_BAND_CENTERS[clampedBand],
    baseOffset,
    spreadPercent
  );
};

export const resolveFlatInkSetForPosition = (
  position: number,
  _inkCount: FlatInkCount,
  baseOffset: number,
  spreadPercent?: number
): FlatInkSet => {
  const clampedPosition = clamp01(position);
  return resolveFlatInkPairFromRepresentativeTone(
    Math.round(clampedPosition * 254) + 1,
    baseOffset,
    spreadPercent
  );
};

export const resolveFlatPairDistance = (band: number, spreadPercent?: number): number => {
  const [low, high] = resolveFlatInkSetForBand(band, 2, 0, spreadPercent).indices;
  const forward = ((high - low) % PALETTE_CYCLE_SIZE + PALETTE_CYCLE_SIZE) % PALETTE_CYCLE_SIZE;
  return Math.min(forward, PALETTE_CYCLE_SIZE - forward);
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

const hash32 = (a: number, b: number, c: number, d: number): number => {
  let n =
    Math.imul((a | 0) ^ 0x9e3779b9, 374761393) +
    Math.imul((b | 0) ^ 0x85ebca6b, 668265263) +
    Math.imul((c | 0) ^ 0xc2b2ae35, 1274126177) +
    Math.imul((d | 0) ^ 0x27d4eb2d, 1597334677);
  n = (n ^ (n >>> 13)) >>> 0;
  n = Math.imul(n, 1274126177) >>> 0;
  n = (n ^ (n >>> 16)) >>> 0;
  return n >>> 0;
};

const variantNoise01 = (
  x: number,
  y: number,
  identityKey: number,
  flatSeed: number,
  variant: number,
  patternKey: number
): number => {
  const h = hash32(
    x + variant * 17,
    y + variant * 31,
    identityKey ^ flatSeed,
    patternKey ^ (variant << 24)
  );
  return (h & 1023) / 1023;
};

const resolvePatternVariant = (flatSeed = 0, patternKey = 0): number => {
  return hash32(flatSeed, patternKey, flatSeed ^ patternKey, 0x51f15e) & 7;
};

const resolveSeededThreshold = (
  x: number,
  y: number,
  identityKey: number,
  flatSeed: number,
  variant: number,
  patternKey: number
): number => {
  const n = variantNoise01(x, y, identityKey, flatSeed, variant, patternKey);
  const amp =
    variant === 0 ? 0.03 :
    variant === 1 ? 0.045 :
    variant === 2 ? 0.035 :
    variant === 3 ? 0.05 :
    variant === 4 ? 0.04 :
    variant === 5 ? 0.055 :
    variant === 6 ? 0.038 :
    0.048;
  return SIERRA_LITE_THRESHOLD + (n - 0.5) * amp;
};

const resolveInitialError = (
  x: number,
  y: number,
  identityKey: number,
  flatSeed: number,
  variant: number,
  patternKey: number
): number => {
  const n0 = variantNoise01(x, y, identityKey, flatSeed, variant, patternKey);
  const n1 = variantNoise01(
    x + 37,
    y - 19,
    identityKey ^ 11,
    flatSeed ^ 23,
    variant ^ 3,
    patternKey ^ 0x5a5a
  );
  const centered0 = n0 - 0.5;
  const centered1 = n1 - 0.5;

  switch (variant) {
    case 0:
      return centered0 * 0.06;
    case 1:
      return (((x + y) & 1) === 0 ? 1 : -1) * 0.035 + centered0 * 0.025;
    case 2:
      return (((x & 1) === 0 ? 1 : -1) * 0.03) + centered0 * 0.02;
    case 3:
      return ((((x + y) & 3) - 1.5) / 1.5) * 0.03 + centered0 * 0.02;
    case 4:
      return centered0 * 0.03 + centered1 * 0.03;
    case 5:
      return (((y & 1) === 0 ? 1 : -1) * 0.03) + centered0 * 0.025;
    case 6:
      return ((((x - y) & 3) - 1.5) / 1.5) * 0.028 + centered0 * 0.022;
    default:
      return centered0 * 0.025 + centered1 * 0.035;
  }
};

const fillOrderedFlatPatternMode = ({
  algorithm,
  patternStyle,
  tone,
  flatPosition,
  flatBand,
  flatLowIndex,
  flatHighIndex,
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
    undefined,
    undefined,
    spread
  );

  for (let y = 0; y < gridH; y += 1) {
    const rowOffset = y * gridW;
    for (let x = 0; x < gridW; x += 1) {
      const cellIdx = rowOffset + x;
      if (activeMask && !activeMask[cellIdx]) {
        continue;
      }
      const bit =
        orderedMix >= resolveOrderedThreshold(algorithm, patternStyle, x + phaseX, y + phaseY) ? 1 : 0;
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
  const errors = new Float32Array(gridW * gridH);
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
  const baseMix = isSampledFlat
    ? clamp01(flatMix as number)
    : resolveBandMixAmount(resolvedBand, flatPosition, flatMix, flatMixByBand, spread);
  const mixKey = Math.round(baseMix * 255) & 255;
  const lowIdx = inkSet.indices[0] & 255;
  const highIdx = inkSet.indices[1] & 255;
  const shapeSeed = (flatSeed ?? 0) >>> 0;
  const seedPhaseX = shapeSeed & 7;
  const seedPhaseY = (shapeSeed >>> 3) & 7;
  const patternIdentityBand = isSampledFlat ? 0 : patternBand;
  const patternKey =
    (mixKey << 16) ^
    ((patternIdentityBand & 255) << 8) ^
    Math.imul(shapeSeed, 0x9e3779b1);
  const variant = resolvePatternVariant(shapeSeed, patternKey);
  const patternFingerprint = `${patternKey}:${variant}:${patternBand}:${mixKey}:${lowIdx}:${highIdx}`;
  const debugBits: number[] = [];
  const debugThresholds: number[] = [];
  const debugInitialErrs: number[] = [];
  const debugCoords: Array<[number, number]> = [];
  const debugIndices: number[] = [];

  ccLog('flat sierra pattern', {
    patternFingerprint,
    isSampledFlat,
    band: patternBand,
    resolvedBand,
    baseMix,
    mixKey,
    lowIdx,
    highIdx,
    patternKey,
    flatSeed: shapeSeed,
    variant,
    flatPosition: Number.isFinite(flatPosition) ? flatPosition : null,
  });
  debugCollector?.({
    baseMix,
    lowIdx,
    highIdx,
  });

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

      const errorBandKey = patternIdentityBand;
      const seededX = x + phaseX + seedPhaseX;
      const seededY = y + phaseY + seedPhaseY;
      const initialErr = resolveInitialError(
        seededX,
        seededY,
        errorBandKey,
        shapeSeed,
        variant,
        patternKey
      );
      const value = clamp01(baseMix + initialErr + errors[idx]);
      const threshold = resolveSeededThreshold(
        seededX,
        seededY,
        errorBandKey,
        shapeSeed,
        variant,
        patternKey
      );
      const bit: 0 | 1 = value >= threshold ? 1 : 0;
      const qErr = value - bit;

      const index = !fillBackground && bit === 0
        ? 0
        : (bit === 0 ? inkSet.indices[0] : inkSet.indices[1]);

      writeCellIndex(idx, index);
      if (debugBits.length < 24) {
        debugBits.push(bit);
        debugThresholds.push(Number(threshold.toFixed(4)));
        debugInitialErrs.push(Number(initialErr.toFixed(4)));
        debugCoords.push([seededX, seededY]);
        debugIndices.push(index);
      }

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

  ccLog(
    `flat sierra samples fp=${patternFingerprint} variant=${variant} band=${resolvedBand} mix=${baseMix.toFixed(4)} low=${lowIdx} high=${highIdx} bits=${debugBits.join('')} thresholds=${debugThresholds.join(',')} initialErrs=${debugInitialErrs.join(',')} coords=${debugCoords.map(([x, y]) => `${x}:${y}`).join('|')} indices=${debugIndices.join(',')}`
  );
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
