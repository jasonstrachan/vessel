import type { UiShapePalette } from '@/types';
import { resolveSierraLiteBinaryField } from '@/lib/colorCycle/gobletPlaybackMath';

type UiShapeCanvasContext = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
type UiShapeCanvasSurface = HTMLCanvasElement | OffscreenCanvas;
const UI_SHAPE_CLEAN_CONTEXT = Symbol('ui-shape-clean-context');

export interface UiShapeSierraLiteInkPair {
  highColor: string;
  lowColor: string;
  mix: number;
}

export interface UiShapeHanddrawnRect {
  height: number;
  width: number;
  x: number;
  y: number;
}

const PALETTE_ROLES: readonly (keyof UiShapePalette)[] = [
  'face',
  'highlight',
  'light',
  'shadow',
  'darkShadow',
  'text',
  'active',
  'activeText',
  'selection',
  'selectionText',
];
const DITHER_FIELD_SIZE = 1_024;
const MIN_DITHER_FILL_THICKNESS = 2;
const SECONDARY_INK_NEIGHBOR_BLEND = 0.24;
const MAX_SECONDARY_INK_CHANNEL_DELTA = 16;
const MAX_RASTER_CACHE_PIXELS = 16 * 1_024 * 1_024;
const paintRasterCache = new Map<string, { pixels: number; surface: UiShapeCanvasSurface }>();
const sierraFieldCache = new Map<number, Uint8Array>();
let paintRasterCachePixels = 0;

const createCanvasSurface = (width: number, height: number): UiShapeCanvasSurface | null => {
  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    return canvas;
  }
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(width, height);
  return null;
};

const colorLuminance = (color: string): number => {
  const normalized = color.match(/^#([\da-f]{3}|[\da-f]{6})$/i)?.[1];
  if (!normalized) return 0;
  const expanded = normalized.length === 3
    ? normalized.split('').map((value) => `${value}${value}`).join('')
    : normalized;
  const packed = Number.parseInt(expanded, 16);
  const red = (packed >> 16) & 255;
  const green = (packed >> 8) & 255;
  const blue = packed & 255;
  return red * 0.2126 + green * 0.7152 + blue * 0.0722;
};

const parseHexColor = (color: string): [number, number, number] | null => {
  const normalized = color.match(/^#([\da-f]{3}|[\da-f]{6})$/i)?.[1];
  if (!normalized) return null;
  const expanded = normalized.length === 3
    ? normalized.split('').map((value) => `${value}${value}`).join('')
    : normalized;
  const packed = Number.parseInt(expanded, 16);
  return [(packed >> 16) & 255, (packed >> 8) & 255, packed & 255];
};

const blendHexColors = (source: string, neighbor: string, amount: number): string => {
  const sourceRgb = parseHexColor(source);
  const neighborRgb = parseHexColor(neighbor);
  if (!sourceRgb || !neighborRgb) return source;
  const channels = sourceRgb.map((channel, index) => {
    const blended = Math.round(channel + (neighborRgb[index]! - channel) * amount);
    return channel + Math.max(
      -MAX_SECONDARY_INK_CHANNEL_DELTA,
      Math.min(MAX_SECONDARY_INK_CHANNEL_DELTA, blended - channel),
    );
  });
  return `#${channels.map((channel) => channel.toString(16).padStart(2, '0')).join('')}`;
};

const resolveSierraLiteInkPair = (
  color: string,
  paletteColors: readonly string[],
): UiShapeSierraLiteInkPair | null => {
  if (!parseHexColor(color)) return null;
  const colors = [...new Set(paletteColors)]
    .sort((left, right) => colorLuminance(left) - colorLuminance(right));
  if (colors.length < 2) return { lowColor: color, highColor: color, mix: 0 };
  const exactIndex = colors.indexOf(color);
  const closestIndex = exactIndex >= 0
    ? exactIndex
    : colors.reduce((bestIndex, candidate, index) => (
      Math.abs(colorLuminance(candidate) - colorLuminance(color))
        < Math.abs(colorLuminance(colors[bestIndex]!) - colorLuminance(color))
        ? index
        : bestIndex
    ), 0);
  const neighborIndex = closestIndex === colors.length - 1 ? closestIndex - 1 : closestIndex + 1;
  const neighbor = colors[neighborIndex]!;
  const neighborIsLighter = colorLuminance(neighbor) > colorLuminance(color);
  const secondaryInk = blendHexColors(color, neighbor, SECONDARY_INK_NEIGHBOR_BLEND);
  return {
    lowColor: neighborIsLighter ? color : secondaryInk,
    highColor: neighborIsLighter ? secondaryInk : color,
    mix: neighborIsLighter ? 0.28 : 0.72,
  };
};

export const resolveUiShapeSierraLiteInkPairs = (
  palette: UiShapePalette,
): Record<keyof UiShapePalette, UiShapeSierraLiteInkPair> => {
  const colors = PALETTE_ROLES.map((role) => palette[role]);
  return PALETTE_ROLES.reduce((result, role) => {
    const color = palette[role];
    result[role] = resolveSierraLiteInkPair(color, colors)
      ?? { lowColor: color, highColor: color, mix: 0 };
    return result;
  }, {} as Record<keyof UiShapePalette, UiShapeSierraLiteInkPair>);
};

const positiveModulo = (value: number, divisor: number): number => (
  (value % divisor + divisor) % divisor
);

const trimPaintRasterCache = (): void => {
  while (paintRasterCachePixels > MAX_RASTER_CACHE_PIXELS && paintRasterCache.size > 1) {
    const oldestKey = paintRasterCache.keys().next().value;
    if (!oldestKey) return;
    const oldest = paintRasterCache.get(oldestKey);
    if (oldest) paintRasterCachePixels -= oldest.pixels;
    paintRasterCache.delete(oldestKey);
  }
};

const resolveRegisteredSierraField = (mix: number): Uint8Array => {
  const cached = sierraFieldCache.get(mix);
  if (cached) return cached;
  const field = resolveSierraLiteBinaryField({
    width: DITHER_FIELD_SIZE,
    height: DITHER_FIELD_SIZE,
    mix,
    diversity: 1,
  });
  sierraFieldCache.set(mix, field);
  return field;
};

const resolvePaintRaster = (
  width: number,
  height: number,
  phaseX: number,
  phaseY: number,
  pair: UiShapeSierraLiteInkPair,
): UiShapeCanvasSurface | null => {
  const key = [
    pair.lowColor.toLowerCase(),
    pair.highColor.toLowerCase(),
    pair.mix,
    width,
    height,
    phaseX,
    phaseY,
  ].join('|');
  const cached = paintRasterCache.get(key);
  if (cached) {
    paintRasterCache.delete(key);
    paintRasterCache.set(key, cached);
    return cached.surface;
  }
  const low = parseHexColor(pair.lowColor);
  const high = parseHexColor(pair.highColor);
  if (!low || !high) return null;
  const surface = createCanvasSurface(width, height);
  const context = surface?.getContext('2d') as UiShapeCanvasContext | null;
  if (!surface || !context) return null;
  const fieldMix = pair.mix > 0.5 ? 1 - pair.mix : pair.mix;
  const field = resolveRegisteredSierraField(fieldMix);
  const shouldInvertField = pair.mix > 0.5;
  const image = context.createImageData(width, height);
  for (let row = 0; row < height; row += 1) {
    const fieldRow = positiveModulo(row + phaseY, DITHER_FIELD_SIZE) * DITHER_FIELD_SIZE;
    for (let column = 0; column < width; column += 1) {
      const fieldColumn = positiveModulo(column + phaseX, DITHER_FIELD_SIZE);
      const isHigh = field[fieldRow + fieldColumn] === (shouldInvertField ? 0 : 1);
      const color = isHigh ? high : low;
      const offset = (row * width + column) * 4;
      image.data[offset] = color[0];
      image.data[offset + 1] = color[1];
      image.data[offset + 2] = color[2];
      image.data[offset + 3] = 255;
    }
  }
  context.putImageData(image, 0, 0);
  const pixels = width * height;
  if (pixels <= MAX_RASTER_CACHE_PIXELS) {
    paintRasterCache.set(key, { pixels, surface });
    paintRasterCachePixels += pixels;
    trimPaintRasterCache();
  }
  return surface;
};

export const createUiShapePaintContext = (
  ctx: UiShapeCanvasContext,
  palette: UiShapePalette,
): UiShapeCanvasContext => {
  const pairs = resolveUiShapeSierraLiteInkPairs(palette);
  const pairByColor = new Map<string, UiShapeSierraLiteInkPair>();
  PALETTE_ROLES.forEach((role) => {
    pairByColor.set(palette[role].toLowerCase(), pairs[role]);
  });
  const paletteColors = PALETTE_ROLES.map((role) => palette[role]);
  const resolvePair = (color: string): UiShapeSierraLiteInkPair | undefined => {
    const normalized = color.toLowerCase();
    const cached = pairByColor.get(normalized);
    if (cached) return cached;
    const pair = resolveSierraLiteInkPair(normalized, paletteColors) ?? undefined;
    if (pair) pairByColor.set(normalized, pair);
    return pair;
  };
  let fillStyle = ctx.fillStyle;
  const fillStyleStack: (string | CanvasGradient | CanvasPattern)[] = [];
  return new Proxy(ctx, {
    get(target, property) {
      if (property === 'fillStyle') return fillStyle;
      if (property === 'save') {
        return (): void => {
          fillStyleStack.push(fillStyle);
          target.save();
        };
      }
      if (property === 'restore') {
        return (): void => {
          target.restore();
          fillStyle = fillStyleStack.pop() ?? target.fillStyle;
        };
      }
      if (property === 'fillRect') {
        return (x: number, y: number, width: number, height: number): void => {
          const pair = typeof fillStyle === 'string'
            ? resolvePair(fillStyle)
            : undefined;
          const rasterWidth = Math.max(0, Math.round(Math.abs(width)));
          const rasterHeight = Math.max(0, Math.round(Math.abs(height)));
          const isFlatFill = rasterWidth >= MIN_DITHER_FILL_THICKNESS
            && rasterHeight >= MIN_DITHER_FILL_THICKNESS;
          if (!pair || pair.lowColor === pair.highColor || !isFlatFill) {
            target.fillRect(x, y, width, height);
            return;
          }
          const drawX = width < 0 ? x + width : x;
          const drawY = height < 0 ? y + height : y;
          const raster = resolvePaintRaster(
            rasterWidth,
            rasterHeight,
            positiveModulo(Math.floor(drawX), DITHER_FIELD_SIZE),
            positiveModulo(Math.floor(drawY), DITHER_FIELD_SIZE),
            pair,
          );
          if (!raster) {
            target.fillRect(x, y, width, height);
            return;
          }
          target.drawImage(
            raster as CanvasImageSource,
            drawX,
            drawY,
            Math.abs(width),
            Math.abs(height),
          );
        };
      }
      const value = Reflect.get(target, property, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
    set(target, property, value) {
      if (property === 'fillStyle') fillStyle = value;
      return Reflect.set(target, property, value, target);
    },
  }) as UiShapeCanvasContext;
};

const hashPaintSeed = (value: string): number => {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return hash >>> 0;
};

export const resolveUiShapeHanddrawnRect = (
  componentId: string,
  operationIndex: number,
  x: number,
  y: number,
  width: number,
  height: number,
): UiShapeHanddrawnRect => {
  let value = hashPaintSeed(componentId) ^ Math.imul(operationIndex + 1, 0x45d9f3b);
  value = Math.imul(value ^ value >>> 16, 0x45d9f3b);
  value ^= value >>> 16;
  const result = { x, y, width, height };
  const isSinglePixel = width === 1 && height === 1;
  const decision = (value >>> 0) % 16;
  if (decision === 12 && !isSinglePixel) {
    if (width > 1) {
      result.x += 1;
      result.width -= 1;
    } else {
      result.x += 1;
    }
  } else if (decision === 13 && !isSinglePixel) {
    if (width > 1) result.width -= 1;
    else result.x -= 1;
  } else if (decision === 14 && !isSinglePixel) {
    if (height > 1) {
      result.y += 1;
      result.height -= 1;
    } else {
      result.y += 1;
    }
  } else if (decision === 15) {
    if (height > 1) result.height -= 1;
    else result.y -= 1;
  }
  return result;
};

export const resolveUiShapeCleanContext = (
  ctx: UiShapeCanvasContext,
): UiShapeCanvasContext => (
  Reflect.get(ctx, UI_SHAPE_CLEAN_CONTEXT) as UiShapeCanvasContext | undefined
  ?? ctx
);

export const createUiShapeHanddrawnContext = (
  ctx: UiShapeCanvasContext,
  componentId: string,
): UiShapeCanvasContext => {
  let operationIndex = 0;
  return new Proxy(ctx, {
    get(target, property) {
      if (property === UI_SHAPE_CLEAN_CONTEXT) return target;
      if (property === 'fillRect') {
        return (x: number, y: number, width: number, height: number): void => {
          const rect = resolveUiShapeHanddrawnRect(
            componentId,
            operationIndex,
            x,
            y,
            width,
            height,
          );
          operationIndex += 1;
          target.fillRect(rect.x, rect.y, rect.width, rect.height);
        };
      }
      const value = Reflect.get(target, property, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
    set(target, property, value) {
      return Reflect.set(target, property, value, target);
    },
  }) as UiShapeCanvasContext;
};
