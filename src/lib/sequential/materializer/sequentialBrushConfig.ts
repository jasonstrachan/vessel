import { BrushShape, type SequentialStrokeEvent } from '@/types';
import {
  normalizeSequentialDitherPluginConfig,
  normalizeSequentialParticlePluginConfig,
  normalizeSequentialSpamPluginConfig,
} from '@/lib/sequential/pluginConfig';
import { resolveStrokeDitherPalette } from '@/hooks/brushEngine/engineShared';
import { parseCssColor } from '@/utils/color/parseCssColor';
import { DEFAULT_GRADIENT_STOPS } from '@/utils/gradientPresets';
import type { SequentialStampShape } from '@/lib/sequential/materializer/sequentialBrushShape';

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

export type SequentialTextureMode = 'solid' | 'dither' | 'mosaic' | 'risograph-soft' | 'risograph-ultra';
export type SequentialPluginRenderMode = 'none' | 'dither-brush' | 'particle-brush' | 'spam-brush';
export type SupportedBlendMode = 'source-over' | 'destination-out';
export type SequentialMosaicConfig = {
  tilePx: number;
  segmentPx: number;
  blocksCount: number;
  paletteCount: number;
  ditherEnabled: boolean;
  segmentJitter: number;
  seed: number;
  gradientStops: Array<{ position: number; color: string }>;
};
export type ResolvedDitherTextureConfig = {
  algorithm:
    | 'bayer'
    | 'bayer-4x4'
    | 'blue-noise'
    | 'void-and-cluster'
    | 'pattern'
    | 'floyd-steinberg'
    | 'jarvis-judice-ninke'
    | 'stucki'
    | 'burkes'
    | 'sierra-3'
    | 'sierra-2'
    | 'sierra-lite'
    | 'atkinson';
  patternStyle:
    | 'dots'
    | 'lines'
    | 'vertical-lines'
    | 'horizontal-lines'
    | 'crosshatch'
    | 'diagonal'
    | 'tone-adaptive';
  intensity: number;
  matrixSize: 2 | 4 | 8;
  coverageBase: number;
  bgFill: boolean;
  tileScale: number;
  seed: number;
};
export type ResolvedDitherPalette = {
  primary: [number, number, number];
  secondary: [number, number, number];
};
export type ResolvedParticleConfig = {
  density: number;
  scatterRadiusFactor: number;
};
export type ResolvedSpamConfig = {
  fontBias: number;
  contentBias: number;
  customTextBias: number;
};
export const resolveStampShape = (event: SequentialStrokeEvent): SequentialStampShape => {
  const explicitTipShape = event.brush.tipShape;
  if (
    explicitTipShape === 'round' ||
    explicitTipShape === 'square' ||
    explicitTipShape === 'triangle' ||
    explicitTipShape === 'diamond' ||
    explicitTipShape === 'diamond5' ||
    explicitTipShape === 'diamond7' ||
    explicitTipShape === 'diamond9' ||
    explicitTipShape === 'checkered'
  ) {
    return explicitTipShape;
  }

  const pluginMode = resolvePluginRenderMode(event.brush.pluginBrushId);
  const shouldUseDitherTipShape =
    event.brush.ditherEnabled ||
    pluginMode === 'dither-brush' ||
    event.brush.brushShape === BrushShape.PIXEL_DITHER ||
    event.brush.brushShape === BrushShape.DITHER_GRADIENT;
  if (shouldUseDitherTipShape) {
    const tipShape = event.brush.ditherStrokeTipShape;
    if (tipShape === 'square') {
      return 'square';
    }
    if (tipShape === 'diamond5') {
      return 'diamond5';
    }
    if (tipShape === 'diamond7') {
      return 'diamond7';
    }
    if (tipShape === 'diamond9') {
      return 'diamond9';
    }
    if (tipShape === 'checkered') {
      return 'checkered';
    }
    if (tipShape === 'diamond') {
      return 'diamond';
    }
    if (tipShape === 'triangle') {
      return 'triangle';
    }
    if (tipShape === 'round') {
      return 'round';
    }
  }
  const brushShape = event.brush.brushShape;
  switch (brushShape) {
    case BrushShape.SQUARE:
    case BrushShape.MOSAIC:
    case BrushShape.PIXEL_DITHER:
      return 'square';
    case BrushShape.TRIANGLE:
    case BrushShape.COLOR_CYCLE_TRIANGLE:
      return 'triangle';
    default:
      return 'round';
  }
};

export const resolveTextureMode = (event: SequentialStrokeEvent): SequentialTextureMode => {
  const pluginMode = resolvePluginRenderMode(event.brush.pluginBrushId);
  if (pluginMode === 'dither-brush') {
    return 'dither';
  }
  if (event.brush.brushShape === BrushShape.MOSAIC) {
    return 'mosaic';
  }
  if (event.brush.ditherEnabled) {
    return 'dither';
  }
  switch (event.brush.brushShape) {
    case BrushShape.PIXEL_DITHER:
    case BrushShape.DITHER_GRADIENT:
      return 'dither';
    case BrushShape.RISOGRAPH_SOFT:
      return 'risograph-soft';
    case BrushShape.RISOGRAPH_ULTRA:
      return 'risograph-ultra';
    default:
      return 'solid';
  }
};

export const resolvePluginRenderMode = (pluginBrushId?: string | null): SequentialPluginRenderMode => {
  const normalizedId = pluginBrushId?.trim().toLowerCase();
  switch (normalizedId) {
    case 'dither-brush':
      return 'dither-brush';
    case 'particle-brush':
      return 'particle-brush';
    case 'spam-brush':
      return 'spam-brush';
    default:
      return 'none';
  }
};

export const resolveBlendMode = (event: SequentialStrokeEvent): SupportedBlendMode =>
  event.brush.blendMode === 'destination-out' ? 'destination-out' : 'source-over';

export const resolveMosaicConfig = (event: SequentialStrokeEvent): SequentialMosaicConfig => ({
  tilePx: Math.max(1, Math.round(event.brush.mosaicTilePx ?? 4)),
  segmentPx: Math.max(1, Math.round(event.brush.mosaicSegmentPx ?? 160)),
  blocksCount: Math.max(1, Math.round(event.brush.mosaicBlocksCount ?? 1)),
  paletteCount: Math.max(2, Math.round(event.brush.mosaicPaletteCount ?? 6)),
  ditherEnabled: Boolean(event.brush.mosaicDitherEnabled),
  segmentJitter: clamp01((event.brush.mosaicSegmentJitter ?? 0) / 100),
  seed: Math.round(event.brush.mosaicSeed ?? 0),
  gradientStops:
    event.brush.colorCycleGradient?.length
      ? event.brush.colorCycleGradient
      : DEFAULT_GRADIENT_STOPS,
});

const sampleGradientRgb = (
  stops: Array<{ position: number; color: string }>,
  position: number
): [number, number, number] => {
  const normalizedStops = stops
    .map((stop) => ({
      position: clamp01(stop.position),
      color: parseCssColor(stop.color),
    }))
    .sort((a, b) => a.position - b.position);
  if (normalizedStops.length === 0) {
    return [0, 0, 0];
  }
  const clamped = clamp01(position);
  let prev = normalizedStops[0];
  let next = normalizedStops[normalizedStops.length - 1];
  for (let i = 0; i < normalizedStops.length - 1; i += 1) {
    const current = normalizedStops[i];
    const upcoming = normalizedStops[i + 1];
    if (clamped >= current.position && clamped <= upcoming.position) {
      prev = current;
      next = upcoming;
      break;
    }
  }
  const span = next.position - prev.position;
  const t = span > 0 ? (clamped - prev.position) / span : 0;
  const r = Math.round(prev.color.r + (next.color.r - prev.color.r) * t);
  const g = Math.round(prev.color.g + (next.color.g - prev.color.g) * t);
  const b = Math.round(prev.color.b + (next.color.b - prev.color.b) * t);
  return [r, g, b];
};

export const samplePalette = (
  stops: Array<{ position: number; color: string }>,
  paletteCount: number,
  rng: () => number
): Array<[number, number, number]> => {
  const palette: Array<[number, number, number]> = [];
  for (let i = 0; i < paletteCount; i += 1) {
    const t = (i + 0.5) / paletteCount;
    palette.push(sampleGradientRgb(stops, t));
  }
  for (let i = palette.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [palette[i], palette[j]] = [palette[j], palette[i]];
  }
  return palette;
};

export const hashString32 = (value: string): number => {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
};

export const resolveReplayDitherPalette = ({
  color,
  ditherIntensity,
  ditherBackgroundFill,
}: {
  color: { r: number; g: number; b: number };
  ditherIntensity: number;
  ditherBackgroundFill: boolean;
}): ResolvedDitherPalette => {
  const { foregroundInk, backgroundInk } = resolveStrokeDitherPalette({
    color: `rgb(${color.r}, ${color.g}, ${color.b})`,
    spreadPercent: Math.max(0, Math.min(100, ditherIntensity)),
    ditherBackgroundFill,
  });
  return {
    primary: foregroundInk,
    secondary: backgroundInk,
  };
};

export const resolveDitherTextureConfig = ({
  event,
}: {
  event: SequentialStrokeEvent;
}): ResolvedDitherTextureConfig => {
  const config = normalizeSequentialDitherPluginConfig({
    config: event.brush.pluginConfig,
    brushDitherAlgorithm: event.brush.ditherAlgorithm,
    brushPatternStyle: event.brush.pluginConfig?.patternStyle ?? undefined,
    brushDitherBackgroundFill: event.brush.ditherBackgroundFill,
    fillResolution: event.brush.fillResolution,
  });
  const normalizedAlgorithm = typeof config.ditherAlgorithm === 'string'
    ? config.ditherAlgorithm
    : 'bayer';
  const intensity = clamp01((config.ditherIntensity ?? 80) / 100);
  const matrixSize = config.ditherBayerMatrixSize === 2 || config.ditherBayerMatrixSize === 4
    ? config.ditherBayerMatrixSize
    : 8;
  const patternStyle = config.patternStyle === 'lines' ||
    config.patternStyle === 'vertical-lines' ||
    config.patternStyle === 'horizontal-lines' ||
    config.patternStyle === 'crosshatch' ||
    config.patternStyle === 'diagonal' ||
    config.patternStyle === 'tone-adaptive'
    ? config.patternStyle
    : 'dots';
  const algorithm =
    normalizedAlgorithm === 'bayer-4x4' ||
    normalizedAlgorithm === 'pattern' ||
    normalizedAlgorithm === 'blue-noise' ||
    normalizedAlgorithm === 'void-and-cluster' ||
    normalizedAlgorithm === 'floyd-steinberg' ||
    normalizedAlgorithm === 'jarvis-judice-ninke' ||
    normalizedAlgorithm === 'stucki' ||
    normalizedAlgorithm === 'burkes' ||
    normalizedAlgorithm === 'sierra-3' ||
    normalizedAlgorithm === 'sierra-2' ||
    normalizedAlgorithm === 'sierra-lite' ||
    normalizedAlgorithm === 'atkinson'
      ? normalizedAlgorithm
      : 'bayer';
  const tileScale = Number.isFinite(event.brush.fillResolution)
    ? Math.max(1, Math.min(64, Math.round(event.brush.fillResolution ?? 1)))
    : 1;
  const seed = hashString32(`${event.strokeId}:${event.id}:${algorithm}:${patternStyle}`);
  return {
    algorithm,
    patternStyle,
    intensity,
    matrixSize,
    coverageBase: 0.62 + (1 - intensity) * 0.26,
    bgFill: config.ditherBackgroundFill !== false && event.brush.ditherBackgroundFill !== false,
    tileScale,
    seed,
  };
};

export const resolveParticleConfig = ({
  event,
}: {
  event: SequentialStrokeEvent;
}): ResolvedParticleConfig => {
  const config = normalizeSequentialParticlePluginConfig({
    config: event.brush.pluginConfig,
  });
  return {
    density: Number.isFinite(config.particleDensity) ? config.particleDensity ?? 20 : 20,
    scatterRadiusFactor: Number.isFinite(config.particleScatterRadius)
      ? config.particleScatterRadius ?? 1.5
      : 1.5,
  };
};

export const resolveSpamConfig = ({
  event,
}: {
  event: SequentialStrokeEvent;
}): ResolvedSpamConfig => {
  const config = normalizeSequentialSpamPluginConfig({
    config: event.brush.pluginConfig,
  });
  return {
    fontBias:
      typeof config.spamFont === 'string'
        ? clamp01((config.spamFont.length % 10) / 10)
        : 0.5,
    contentBias:
      typeof config.spamContentType === 'string'
        ? clamp01((config.spamContentType.length % 12) / 12)
        : 0.5,
    customTextBias:
      typeof config.spamCustomText === 'string'
        ? clamp01(Math.min(1, config.spamCustomText.length / 32))
        : 0,
  };
};
