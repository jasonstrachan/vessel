import { BrushShape, type SequentialStrokeEvent } from '@/types';
import { recordSequentialMaterializePerf } from '@/lib/sequential/SequentialPerfCounters';
import {
  normalizeSequentialDitherPluginConfig,
  normalizeSequentialParticlePluginConfig,
  normalizeSequentialSpamPluginConfig,
} from '@/lib/sequential/pluginConfig';
import {
  BLUE_NOISE_16x16,
  VOID_CLUSTER_8x8,
} from '@/utils/ditherAlgorithms';
import {
  sampleStampDitherReplayMask,
  type StampDitherAlgorithm,
} from '@/hooks/brushEngine/strokeStampDither';
import { resolveStrokeDitherPalette } from '@/hooks/brushEngine/engineShared';
import { parseCssColor } from '@/utils/color/parseCssColor';
import { DEFAULT_GRADIENT_STOPS } from '@/utils/gradientPresets';
import type { FrameTile, FrameTileSet, SequentialMaterializeFrameInput } from '@/lib/sequential/types';
import type { SequentialMaterializerBackend } from '@/lib/sequential/materializer/SequentialMaterializerBackend';

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

type SequentialStampShape = 'round' | 'square' | 'triangle';
type SequentialTextureMode = 'solid' | 'dither' | 'mosaic' | 'risograph-soft' | 'risograph-ultra';
type SequentialPluginRenderMode = 'none' | 'dither-brush' | 'particle-brush' | 'spam-brush';
type SupportedBlendMode = 'source-over' | 'destination-out';
type ParsedCustomStamp = {
  width: number;
  height: number;
  rgba: Uint8ClampedArray;
  isColorizable: boolean;
};
type SequentialMosaicConfig = {
  tilePx: number;
  segmentPx: number;
  blocksCount: number;
  paletteCount: number;
  ditherEnabled: boolean;
  segmentJitter: number;
  seed: number;
  gradientStops: Array<{ position: number; color: string }>;
};
type SequentialMosaicRuntime = {
  activePaletteRgb: Array<[number, number, number]>;
  tileColorIndices: number[];
  stampW: number;
  stampH: number;
  cols: number;
  rows: number;
  spacingPx: number;
  segmentRemainingPx: number;
  rng: () => number;
};
type ResolvedDitherTextureConfig = {
  algorithm:
    | 'bayer'
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
type ResolvedDitherPalette = {
  primary: [number, number, number];
  secondary: [number, number, number];
};
type ResolvedParticleConfig = {
  density: number;
  scatterRadiusFactor: number;
};
type ResolvedSpamConfig = {
  fontBias: number;
  contentBias: number;
  customTextBias: number;
};
const parsedCustomStampCache = new Map<string, ParsedCustomStamp>();

const resolveStampShape = (event: SequentialStrokeEvent): SequentialStampShape => {
  const explicitTipShape = event.brush.tipShape;
  if (
    explicitTipShape === 'round' ||
    explicitTipShape === 'square' ||
    explicitTipShape === 'triangle'
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
    if (tipShape === 'triangle' || tipShape === 'diamond') {
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

const resolveTextureMode = (event: SequentialStrokeEvent): SequentialTextureMode => {
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

const resolvePluginRenderMode = (pluginBrushId?: string | null): SequentialPluginRenderMode => {
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

const resolveBlendMode = (event: SequentialStrokeEvent): SupportedBlendMode =>
  event.brush.blendMode === 'destination-out' ? 'destination-out' : 'source-over';

const resolveMosaicConfig = (event: SequentialStrokeEvent): SequentialMosaicConfig => ({
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

const createRng = (seed: number): (() => number) => {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
};

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

const samplePalette = (
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

const refillMosaicTileIndices = (state: SequentialMosaicRuntime): void => {
  const tileCount = state.cols * state.rows;
  state.tileColorIndices = new Array(tileCount);
  for (let i = 0; i < tileCount; i += 1) {
    state.tileColorIndices[i] = Math.floor(state.rng() * state.activePaletteRgb.length);
  }
};

const nextSegmentLength = (config: SequentialMosaicConfig, rng: () => number): number => {
  if (config.segmentJitter <= 0) {
    return config.segmentPx;
  }
  const jitter = (rng() * 2 - 1) * config.segmentJitter;
  return Math.max(1, Math.round(config.segmentPx * (1 + jitter)));
};

const createMosaicRuntime = (
  config: SequentialMosaicConfig,
  spacingHint: number
): SequentialMosaicRuntime => {
  const rng = createRng(config.seed);
  const rows = 1;
  const cols = config.blocksCount;
  const runtime: SequentialMosaicRuntime = {
    activePaletteRgb: samplePalette(config.gradientStops, config.paletteCount, rng),
    tileColorIndices: [],
    stampW: config.tilePx * cols,
    stampH: config.tilePx * rows,
    cols,
    rows,
    spacingPx:
      Number.isFinite(spacingHint) && spacingHint > 0
        ? Math.max(1, Math.round(spacingHint))
        : Math.max(1, Math.floor(config.tilePx * 0.75)),
    segmentRemainingPx: 0,
    rng,
  };
  refillMosaicTileIndices(runtime);
  runtime.segmentRemainingPx = nextSegmentLength(config, rng);
  return runtime;
};

const advanceMosaicRuntimeByDistance = (
  runtime: SequentialMosaicRuntime,
  config: SequentialMosaicConfig,
  distance: number
): void => {
  let remaining = Math.max(0, distance);
  while (remaining > 0) {
    if (runtime.segmentRemainingPx <= 0) {
      runtime.activePaletteRgb = samplePalette(config.gradientStops, config.paletteCount, runtime.rng);
      refillMosaicTileIndices(runtime);
      runtime.segmentRemainingPx = nextSegmentLength(config, runtime.rng);
    }
    const step = Math.min(remaining, runtime.segmentRemainingPx);
    runtime.segmentRemainingPx -= step;
    remaining -= step;
  }
};

const isStampPixelCovered = ({
  shape,
  dx,
  dy,
  halfSize,
  radiusSq,
}: {
  shape: SequentialStampShape;
  dx: number;
  dy: number;
  halfSize: number;
  radiusSq: number;
}): boolean => {
  switch (shape) {
    case 'square':
      return Math.abs(dx) <= halfSize && Math.abs(dy) <= halfSize;
    case 'triangle': {
      if (Math.abs(dx) > halfSize || Math.abs(dy) > halfSize) {
        return false;
      }
      const normalizedY = dy / halfSize;
      const maxAbsX = (normalizedY + 1) * 0.5;
      return Math.abs(dx / halfSize) <= maxAbsX;
    }
    case 'round':
    default:
      return dx * dx + dy * dy <= radiusSq;
  }
};

const base64ToBytes = (base64: string): Uint8Array => {
  if (!base64) {
    return new Uint8Array(0);
  }
  if (typeof Buffer !== 'undefined') {
    return new Uint8Array(Buffer.from(base64, 'base64'));
  }
  if (typeof atob === 'function') {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }
  return new Uint8Array(0);
};

const parseCustomStamp = (event: SequentialStrokeEvent): ParsedCustomStamp | null => {
  const stamp = event.brush.customStamp;
  const hashKey = event.brush.customStampHash || null;
  if (!stamp || stamp.width <= 0 || stamp.height <= 0 || !stamp.rgbaBase64) {
    if (hashKey) {
      return parsedCustomStampCache.get(hashKey) ?? null;
    }
    return null;
  }
  const key = hashKey || `${stamp.width}x${stamp.height}:${stamp.rgbaBase64.length}`;
  const cached = parsedCustomStampCache.get(key);
  if (cached) {
    return cached;
  }
  const bytes = base64ToBytes(stamp.rgbaBase64);
  if (bytes.length !== stamp.width * stamp.height * 4) {
    return null;
  }
  const parsed: ParsedCustomStamp = {
    width: stamp.width,
    height: stamp.height,
    rgba: new Uint8ClampedArray(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)),
    isColorizable: Boolean(stamp.isColorizable),
  };
  parsedCustomStampCache.set(key, parsed);
  return parsed;
};

const BAYER_4 = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
];
const BAYER_2 = [
  [0, 2],
  [3, 1],
];
const BAYER_8 = [
  [0, 48, 12, 60, 3, 51, 15, 63],
  [32, 16, 44, 28, 35, 19, 47, 31],
  [8, 56, 4, 52, 11, 59, 7, 55],
  [40, 24, 36, 20, 43, 27, 39, 23],
  [2, 50, 14, 62, 1, 49, 13, 61],
  [34, 18, 46, 30, 33, 17, 45, 29],
  [10, 58, 6, 54, 9, 57, 5, 53],
  [42, 26, 38, 22, 41, 25, 37, 21],
];

const resolveDitherMatrixThreshold = ({
  x,
  y,
  matrixSize,
}: {
  x: number;
  y: number;
  matrixSize: 2 | 4 | 8;
}): number => {
  if (matrixSize === 2) {
    return (BAYER_2[y & 1][x & 1] + 0.5) / 4;
  }
  if (matrixSize === 8) {
    return (BAYER_8[y & 7][x & 7] + 0.5) / 64;
  }
  return (BAYER_4[y & 3][x & 3] + 0.5) / 16;
};

const shouldKeepDitherPixel = ({
  x,
  y,
  alpha,
}: {
  x: number;
  y: number;
  alpha: number;
}): boolean => {
  const threshold = resolveDitherMatrixThreshold({ x, y, matrixSize: 4 });
  const coverage = Math.max(0.1, Math.min(0.9, alpha * 0.5));
  return coverage >= threshold;
};

const hash2D01 = (x: number, y: number): number => {
  let h = (Math.imul(x + 1, 374761393) ^ Math.imul(y + 1, 668265263)) >>> 0;
  h = (h ^ (h >>> 13)) >>> 0;
  h = Math.imul(h, 1274126177) >>> 0;
  return (h & 0xffff) / 0xffff;
};

const hashString32 = (value: string): number => {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
};

const hashSeed01 = (seed: number, index: number): number => {
  const mixed = (Math.imul(index + 1, 374761393) ^ Math.imul(seed + 1, 668265263)) >>> 0;
  return hash2D01(mixed, seed ^ 0x9e3779b9);
};

const resolveReplayDitherPalette = ({
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

const compositePremultipliedPixel = ({
  pixels,
  index,
  srcR,
  srcG,
  srcB,
  srcA,
  blendMode,
}: {
  pixels: Uint8ClampedArray;
  index: number;
  srcR: number;
  srcG: number;
  srcB: number;
  srcA: number;
  blendMode: SupportedBlendMode;
}): void => {
  if (srcA <= 0) {
    return;
  }
  const dstR = pixels[index] / 255;
  const dstG = pixels[index + 1] / 255;
  const dstB = pixels[index + 2] / 255;
  const dstA = pixels[index + 3] / 255;

  if (blendMode === 'destination-out') {
    const outScale = 1 - srcA;
    pixels[index] = Math.round(clamp01(dstR * outScale) * 255);
    pixels[index + 1] = Math.round(clamp01(dstG * outScale) * 255);
    pixels[index + 2] = Math.round(clamp01(dstB * outScale) * 255);
    pixels[index + 3] = Math.round(clamp01(dstA * outScale) * 255);
    return;
  }

  const outA = srcA + dstA * (1 - srcA);
  const outR = srcR + dstR * (1 - srcA);
  const outG = srcG + dstG * (1 - srcA);
  const outB = srcB + dstB * (1 - srcA);
  pixels[index] = Math.round(clamp01(outR) * 255);
  pixels[index + 1] = Math.round(clamp01(outG) * 255);
  pixels[index + 2] = Math.round(clamp01(outB) * 255);
  pixels[index + 3] = Math.round(clamp01(outA) * 255);
};

const shouldKeepTexturedPixel = ({
  mode,
  x,
  y,
  alpha,
  ditherConfig,
}: {
  mode: SequentialTextureMode;
  x: number;
  y: number;
  alpha: number;
  ditherConfig?: ResolvedDitherTextureConfig | null;
}): boolean => {
  if (mode === 'solid') {
    return true;
  }
  if (mode === 'dither') {
    const config = ditherConfig ?? {
      algorithm: 'bayer',
      patternStyle: 'dots' as const,
      intensity: 0.8,
      matrixSize: 8 as const,
      coverageBase: 0.62 + (1 - 0.8) * 0.26,
      bgFill: true,
      tileScale: 1,
      seed: 0,
    };
    const coverage = Math.max(0.18, Math.min(0.98, alpha * config.coverageBase));
    if (config.algorithm === 'pattern') {
      const spacing = Math.max(2, Math.round(6 + (1 - config.intensity) * 10));
      const px = ((x % spacing) + spacing) % spacing;
      const py = ((y % spacing) + spacing) % spacing;
      const center = (spacing - 1) * 0.5;
      let patternValue = 0;
      switch (config.patternStyle) {
        case 'lines': {
          const diagonal = (px + py) % spacing;
          patternValue = diagonal / spacing;
          break;
        }
        case 'vertical-lines':
          patternValue = px / spacing;
          break;
        case 'horizontal-lines':
          patternValue = py / spacing;
          break;
        case 'crosshatch': {
          const vertical = px / spacing;
          const horizontal = py / spacing;
          patternValue = Math.min(vertical, horizontal);
          break;
        }
        case 'diagonal': {
          const dx = Math.abs(px - center);
          const dy = Math.abs(py - center);
          patternValue = (dx + dy) / spacing;
          break;
        }
        case 'tone-adaptive':
          patternValue = coverage < 0.33 ? px / spacing : coverage < 0.66 ? ((px + py) % spacing) / spacing : py / spacing;
          break;
        case 'dots':
        default: {
          const dx = px - center;
          const dy = py - center;
          const distance = Math.sqrt(dx * dx + dy * dy) / (spacing * 0.5);
          patternValue = Math.min(1, distance);
        }
      }
      return patternValue <= coverage;
    }
    if (config.algorithm === 'blue-noise') {
      const threshold = BLUE_NOISE_16x16[y & 15][x & 15];
      return coverage >= threshold;
    }
    if (config.algorithm === 'void-and-cluster') {
      const threshold = VOID_CLUSTER_8x8[y & 7][x & 7];
      return coverage >= threshold;
    }
    if (
      config.algorithm === 'floyd-steinberg' ||
      config.algorithm === 'jarvis-judice-ninke' ||
      config.algorithm === 'stucki' ||
      config.algorithm === 'burkes' ||
      config.algorithm === 'sierra-3' ||
      config.algorithm === 'sierra-2' ||
      config.algorithm === 'sierra-lite' ||
      config.algorithm === 'atkinson'
    ) {
      const sample = sampleStampDitherReplayMask({
        x,
        y,
        coverage,
        seed: config.seed,
        tileScale: config.tileScale,
        originX: 0,
        originY: 0,
        algorithm: config.algorithm as StampDitherAlgorithm,
        patternStyle: config.patternStyle,
      });
      return sample >= 0.5;
    }
    const threshold = resolveDitherMatrixThreshold({ x, y, matrixSize: config.matrixSize });
    return coverage >= threshold;
  }
  const noise = hash2D01(x, y);
  if (mode === 'risograph-soft') {
    return noise <= Math.max(0.55, Math.min(0.95, alpha));
  }
  return noise <= Math.max(0.35, Math.min(0.85, alpha * 0.85));
};

const paintStamp = ({
  pixels,
  width,
  height,
  stampX,
  stampY,
  stampSize,
  stampAlpha,
  shape,
  textureMode,
  color,
  blendMode,
  mosaicConfig,
  ditherConfig,
  ditherPalette,
}: {
  pixels: Uint8ClampedArray;
  width: number;
  height: number;
  stampX: number;
  stampY: number;
  stampSize: number;
  stampAlpha: number;
  shape: SequentialStampShape;
  textureMode: SequentialTextureMode;
  color: { r: number; g: number; b: number; a: number };
  blendMode: SupportedBlendMode;
  mosaicConfig?: SequentialMosaicConfig | null;
  ditherConfig?: ResolvedDitherTextureConfig | null;
  ditherPalette?: ResolvedDitherPalette | null;
}) => {
  if (stampSize <= 0 || stampAlpha <= 0) {
    return;
  }

  const halfSize = Math.max(0.5, stampSize * 0.5);
  const minX = Math.max(0, Math.floor(stampX - halfSize));
  const maxX = Math.min(width - 1, Math.ceil(stampX + halfSize));
  const minY = Math.max(0, Math.floor(stampY - halfSize));
  const maxY = Math.min(height - 1, Math.ceil(stampY + halfSize));
  const radiusSq = halfSize * halfSize;

  const baseSrcA = clamp01(stampAlpha) * clamp01(color.a / 255);
  if (baseSrcA <= 0) {
    return;
  }

  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const dx = x + 0.5 - stampX;
      const dy = y + 0.5 - stampY;
      if (!isStampPixelCovered({ shape, dx, dy, halfSize, radiusSq })) {
        continue;
      }

      const srcA = baseSrcA;
      let toneFactor = 1;
      const alphaScale = 1;
      let localColor = color;
      if (textureMode === 'mosaic') {
        const tilePx = mosaicConfig?.tilePx ?? Math.max(1, Math.round(stampSize * 0.35));
        const paletteCount = mosaicConfig?.paletteCount ?? 6;
        const blocksCount = mosaicConfig?.blocksCount ?? 1;
        const seed = mosaicConfig?.seed ?? 0;
        const tileX = Math.floor((x + seed) / tilePx);
        const tileY = Math.floor((y + seed * 7) / tilePx);
        const blockBucket =
          blocksCount > 1
            ? Math.floor((((Math.atan2(dy, dx) + Math.PI) / (Math.PI * 2)) * blocksCount))
            : 0;
        const toneNoise = hash2D01(tileX + blockBucket * 131, tileY + seed * 17);
        const toneLevel = Math.floor(toneNoise * paletteCount);
        toneFactor = 0.45 + (toneLevel / Math.max(1, paletteCount - 1)) * 0.55;
        if (
          mosaicConfig?.ditherEnabled &&
          !shouldKeepDitherPixel({ x, y, alpha: srcA * toneFactor })
        ) {
          continue;
        }
      } else if (textureMode === 'dither') {
        const keepPrimary = shouldKeepTexturedPixel({
          mode: textureMode,
          x,
          y,
          alpha: srcA,
          ditherConfig,
        });
        if (!keepPrimary) {
          if (ditherConfig?.bgFill === false) {
            continue;
          }
          if (ditherPalette) {
            localColor = {
              r: ditherPalette.secondary[0],
              g: ditherPalette.secondary[1],
              b: ditherPalette.secondary[2],
              a: color.a,
            };
          }
        } else if (ditherPalette) {
          localColor = {
            r: ditherPalette.primary[0],
            g: ditherPalette.primary[1],
            b: ditherPalette.primary[2],
            a: color.a,
          };
        }
      } else if (!shouldKeepTexturedPixel({ mode: textureMode, x, y, alpha: srcA })) {
        continue;
      }

      const shadedSrcA = srcA * alphaScale;
      const srcR = (localColor.r / 255) * shadedSrcA * toneFactor;
      const srcG = (localColor.g / 255) * shadedSrcA * toneFactor;
      const srcB = (localColor.b / 255) * shadedSrcA * toneFactor;

      const index = (y * width + x) * 4;
      compositePremultipliedPixel({
        pixels,
        index,
        srcR,
        srcG,
        srcB,
        srcA: shadedSrcA,
        blendMode,
      });
    }
  }
};

const resolveDitherTextureConfig = ({
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

const resolveParticleConfig = ({
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

const resolveSpamConfig = ({
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

const paintMosaicStamp = ({
  pixels,
  width,
  height,
  stampX,
  stampY,
  stampSize,
  stampAlpha,
  rotation,
  runtime,
  config,
  blendMode,
}: {
  pixels: Uint8ClampedArray;
  width: number;
  height: number;
  stampX: number;
  stampY: number;
  stampSize: number;
  stampAlpha: number;
  rotation: number;
  runtime: SequentialMosaicRuntime;
  config: SequentialMosaicConfig;
  blendMode: SupportedBlendMode;
}): void => {
  if (stampSize <= 0 || stampAlpha <= 0) {
    return;
  }

  const scale = stampSize > 0 ? stampSize / Math.max(1, runtime.stampW) : 1;
  const drawW = Math.max(1, runtime.stampW * scale);
  const drawH = Math.max(1, runtime.stampH * scale);
  const halfW = drawW * 0.5;
  const halfH = drawH * 0.5;
  const srcA = clamp01(stampAlpha);
  if (srcA <= 0) {
    return;
  }

  const totalRotation = rotation + Math.PI / 2;
  const absCos = Math.abs(Math.cos(totalRotation));
  const absSin = Math.abs(Math.sin(totalRotation));
  const bboxHalfW = absCos * halfW + absSin * halfH;
  const bboxHalfH = absSin * halfW + absCos * halfH;
  const minX = Math.max(0, Math.floor(stampX - bboxHalfW));
  const maxX = Math.min(width - 1, Math.ceil(stampX + bboxHalfW));
  const minY = Math.max(0, Math.floor(stampY - bboxHalfH));
  const maxY = Math.min(height - 1, Math.ceil(stampY + bboxHalfH));
  const cos = Math.cos(-totalRotation);
  const sin = Math.sin(-totalRotation);
  const tileW = drawW / Math.max(1, runtime.cols);
  const tileH = drawH / Math.max(1, runtime.rows);

  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const localX = (x + 0.5 - stampX) * cos - (y + 0.5 - stampY) * sin + halfW;
      const localY = (x + 0.5 - stampX) * sin + (y + 0.5 - stampY) * cos + halfH;
      if (localX < 0 || localY < 0 || localX >= drawW || localY >= drawH) {
        continue;
      }
      const col = Math.min(runtime.cols - 1, Math.floor(localX / Math.max(1, tileW)));
      const row = Math.min(runtime.rows - 1, Math.floor(localY / Math.max(1, tileH)));
      const tileIndex = col + row * runtime.cols;
      const colorIndex = runtime.tileColorIndices[tileIndex] ?? 0;
      const rgb = runtime.activePaletteRgb[colorIndex % runtime.activePaletteRgb.length] ?? [0, 0, 0];
      if (config.ditherEnabled && !shouldKeepDitherPixel({ x, y, alpha: srcA })) {
        continue;
      }

      const dstIndex = (y * width + x) * 4;
      const srcR = (rgb[0] / 255) * srcA;
      const srcG = (rgb[1] / 255) * srcA;
      const srcB = (rgb[2] / 255) * srcA;
      compositePremultipliedPixel({
        pixels,
        index: dstIndex,
        srcR,
        srcG,
        srcB,
        srcA,
        blendMode,
      });
    }
  }
};

const paintCustomStamp = ({
  pixels,
  width,
  height,
  stampX,
  stampY,
  stampSize,
  stampAlpha,
  color,
  stamp,
  blendMode,
}: {
  pixels: Uint8ClampedArray;
  width: number;
  height: number;
  stampX: number;
  stampY: number;
  stampSize: number;
  stampAlpha: number;
  color: { r: number; g: number; b: number; a: number };
  stamp: ParsedCustomStamp;
  blendMode: SupportedBlendMode;
}): void => {
  if (stampSize <= 0 || stampAlpha <= 0 || stamp.width <= 0 || stamp.height <= 0) {
    return;
  }

  const maxDimension = Math.max(stamp.width, stamp.height);
  const scale = Math.max(0.01, stampSize / Math.max(1, maxDimension));
  const targetWidth = Math.max(1, Math.round(stamp.width * scale));
  const targetHeight = Math.max(1, Math.round(stamp.height * scale));
  const left = Math.round(stampX - targetWidth / 2);
  const top = Math.round(stampY - targetHeight / 2);
  const tintA = clamp01(stampAlpha) * clamp01(color.a / 255);
  if (tintA <= 0) {
    return;
  }

  for (let ty = 0; ty < targetHeight; ty += 1) {
    const y = top + ty;
    if (y < 0 || y >= height) {
      continue;
    }
    const srcY = Math.min(stamp.height - 1, Math.max(0, Math.floor((ty / targetHeight) * stamp.height)));
    for (let tx = 0; tx < targetWidth; tx += 1) {
      const x = left + tx;
      if (x < 0 || x >= width) {
        continue;
      }
      const srcX = Math.min(stamp.width - 1, Math.max(0, Math.floor((tx / targetWidth) * stamp.width)));
      const srcIndex = (srcY * stamp.width + srcX) * 4;
      const srcAlpha = (stamp.rgba[srcIndex + 3] / 255) * tintA;
      if (srcAlpha <= 0) {
        continue;
      }

      const srcR = stamp.isColorizable
        ? (color.r / 255) * srcAlpha
        : (stamp.rgba[srcIndex] / 255) * srcAlpha;
      const srcG = stamp.isColorizable
        ? (color.g / 255) * srcAlpha
        : (stamp.rgba[srcIndex + 1] / 255) * srcAlpha;
      const srcB = stamp.isColorizable
        ? (color.b / 255) * srcAlpha
        : (stamp.rgba[srcIndex + 2] / 255) * srcAlpha;

      const dstIndex = (y * width + x) * 4;
      compositePremultipliedPixel({
        pixels,
        index: dstIndex,
        srcR,
        srcG,
        srcB,
        srcA: srcAlpha,
        blendMode,
      });
    }
  }
};

const paintParticleStamp = ({
  pixels,
  width,
  height,
  stampX,
  stampY,
  stampSize,
  stampAlpha,
  color,
  blendMode,
  seed,
  particleConfig,
}: {
  pixels: Uint8ClampedArray;
  width: number;
  height: number;
  stampX: number;
  stampY: number;
  stampSize: number;
  stampAlpha: number;
  color: { r: number; g: number; b: number; a: number };
  blendMode: SupportedBlendMode;
  seed: number;
  particleConfig: ResolvedParticleConfig;
}): void => {
  const { density, scatterRadiusFactor } = particleConfig;
  const particleCount = Math.max(4, Math.min(200, Math.round(density * clamp01(stampAlpha) * 1.2)));
  const scatterRadius = stampSize * scatterRadiusFactor;
  const alphaScale = clamp01(Math.min(0.7, 1.8 / Math.sqrt(particleCount)));
  for (let i = 0; i < particleCount; i += 1) {
    const angle = hashSeed01(seed, i * 3) * Math.PI * 2;
    const distance = hashSeed01(seed, i * 3 + 1) * scatterRadius;
    const px = stampX + Math.cos(angle) * distance;
    const py = stampY + Math.sin(angle) * distance;
    const particleSize = Math.max(1, stampSize * (0.08 + hashSeed01(seed, i * 3 + 2) * 0.25));
    paintStamp({
      pixels,
      width,
      height,
      stampX: px,
      stampY: py,
      stampSize: particleSize,
      stampAlpha: clamp01(stampAlpha * alphaScale),
      shape: 'round',
      textureMode: 'solid',
      color,
      blendMode,
      mosaicConfig: null,
      ditherConfig: null,
    });
  }
};

const paintSpamStamp = ({
  pixels,
  width,
  height,
  stampX,
  stampY,
  stampSize,
  stampAlpha,
  color,
  blendMode,
  seed,
  spamConfig,
}: {
  pixels: Uint8ClampedArray;
  width: number;
  height: number;
  stampX: number;
  stampY: number;
  stampSize: number;
  stampAlpha: number;
  color: { r: number; g: number; b: number; a: number };
  blendMode: SupportedBlendMode;
  seed: number;
  spamConfig: ResolvedSpamConfig;
}): void => {
  if (stampSize <= 0 || stampAlpha <= 0) {
    return;
  }
  const { fontBias, contentBias, customTextBias } = spamConfig;
  const glyphWidthScale = 1.7 + fontBias * 0.8;
  const glyphHeightScale = 0.75 + contentBias * 0.4;
  const glyphWidth = Math.max(4, Math.round(stampSize * glyphWidthScale));
  const glyphHeight = Math.max(4, Math.round(stampSize * glyphHeightScale));
  const cols = Math.max(5, Math.min(12, Math.round(glyphWidth / 2)));
  const rows = Math.max(5, Math.min(9, Math.round(6 + customTextBias * 2)));
  const left = Math.round(stampX - glyphWidth * 0.5);
  const top = Math.round(stampY - glyphHeight * 0.5);
  const cellW = glyphWidth / cols;
  const cellH = glyphHeight / rows;
  const tintA = clamp01(stampAlpha) * clamp01(color.a / 255);
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const keepThreshold = 0.35 + contentBias * 0.2;
      const keepCell = hashSeed01(seed + row * 97 + col * 131, row + col) > keepThreshold;
      if (!keepCell) {
        continue;
      }
      const minX = Math.max(0, Math.floor(left + col * cellW));
      const maxX = Math.min(width - 1, Math.ceil(left + (col + 1) * cellW));
      const minY = Math.max(0, Math.floor(top + row * cellH));
      const maxY = Math.min(height - 1, Math.ceil(top + (row + 1) * cellH));
      const srcA = clamp01(
        tintA * (0.4 + hashSeed01(seed, row * cols + col) * (0.5 + customTextBias * 0.2))
      );
      if (srcA <= 0) {
        continue;
      }
      const srcR = (color.r / 255) * srcA;
      const srcG = (color.g / 255) * srcA;
      const srcB = (color.b / 255) * srcA;
      for (let y = minY; y <= maxY; y += 1) {
        for (let x = minX; x <= maxX; x += 1) {
          const index = (y * width + x) * 4;
          compositePremultipliedPixel({
            pixels,
            index,
            srcR,
            srcG,
            srcB,
            srcA,
            blendMode,
          });
        }
      }
    }
  }
};

const copyTileData = ({
  pixels,
  width,
  tileX,
  tileY,
  tileWidth,
  tileHeight,
}: {
  pixels: Uint8ClampedArray;
  width: number;
  tileX: number;
  tileY: number;
  tileWidth: number;
  tileHeight: number;
}): Uint8ClampedArray => {
  const tileData = new Uint8ClampedArray(tileWidth * tileHeight * 4);
  for (let row = 0; row < tileHeight; row += 1) {
    const sourceOffset = ((tileY + row) * width + tileX) * 4;
    const targetOffset = row * tileWidth * 4;
    tileData.set(
      pixels.subarray(sourceOffset, sourceOffset + tileWidth * 4),
      targetOffset
    );
  }
  return tileData;
};

const buildTiles = ({
  pixels,
  width,
  height,
  tileSize,
}: {
  pixels: Uint8ClampedArray;
  width: number;
  height: number;
  tileSize: number;
}): FrameTile[] => {
  const tiles: FrameTile[] = [];

  for (let tileY = 0; tileY < height; tileY += tileSize) {
    for (let tileX = 0; tileX < width; tileX += tileSize) {
      const tileWidth = Math.min(tileSize, width - tileX);
      const tileHeight = Math.min(tileSize, height - tileY);

      let hasAlpha = false;
      for (let y = 0; y < tileHeight && !hasAlpha; y += 1) {
        const base = ((tileY + y) * width + tileX) * 4;
        for (let x = 0; x < tileWidth; x += 1) {
          if (pixels[base + x * 4 + 3] > 0) {
            hasAlpha = true;
            break;
          }
        }
      }
      if (!hasAlpha) {
        continue;
      }

      tiles.push({
        x: tileX,
        y: tileY,
        width: tileWidth,
        height: tileHeight,
        data: copyTileData({
          pixels,
          width,
          tileX,
          tileY,
          tileWidth,
          tileHeight,
        }),
      });
    }
  }

  return tiles;
};

const inflatePixelsFromTileSet = ({
  tileSet,
  width,
  height,
  target,
}: {
  tileSet: FrameTileSet;
  width: number;
  height: number;
  target: Uint8ClampedArray;
}): void => {
  target.fill(0, 0, width * height * 4);
  const tiles = tileSet.tiles;
  for (let tileIndex = 0; tileIndex < tiles.length; tileIndex += 1) {
    const tile = tiles[tileIndex];
    if (tile.width <= 0 || tile.height <= 0) {
      continue;
    }
    for (let row = 0; row < tile.height; row += 1) {
      const sourceOffset = row * tile.width * 4;
      const targetOffset = ((tile.y + row) * width + tile.x) * 4;
      target.set(
        tile.data.subarray(sourceOffset, sourceOffset + tile.width * 4),
        targetOffset
      );
    }
  }
};

const paintEventsToPixels = ({
  pixels,
  width,
  height,
  events,
}: {
  pixels: Uint8ClampedArray;
  width: number;
  height: number;
  events: ReadonlyArray<SequentialStrokeEvent>;
}): void => {
  const parsedColorCache = new Map<string, ReturnType<typeof parseCssColor>>();
  for (let eventIndex = 0; eventIndex < events.length; eventIndex += 1) {
    const event = events[eventIndex];
    const colorKey = event.brush.color;
    let parsedColor = parsedColorCache.get(colorKey);
    if (!parsedColor) {
      parsedColor = parseCssColor(colorKey);
      parsedColorCache.set(colorKey, parsedColor);
    }
    const stampShape = resolveStampShape(event);
    const customStamp = parseCustomStamp(event);
    const textureMode = resolveTextureMode(event);
    const ditherConfig = textureMode === 'dither' ? resolveDitherTextureConfig({ event }) : null;
    const ditherPalette = textureMode === 'dither'
      ? resolveReplayDitherPalette({
          color: parsedColor,
          ditherIntensity: (ditherConfig?.intensity ?? 0.8) * 100,
          ditherBackgroundFill: ditherConfig?.bgFill !== false,
        })
      : null;
    const pluginMode = resolvePluginRenderMode(event.brush.pluginBrushId);
    const particleConfig = pluginMode === 'particle-brush' ? resolveParticleConfig({ event }) : null;
    const spamConfig = pluginMode === 'spam-brush' ? resolveSpamConfig({ event }) : null;
    const blendMode = resolveBlendMode(event);
    const mosaicConfig = textureMode === 'mosaic' ? resolveMosaicConfig(event) : null;
    const mosaicRuntime =
      textureMode === 'mosaic' && mosaicConfig
        ? createMosaicRuntime(mosaicConfig, event.brush.spacing)
        : null;
    let previousMosaicStamp: { x: number; y: number } | null = null;

    for (let stampIndex = 0; stampIndex < event.stamps.length; stampIndex += 1) {
      const stamp = event.stamps[stampIndex];
      if (customStamp) {
        paintCustomStamp({
          pixels,
          width,
          height,
          stampX: stamp.x,
          stampY: stamp.y,
          stampSize: stamp.size || event.brush.size,
          stampAlpha: clamp01(stamp.alpha),
          color: parsedColor,
          stamp: customStamp,
          blendMode,
        });
        continue;
      }
      if (pluginMode === 'particle-brush') {
        paintParticleStamp({
          pixels,
          width,
          height,
          stampX: stamp.x,
          stampY: stamp.y,
          stampSize: stamp.size || event.brush.size,
          stampAlpha: clamp01(stamp.alpha),
          color: parsedColor,
          blendMode,
          seed: hashString32(`${event.id}:${stampIndex}`),
          particleConfig: particleConfig ?? { density: 20, scatterRadiusFactor: 1.5 },
        });
        continue;
      }
      if (pluginMode === 'spam-brush') {
        paintSpamStamp({
          pixels,
          width,
          height,
          stampX: stamp.x,
          stampY: stamp.y,
          stampSize: stamp.size || event.brush.size,
          stampAlpha: clamp01(stamp.alpha),
          color: parsedColor,
          blendMode,
          seed: hashString32(`${event.id}:${stampIndex}:spam`),
          spamConfig: spamConfig ?? { fontBias: 0.5, contentBias: 0.5, customTextBias: 0 },
        });
        continue;
      }
      if (textureMode === 'mosaic' && mosaicConfig && mosaicRuntime) {
        if (previousMosaicStamp) {
          const dx = stamp.x - previousMosaicStamp.x;
          const dy = stamp.y - previousMosaicStamp.y;
          advanceMosaicRuntimeByDistance(mosaicRuntime, mosaicConfig, Math.hypot(dx, dy));
        }
        paintMosaicStamp({
          pixels,
          width,
          height,
          stampX: stamp.x,
          stampY: stamp.y,
          stampSize: stamp.size || event.brush.size,
          stampAlpha: clamp01(stamp.alpha),
          rotation: stamp.rotation || event.brush.rotation || 0,
          runtime: mosaicRuntime,
          config: mosaicConfig,
          blendMode,
        });
        previousMosaicStamp = { x: stamp.x, y: stamp.y };
        continue;
      }
      paintStamp({
        pixels,
        width,
        height,
        stampX: stamp.x,
        stampY: stamp.y,
        stampSize: stamp.size || event.brush.size,
        stampAlpha: clamp01(stamp.alpha),
        shape: stampShape,
        textureMode,
        color: parsedColor,
        blendMode,
        mosaicConfig,
        ditherConfig,
        ditherPalette,
      });
    }
  }
};

const getFrameEvents = (
  events: ReadonlyArray<SequentialStrokeEvent>,
  frameIndex: number,
  eventsAreFrameScoped: boolean
): ReadonlyArray<SequentialStrokeEvent> => {
  if (events.length === 0) {
    return [];
  }
  if (eventsAreFrameScoped) {
    return events;
  }
  let allMatch = true;
  for (let i = 0; i < events.length; i += 1) {
    if (events[i].frameIndex !== frameIndex) {
      allMatch = false;
      break;
    }
  }
  if (allMatch) {
    return events;
  }
  const matches: SequentialStrokeEvent[] = [];
  for (let i = 0; i < events.length; i += 1) {
    if (events[i].frameIndex === frameIndex) {
      matches.push(events[i]);
    }
  }
  return matches;
};

export class SequentialCpuMaterializer implements SequentialMaterializerBackend {
  readonly kind = 'cpu' as const;
  private readonly tileSize: number;
  private scratchPixels: Uint8ClampedArray | null = null;
  private scratchCapacity = 0;

  constructor(options?: { tileSize?: number }) {
    this.tileSize = Math.max(1, Math.round(options?.tileSize ?? 128));
  }

  private acquireScratchPixels(width: number, height: number): Uint8ClampedArray {
    const requiredCapacity = width * height * 4;
    if (!this.scratchPixels || this.scratchCapacity < requiredCapacity) {
      this.scratchPixels = new Uint8ClampedArray(requiredCapacity);
      this.scratchCapacity = requiredCapacity;
    } else {
      this.scratchPixels.fill(0, 0, requiredCapacity);
    }
    return this.scratchPixels;
  }

  materializeFrame({
    width,
    height,
    frameIndex,
    events,
    eventsAreFrameScoped = false,
  }: SequentialMaterializeFrameInput): FrameTileSet {
    const materializeStartMs =
      typeof performance !== 'undefined' && typeof performance.now === 'function'
        ? performance.now()
        : Date.now();
    const safeWidth = Math.max(1, Math.round(width));
    const safeHeight = Math.max(1, Math.round(height));
    const pixels = this.acquireScratchPixels(safeWidth, safeHeight);
    const frameEvents = getFrameEvents(events, frameIndex, eventsAreFrameScoped);

    paintEventsToPixels({
      pixels,
      width: safeWidth,
      height: safeHeight,
      events: frameEvents,
    });

    const tileSet: FrameTileSet = {
      frameIndex,
      tileSize: this.tileSize,
      pixelFormat: 'rgba8',
      premultipliedAlpha: true,
      colorSpace: 'srgb',
      tiles: buildTiles({
        pixels,
        width: safeWidth,
        height: safeHeight,
        tileSize: this.tileSize,
      }),
    };
    const materializeDurationMs =
      (typeof performance !== 'undefined' && typeof performance.now === 'function'
        ? performance.now()
        : Date.now()) - materializeStartMs;
    recordSequentialMaterializePerf({
      events: frameEvents.length,
      durationMs: materializeDurationMs,
    });
    return tileSet;
  }

  patchFrame({
    width,
    height,
    frameIndex,
    events,
    baseTileSet,
    eventsAreFrameScoped = false,
  }: SequentialMaterializeFrameInput & { baseTileSet: FrameTileSet }): FrameTileSet {
    const safeWidth = Math.max(1, Math.round(width));
    const safeHeight = Math.max(1, Math.round(height));
    const frameEvents = getFrameEvents(events, frameIndex, eventsAreFrameScoped);
    if (frameEvents.length === 0) {
      return baseTileSet;
    }
    const pixels = this.acquireScratchPixels(safeWidth, safeHeight);
    inflatePixelsFromTileSet({
      tileSet: baseTileSet,
      width: safeWidth,
      height: safeHeight,
      target: pixels,
    });
    paintEventsToPixels({
      pixels,
      width: safeWidth,
      height: safeHeight,
      events: frameEvents,
    });
    return {
      frameIndex,
      tileSize: this.tileSize,
      pixelFormat: 'rgba8',
      premultipliedAlpha: true,
      colorSpace: 'srgb',
      tiles: buildTiles({
        pixels,
        width: safeWidth,
        height: safeHeight,
        tileSize: this.tileSize,
      }),
    };
  }
}
