import { parseColor } from '@/hooks/brushEngine/colorUtils';
import {
  buildSpreadInkPalette,
  resolveStrokeDitherPalette,
  spreadPaletteColors,
} from '@/hooks/brushEngine/engineShared';
import type { BrushSettings } from '@/types';
import {
  resolveFlatInkSetForBand,
  resolveFlatInkSetForPosition,
  resolveFlatPairContrastStrength,
} from '@/utils/colorCycle/ccFlatModePatterns';
import type { StoredStop } from '@/utils/colorCycleGradientDefs';

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

const luminance = (rgb: [number, number, number]): number =>
  0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];

const mixRgb = (a: [number, number, number], b: [number, number, number]): [number, number, number] => ([
  Math.round((a[0] + b[0]) / 2),
  Math.round((a[1] + b[1]) / 2),
  Math.round((a[2] + b[2]) / 2),
]);

const rgbDistance = (a: [number, number, number], b: [number, number, number]): number => {
  const dr = a[0] - b[0];
  const dg = a[1] - b[1];
  const db = a[2] - b[2];
  return Math.sqrt(dr * dr + dg * dg + db * db);
};

const formatRgb = (rgb: [number, number, number]): string =>
  `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;

const rgbToCss = (rgb: [number, number, number]): string => formatRgb(rgb);

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

const pickInkPair = (
  target: [number, number, number],
  palette: string[]
): { low: string; high: string } => {
  const parsed = palette.map((color) => ({
    color,
    rgb: parseColor(color),
  }));
  if (parsed.length <= 1) {
    const fallback = parsed[0]?.color ?? formatRgb(target);
    return { low: fallback, high: fallback };
  }

  let bestPair = {
    low: parsed[0].color,
    high: parsed[1].color,
    score: Number.NEGATIVE_INFINITY,
  };

  for (let i = 0; i < parsed.length; i += 1) {
    for (let j = i + 1; j < parsed.length; j += 1) {
      const first = parsed[i];
      const second = parsed[j];
      const midpoint = mixRgb(first.rgb, second.rgb);
      const midpointError = rgbDistance(midpoint, target);
      const pairDistance = rgbDistance(first.rgb, second.rgb);
      const score = pairDistance - midpointError * 1.35;
      if (score <= bestPair.score) {
        continue;
      }
      const firstLum = luminance(first.rgb);
      const secondLum = luminance(second.rgb);
      bestPair = firstLum <= secondLum
        ? { low: first.color, high: second.color, score }
        : { low: second.color, high: first.color, score };
    }
  }

  const lowRgb = parseColor(bestPair.low);
  const highRgb = parseColor(bestPair.high);
  const midpoint = mixRgb(lowRgb, highRgb);
  const shift: [number, number, number] = [
    target[0] - midpoint[0],
    target[1] - midpoint[1],
    target[2] - midpoint[2],
  ];
  const recenter = (rgb: [number, number, number]): [number, number, number] => ([
    Math.max(0, Math.min(255, rgb[0] + shift[0])),
    Math.max(0, Math.min(255, rgb[1] + shift[1])),
    Math.max(0, Math.min(255, rgb[2] + shift[2])),
  ]);
  const shiftedLow = recenter(lowRgb);
  const shiftedHigh = recenter(highRgb);
  const lowLum = luminance(shiftedLow);
  const highLum = luminance(shiftedHigh);

  return lowLum <= highLum
    ? { low: formatRgb(shiftedLow), high: formatRgb(shiftedHigh) }
    : { low: formatRgb(shiftedHigh), high: formatRgb(shiftedLow) };
};

const pickInkTriad = (
  target: [number, number, number],
  palette: string[]
): { low: string; mid: string; high: string } | null => {
  const parsed = palette.map((color) => ({
    color,
    rgb: parseColor(color),
    lum: luminance(parseColor(color)),
  }));
  if (parsed.length < 3) {
    return null;
  }

  const byLum = [...parsed].sort((a, b) => a.lum - b.lum);
  const low = byLum[0];
  const high = byLum[byLum.length - 1];
  const middleCandidates = parsed.filter((entry) => entry.color !== low.color && entry.color !== high.color);
  const middleSource = middleCandidates.length > 0
    ? middleCandidates.reduce((best, current) => {
        const currentError = rgbDistance(current.rgb, target);
        const bestError = rgbDistance(best.rgb, target);
        return currentError < bestError ? current : best;
      }, middleCandidates[0])
    : parsed.reduce((best, current) => {
        const currentError = rgbDistance(current.rgb, target);
        const bestError = rgbDistance(best.rgb, target);
        return currentError < bestError ? current : best;
      }, parsed[1]);

  const triad = [low.rgb, middleSource.rgb, high.rgb] as const;
  const average: [number, number, number] = [
    Math.round((triad[0][0] + triad[1][0] + triad[2][0]) / 3),
    Math.round((triad[0][1] + triad[1][1] + triad[2][1]) / 3),
    Math.round((triad[0][2] + triad[1][2] + triad[2][2]) / 3),
  ];
  const shift: [number, number, number] = [
    target[0] - average[0],
    target[1] - average[1],
    target[2] - average[2],
  ];
  const recenter = (rgb: [number, number, number]): [number, number, number] => ([
    Math.max(0, Math.min(255, rgb[0] + shift[0])),
    Math.max(0, Math.min(255, rgb[1] + shift[1])),
    Math.max(0, Math.min(255, rgb[2] + shift[2])),
  ]);

  const shifted = triad.map(recenter);
  const shiftedEntries = shifted.map((rgb) => ({ rgb, lum: luminance(rgb) }));
  const ordered = [...shiftedEntries].sort((a, b) => a.lum - b.lum);
  const lowRgb = ordered[0].rgb;
  const highRgb = ordered[ordered.length - 1].rgb;
  const midRgb = ordered[1].rgb;

  return {
    low: formatRgb(lowRgb),
    mid: formatRgb(midRgb),
    high: formatRgb(highRgb),
  };
};

export type CcDitherRenderPalette = {
  bandCount: number;
  renderStops: StoredStop[];
};

export type CcDitherBandMode = {
  pairBandCount: number;
  quantLevels: number;
};

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
  const spreadStrength = clamp01((spread ?? 0) / 100);
  const useTriadStops = spreadStrength >= 0.95;
  const preservesOrderedStops = baseStops.length > 2;
  if (!baseStops.length) {
    return { bandCount: 0, renderStops: baseStops.slice() };
  }

  if (bandCount <= 0) {
    const targetRgb = sampleGradientColor(baseStops, 0.5);
    const targetHex = formatRgb(targetRgb);
    const palette = useTriadStops
      ? buildSpreadInkPalette({
          color: targetHex,
          spreadPercent: spread ?? 0,
        })
      : resolveStrokeDitherPalette({
          color: targetHex,
          spreadPercent: spread ?? 0,
          ditherBackgroundFill: false,
        }).palette;
    const triad = useTriadStops ? pickInkTriad(targetRgb, palette) : null;
    if (triad) {
      return {
        bandCount: 0,
        renderStops: [
          { position: 0, color: triad.low },
          { position: 0.5, color: triad.mid },
          { position: 1, color: triad.high },
        ],
      };
    }
    const { low, high } = pickInkPair(targetRgb, palette);
    return {
      bandCount: 0,
      renderStops: [
        { position: 0, color: low },
        { position: 0.5, color: high },
        { position: 1, color: high },
      ],
    };
  }

  const renderStops: StoredStop[] = [];
  for (let band = 0; band < bandCount; band += 1) {
    const segmentStart = band / bandCount;
    const center = clamp01((band + 0.5) / bandCount);
    const segmentEnd = (band + 1) / bandCount;
    if (preservesOrderedStops) {
      const sourceColors = useTriadStops
        ? [
            rgbToCss(sampleGradientColor(baseStops, segmentStart)),
            rgbToCss(sampleGradientColor(baseStops, center)),
            rgbToCss(sampleGradientColor(baseStops, segmentEnd)),
          ]
        : [
            rgbToCss(sampleGradientColor(baseStops, segmentStart)),
            rgbToCss(sampleGradientColor(baseStops, center)),
          ];
      const spreadColors = spreadPaletteColors(sourceColors, spread ?? 0);
      if (useTriadStops && spreadColors.length >= 3) {
        renderStops.push({ position: segmentStart, color: spreadColors[0] });
        renderStops.push({ position: center, color: spreadColors[1] });
        renderStops.push({ position: segmentEnd, color: spreadColors[2] });
        continue;
      }

      renderStops.push({ position: segmentStart, color: spreadColors[0] ?? sourceColors[0] });
      renderStops.push({
        position: center,
        color: spreadColors[1] ?? sourceColors[1],
      });
      continue;
    }

    const targetRgb = sampleGradientColor(baseStops, center);
    const targetHex = formatRgb(targetRgb);
    const palette = useTriadStops
      ? buildSpreadInkPalette({
          color: targetHex,
          spreadPercent: spread ?? 0,
        })
      : resolveStrokeDitherPalette({
          color: targetHex,
          spreadPercent: spread ?? 0,
          ditherBackgroundFill: false,
        }).palette;
    const triad = useTriadStops ? pickInkTriad(targetRgb, palette) : null;
    if (triad) {
      renderStops.push({ position: segmentStart, color: triad.low });
      renderStops.push({ position: center, color: triad.mid });
      renderStops.push({ position: segmentEnd, color: triad.high });
      continue;
    }
    const { low, high } = pickInkPair(targetRgb, palette);
    const lowPos = (band * 2) / (bandCount * 2);
    const highPos = (band * 2 + 1) / (bandCount * 2);
    renderStops.push({ position: lowPos, color: low });
    renderStops.push({ position: highPos, color: high });
  }

  return { bandCount, renderStops };
};

const SIERRA_FLAT_BANDS = 5;
const clampColorChannel = (value: number): number => Math.max(0, Math.min(255, Math.round(value)));

const toPalettePosition = (index: number): number => clamp01((index - 1) / 254);

const buildContrastInkPairForTarget = ({
  target,
  spreadDistance,
}: {
  target: [number, number, number];
  spreadDistance: number;
}): { low: [number, number, number]; high: [number, number, number] } => {
  const spreadStrength = resolveFlatPairContrastStrength(spreadDistance);
  const contrast = 10 + Math.round(Math.pow(spreadStrength, 0.85) * 90);

  const low: [number, number, number] = [
    clampColorChannel(target[0] - contrast),
    clampColorChannel(target[1] - contrast),
    clampColorChannel(target[2] - contrast),
  ];

  const high: [number, number, number] = [
    clampColorChannel(target[0] + contrast),
    clampColorChannel(target[1] + contrast),
    clampColorChannel(target[2] + contrast),
  ];
  const lowLum = luminance(low);
  const highLum = luminance(high);
  return lowLum <= highLum ? { low, high } : { low: high, high: low };
};

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
    const { low, high } = buildContrastInkPairForTarget({
      target: targetRgb,
      spreadDistance: Math.max(1, indices[1] - indices[0]),
    });
    renderStops.push(
      { position: toPalettePosition(indices[0]), color: formatRgb(low) },
      { position: toPalettePosition(indices[1]), color: formatRgb(high) }
    );
  }
  renderStops.sort((a, b) => a.position - b.position);
  return { bandCount: 0, renderStops };
};

export const buildCcDitherRuntimePalette = ({
  baseStops,
  bands,
  spread,
  algorithm,
}: {
  baseStops: StoredStop[];
  bands: number;
  spread: Pick<BrushSettings, 'ditherPaletteSpread'>['ditherPaletteSpread'];
  algorithm?: BrushSettings['ditherAlgorithm'];
}): CcDitherRenderPalette => {
  const normalizedBandCount = Math.max(0, Math.floor(bands || 0));
  const resolvedAlgorithm = algorithm ?? 'sierra-lite';
  if (normalizedBandCount <= 0 && resolvedAlgorithm === 'sierra-lite') {
    return buildCcFlatSierraContrastRenderPalette({
      baseStops,
      spread,
    });
  }
  return buildCcDitherRenderPalette({
    baseStops,
    bands: normalizedBandCount,
    spread,
  });
};
