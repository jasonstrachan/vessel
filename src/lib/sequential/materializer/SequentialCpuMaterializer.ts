import { BrushShape, type SequentialStrokeEvent } from '@/types';
import { parseCssColor } from '@/utils/color/parseCssColor';
import { DEFAULT_GRADIENT_STOPS } from '@/utils/gradientPresets';
import type { FrameTile, FrameTileSet, SequentialMaterializeFrameInput } from '@/lib/sequential/types';
import type { SequentialMaterializerBackend } from '@/lib/sequential/materializer/SequentialMaterializerBackend';

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

type SequentialStampShape = 'round' | 'square' | 'triangle';
type SequentialTextureMode = 'solid' | 'dither' | 'mosaic' | 'risograph-soft' | 'risograph-ultra';
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
const parsedCustomStampCache = new Map<string, ParsedCustomStamp>();

const resolveStampShape = (brushShape: BrushShape): SequentialStampShape => {
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
  if (!stamp || stamp.width <= 0 || stamp.height <= 0 || !stamp.rgbaBase64) {
    return null;
  }
  const key = event.brush.customStampHash || `${stamp.width}x${stamp.height}:${stamp.rgbaBase64.length}`;
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

const shouldKeepDitherPixel = ({
  x,
  y,
  alpha,
}: {
  x: number;
  y: number;
  alpha: number;
}): boolean => {
  const threshold = (BAYER_4[y & 3][x & 3] + 0.5) / 16;
  const coverage = Math.max(0.1, Math.min(0.9, alpha * 0.5));
  return coverage >= threshold;
};

const hash2D01 = (x: number, y: number): number => {
  let h = (Math.imul(x + 1, 374761393) ^ Math.imul(y + 1, 668265263)) >>> 0;
  h = (h ^ (h >>> 13)) >>> 0;
  h = Math.imul(h, 1274126177) >>> 0;
  return (h & 0xffff) / 0xffff;
};

const shouldKeepTexturedPixel = ({
  mode,
  x,
  y,
  alpha,
}: {
  mode: SequentialTextureMode;
  x: number;
  y: number;
  alpha: number;
}): boolean => {
  if (mode === 'solid') {
    return true;
  }
  if (mode === 'dither') {
    return shouldKeepDitherPixel({ x, y, alpha });
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
  mosaicConfig,
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
  mosaicConfig?: SequentialMosaicConfig | null;
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
      } else if (!shouldKeepTexturedPixel({ mode: textureMode, x, y, alpha: srcA })) {
        continue;
      }

      const srcR = (color.r / 255) * srcA * toneFactor;
      const srcG = (color.g / 255) * srcA * toneFactor;
      const srcB = (color.b / 255) * srcA * toneFactor;

      const index = (y * width + x) * 4;
      const dstR = pixels[index] / 255;
      const dstG = pixels[index + 1] / 255;
      const dstB = pixels[index + 2] / 255;
      const dstA = pixels[index + 3] / 255;

      const outA = srcA + dstA * (1 - srcA);
      const outR = srcR + dstR * (1 - srcA);
      const outG = srcG + dstG * (1 - srcA);
      const outB = srcB + dstB * (1 - srcA);

      pixels[index] = Math.round(clamp01(outR) * 255);
      pixels[index + 1] = Math.round(clamp01(outG) * 255);
      pixels[index + 2] = Math.round(clamp01(outB) * 255);
      pixels[index + 3] = Math.round(clamp01(outA) * 255);
    }
  }
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
      const dstR = pixels[dstIndex] / 255;
      const dstG = pixels[dstIndex + 1] / 255;
      const dstB = pixels[dstIndex + 2] / 255;
      const dstA = pixels[dstIndex + 3] / 255;

      const srcR = (rgb[0] / 255) * srcA;
      const srcG = (rgb[1] / 255) * srcA;
      const srcB = (rgb[2] / 255) * srcA;
      const outA = srcA + dstA * (1 - srcA);
      const outR = srcR + dstR * (1 - srcA);
      const outG = srcG + dstG * (1 - srcA);
      const outB = srcB + dstB * (1 - srcA);

      pixels[dstIndex] = Math.round(clamp01(outR) * 255);
      pixels[dstIndex + 1] = Math.round(clamp01(outG) * 255);
      pixels[dstIndex + 2] = Math.round(clamp01(outB) * 255);
      pixels[dstIndex + 3] = Math.round(clamp01(outA) * 255);
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
      const dstR = pixels[dstIndex] / 255;
      const dstG = pixels[dstIndex + 1] / 255;
      const dstB = pixels[dstIndex + 2] / 255;
      const dstA = pixels[dstIndex + 3] / 255;

      const outA = srcAlpha + dstA * (1 - srcAlpha);
      const outR = srcR + dstR * (1 - srcAlpha);
      const outG = srcG + dstG * (1 - srcAlpha);
      const outB = srcB + dstB * (1 - srcAlpha);

      pixels[dstIndex] = Math.round(clamp01(outR) * 255);
      pixels[dstIndex + 1] = Math.round(clamp01(outG) * 255);
      pixels[dstIndex + 2] = Math.round(clamp01(outB) * 255);
      pixels[dstIndex + 3] = Math.round(clamp01(outA) * 255);
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

const getFrameEvents = (
  events: ReadonlyArray<SequentialStrokeEvent>,
  frameIndex: number
): SequentialStrokeEvent[] =>
  events.filter((event) => event.frameIndex === frameIndex);

export class SequentialCpuMaterializer implements SequentialMaterializerBackend {
  readonly kind = 'cpu' as const;
  private readonly tileSize: number;

  constructor(options?: { tileSize?: number }) {
    this.tileSize = Math.max(1, Math.round(options?.tileSize ?? 128));
  }

  materializeFrame({
    width,
    height,
    frameIndex,
    events,
  }: SequentialMaterializeFrameInput): FrameTileSet {
    const safeWidth = Math.max(1, Math.round(width));
    const safeHeight = Math.max(1, Math.round(height));
    const pixels = new Uint8ClampedArray(safeWidth * safeHeight * 4);
    const frameEvents = getFrameEvents(events, frameIndex);

    for (let eventIndex = 0; eventIndex < frameEvents.length; eventIndex += 1) {
      const event = frameEvents[eventIndex];
      const parsedColor = parseCssColor(event.brush.color);
      const stampShape = resolveStampShape(event.brush.brushShape);
      const customStamp = parseCustomStamp(event);
      const textureMode = resolveTextureMode(event);
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
            width: safeWidth,
            height: safeHeight,
            stampX: stamp.x,
            stampY: stamp.y,
            stampSize: stamp.size || event.brush.size,
            stampAlpha: clamp01(stamp.alpha),
            color: parsedColor,
            stamp: customStamp,
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
            width: safeWidth,
            height: safeHeight,
            stampX: stamp.x,
            stampY: stamp.y,
            stampSize: stamp.size || event.brush.size,
            stampAlpha: clamp01(stamp.alpha),
            rotation: stamp.rotation || event.brush.rotation || 0,
            runtime: mosaicRuntime,
            config: mosaicConfig,
          });
          previousMosaicStamp = { x: stamp.x, y: stamp.y };
          continue;
        }
        paintStamp({
          pixels,
          width: safeWidth,
          height: safeHeight,
          stampX: stamp.x,
          stampY: stamp.y,
          stampSize: stamp.size || event.brush.size,
          stampAlpha: clamp01(stamp.alpha),
          shape: stampShape,
          textureMode,
          color: parsedColor,
          mosaicConfig,
        });
      }
    }

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
