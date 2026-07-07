import { debugLog, debugWarn } from '@/utils/debug';
import {
  ensurePresResDebugBridge,
  isPresResDebugEnabled as isSharedPresResDebugEnabled,
} from '@/hooks/canvas/utils/presResDebug';

export {
  buildSpreadInkPalette,
  computeStrokeDitherPaletteForSettings,
  normalizePressureSettings,
  pickTransparentInk,
  resolveStrokeDitherPalette,
  spreadPaletteColors,
} from './enginePalette';

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
    debugWarn('raw-console',
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
  const level = typeof window !== 'undefined'
    ? (window as Window & { __alphaLockDebug?: number }).__alphaLockDebug ?? 0
    : 0;
  if (level > 0) {
    try {
      debugLog('raw-console', `[AL] ${step} ${JSON.stringify(obj)}`);
    } catch {
      debugLog('raw-console', '[AL]', step, obj);
    }
  }
};

export const DD = (step: string, obj: Record<string, unknown>) => {
  const level = typeof window !== 'undefined'
    ? (window as { __ditherDebugLevel?: number }).__ditherDebugLevel ?? 0
    : 0;
  if (level > 0) {
    try {
      debugLog('raw-console', `[DITHER] ${step} ${JSON.stringify(obj)}`);
    } catch {
      debugLog('raw-console', '[DITHER]', step, obj);
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
  const traceWindow = window as Window & { __presResTrace?: Array<Record<string, unknown>> };
  const trace = (traceWindow.__presResTrace ??= []);
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
  const w = window as Window & {
    __presResTrace?: Array<Record<string, unknown>>;
    __clearPresResTrace?: () => void;
    __summarizePresResTrace?: () => Record<string, unknown>;
  };
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
