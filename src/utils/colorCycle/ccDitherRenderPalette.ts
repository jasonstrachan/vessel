import { clampForegroundColors } from '@/utils/colorCycle/foregroundGradientSettings';
import { parseColor } from '@/hooks/brushEngine/colorUtils';
import { buildCcInkPalettes } from '@/utils/colorCycle/ccInkSpread';
import type { BrushSettings } from '@/types';
import {
  resolveFlatInkSetForBand,
  resolveFlatInkSetForPosition,
} from '@/utils/colorCycle/ccFlatModePatterns';
import type { StoredStop } from '@/utils/colorCycleGradientDefs';
import { parseCssColor } from '@/utils/color/parseCssColor';

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

const formatRgb = (rgb: [number, number, number]): string =>
  `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;

const resolveStopOpacity = (stop: StoredStop): number => {
  const cssAlpha = parseCssColor(stop.color).a / 255;
  const opacity = Number.isFinite(stop.opacity)
    ? clamp01(Number(stop.opacity))
    : 1;
  return cssAlpha * opacity;
};

const preserveTransparentKeywordChroma = (stops: StoredStop[]): StoredStop[] => {
  const chromaStops = stops.filter(
    (stop) => stop.color.trim().toLowerCase() !== 'transparent',
  );
  if (chromaStops.length === 0) {
    return stops.map((stop) => ({ ...stop, opacity: 0 }));
  }

  return stops.map((stop) => {
    if (stop.color.trim().toLowerCase() !== 'transparent') {
      return stop;
    }
    const nearest = chromaStops.reduce((best, candidate) => (
      Math.abs(candidate.position - stop.position) < Math.abs(best.position - stop.position)
        ? candidate
        : best
    ));
    return {
      ...stop,
      color: nearest.color,
      opacity: 0,
    };
  });
};

const sampleGradientOpacity = (stops: StoredStop[], position: number): number => {
  const sorted = [...stops].sort((a, b) => a.position - b.position);
  if (sorted.length === 0) {
    return 1;
  }
  if (sorted.length === 1 || position <= sorted[0].position) {
    return resolveStopOpacity(sorted[0]);
  }
  const last = sorted[sorted.length - 1];
  if (position >= last.position) {
    return resolveStopOpacity(last);
  }

  for (let index = 0; index < sorted.length - 1; index += 1) {
    const left = sorted[index];
    const right = sorted[index + 1];
    if (position < left.position || position > right.position) {
      continue;
    }
    const mix = (position - left.position) / Math.max(1e-6, right.position - left.position);
    const leftOpacity = resolveStopOpacity(left);
    const rightOpacity = resolveStopOpacity(right);
    return leftOpacity + (rightOpacity - leftOpacity) * mix;
  }

  return resolveStopOpacity(last);
};

const makeRenderStop = (
  baseStops: StoredStop[],
  position: number,
  color: string,
): StoredStop => {
  const opacity = sampleGradientOpacity(baseStops, position);
  return opacity >= 1
    ? { position, color }
    : { position, color, opacity };
};

const makeStopsOpaque = (stops: StoredStop[]): StoredStop[] =>
  stops.map((stop) => {
    const parsed = parseCssColor(stop.color);
    const opacity = Number.isFinite(stop.opacity)
      ? clamp01(Number(stop.opacity))
      : 1;
    if (parsed.a >= 255 && opacity >= 1) {
      return stop;
    }
    return {
      ...stop,
      color: parsed.a >= 255
        ? stop.color
        : formatRgb([parsed.r, parsed.g, parsed.b]),
      opacity: 1,
    };
  });

const completeRenderAlphaBounds = (
  baseStops: StoredStop[],
  renderStops: StoredStop[],
): StoredStop[] => {
  if (renderStops.length === 0) {
    return renderStops;
  }
  const completed = renderStops.slice();
  const first = completed[0];
  if (
    first.position > 0
    && Math.abs(resolveStopOpacity(first) - sampleGradientOpacity(baseStops, 0)) > 1e-6
  ) {
    completed.unshift(makeRenderStop(baseStops, 0, first.color));
  }
  const last = completed[completed.length - 1];
  if (
    last.position < 1
    && Math.abs(resolveStopOpacity(last) - sampleGradientOpacity(baseStops, 1)) > 1e-6
  ) {
    completed.push(makeRenderStop(baseStops, 1, last.color));
  }
  return completed;
};

const sampleGradientColor = (stops: StoredStop[], position: number): [number, number, number] => {
  const sorted = [...stops].sort((a, b) => a.position - b.position);
  if (sorted.length === 0) {
    return [0, 0, 0];
  }
  if (sorted.length === 1 || position <= sorted[0].position) {
    return parseColor(sorted[0].color);
  }
  const last = sorted[sorted.length - 1];
  if (position >= last.position) {
    return parseColor(last.color);
  }

  for (let index = 0; index < sorted.length - 1; index += 1) {
    const left = sorted[index];
    const right = sorted[index + 1];
    if (position < left.position || position > right.position) {
      continue;
    }
    const leftRgb = parseColor(left.color);
    const rightRgb = parseColor(right.color);
    const mix = (position - left.position) / Math.max(1e-6, right.position - left.position);
    return [
      Math.round(leftRgb[0] + (rightRgb[0] - leftRgb[0]) * mix),
      Math.round(leftRgb[1] + (rightRgb[1] - leftRgb[1]) * mix),
      Math.round(leftRgb[2] + (rightRgb[2] - leftRgb[2]) * mix),
    ];
  }

  return parseColor(last.color);
};

const dotRgb = (
  a: [number, number, number],
  b: [number, number, number]
): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

const subtractRgb = (
  a: [number, number, number],
  b: [number, number, number]
): [number, number, number] => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];

export type FlatSierraBandMixInfo = {
  band: number;
  low: [number, number, number];
  high: [number, number, number];
  target: [number, number, number];
  mix: number;
};

export const resolveFlatSierraBandMixInfo = ({
  stops,
  targetColor,
  baseOffset,
  spread,
}: {
  stops: StoredStop[];
  targetColor?: string;
  baseOffset: number;
  spread?: number;
}): FlatSierraBandMixInfo[] => {
  if (!stops.length) {
    return [];
  }
  const globalTarget = targetColor ? parseColor(targetColor) : null;
  const info: FlatSierraBandMixInfo[] = [];
  for (let band = 0; band < 5; band += 1) {
    const [lowIndex, highIndex] = resolveFlatInkSetForBand(band, 2, baseOffset, spread).indices;
    const low = sampleGradientColor(stops, clamp01((lowIndex - 1) / 254));
    const high = sampleGradientColor(stops, clamp01((highIndex - 1) / 254));
    const centerPos = clamp01((((lowIndex - 1) / 254) + ((highIndex - 1) / 254)) * 0.5);
    const target = globalTarget ?? sampleGradientColor(stops, centerPos);
    const span = subtractRgb(high, low);
    const toTarget = subtractRgb(target, low);
    const denom = dotRgb(span, span);
    const mix = denom <= 1e-6 ? 0.5 : clamp01(dotRgb(toTarget, span) / denom);
    info.push({ band, low, high, target, mix });
  }
  return info;
};

export const resolveFlatSierraMixByBand = ({
  stops,
  targetColor,
  baseOffset,
  spread,
}: {
  stops: StoredStop[];
  targetColor?: string;
  baseOffset: number;
  spread?: number;
}): number[] => {
  return resolveFlatSierraBandMixInfo({
    stops,
    targetColor,
    baseOffset,
    spread,
  }).map((entry) => entry.mix);
};

export const resolveFlatSierraBestBandForTarget = ({
  stops,
  targetColor,
  baseOffset,
  spread,
}: {
  stops: StoredStop[];
  targetColor: string;
  baseOffset: number;
  spread?: number;
}): number => {
  if (!stops.length) {
    return 2;
  }
  const target = parseColor(targetColor);
  const mixes = resolveFlatSierraMixByBand({
    stops,
    targetColor,
    baseOffset,
    spread,
  });

  let bestBand = 0;
  let bestError = Number.POSITIVE_INFINITY;
  for (let band = 0; band < 5; band += 1) {
    const [lowIndex, highIndex] = resolveFlatInkSetForBand(band, 2, baseOffset, spread).indices;
    const low = sampleGradientColor(stops, clamp01((lowIndex - 1) / 254));
    const high = sampleGradientColor(stops, clamp01((highIndex - 1) / 254));
    const amount = clamp01(mixes[band] ?? 0.5);
    const mixed: [number, number, number] = [
      Math.round(low[0] + (high[0] - low[0]) * amount),
      Math.round(low[1] + (high[1] - low[1]) * amount),
      Math.round(low[2] + (high[2] - low[2]) * amount),
    ];
    const dr = target[0] - mixed[0];
    const dg = target[1] - mixed[1];
    const db = target[2] - mixed[2];
    const error = dr * dr + dg * dg + db * db;
    if (error < bestError) {
      bestError = error;
      bestBand = band;
    }
  }
  return bestBand;
};

export type CcDitherRenderPalette = {
  bandCount: number;
  renderStops: StoredStop[];
};

export type CcDitherBandMode = {
  pairBandCount: number;
  quantLevels: number;
};

export const DEFAULT_CC_DITHER_INK_COLORS = 16;
export const MAX_CC_DITHER_INK_COLORS = 16;

export const resolveCcDitherInkColorCount = (
  settings: Pick<BrushSettings, 'ccDitherInkColors' | 'gradientBands' | 'colorCycleUseForegroundGradient' | 'colorCycleFgColors'>,
): number => {
  if (settings.colorCycleUseForegroundGradient) {
    return clampForegroundColors(settings.colorCycleFgColors);
  }
  const value = settings.ccDitherInkColors;
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.max(1, Math.min(MAX_CC_DITHER_INK_COLORS, Math.round(value)));
  }
  const legacyBands = settings.gradientBands;
  return typeof legacyBands === 'number' && Number.isFinite(legacyBands)
    ? Math.max(1, Math.min(254, Math.round(legacyBands)))
    : DEFAULT_CC_DITHER_INK_COLORS;
};

export const resolveCcDitherInkMode = (
  settings: Pick<BrushSettings, 'ccDitherInkColors' | 'gradientBands' | 'colorCycleUseForegroundGradient' | 'colorCycleFgColors'>,
): CcDitherBandMode => resolveCcDitherBandMode(resolveCcDitherInkColorCount(settings));

export const resolveCcDitherBandMode = (colors: number | undefined): CcDitherBandMode => {
  const clampedColors = Math.max(1, Math.floor(colors || 1));
  if (clampedColors <= 1) {
    return {
      pairBandCount: 0,
      quantLevels: 1,
    };
  }

  return {
    pairBandCount: clampedColors - 1,
    quantLevels: clampedColors,
  };
};

export const buildCcDitherRenderPalette = ({
  baseStops,
  bands,
  spread,
}: {
  baseStops: StoredStop[];
  bands: number;
  spread: Pick<BrushSettings, 'ditherPaletteSpread'>['ditherPaletteSpread'];
}): CcDitherRenderPalette => {
  const bandCount = Math.max(0, Math.floor(bands || 0));
  if (!baseStops.length) return { bandCount: 0, renderStops: [] };
  const renderStops: StoredStop[] = [];
  const count = Math.max(1, bandCount);
  for (let band = 0; band < count; band += 1) {
    const start = band / count;
    const center = (band + 0.5) / count;
    const target = formatRgb(sampleGradientColor(baseStops, center));
    const inks = buildCcInkPalettes([{ position: center, color: target }], spread);
    renderStops.push(
      makeRenderStop(baseStops, start, inks.primary[0].color),
      makeRenderStop(baseStops, center, inks.secondary[0].color),
    );
  }
  return { bandCount, renderStops: completeRenderAlphaBounds(baseStops, renderStops) };
};

const SIERRA_FLAT_BANDS = 5;
const toPalettePosition = (index: number): number => clamp01((index - 1) / 254);

export const buildCcFlatSierraContrastRenderPalette = ({
  baseStops,
  spread,
}: {
  baseStops: StoredStop[];
  spread: Pick<BrushSettings, 'ditherPaletteSpread'>['ditherPaletteSpread'];
}): CcDitherRenderPalette => {
  if (!baseStops.length) {
    return { bandCount: 0, renderStops: [] };
  }
  const renderStops: StoredStop[] = [];
  for (let band = 0; band < SIERRA_FLAT_BANDS; band += 1) {
    const centerPos = clamp01((band + 0.5) / SIERRA_FLAT_BANDS);
    const indices = resolveFlatInkSetForPosition(centerPos, 2, 0, spread).indices;
    const targetRgb = sampleGradientColor(baseStops, centerPos);
    const inks = buildCcInkPalettes([{ position: centerPos, color: formatRgb(targetRgb) }], spread);
    const lowPosition = toPalettePosition(indices[0]);
    const highPosition = toPalettePosition(indices[1]);
    renderStops.push(
      makeRenderStop(baseStops, lowPosition, inks.primary[0].color),
      makeRenderStop(baseStops, highPosition, inks.secondary[0].color),
    );
  }
  renderStops.sort((a, b) => a.position - b.position);
  return {
    bandCount: 0,
    renderStops: completeRenderAlphaBounds(baseStops, renderStops),
  };
};

export const buildCcDitherRuntimePalette = ({
  baseStops,
  bands,
  spread,
  algorithm,
  preserveSourceStops = false,
  useDitherRenderPalette = true,
  fillBackground = false,
  debugContext,
}: {
  baseStops: StoredStop[];
  bands: number;
  spread: Pick<BrushSettings, 'ditherPaletteSpread'>['ditherPaletteSpread'];
  algorithm?: BrushSettings['ditherAlgorithm'];
  preserveSourceStops?: boolean;
  useDitherRenderPalette?: boolean;
  fillBackground?: boolean;
  debugContext?: string;
}): CcDitherRenderPalette => {
  void debugContext;
  const sourceStops = preserveTransparentKeywordChroma(baseStops);
  const normalizedBandCount = Math.max(0, Math.floor(bands || 0));
  const resolvedAlgorithm = algorithm ?? 'sierra-lite';
  let result: CcDitherRenderPalette;
  if (!useDitherRenderPalette || (normalizedBandCount <= 0 && preserveSourceStops)) {
    result = {
      bandCount: 0,
      renderStops: sourceStops,
    };
  } else if (normalizedBandCount <= 0 && resolvedAlgorithm === 'sierra-lite') {
    result = buildCcFlatSierraContrastRenderPalette({
      baseStops: sourceStops,
      spread,
    });
  } else {
    result = buildCcDitherRenderPalette({
      baseStops: sourceStops,
      bands: normalizedBandCount,
      spread,
    });
  }
  // Flat Cycle already uses fillBackground to decide whether to write the low
  // weave index. Its base gradient alpha must remain available for playback.
  return fillBackground && useDitherRenderPalette
    ? {
        ...result,
        renderStops: makeStopsOpaque(result.renderStops),
      }
    : result;
};
