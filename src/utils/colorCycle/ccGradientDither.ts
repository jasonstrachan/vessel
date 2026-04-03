import {
  BAYER_8x8_MATRIX,
  BLUE_NOISE_16x16,
  VOID_CLUSTER_8x8,
  type DitherAlgorithm,
  type PatternStyle,
} from '@/utils/ditherAlgorithms';
import {
  fillFlatPatternMode,
  resolveFlatInkSetForPosition,
} from '@/utils/colorCycle/ccFlatModePatterns';
import { resolveFlatSierraBandMixInfo } from '@/utils/colorCycle/ccDitherRenderPalette';
import { ccLog } from '@/utils/colorCycle/ccDebug';
import { getActiveMarkGradientSession } from '@/hooks/canvas/utils/colorCycleMarkSession';
import type { StoredStop } from '@/utils/colorCycleGradientDefs';
import { useAppStore } from '@/stores/useAppStore';

type Point = { x: number; y: number };

export type CcGradientDitherOptions = {
  vertices: Point[];
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  pixelSize: number;
  levels: number;
  baseOffset: number;
  flatPairSpread?: number;
  flatMixByBand?: readonly number[];
  flatSeed?: number;
  algorithm?: DitherAlgorithm;
  patternStyle?: PatternStyle;
  pairBandCount?: number;
  sampledStopsOverride?: StoredStop[];
  fillBackground?: boolean;
  pxlEdge?: boolean;
  sampleNormalized: (x: number, y: number) => number;
  writeIndex: (x: number, y: number, index: number) => void;
  logSetIndexSample?: (x: number, y: number) => void;
  yieldIfNeeded?: (row: number) => Promise<void>;
  sampledFlatTraceId?: string;
  sampledFlatTraceStage?: string;
};

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

const noiseAt = (x: number, y: number): number => {
  let n = (x | 0) * 374761393 + (y | 0) * 668265263;
  n = (n ^ (n >>> 13)) * 1274126177;
  n = (n ^ (n >>> 16)) >>> 0;
  return (n & 0xffff) / 65536;
};

const indexFromNormalized = (pos: number, baseOffset: number): number => {
  const raw = Math.round(pos * 254);
  const shifted = (raw + baseOffset) % 255;
  return Math.max(1, Math.min(255, shifted + 1));
};

const levelToCyclePos = (level: number, levels: number): number => {
  const safeLevels = Math.max(1, levels | 0);
  if (safeLevels <= 1) {
    return 0;
  }
  const clampedLevel = Math.max(0, Math.min(safeLevels - 1, level | 0));
  // Color-cycle gradients are periodic, so avoid sampling the duplicated 1.0 endpoint.
  // This keeps low slice counts (especially 2) from collapsing to a single color.
  return clampedLevel / safeLevels;
};

const resolveAverageActiveTone = (
  cellCoverage: Uint8Array,
  activeMask: Uint8Array
): number => {
  let totalCoverage = 0;
  let activeCount = 0;

  for (let i = 0; i < activeMask.length; i += 1) {
    if (!activeMask[i]) {
      continue;
    }
    totalCoverage += cellCoverage[i] ?? 0;
    activeCount += 1;
  }

  if (activeCount <= 0) {
    return 0.5;
  }

  return clamp01(totalCoverage / (activeCount * 255));
};

const sampleStoredGradientColor = (
  stops: StoredStop[],
  position: number
): [number, number, number] => {
  const sorted = [...stops].sort((a, b) => a.position - b.position);
  if (sorted.length === 0) {
    return [0, 0, 0];
  }
  if (sorted.length === 1 || position <= sorted[0].position) {
    return parseCssRgb(sorted[0].color);
  }
  const last = sorted[sorted.length - 1];
  if (position >= last.position) {
    return parseCssRgb(last.color);
  }

  for (let index = 0; index < sorted.length - 1; index += 1) {
    const left = sorted[index];
    const right = sorted[index + 1];
    if (position < left.position || position > right.position) {
      continue;
    }
    const leftRgb = parseCssRgb(left.color);
    const rightRgb = parseCssRgb(right.color);
    const mix = (position - left.position) / Math.max(1e-6, right.position - left.position);
    return [
      Math.round(leftRgb[0] + (rightRgb[0] - leftRgb[0]) * mix),
      Math.round(leftRgb[1] + (rightRgb[1] - leftRgb[1]) * mix),
      Math.round(leftRgb[2] + (rightRgb[2] - leftRgb[2]) * mix),
    ];
  }

  return parseCssRgb(last.color);
};

const parseCssRgb = (color: string): [number, number, number] => {
  if (color.startsWith('#')) {
    const hex = color.slice(1);
    if (hex.length === 3) {
      return [
        Number.parseInt(hex[0] + hex[0], 16),
        Number.parseInt(hex[1] + hex[1], 16),
        Number.parseInt(hex[2] + hex[2], 16),
      ];
    }
    if (hex.length >= 6) {
      return [
        Number.parseInt(hex.slice(0, 2), 16),
        Number.parseInt(hex.slice(2, 4), 16),
        Number.parseInt(hex.slice(4, 6), 16),
      ];
    }
  }
  const match = color.match(/rgba?\(([^)]+)\)/i);
  if (match) {
    const parts = match[1].split(',').slice(0, 3).map((part) => Number.parseFloat(part.trim()));
    if (parts.length === 3 && parts.every((part) => Number.isFinite(part))) {
      return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0];
    }
  }
  return [0, 0, 0];
};

const rgbToCss = (rgb: [number, number, number]): string =>
  `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;

const rgbToTone = (rgb: [number, number, number]): number =>
  clamp01((rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722) / 255);

const rgbDistance = (left: [number, number, number], right: [number, number, number]): number => {
  const dr = left[0] - right[0];
  const dg = left[1] - right[1];
  const db = left[2] - right[2];
  return Math.sqrt(dr * dr + dg * dg + db * db);
};

const buildFlatTargetContrastPair = ({
  target,
  spread01,
}: {
  target: [number, number, number];
  spread01: number;
}): { low: [number, number, number]; high: [number, number, number] } => {
  const lift = 0.2 + spread01 * 0.72;
  const low: [number, number, number] = [
    Math.max(0, Math.round(target[0] * (1 - lift))),
    Math.max(0, Math.round(target[1] * (1 - lift))),
    Math.max(0, Math.round(target[2] * (1 - lift))),
  ];
  const high: [number, number, number] = [
    Math.min(255, Math.round(target[0] + (255 - target[0]) * lift)),
    Math.min(255, Math.round(target[1] + (255 - target[1]) * lift)),
    Math.min(255, Math.round(target[2] + (255 - target[2]) * lift)),
  ];

  return rgbToTone(low) <= rgbToTone(high)
    ? { low, high }
    : { low: high, high: low };
};

const projectTargetToPairMix = ({
  target,
  low,
  high,
}: {
  target: [number, number, number];
  low: [number, number, number];
  high: [number, number, number];
}): { flatMix: number; solveError: number; usedFallbackPair: boolean } => {
  const axis: [number, number, number] = [
    high[0] - low[0],
    high[1] - low[1],
    high[2] - low[2],
  ];
  const axisLenSq = axis[0] * axis[0] + axis[1] * axis[1] + axis[2] * axis[2];
  const fallbackTargetMix = clamp01(rgbToTone(target));
  if (axisLenSq < 1e-6) {
    return {
      flatMix: fallbackTargetMix,
      solveError: 0,
      usedFallbackPair: true,
    };
  }

  const relative: [number, number, number] = [
    target[0] - low[0],
    target[1] - low[1],
    target[2] - low[2],
  ];
  const projected = (
    relative[0] * axis[0] +
    relative[1] * axis[1] +
    relative[2] * axis[2]
  ) / axisLenSq;
  const flatMix = clamp01(projected);
  const solved: [number, number, number] = [
    low[0] + axis[0] * flatMix,
    low[1] + axis[1] * flatMix,
    low[2] + axis[2] * flatMix,
  ];

  return {
    flatMix,
    solveError: rgbDistance(
      target,
      [
        Math.round(solved[0]),
        Math.round(solved[1]),
        Math.round(solved[2]),
      ]
    ),
    usedFallbackPair: false,
  };
};

const resolveRepresentativeSampledTarget = (
  stops: StoredStop[] | null | undefined
): { tone: number; rgb: [number, number, number]; color: string } | null => {
  if (!stops?.length) {
    return null;
  }
  let totalR = 0;
  let totalG = 0;
  let totalB = 0;
  for (let i = 0; i < stops.length; i += 1) {
    const rgb = parseCssRgb(stops[i].color);
    totalR += rgb[0];
    totalG += rgb[1];
    totalB += rgb[2];
  }
  const count = Math.max(1, stops.length);
  const rgb: [number, number, number] = [
    Math.round(totalR / count),
    Math.round(totalG / count),
    Math.round(totalB / count),
  ];
  return {
    tone: rgbToTone(rgb),
    rgb,
    color: rgbToCss(rgb),
  };
};

const summarizeStoredStopsForDebug = (stops: StoredStop[] | null | undefined) =>
  (stops ?? []).slice(0, 8).map((stop) => ({
    p: Number(stop.position.toFixed(6)),
    c: stop.color,
  }));

const clampCycleIndex = (value: number): number => Math.max(1, Math.min(255, Math.round(value)));

const normalizeCycleIndex = (index: number, baseOffset: number): number => {
  const zeroBased = clampCycleIndex(index) - 1;
  const wrappedBaseOffset = ((baseOffset % 255) + 255) % 255;
  const unshifted = ((zeroBased - wrappedBaseOffset) % 255 + 255) % 255;
  return clamp01(unshifted / 254);
};

const MULTI_INK_THRESHOLD = 40;

const shouldUseSampledMultiInk = (spread: number): boolean => spread > MULTI_INK_THRESHOLD;

export const resolveSampledTripleInks = ({
  representativeTone,
  baseOffset,
  spread,
}: {
  representativeTone: number;
  baseOffset: number;
  spread: number;
}): {
  lowIndex: number;
  midIndex: number;
  highIndex: number;
} => {
  const spread01 = clamp01(spread / 100);
  const centerIndex = indexFromNormalized(representativeTone, baseOffset);
  const reach = Math.round(spread01 * 100);

  return {
    lowIndex: clampCycleIndex(centerIndex - reach),
    midIndex: centerIndex,
    highIndex: clampCycleIndex(centerIndex + reach),
  };
};

const tripleInkIndex = (
  level: number,
  inks: { lowIndex: number; midIndex: number; highIndex: number }
): number => {
  if (level <= 0) {
    return inks.lowIndex;
  }
  if (level >= 2) {
    return inks.highIndex;
  }
  return inks.midIndex;
};

export const resolveSampledFlatPositionMix = ({
  stops,
  sampledSourceStops,
  flatPosition,
  baseOffset = 0,
  spread,
  targetRgbOverride,
}: {
  stops: StoredStop[];
  sampledSourceStops?: StoredStop[];
  flatPosition: number;
  baseOffset?: number;
  spread?: number;
  targetRgbOverride?: [number, number, number];
}): {
  flatPosition: number;
  flatMix: number;
  targetColor: string;
  lowIndex: number;
  highIndex: number;
  lowColor: string;
  highColor: string;
} | null => {
  if (!stops.length) {
    return null;
  }

  const clampedPosition = clamp01(flatPosition);
  const spread01 = clamp01((spread ?? 0) / 100);
  const targetRgb = targetRgbOverride ?? sampleStoredGradientColor(stops, clampedPosition);
  const targetColor = rgbToCss(targetRgb);
  const centerIndex = indexFromNormalized(clampedPosition, baseOffset);
  const resolvedPair = resolveFlatInkSetForPosition(clampedPosition, 2, baseOffset, spread);
  const [lowIndex, highIndex] = resolvedPair.indices;
  const pairSpan = Math.max(1, highIndex - lowIndex);
  const sampledLowRgb = sampleStoredGradientColor(stops, normalizeCycleIndex(lowIndex, baseOffset));
  const sampledHighRgb = sampleStoredGradientColor(stops, normalizeCycleIndex(highIndex, baseOffset));
  const sampledPairDistance = rgbDistance(sampledLowRgb, sampledHighRgb);
  const contrastPair = buildFlatTargetContrastPair({
    target: targetRgb,
    spread01,
  });
  const useFallbackPair = sampledPairDistance < 18;
  const solvePairLow = useFallbackPair ? contrastPair.low : sampledLowRgb;
  const solvePairHigh = useFallbackPair ? contrastPair.high : sampledHighRgb;
  const {
    flatMix,
    solveError,
    usedFallbackPair,
  } = projectTargetToPairMix({
    target: targetRgb,
    low: solvePairLow,
    high: solvePairHigh,
  });
  const lowColor = rgbToCss(sampledLowRgb);
  const highColor = rgbToCss(sampledHighRgb);

  ccLog('sampled flat solver decision', {
    flatPosition: Number(clampedPosition.toFixed(6)),
    targetColor,
    spread: spread ?? null,
    spread01: Number(spread01.toFixed(6)),
    centerIndex,
    sourceStopCount: stops.length,
    sourceStops: stops.slice(0, 8).map((stop) => ({
      p: Number(stop.position.toFixed(6)),
      c: stop.color,
    })),
    sampledSourceStops: (sampledSourceStops ?? []).slice(0, 8).map((stop) => ({
      p: Number(stop.position.toFixed(6)),
      c: stop.color,
    })),
    lowIndex,
    highIndex,
    pairSpan,
    sampledPairDistance: Number(sampledPairDistance.toFixed(6)),
    usedFallbackPair,
    solvePairLow: rgbToCss(solvePairLow),
    solvePairHigh: rgbToCss(solvePairHigh),
    flatMix: Number(flatMix.toFixed(6)),
    solveError: Number(solveError.toFixed(6)),
    lowColor,
    highColor,
  });

  return {
    flatPosition: clampedPosition,
    flatMix,
    targetColor,
    lowIndex,
    highIndex,
    lowColor,
    highColor,
  };
};

const resolveActiveSampledStops = (): StoredStop[] | null => {
  const layerId = useAppStore.getState().activeLayerId;
  if (!layerId) {
    return null;
  }
  const session = getActiveMarkGradientSession(layerId);
  if (!session || session.source !== 'sampled') {
    return null;
  }
  const sampledStops =
    session.previewStopsStored && session.previewStopsStored.length >= 2
      ? session.previewStopsStored
      : (session.fallbackStopsStored?.length ? session.fallbackStopsStored : session.frozenStopsStored);
  return sampledStops?.length ? sampledStops : null;
};

const resolveRuntimeFlatMixByBand = (
  baseOffset: number,
  spread?: number
): { mixByBand?: number[] } => {
  try {
    const state = useAppStore.getState();
    const tools = state.tools?.brushSettings;
    const layerId = state.activeLayerId;
    const layer = state.layers?.find((entry) => entry.id === layerId);
    const fgColor = state.palette?.foregroundColor ?? tools?.color;

    const useForegroundGradient = Boolean(tools?.colorCycleUseForegroundGradient);
    const defs = layer?.colorCycleData?.gradientDefs ?? [];
    const activeId = layer?.colorCycleData?.activeGradientId ?? defs[0]?.id;
    const activeDef = defs.find((entry) => entry.id === activeId) ?? defs[0];
    const slot = useForegroundGradient
      ? (layer?.colorCycleData?.fgActiveSlot ?? layer?.colorCycleData?.paintSlot ?? activeDef?.currentSlot ?? 0)
      : (layer?.colorCycleData?.paintSlot ?? activeDef?.currentSlot ?? 0);
    const slotPalettes = layer?.colorCycleData?.slotPalettes ?? [];
    const slotStops = slotPalettes.find((entry) => entry.slot === slot)?.stops;
    const fallbackStops = layer?.colorCycleData?.gradient ?? tools?.colorCycleGradient;
    const stops = useForegroundGradient
      ? ((fallbackStops?.length ? fallbackStops : slotStops) ?? [])
      : ((slotStops?.length ? slotStops : fallbackStops) ?? []);
    if (!stops.length) {
      return {};
    }

    const bandMixInfo = resolveFlatSierraBandMixInfo({
      stops,
      targetColor: fgColor,
      baseOffset,
      spread,
    });
    return {
      mixByBand: bandMixInfo.length === 5 ? bandMixInfo.map((entry) => entry.mix) : undefined,
    };
  } catch {
    return {};
  }
};

const summarizeFlatPatternOutput = (
  cellIndices: Uint16Array,
  activeMask: Uint8Array
): {
  activeCellCount: number;
  sampleCellIndices: number[];
  sampleHash: number;
  backgroundCount: number;
  lowInkIndex: number | null;
  lowInkCount: number;
  highInkIndex: number | null;
  highInkCount: number;
  uniqueActiveIndices: number[];
} => {
  const sampleCellIndices: number[] = [];
  const indexCounts = new Map<number, number>();
  let activeCellCount = 0;
  let sampleHash = 2166136261;

  for (let i = 0; i < activeMask.length; i += 1) {
    if (!activeMask[i]) {
      continue;
    }
    const index = cellIndices[i] ?? 0;
    activeCellCount += 1;
    if (sampleCellIndices.length < 24) {
      sampleCellIndices.push(index);
    }
    if (activeCellCount <= 128) {
      sampleHash ^= index + ((i & 255) << 8);
      sampleHash = Math.imul(sampleHash, 16777619) >>> 0;
    }
    indexCounts.set(index, (indexCounts.get(index) ?? 0) + 1);
  }

  const uniqueActiveIndices = [...indexCounts.keys()].sort((a, b) => a - b);
  const nonBackgroundIndices = uniqueActiveIndices.filter((index) => index !== 0);
  const lowInkIndex = nonBackgroundIndices[0] ?? null;
  const highInkIndex = nonBackgroundIndices[nonBackgroundIndices.length - 1] ?? null;

  return {
    activeCellCount,
    sampleCellIndices,
    sampleHash,
    backgroundCount: indexCounts.get(0) ?? 0,
    lowInkIndex,
    lowInkCount: lowInkIndex == null ? 0 : (indexCounts.get(lowInkIndex) ?? 0),
    highInkIndex,
    highInkCount: highInkIndex == null ? 0 : (indexCounts.get(highInkIndex) ?? 0),
    uniqueActiveIndices,
  };
};

type ErrorDiffusionTap = { dx: number; dy: number; weight: number };
type ErrorDiffusionKernel = {
  taps: ReadonlyArray<ErrorDiffusionTap>;
  divisor: number;
  serpentine?: boolean;
};

type ErrorDiffusionProfile = {
  threshold: number;
  jitterBase: number;
};

const ERROR_DIFFUSION_KERNELS: Readonly<Record<Exclude<DitherAlgorithm, 'bayer' | 'blue-noise' | 'void-and-cluster' | 'pattern'>, ErrorDiffusionKernel>> = {
  'floyd-steinberg': {
    taps: [
      { dx: 1, dy: 0, weight: 7 },
      { dx: -1, dy: 1, weight: 3 },
      { dx: 0, dy: 1, weight: 5 },
      { dx: 1, dy: 1, weight: 1 },
    ],
    divisor: 16,
    serpentine: true,
  },
  'jarvis-judice-ninke': {
    taps: [
      { dx: 1, dy: 0, weight: 7 },
      { dx: 2, dy: 0, weight: 5 },
      { dx: -2, dy: 1, weight: 3 },
      { dx: -1, dy: 1, weight: 5 },
      { dx: 0, dy: 1, weight: 7 },
      { dx: 1, dy: 1, weight: 5 },
      { dx: 2, dy: 1, weight: 3 },
      { dx: -2, dy: 2, weight: 1 },
      { dx: -1, dy: 2, weight: 3 },
      { dx: 0, dy: 2, weight: 5 },
      { dx: 1, dy: 2, weight: 3 },
      { dx: 2, dy: 2, weight: 1 },
    ],
    divisor: 48,
    serpentine: true,
  },
  stucki: {
    taps: [
      { dx: 1, dy: 0, weight: 8 },
      { dx: 2, dy: 0, weight: 4 },
      { dx: -2, dy: 1, weight: 2 },
      { dx: -1, dy: 1, weight: 4 },
      { dx: 0, dy: 1, weight: 8 },
      { dx: 1, dy: 1, weight: 4 },
      { dx: 2, dy: 1, weight: 2 },
      { dx: -2, dy: 2, weight: 1 },
      { dx: -1, dy: 2, weight: 2 },
      { dx: 0, dy: 2, weight: 4 },
      { dx: 1, dy: 2, weight: 2 },
      { dx: 2, dy: 2, weight: 1 },
    ],
    divisor: 42,
    serpentine: true,
  },
  burkes: {
    taps: [
      { dx: 1, dy: 0, weight: 8 },
      { dx: 2, dy: 0, weight: 4 },
      { dx: -2, dy: 1, weight: 2 },
      { dx: -1, dy: 1, weight: 4 },
      { dx: 0, dy: 1, weight: 8 },
      { dx: 1, dy: 1, weight: 4 },
      { dx: 2, dy: 1, weight: 2 },
    ],
    divisor: 32,
    serpentine: true,
  },
  'sierra-3': {
    taps: [
      { dx: 1, dy: 0, weight: 5 },
      { dx: 2, dy: 0, weight: 3 },
      { dx: -2, dy: 1, weight: 2 },
      { dx: -1, dy: 1, weight: 4 },
      { dx: 0, dy: 1, weight: 5 },
      { dx: 1, dy: 1, weight: 4 },
      { dx: 2, dy: 1, weight: 2 },
      { dx: -1, dy: 2, weight: 2 },
      { dx: 0, dy: 2, weight: 3 },
      { dx: 1, dy: 2, weight: 2 },
    ],
    divisor: 32,
    serpentine: true,
  },
  'sierra-2': {
    taps: [
      { dx: 1, dy: 0, weight: 4 },
      { dx: 2, dy: 0, weight: 3 },
      { dx: -2, dy: 1, weight: 1 },
      { dx: -1, dy: 1, weight: 2 },
      { dx: 0, dy: 1, weight: 3 },
      { dx: 1, dy: 1, weight: 2 },
      { dx: 2, dy: 1, weight: 1 },
    ],
    divisor: 16,
    serpentine: true,
  },
  'sierra-lite': {
    taps: [
      { dx: 1, dy: 0, weight: 2 },
      { dx: -1, dy: 1, weight: 1 },
      { dx: 0, dy: 1, weight: 1 },
    ],
    divisor: 4,
    serpentine: true,
  },
  atkinson: {
    taps: [
      { dx: 1, dy: 0, weight: 1 },
      { dx: 2, dy: 0, weight: 1 },
      { dx: -1, dy: 1, weight: 1 },
      { dx: 0, dy: 1, weight: 1 },
      { dx: 1, dy: 1, weight: 1 },
      { dx: 0, dy: 2, weight: 1 },
    ],
    divisor: 8,
    serpentine: true,
  },
};

const ERROR_DIFFUSION_PROFILES: Readonly<Record<Exclude<DitherAlgorithm, 'bayer' | 'blue-noise' | 'void-and-cluster' | 'pattern'>, ErrorDiffusionProfile>> = {
  'floyd-steinberg': { threshold: 0.5, jitterBase: 0.04 },
  'jarvis-judice-ninke': { threshold: 0.46, jitterBase: 0.02 },
  stucki: { threshold: 0.48, jitterBase: 0.02 },
  burkes: { threshold: 0.53, jitterBase: 0.03 },
  'sierra-3': { threshold: 0.5, jitterBase: 0.025 },
  'sierra-2': { threshold: 0.52, jitterBase: 0.03 },
  'sierra-lite': { threshold: 0.5, jitterBase: 0 },
  atkinson: { threshold: 0.45, jitterBase: 0.015 },
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

export const fillCcGradientDither = async ({
  vertices,
  minX,
  minY,
  maxX,
  maxY,
  pixelSize,
  levels,
  baseOffset,
  flatPairSpread,
  flatMixByBand,
  flatSeed,
  algorithm = 'sierra-lite',
  patternStyle = 'dots',
  pairBandCount,
  sampledStopsOverride,
  fillBackground = true,
  pxlEdge = false,
  sampleNormalized,
  writeIndex,
  logSetIndexSample,
  yieldIfNeeded,
  sampledFlatTraceId,
  sampledFlatTraceStage,
}: CcGradientDitherOptions): Promise<void> => {
  const clampedLevels = Math.max(1, Math.min(255, Math.floor(levels)));
  const clampedPairBands = Math.max(0, Math.floor(pairBandCount ?? 0));
  const cellSize = Math.max(1, Math.floor(pixelSize));
  const useWholeEdgeCells = Boolean(pxlEdge && cellSize > 1);
  const bboxWidth = Math.max(1, maxX - minX + 1);
  const bboxHeight = Math.max(1, maxY - minY + 1);
  const gridW = Math.max(1, Math.ceil(bboxWidth / cellSize));
  const gridH = Math.max(1, Math.ceil(bboxHeight / cellSize));

  const cellIndices = new Uint16Array(gridW * gridH);
  const cellCoverage = new Uint8Array(gridW * gridH);
  const activeMask = new Uint8Array(gridW * gridH);
  const activeCellsByRow: number[][] = Array.from({ length: gridH }, () => []);
  const rowSpans: Array<Array<[number, number]>> = Array.from({ length: bboxHeight }, () => []);

  const activeCells: number[] = [];
  const cellSeen = new Uint8Array(gridW);
  const thresholdJitter = algorithm === 'sierra-lite' ? 0 : 0.2;

  for (let row = 0; row < bboxHeight; row += 1) {
    const y = minY + row;
    const intersections: number[] = [];
    for (let i = 0; i < vertices.length; i += 1) {
      const v1 = vertices[i];
      const v2 = vertices[(i + 1) % vertices.length];
      if (Math.abs(v2.y - v1.y) < 1e-4) continue;
      if ((v1.y <= y && v2.y > y) || (v2.y <= y && v1.y > y)) {
        const t = (y - v1.y) / (v2.y - v1.y);
        const x = v1.x + t * (v2.x - v1.x);
        intersections.push(x);
      }
    }

    intersections.sort((a, b) => a - b);
    for (let i = 0; i < intersections.length - 1; i += 2) {
      const startFloat = intersections[i];
      const endFloat = intersections[i + 1];
      if (endFloat <= startFloat) continue;
      const startX = Math.floor(startFloat);
      const endX = useWholeEdgeCells
        ? Math.ceil(endFloat) - 1
        : Math.ceil(endFloat);
      if (endX >= startX) {
        rowSpans[row].push([startX, endX]);
      }
    }
  }

  for (let cy = 0; cy < gridH; cy += 1) {
    cellSeen.fill(0);
    activeCells.length = 0;

    const rowStart = cy * cellSize;
    const rowEnd = Math.min(bboxHeight - 1, rowStart + cellSize - 1);
    for (let row = rowStart; row <= rowEnd; row += 1) {
      const spans = rowSpans[row];
      for (let i = 0; i < spans.length; i += 1) {
        const [startX, endX] = spans[i];
        const startCell = Math.floor((startX - minX) / cellSize);
        const endCell = Math.floor((endX - minX) / cellSize);
        for (let cx = startCell; cx <= endCell; cx += 1) {
          if (cx < 0 || cx >= gridW) continue;
          if (!cellSeen[cx]) {
            cellSeen[cx] = 1;
            activeCells.push(cx);
          }
        }
      }
    }

    if (!activeCells.length) {
      continue;
    }
    activeCells.sort((a, b) => a - b);
    activeCellsByRow[cy] = activeCells.slice();

    const serpentine = (cy & 1) === 1;
    const start = serpentine ? activeCells.length - 1 : 0;
    const end = serpentine ? -1 : activeCells.length;
    const step = serpentine ? -1 : 1;

    const sampleY = minY + cy * cellSize + cellSize * 0.5;
    for (let i = start; i !== end; i += step) {
      const cx = activeCells[i];
      const sampleX = minX + cx * cellSize + cellSize * 0.5;
      let r = clamp01(sampleNormalized(sampleX, sampleY));
      if (clampedLevels > 1 && algorithm !== 'sierra-lite') {
        const j = (noiseAt(Math.floor(sampleX), Math.floor(sampleY)) - 0.5) * (0.2 / clampedLevels);
        r = clamp01(r + j);
      }
      const cellIdx = cy * gridW + cx;
      activeMask[cellIdx] = 255;
      cellCoverage[cellIdx] = Math.max(0, Math.min(255, Math.round(r * 255)));
    }
  }

  if (clampedPairBands > 0) {
    const pairCount = Math.max(1, clampedPairBands);
    const lowIndexForBand = (band: number) =>
      indexFromNormalized((band * 2) / (pairCount * 2), baseOffset);
    const highIndexForBand = (band: number) =>
      indexFromNormalized((band * 2 + 1) / (pairCount * 2), baseOffset);
    const resolveBandState = (coverage: number, error = 0) => {
      const scaled = clamp01(coverage / 255 + error) * pairCount;
      const band = Math.max(0, Math.min(pairCount - 1, Math.floor(Math.min(pairCount - 1e-6, scaled))));
      const local = clamp01(scaled - band);
      return { band, local };
    };

    if (algorithm in ERROR_DIFFUSION_KERNELS) {
      const kernel = ERROR_DIFFUSION_KERNELS[algorithm as keyof typeof ERROR_DIFFUSION_KERNELS];
      const profile = ERROR_DIFFUSION_PROFILES[algorithm as keyof typeof ERROR_DIFFUSION_PROFILES];
      const errBuf = new Float32Array(gridW * gridH);
      const jitterScale = profile.jitterBase * 0.25;

      for (let cy = 0; cy < gridH; cy += 1) {
        const activeRow = activeCellsByRow[cy];
        if (!activeRow.length) continue;

        const useSerpentine = kernel.serpentine !== false;
        const leftToRight = useSerpentine ? (cy & 1) === 0 : true;
        const start = leftToRight ? 0 : activeRow.length - 1;
        const end = leftToRight ? activeRow.length : -1;
        const step = leftToRight ? 1 : -1;

        for (let i = start; i !== end; i += step) {
          const cx = activeRow[i];
          const cellIdx = cy * gridW + cx;
          const { band, local: initialLocal } = resolveBandState(cellCoverage[cellIdx], errBuf[cellIdx] || 0);
          let local = initialLocal;
          if (jitterScale > 0) {
            local = clamp01(local + (noiseAt(cx, cy) - 0.5) * jitterScale);
          }
          const usePrimary = local >= profile.threshold;
          cellIndices[cellIdx] = usePrimary ? highIndexForBand(band) : (fillBackground ? lowIndexForBand(band) : 0);
          const quant = usePrimary ? 1 : 0;
          const err = local - quant;
          if (err !== 0) {
            const norm = 1 / Math.max(1, kernel.divisor);
            for (let k = 0; k < kernel.taps.length; k += 1) {
              const tap = kernel.taps[k];
              const nx = cx + (leftToRight ? tap.dx : -tap.dx);
              const ny = cy + tap.dy;
              if (nx < 0 || nx >= gridW || ny < 0 || ny >= gridH) continue;
              const nIdx = ny * gridW + nx;
              if (!activeMask[nIdx]) continue;
              errBuf[nIdx] += err * tap.weight * norm;
            }
          }
        }
      }
    } else {
      const phaseX = Math.floor(minX / Math.max(1, cellSize));
      const phaseY = Math.floor(minY / Math.max(1, cellSize));
      for (let cy = 0; cy < gridH; cy += 1) {
        const activeRow = activeCellsByRow[cy];
        if (!activeRow.length) continue;
        const rowOffset = cy * gridW;
        for (let i = 0; i < activeRow.length; i += 1) {
          const cx = activeRow[i];
          const cellIdx = rowOffset + cx;
          const { band, local } = resolveBandState(cellCoverage[cellIdx]);
          const threshold = resolveOrderedThreshold(
            algorithm,
            patternStyle,
            cx + phaseX,
            cy + phaseY
          );
          const usePrimary = local >= threshold;
          cellIndices[cellIdx] = usePrimary ? highIndexForBand(band) : (fillBackground ? lowIndexForBand(band) : 0);
        }
      }
    }
  } else if (clampedLevels === 1) {
    const phaseX = Math.floor(minX / Math.max(1, cellSize));
    const phaseY = Math.floor(minY / Math.max(1, cellSize));
    const flatPosition = resolveAverageActiveTone(cellCoverage, activeMask);
    const brushSettings = useAppStore.getState().tools?.brushSettings;
    const preferSampledFlatSolver =
      algorithm === 'sierra-lite' &&
      !flatMixByBand &&
      (sampledStopsOverride?.length
        ? true
        : useAppStore.getState().tools?.ccGradientSource === 'sampled') &&
      !brushSettings?.colorCycleUseForegroundGradient;
    const sampledFlatSourceStops =
      sampledStopsOverride?.length
        ? sampledStopsOverride
        : (resolveActiveSampledStops() ?? []);
    const representativeSampledTarget = preferSampledFlatSolver
      ? resolveRepresentativeSampledTarget(sampledFlatSourceStops)
      : null;
    if (preferSampledFlatSolver && representativeSampledTarget && shouldUseSampledMultiInk(flatPairSpread ?? 0)) {
      const tripleInks = resolveSampledTripleInks({
        representativeTone: representativeSampledTarget.tone,
        baseOffset,
        spread: flatPairSpread ?? 0,
      });
      const centered = clamp01(flatPosition) - 0.5;
      const amplified = 0.5 + centered * 2.5;
      const seedHash = flatSeed
        ? (Math.imul((flatSeed >>> 0) ^ 0x9e3779b9, 2654435761) >>> 0)
        : 0;
      const seedNoise = flatSeed
        ? ((seedHash & 0xffff) / 65536 - 0.5) * 0.5
        : 0;
      const sampledTripleMix = Math.max(0.02, Math.min(0.98, amplified + seedNoise));
      const tripleLevels = 3;
      let errCurr = new Float32Array(gridW);
      let errNext = new Float32Array(gridW);

      for (let cy = 0; cy < gridH; cy += 1) {
        const activeRow = activeCellsByRow[cy];
        if (!activeRow.length) {
          const swap = errCurr;
          errCurr = errNext;
          errNext = swap;
          errNext.fill(0);
          continue;
        }

        const swap = errCurr;
        errCurr = errNext;
        errNext = swap;
        errNext.fill(0);

        const serpentine = (cy & 1) === 1;
        const start = serpentine ? activeRow.length - 1 : 0;
        const end = serpentine ? -1 : activeRow.length;
        const step = serpentine ? -1 : 1;

        for (let i = start; i !== end; i += step) {
          const cx = activeRow[i];
          const cellIdx = cy * gridW + cx;
          const scaled = sampledTripleMix * (tripleLevels - 1);
          const lower = Math.max(0, Math.min(tripleLevels - 1, Math.floor(scaled)));
          const frac = scaled - lower;
          const adj = clamp01(frac + (errCurr[cx] || 0));
          const chooseUpper = lower < tripleLevels - 1 && adj >= 0.5;
          const q = chooseUpper ? 1 : 0;
          const err = adj - q;

          if (!serpentine) {
            if (cx + 1 < gridW) {
              errCurr[cx + 1] += err * 0.5;
            }
            if (cx - 1 >= 0) {
              errNext[cx - 1] += err * 0.25;
            }
          } else {
            if (cx - 1 >= 0) {
              errCurr[cx - 1] += err * 0.5;
            }
            if (cx + 1 < gridW) {
              errNext[cx + 1] += err * 0.25;
            }
          }
          errNext[cx] += err * 0.25;

          const level = chooseUpper ? lower + 1 : lower;
          cellIndices[cellIdx] = tripleInkIndex(level, tripleInks);
        }
      }
    } else {
      const sampledFlatSolver =
        preferSampledFlatSolver && representativeSampledTarget
          ? resolveSampledFlatPositionMix({
              stops: sampledFlatSourceStops,
              sampledSourceStops: sampledFlatSourceStops,
              flatPosition: representativeSampledTarget.tone,
              baseOffset,
              spread: flatPairSpread,
              targetRgbOverride: representativeSampledTarget.rgb,
            })
          : null;
      if (sampledFlatSolver) {
        const centered = clamp01(flatPosition) - 0.5;
        const amplified = 0.5 + centered * 2.5;
        const seedHash = flatSeed
          ? (Math.imul((flatSeed >>> 0) ^ 0x9e3779b9, 2654435761) >>> 0)
          : 0;
        const seedNoise = flatSeed
          ? ((seedHash & 0xffff) / 65536 - 0.5) * 0.5
          : 0;
        sampledFlatSolver.flatMix = Math.max(0.08, Math.min(0.92, amplified + seedNoise));
      }
      const runtimeFlat = algorithm === 'sierra-lite'
        ? resolveRuntimeFlatMixByBand(0, flatPairSpread)
        : {};
      const resolvedFlatMixByBand = sampledFlatSolver
        ? undefined
        : preferSampledFlatSolver
        ? undefined
        : (flatMixByBand ?? runtimeFlat.mixByBand);

      ccLog('flat recipe inputs', {
        algorithm,
        flatPosition,
        baseOffset,
        flatPairSpread,
        preferSampledFlatSolver,
        sampledFlatSolverStopCount: sampledFlatSourceStops.length,
        representativeSampledTarget: representativeSampledTarget
          ? {
              tone: Number(representativeSampledTarget.tone.toFixed(6)),
              color: representativeSampledTarget.color,
            }
          : null,
        sampledFlatSolver,
        resolvedFlatMixByBand,
        activeCellCount: activeMask.reduce((count, value) => count + (value ? 1 : 0), 0),
      });
      fillFlatPatternMode({
        algorithm,
        patternStyle,
        tone: flatPosition,
        flatPosition: sampledFlatSolver?.flatPosition ?? (sampledFlatSolver ? undefined : flatPosition),
        flatLowIndex: sampledFlatSolver?.lowIndex,
        flatHighIndex: sampledFlatSolver?.highIndex,
        flatMix: sampledFlatSolver?.flatMix,
        flatMixByBand: resolvedFlatMixByBand,
        flatSeed,
        spread: flatPairSpread,
        gridW,
        gridH,
        activeMask,
        fillBackground,
        baseOffset,
        phaseX,
        phaseY,
        writeCellIndex: (cellIdx, index) => {
          cellIndices[cellIdx] = index;
        },
      });

      const patternOutput = summarizeFlatPatternOutput(cellIndices, activeMask);
      ccLog('flat pattern output', patternOutput);
      if (preferSampledFlatSolver && sampledFlatTraceId) {
        ccLog('sampled flat trace', {
          traceId: sampledFlatTraceId,
          stage: sampledFlatTraceStage ?? 'unknown',
        sampledSourceStops: summarizeStoredStopsForDebug(sampledFlatSourceStops),
        flatPosition: Number(flatPosition.toFixed(6)),
        representativeSampledTone: representativeSampledTarget
          ? Number(representativeSampledTarget.tone.toFixed(6))
          : null,
        representativeSampledColor: representativeSampledTarget?.color ?? null,
        spread: flatPairSpread ?? null,
        solvedLowIndex: sampledFlatSolver?.lowIndex ?? null,
        solvedHighIndex: sampledFlatSolver?.highIndex ?? null,
          solvedFlatMix: sampledFlatSolver
            ? Number(sampledFlatSolver.flatMix.toFixed(6))
            : null,
          writtenLowInkIndex: patternOutput.lowInkIndex,
          writtenHighInkIndex: patternOutput.highInkIndex,
          writtenIndexRange:
            patternOutput.lowInkIndex != null && patternOutput.highInkIndex != null
              ? Math.max(0, patternOutput.highInkIndex - patternOutput.lowInkIndex)
              : null,
          finalActiveCellCount: patternOutput.activeCellCount,
          finalUniqueIndices: patternOutput.uniqueActiveIndices,
        });
      }
    }
  } else if (algorithm === 'sierra-lite') {
    let errCurr = new Float32Array(gridW);
    let errNext = new Float32Array(gridW);
    for (let cy = 0; cy < gridH; cy += 1) {
      const activeRow = activeCellsByRow[cy];
      if (!activeRow.length) {
        const swapErr = errCurr;
        errCurr = errNext;
        errNext = swapErr;
        errNext.fill(0);
        continue;
      }

      const swapErr = errCurr;
      errCurr = errNext;
      errNext = swapErr;
      errNext.fill(0);

      const serpentine = (cy & 1) === 1;
      const start = serpentine ? activeRow.length - 1 : 0;
      const end = serpentine ? -1 : activeRow.length;
      const step = serpentine ? -1 : 1;

      for (let i = start; i !== end; i += step) {
        const cx = activeRow[i];
        const cellIdx = cy * gridW + cx;
        const scaled = (cellCoverage[cellIdx] / 255) * (clampedLevels - 1);
        const lower = Math.max(0, Math.min(clampedLevels - 1, Math.floor(scaled)));
        const frac = scaled - lower;
        const adj = clamp01(frac + (errCurr[cx] || 0));
        const thr = 0.5 + (noiseAt(cx, cy) - 0.5) * thresholdJitter;
        const chooseUpper = lower < clampedLevels - 1 && adj >= thr;
        const q = chooseUpper ? 1 : 0;
        const err = adj - q;

        if (!serpentine) {
          if (cx + 1 < gridW) errCurr[cx + 1] += err * 0.5;
          if (cx - 1 >= 0) errNext[cx - 1] += err * 0.25;
        } else {
          if (cx - 1 >= 0) errCurr[cx - 1] += err * 0.5;
          if (cx + 1 < gridW) errNext[cx + 1] += err * 0.25;
        }
        errNext[cx] += err * 0.25;

        const level = chooseUpper ? lower + 1 : lower;
        const pos = levelToCyclePos(level, clampedLevels);
        cellIndices[cellIdx] = indexFromNormalized(pos, baseOffset);
      }
    }
  } else if (algorithm in ERROR_DIFFUSION_KERNELS) {
    const kernel = ERROR_DIFFUSION_KERNELS[algorithm as keyof typeof ERROR_DIFFUSION_KERNELS];
    const profile = ERROR_DIFFUSION_PROFILES[algorithm as keyof typeof ERROR_DIFFUSION_PROFILES];
    const errBuf = new Float32Array(gridW * gridH);
    const jitterScale = profile.jitterBase / Math.max(1, clampedLevels - 1);

    for (let cy = 0; cy < gridH; cy += 1) {
      const activeRow = activeCellsByRow[cy];
      if (!activeRow.length) continue;

      const useSerpentine = kernel.serpentine !== false;
      const leftToRight = useSerpentine ? (cy & 1) === 0 : true;
      const start = leftToRight ? 0 : activeRow.length - 1;
      const end = leftToRight ? activeRow.length : -1;
      const step = leftToRight ? 1 : -1;

      for (let i = start; i !== end; i += step) {
        const cx = activeRow[i];
        const cellIdx = cy * gridW + cx;
        let scaled = (cellCoverage[cellIdx] / 255) * (clampedLevels - 1);
        scaled += errBuf[cellIdx] || 0;
        if (jitterScale > 0) {
          scaled += (noiseAt(cx, cy) - 0.5) * jitterScale;
        }
        scaled = Math.max(0, Math.min(clampedLevels - 1, scaled));

        const lower = Math.floor(scaled);
        const upper = Math.min(clampedLevels - 1, lower + 1);
        const frac = scaled - lower;
        const level = frac >= profile.threshold ? upper : lower;
        const err = scaled - level;

        if (err !== 0) {
          const norm = 1 / Math.max(1, kernel.divisor);
          for (let k = 0; k < kernel.taps.length; k += 1) {
            const tap = kernel.taps[k];
            const nx = cx + (leftToRight ? tap.dx : -tap.dx);
            const ny = cy + tap.dy;
            if (nx < 0 || nx >= gridW || ny < 0 || ny >= gridH) continue;
            const nIdx = ny * gridW + nx;
            if (!activeMask[nIdx]) continue;
            errBuf[nIdx] += err * tap.weight * norm;
          }
        }

        const pos = levelToCyclePos(level, clampedLevels);
        cellIndices[cellIdx] = indexFromNormalized(pos, baseOffset);
      }
    }
  } else {
    const phaseX = Math.floor(minX / Math.max(1, cellSize));
    const phaseY = Math.floor(minY / Math.max(1, cellSize));
    for (let cy = 0; cy < gridH; cy += 1) {
      const activeRow = activeCellsByRow[cy];
      if (!activeRow.length) continue;
      for (let i = 0; i < activeRow.length; i += 1) {
        const cx = activeRow[i];
        const cellIdx = cy * gridW + cx;
        const scaled = (cellCoverage[cellIdx] / 255) * (clampedLevels - 1);
        const lower = Math.max(0, Math.min(clampedLevels - 1, Math.floor(scaled)));
        const frac = scaled - lower;
        const threshold = resolveOrderedThreshold(
          algorithm,
          patternStyle,
          cx + phaseX,
          cy + phaseY
        );
        const chooseUpper = lower < clampedLevels - 1 && frac >= threshold;
        const level = chooseUpper ? lower + 1 : lower;
        const pos = levelToCyclePos(level, clampedLevels);
        cellIndices[cellIdx] = indexFromNormalized(pos, baseOffset);
      }
    }
  }

  if (useWholeEdgeCells) {
    for (let cy = 0; cy < gridH; cy += 1) {
      const activeRow = activeCellsByRow[cy];
      if (!activeRow.length) {
        continue;
      }
      const rowOffset = cy * gridW;
      const yStart = minY + cy * cellSize;
      const yEnd = Math.min(maxY, yStart + cellSize - 1);
      for (let y = yStart; y <= yEnd; y += 1) {
        if (yieldIfNeeded) {
          await yieldIfNeeded(y - minY);
        }
        for (let i = 0; i < activeRow.length; i += 1) {
          const cx = activeRow[i];
          if (cx < 0 || cx >= gridW) continue;
          const index = cellIndices[rowOffset + cx];
          const cellX = minX + cx * cellSize;
          const cellXEnd = Math.min(maxX, cellX + cellSize - 1);

          if (index <= 0 && !fillBackground) {
            // In whole-cell edge mode, avoid clearing previous painted cells when BG fill is off.
            // This preserves prior CC shapes and only expands newly painted pixels to full cells.
            continue;
          }

          for (let x = cellX; x <= cellXEnd; x += 1) {
            if (logSetIndexSample) {
              logSetIndexSample(x, y);
            }
            writeIndex(x, y, index);
          }
        }
      }
    }
    return;
  }

  for (let row = 0; row < bboxHeight; row += 1) {
    const y = minY + row;
    if (yieldIfNeeded) {
      await yieldIfNeeded(row);
    }
    const spans = rowSpans[row];
    if (!spans.length) continue;

    const cy = Math.max(0, Math.min(gridH - 1, Math.floor((y - minY) / cellSize)));
    const rowOffset = cy * gridW;

    for (let i = 0; i < spans.length; i += 1) {
      const [startX, endX] = spans[i];
      const startCell = Math.floor((startX - minX) / cellSize);
      const endCell = Math.floor((endX - minX) / cellSize);

      for (let cx = startCell; cx <= endCell; cx += 1) {
        if (cx < 0 || cx >= gridW) continue;
        const index = cellIndices[rowOffset + cx];
        if (index <= 0) {
          if (!fillBackground) {
            const cellX = minX + cx * cellSize;
            const cellXEnd = Math.min(endX, cellX + cellSize - 1);
            const fillStart = Math.max(startX, cellX);
            if (fillStart <= cellXEnd) {
              for (let x = fillStart; x <= cellXEnd; x += 1) {
                if (logSetIndexSample) {
                  logSetIndexSample(x, y);
                }
                writeIndex(x, y, 0);
              }
            }
          }
          continue;
        }

        const cellX = minX + cx * cellSize;
        const cellXEnd = Math.min(endX, cellX + cellSize - 1);
        const fillStart = Math.max(startX, cellX);
        if (fillStart > cellXEnd) continue;

        for (let x = fillStart; x <= cellXEnd; x += 1) {
          if (logSetIndexSample) {
            logSetIndexSample(x, y);
          }
          writeIndex(x, y, index);
        }
      }
    }
  }
};
