import { parseColor } from './colorUtils';
import { resolveBrushPressureRange } from '@/utils/pressureSettings';
import type { BrushSettings } from '@/types';

export type IdleHandle = { id: number; kind: 'idle' | 'timeout' } | null;

export const scheduleDeferred = (callback: () => void, timeout = 120): IdleHandle => {
  if (typeof window === 'undefined') {
    callback();
    return null;
  }
  const idleWindow = window as Window & {
    requestIdleCallback?: (cb: IdleRequestCallback, opts?: IdleRequestOptions) => number;
    cancelIdleCallback?: (handle: number) => void;
  };
  if (typeof idleWindow.requestIdleCallback === 'function') {
    const id = idleWindow.requestIdleCallback(() => callback(), { timeout });
    return { id, kind: 'idle' };
  }
  const id = window.setTimeout(callback, timeout);
  return { id, kind: 'timeout' };
};

export const cancelDeferred = (handle: IdleHandle) => {
  if (!handle || typeof window === 'undefined') {
    return;
  }
  const idleWindow = window as Window & {
    cancelIdleCallback?: (handle: number) => void;
  };
  if (handle.kind === 'idle' && typeof idleWindow.cancelIdleCallback === 'function') {
    idleWindow.cancelIdleCallback(handle.id);
    return;
  }
  clearTimeout(handle.id);
};

export const warnShapeFillRemoved = (() => {
  let hasWarned = false;
  return (feature: string) => {
    if (hasWarned || typeof console === 'undefined') {
      return;
    }
    hasWarned = true;
    console.warn(
      `[ShapeFill] ${feature} called after shape-fill system was removed. This operation is now a no-op.`
    );
  };
})();

export const getAlphaLockDebugLevel = () => {
  if (typeof window === 'undefined') {
    return 0;
  }
  const level = Number((window as { __alphaLockDebug?: unknown }).__alphaLockDebug ?? 0);
  return Number.isFinite(level) ? level : 0;
};

export const AL = (step: string, obj: Record<string, unknown>) => {
  const level = typeof window !== 'undefined' ? window.__alphaLockDebug ?? 0 : 0;
  if (level > 0) {
    try {
      console.log(`[AL] ${step} ${JSON.stringify(obj)}`);
    } catch {
      console.log('[AL]', step, obj);
    }
  }
};

import { ensurePresResDebugBridge, isPresResDebugEnabled as isSharedPresResDebugEnabled } from '@/hooks/canvas/utils/presResDebug';

export const DD = (step: string, obj: Record<string, unknown>) => {
  const level = typeof window !== 'undefined'
    ? (window as { __ditherDebugLevel?: number }).__ditherDebugLevel ?? 0
    : 0;
  if (level > 0) {
    try {
      console.log(`[DITHER] ${step} ${JSON.stringify(obj)}`);
    } catch {
      console.log('[DITHER]', step, obj);
    }
  }
};

export const isPresResDebugEnabled = () => {
  ensurePresResDebugBridge();
  return isSharedPresResDebugEnabled();
};

export const appendPresResTrace = (entry: Record<string, unknown>) => {
  if (typeof window === 'undefined') {
    return;
  }
  ensurePresResTraceHelpers();
  const trace = ((window as Window).__presResTrace ??= []);
  trace.push(entry);
  const MAX_TRACE = 400;
  if (trace.length > MAX_TRACE) {
    trace.splice(0, trace.length - MAX_TRACE);
  }
};

const ensurePresResTraceHelpers = () => {
  if (typeof window === 'undefined') {
    return;
  }
  const w = window as Window;
  if (typeof w.__clearPresResTrace !== 'function') {
    w.__clearPresResTrace = () => {
      w.__presResTrace = [];
    };
  }
  if (typeof w.__summarizePresResTrace !== 'function') {
    w.__summarizePresResTrace = () => {
      const trace = w.__presResTrace ?? [];
      let pointer = 0;
      let engine = 0;
      let minPixelSize = Number.POSITIVE_INFINITY;
      let maxPixelSize = Number.NEGATIVE_INFINITY;
      for (const item of trace) {
        const source = item?.source;
        if (source === 'pointer') {
          pointer += 1;
        } else if (source === 'engine') {
          engine += 1;
          const px = Number(item?.pixelSize);
          if (Number.isFinite(px)) {
            minPixelSize = Math.min(minPixelSize, px);
            maxPixelSize = Math.max(maxPixelSize, px);
          }
        }
      }
      return {
        total: trace.length,
        pointer,
        engine,
        minPixelSize: Number.isFinite(minPixelSize) ? minPixelSize : null,
        maxPixelSize: Number.isFinite(maxPixelSize) ? maxPixelSize : null,
        last: trace[trace.length - 1] ?? null,
      };
    };
  }
};

export const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
export const MAX_ALPHA_PROBE_SIZE = 256;
export const DEFAULT_CC_BAND_SPACING = 12;

export const clampColorCycleBandSpacing = (value?: number) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return DEFAULT_CC_BAND_SPACING;
  }
  return Math.max(2, Math.min(256, Math.round(value)));
};

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

const wrapHue = (h: number): number => {
  const v = h % 360;
  return v < 0 ? v + 360 : v;
};

const shortestHueDelta = (from: number, to: number): number => {
  let delta = (to - from) % 360;
  if (delta > 180) {
    delta -= 360;
  } else if (delta < -180) {
    delta += 360;
  }
  return delta;
};

const rgbToHsl = (r: number, g: number, b: number): { h: number; s: number; l: number } => {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;
  const d = max - min;
  if (d !== 0) {
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case rn:
        h = (gn - bn) / d + (gn < bn ? 6 : 0);
        break;
      case gn:
        h = (bn - rn) / d + 2;
        break;
      default:
        h = (rn - gn) / d + 4;
        break;
    }
    h *= 60;
  }
  return { h, s, l };
};

const hslToRgb = (h: number, s: number, l: number): [number, number, number] => {
  const C = (1 - Math.abs(2 * l - 1)) * s;
  const hp = ((h % 360) + 360) % 360 / 60;
  const X = C * (1 - Math.abs((hp % 2) - 1));
  let r1 = 0;
  let g1 = 0;
  let b1 = 0;
  if (hp >= 0 && hp < 1) {
    r1 = C; g1 = X; b1 = 0;
  } else if (hp >= 1 && hp < 2) {
    r1 = X; g1 = C; b1 = 0;
  } else if (hp >= 2 && hp < 3) {
    r1 = 0; g1 = C; b1 = X;
  } else if (hp >= 3 && hp < 4) {
    r1 = 0; g1 = X; b1 = C;
  } else if (hp >= 4 && hp < 5) {
    r1 = X; g1 = 0; b1 = C;
  } else {
    r1 = C; g1 = 0; b1 = X;
  }
  const m = l - C / 2;
  return [
    Math.round((r1 + m) * 255),
    Math.round((g1 + m) * 255),
    Math.round((b1 + m) * 255)
  ];
};

const averageHue = (colors: Array<{ h: number; s: number; l: number }>): number => {
  if (colors.length === 0) {
    return 0;
  }
  let sumX = 0;
  let sumY = 0;
  for (const color of colors) {
    const radians = (wrapHue(color.h) * Math.PI) / 180;
    sumX += Math.cos(radians);
    sumY += Math.sin(radians);
  }
  if (sumX === 0 && sumY === 0) {
    return wrapHue(colors[0]?.h ?? 0);
  }
  return wrapHue((Math.atan2(sumY, sumX) * 180) / Math.PI);
};

const formatRgb = ([r, g, b]: readonly number[]) =>
  `rgb(${clamp(Math.round(r), 0, 255)}, ${clamp(Math.round(g), 0, 255)}, ${clamp(Math.round(b), 0, 255)})`;

const buildDitherPalette = (baseHex: string, spreadPercent?: number): string[] => {
  const [r, g, b] = parseColor(baseHex || '#000');
  const { h, s, l } = rgbToHsl(r, g, b);

  const spread = clamp01((spreadPercent ?? 0) / 100);
  const baseUnit = [r, g, b].map((v) => v / 255);

  const alignToBase = (units: number[][], strength = 0.85) => {
    const avg = units.reduce(
      (acc, cur) => [acc[0] + cur[0], acc[1] + cur[1], acc[2] + cur[2]],
      [0, 0, 0]
    ).map((v) => v / units.length);
    const delta = [
      (baseUnit[0] - avg[0]) * strength,
      (baseUnit[1] - avg[1]) * strength,
      (baseUnit[2] - avg[2]) * strength,
    ];
    return units.map((c) => [
      clamp01(c[0] + delta[0]),
      clamp01(c[1] + delta[1]),
      clamp01(c[2] + delta[2]),
    ]);
  };

  const toRgbString = (unit: number[]) => formatRgb([
    unit[0] * 255,
    unit[1] * 255,
    unit[2] * 255,
  ]);

  if (spread >= 0.95) {
    const c1 = hslToRgb(wrapHue(h + 150), 0.9, 0.35).map((v) => v / 255);
    const c2 = hslToRgb(wrapHue(h - 150), 0.95, 0.65).map((v) => v / 255);

    const c3 = [
      clamp01(baseUnit[0] * 3 - c1[0] - c2[0]),
      clamp01(baseUnit[1] * 3 - c1[1] - c2[1]),
      clamp01(baseUnit[2] * 3 - c1[2] - c2[2]),
    ];

    return alignToBase([c1, c2, c3]).map(toRgbString);
  }

  if (spread <= 0.01) {
    const darker = (channel: number) => clamp(Math.round(channel * 0.6), 0, 255);
    const lighter = (channel: number) => clamp(Math.round(channel * 1.35), 0, 255);
    return [
      `rgb(${darker(r)}, ${darker(g)}, ${darker(b)})`,
      `rgb(${lighter(r)}, ${lighter(g)}, ${lighter(b)})`
    ];
  }

  const hueSwing = 60 + 120 * spread;
  const sBoost = 1.1 + 0.4 * spread;
  const lDark = clamp01(l * 0.2 + 0.05);
  const lLight = clamp01(1 - (1 - l) * 0.2 - 0.05);

  const inks: Array<[number, number, number]> = [
    [wrapHue(h - hueSwing), clamp01(s * sBoost), lDark],
    [wrapHue(h + hueSwing), clamp01(s * sBoost), lLight],
    [wrapHue(h + 180 - hueSwing), clamp01(s * sBoost), lDark],
    [wrapHue(h + 180 + hueSwing), clamp01(s * sBoost), lLight],
  ];

  const paletteUnits = inks.map(([hh, ss, ll]) => {
    const [rr, gg, bb] = hslToRgb(hh, ss, ll);
    return [rr / 255, gg / 255, bb / 255];
  });

  return alignToBase(paletteUnits, 0.9).map(toRgbString);
};

const resamplePalette = (colors: string[], count: number): [number, number, number][] => {
  const parsed = colors.map((color) => parseColor(color || '#000')) as [number, number, number][];
  if (parsed.length === 0 || count <= 0) {
    return [];
  }
  if (parsed.length === 1 || count === 1) {
    return [parsed[0]];
  }

  const result: [number, number, number][] = [];
  for (let i = 0; i < count; i += 1) {
    const t = count === 1 ? 0 : i / (count - 1);
    const scaled = t * (parsed.length - 1);
    const leftIndex = Math.floor(scaled);
    const rightIndex = Math.min(parsed.length - 1, leftIndex + 1);
    const mix = scaled - leftIndex;
    const left = parsed[leftIndex];
    const right = parsed[rightIndex];
    result.push([
      Math.round(left[0] + (right[0] - left[0]) * mix),
      Math.round(left[1] + (right[1] - left[1]) * mix),
      Math.round(left[2] + (right[2] - left[2]) * mix),
    ]);
  }
  return result;
};

export const spreadPaletteColors = (
  colors: string[],
  spreadPercent?: number
): string[] => {
  if (!Array.isArray(colors) || colors.length === 0) {
    return [];
  }

  const spread = clamp01((spreadPercent ?? 0) / 100);
  if (spread <= 0.01) {
    return colors.slice();
  }

  if (colors.length === 1) {
    return buildDitherPalette(colors[0], spreadPercent);
  }

  const parsed = colors.map((color) => parseColor(color || '#000')) as [number, number, number][];
  const hslColors = parsed.map(([r, g, b]) => rgbToHsl(r, g, b));
  const avgHue = averageHue(hslColors);
  const avgSaturation = hslColors.reduce((sum, color) => sum + color.s, 0) / hslColors.length;
  const avgLightness = hslColors.reduce((sum, color) => sum + color.l, 0) / hslColors.length;
  const anchorPalette = resamplePalette(
    buildDitherPalette(formatRgb(parsed.reduce<[number, number, number]>(
      (acc, color) => [acc[0] + color[0], acc[1] + color[1], acc[2] + color[2]],
      [0, 0, 0]
    ).map((value) => value / parsed.length)), spreadPercent),
    colors.length
  );

  return hslColors.map((color, index) => {
    const position = colors.length === 1 ? 0.5 : index / (colors.length - 1);
    const centerOffset = position - 0.5;
    const hueDelta = shortestHueDelta(avgHue, color.h);
    const anchorHsl = anchorPalette[index]
      ? rgbToHsl(anchorPalette[index][0], anchorPalette[index][1], anchorPalette[index][2])
      : color;

    const nextHue = wrapHue(
      avgHue +
      hueDelta * (1 + spread * 1.6) +
      centerOffset * 110 * spread +
      shortestHueDelta(color.h, anchorHsl.h) * 0.35 * spread
    );
    const nextSaturation = clamp01(
      avgSaturation +
      (color.s - avgSaturation) * (1 + spread * 1.4) +
      (anchorHsl.s - color.s) * 0.45 * spread +
      0.18 * spread
    );
    const nextLightness = clamp01(
      avgLightness +
      (color.l - avgLightness) * (1 + spread * 1.8) +
      centerOffset * 0.42 * spread +
      (anchorHsl.l - color.l) * 0.3 * spread
    );

    return formatRgb(hslToRgb(nextHue, nextSaturation, nextLightness));
  });
};

export const computeStrokeDitherPaletteForSettings = (settings: BrushSettings): string[] => {
  const { palette } = resolveStrokeDitherPalette({
    color: settings.color || '#000',
    spreadPercent: settings.ditherPaletteSpread ?? 0,
    ditherBackgroundFill: settings.ditherBackgroundFill,
  });
  return palette;
};

export const buildSpreadInkPalette = ({
  color,
  spreadPercent,
}: {
  color: string;
  spreadPercent?: number;
}): string[] => buildDitherPalette(color || '#000', spreadPercent ?? 0);

export const resolveStrokeDitherPalette = ({
  color,
  spreadPercent,
  ditherBackgroundFill,
}: {
  color: string;
  spreadPercent?: number;
  ditherBackgroundFill?: boolean;
}): {
  palette: string[];
  foregroundInk: [number, number, number];
  backgroundInk: [number, number, number];
} => {
  const basePalette = buildDitherPalette(color || '#000', spreadPercent ?? 0);
  const reduceForBgOff = ditherBackgroundFill === false && basePalette.length >= 2;
  let palette = basePalette;
  if (reduceForBgOff) {
    const luminance = (rgb: string): number => {
      const [r, g, b] = parseColor(rgb || '#000');
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    let darkest = basePalette[0];
    let lightest = basePalette[0];
    let minLum = luminance(darkest);
    let maxLum = minLum;
    for (let i = 1; i < basePalette.length; i += 1) {
      const l = luminance(basePalette[i]);
      if (l < minLum) {
        minLum = l;
        darkest = basePalette[i];
      }
      if (l > maxLum) {
        maxLum = l;
        lightest = basePalette[i];
      }
    }
    palette = [darkest, lightest];
  }
  const foregroundInk = parseColor(palette[0] ?? color ?? '#000') as [number, number, number];
  const backgroundInk = parseColor(palette[1] ?? palette[0] ?? color ?? '#000') as [number, number, number];
  return { palette, foregroundInk, backgroundInk };
};

export const pickTransparentInk = (palette: string[]): [number, number, number] => {
  const luminance = (rgb: string): number => {
    const [r, g, b] = parseColor(rgb || '#000');
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  if (!palette.length) return parseColor('#000') as [number, number, number];
  let idx = 0;
  let bestLum = luminance(palette[0]);
  for (let i = 1; i < palette.length; i += 1) {
    const l = luminance(palette[i]);
    if (l < bestLum) {
      bestLum = l;
      idx = i;
    }
  }
  return parseColor(palette[idx]) as [number, number, number];
};

export const normalizePressureSettings = (settings: BrushSettings) => {
  const range = resolveBrushPressureRange(settings);
  return {
    enabled: range.enabled,
    min: range.enabled ? range.minPercent : 100,
    max: range.enabled ? range.maxPercent : 100,
  };
};

export type Rect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type StrokeBounds = Rect;

export const mergeRectBounds = (current: Rect | null, next: Rect): Rect => {
  if (!current) {
    return next;
  }
  const minX = Math.min(current.x, next.x);
  const minY = Math.min(current.y, next.y);
  const maxX = Math.max(current.x + current.width, next.x + next.width);
  const maxY = Math.max(current.y + current.height, next.y + next.height);
  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY
  };
};

export const inflateRect = (rect: Rect, padding: number): Rect => ({
  x: rect.x - padding,
  y: rect.y - padding,
  width: rect.width + padding * 2,
  height: rect.height + padding * 2
});

export const normalizeRectForCanvas = (
  rect: Rect | undefined,
  canvasWidth: number,
  canvasHeight: number
): Rect => {
  if (!rect) {
    return {
      x: 0,
      y: 0,
      width: canvasWidth,
      height: canvasHeight
    };
  }

  const minX = clamp(Math.floor(rect.x), 0, canvasWidth);
  const minY = clamp(Math.floor(rect.y), 0, canvasHeight);
  const maxX = clamp(Math.ceil(rect.x + rect.width), minX, canvasWidth);
  const maxY = clamp(Math.ceil(rect.y + rect.height), minY, canvasHeight);
  const width = maxX - minX;
  const height = maxY - minY;

  if (width <= 0 || height <= 0) {
    return {
      x: 0,
      y: 0,
      width: canvasWidth,
      height: canvasHeight
    };
  }

  return {
    x: minX,
    y: minY,
    width,
    height
  };
};

type TwoDContext = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export const pick2D = (c: HTMLCanvasElement | OffscreenCanvas | null): TwoDContext | null =>
  (c?.getContext?.('2d') as TwoDContext | null) ?? null;

export const pick2DRead = (c: HTMLCanvasElement | OffscreenCanvas | null): TwoDContext | null =>
  (c?.getContext?.('2d', { willReadFrequently: true } as CanvasRenderingContext2DSettings) as
    | TwoDContext
    | null) ?? null;

export const sampleMaskA = (
  mask: HTMLCanvasElement | OffscreenCanvas | null,
  dstW: number,
  dstH: number,
  dx: number,
  dy: number
) => {
  if (getAlphaLockDebugLevel() === 0) {
    return -1;
  }
  if (!mask) {
    return -1;
  }
  const mW = (mask as { width?: number }).width ?? 0;
  const mH = (mask as { height?: number }).height ?? 0;
  const mctx = pick2DRead(mask);
  if (!mctx || !mW || !mH) {
    return -1;
  }
  const mx = clamp(Math.floor((dx * mW) / Math.max(1, dstW)), 0, mW - 1);
  const my = clamp(Math.floor((dy * mH) / Math.max(1, dstH)), 0, mH - 1);
  try {
    return mctx.getImageData(mx, my, 1, 1).data[3];
  } catch {
    return -1;
  }
};

export const maskHasAlphaNear = (
  mask: HTMLCanvasElement | OffscreenCanvas | null,
  mx: number,
  my: number,
  radius: number
): boolean => {
  if (!mask) {
    return true;
  }

  const width = (mask as { width?: number }).width ?? 0;
  const height = (mask as { height?: number }).height ?? 0;
  if (!width || !height) {
    return true;
  }

  const ctx = pick2DRead(mask);
  if (!ctx) {
    return true;
  }

  const centerX = clamp(Math.floor(mx), 0, Math.max(0, width - 1));
  const centerY = clamp(Math.floor(my), 0, Math.max(0, height - 1));
  const sampleRadius = Math.max(1, Math.round(radius));
  const sampleSize = Math.max(1, Math.min(sampleRadius * 2, width, height));
  const maxX = Math.max(0, width - sampleSize);
  const maxY = Math.max(0, height - sampleSize);
  const sampleX = clamp(centerX - sampleRadius, 0, maxX);
  const sampleY = clamp(centerY - sampleRadius, 0, maxY);

  try {
    const data = ctx.getImageData(sampleX, sampleY, sampleSize, sampleSize).data;
    for (let i = 3; i < data.length; i += 4) {
      if (data[i] > 0) {
        return true;
      }
    }
    return false;
  } catch {
    return true;
  }
};

export const sampleRGBA = (ctx: CanvasRenderingContext2D, x: number, y: number) => {
  if (getAlphaLockDebugLevel() === 0) {
    return null;
  }
  const ix = clamp(Math.floor(x), 0, (ctx.canvas.width | 0) - 1);
  const iy = clamp(Math.floor(y), 0, (ctx.canvas.height | 0) - 1);
  try {
    return Array.from(ctx.getImageData(ix, iy, 1, 1).data);
  } catch {
    return null;
  }
};

export const ensureCanvasPixelSize = (canvas: HTMLCanvasElement): void => {
  if (
    !canvas ||
    typeof window === 'undefined' ||
    typeof canvas.getBoundingClientRect !== 'function'
  ) {
    return;
  }
  const isConnected =
    typeof (canvas as { isConnected?: unknown }).isConnected === 'boolean'
      ? Boolean((canvas as { isConnected?: unknown }).isConnected)
      : true;
  if (!isConnected) {
    return;
  }
  const rect = canvas.getBoundingClientRect();
  if (!rect.width && !rect.height) {
    return;
  }
  const dpr = window.devicePixelRatio || 1;
  const targetWidth = Math.max(1, Math.round(rect.width * dpr));
  const targetHeight = Math.max(1, Math.round(rect.height * dpr));
  if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
    canvas.width = targetWidth;
    canvas.height = targetHeight;
  }
};
