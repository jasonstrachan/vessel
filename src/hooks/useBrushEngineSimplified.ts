/**
 * Simplified Brush Engine Hook
 * Clean interface using the facade pattern
 */

import { useCallback, useMemo, useRef, useEffect } from 'react';
import {
  selectColorCycleDesiredPlaying,
  selectEffectiveColorCyclePlaying,
  useAppStore
} from '../stores/useAppStore';
import { createBrushEngineFacade, type BrushEngineConfig, type BrushStrokeParams, type CustomBrushStrokeData } from './brushEngine/BrushEngineFacade';
import { BrushShape, type Layer, type BrushSettings } from '../types';
import {
  getRisographPattern,
  getRisographEffectSettings,
  getRisographFilter,
  createSeededRng,
  hashNumbers,
  createRisoTintMask
} from '../utils/risographTexture';
import { applyDithering as applyDitheringImport, applyDitheringWithFillResolution } from './brushEngine/dithering';
import { parseColor } from './brushEngine/colorUtils';
import { canvasPool } from '../utils/canvasPool';
import { resolveBrushPressureRange } from '@/utils/pressureSettings';
import {
  computePressureResolution,
  createPressureResolutionState,
  PRESSURE_RESOLUTION_MAX_PX,
  type PressureResolutionState,
} from '@/utils/pressureResolution';
import { applySierraLiteLostEdgeMask } from '@/utils/ditherAlgorithms';
// Use migration wrapper to switch between WebGL and Canvas2D implementations
import { type ColorCycleBrushImplementation } from './brushEngine/ColorCycleBrushMigration';
import { getColorCycleBrushManager } from '@/stores/colorCycleBrushManager';
import { isColorCycleBrush } from '@/utils/colorCycleGradients';

declare global {
  interface Window {
    transparencyLockEnabled?: boolean;
    __alphaLockDebug?: number;
    __AL_sample?: { x: number; y: number; tag?: string };
    __AL_maskSrc?: string;
  }
}

/**
 * Simplified brush engine hook with facade pattern
 */
type DrawColorCycleOptions = {
  customStamp?: CustomBrushStrokeData;
};

type ShapeFillOptions = Record<string, unknown>;

type IdleHandle = { id: number; kind: 'idle' | 'timeout' } | null;

type GradientStop = { position: number; color: string };
type ColorCycleGradientDef = { id: string; name?: string; currentSlot: number };
type ColorCycleSlotPalette = { slot: number; stops: GradientStop[] };

const DEFAULT_CC_GRADIENT: GradientStop[] = [
  { position: 0.0, color: '#ff0000' },
  { position: 0.17, color: '#ff7f00' },
  { position: 0.33, color: '#ffff00' },
  { position: 0.5, color: '#00ff00' },
  { position: 0.67, color: '#0000ff' },
  { position: 0.83, color: '#4b0082' },
  { position: 1.0, color: '#9400d3' }
];

const resolveColorCycleGradientsForLayer = (
  layer: Layer | undefined,
  brushSettings: BrushSettings
): {
  gradientDefs: ColorCycleGradientDef[];
  slotPalettes: ColorCycleSlotPalette[];
  activeGradientId: string;
  activeSlot: number;
  activeStops: GradientStop[];
  fallbackStops: GradientStop[];
} => {
  const fallbackStops =
    layer?.colorCycleData?.gradient ??
    brushSettings.colorCycleGradient ??
    DEFAULT_CC_GRADIENT;
  const gradientDefs = layer?.colorCycleData?.gradientDefs?.length
    ? layer.colorCycleData.gradientDefs
    : [{ id: 'g0', currentSlot: 0 }];
  const slotPalettes = layer?.colorCycleData?.slotPalettes?.length
    ? layer.colorCycleData.slotPalettes
    : [{ slot: 0, stops: fallbackStops }];
  const activeGradientId = layer?.colorCycleData?.activeGradientId ?? gradientDefs[0].id;
  const activeDef =
    gradientDefs.find((entry) => entry.id === activeGradientId) ?? gradientDefs[0];
  const activeSlot = activeDef?.currentSlot ?? 0;
  const activePalette = slotPalettes.find((entry) => entry.slot === activeSlot);
  const activeStops =
    activePalette?.stops && activePalette.stops.length > 0
      ? activePalette.stops
      : fallbackStops;
  return {
    gradientDefs,
    slotPalettes,
    activeGradientId,
    activeSlot,
    activeStops,
    fallbackStops,
  };
};

const scheduleDeferred = (callback: () => void, timeout = 120): IdleHandle => {
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

const cancelDeferred = (handle: IdleHandle) => {
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

const warnShapeFillRemoved = (() => {
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

const getAlphaLockDebugLevel = () => {
  if (typeof window === 'undefined') {
    return 0;
  }
  const level = Number((window as { __alphaLockDebug?: unknown }).__alphaLockDebug ?? 0);
  return Number.isFinite(level) ? level : 0;
};

const AL = (step: string, obj: Record<string, unknown>) => {
  const level = typeof window !== 'undefined' ? window.__alphaLockDebug ?? 0 : 0;
  if (level > 0) {
    try {
      console.log(`[AL] ${step} ${JSON.stringify(obj)}`);
    } catch {
      console.log('[AL]', step, obj);
    }
  }
};

const DD = (step: string, obj: Record<string, unknown>) => {
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


const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const MAX_ALPHA_PROBE_SIZE = 256;
const DEFAULT_CC_BAND_SPACING = 12;
const clampColorCycleBandSpacing = (value?: number) => {
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

  const toRgbString = (unit: number[]) => {
    const rr = clamp(Math.round(unit[0] * 255), 0, 255);
    const gg = clamp(Math.round(unit[1] * 255), 0, 255);
    const bb = clamp(Math.round(unit[2] * 255), 0, 255);
    return `rgb(${rr}, ${gg}, ${bb})`;
  };

  // Max spread: keep 3 high-contrast inks, but solve so their average mixes back to the
  // selected colour. This keeps the final dither faithful while still visually distinct.
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

  // Very low spread: minimal but visible dither (simple dark/light pair)
  if (spread <= 0.01) {
    const darker = (channel: number) => clamp(Math.round(channel * 0.6), 0, 255);
    const lighter = (channel: number) => clamp(Math.round(channel * 1.35), 0, 255);
    return [
      `rgb(${darker(r)}, ${darker(g)}, ${darker(b)})`,
      `rgb(${lighter(r)}, ${lighter(g)}, ${lighter(b)})`
    ];
  }

  // Build a small, high-contrast palette (4 inks) to force visible dithering
  const hueSwing = 60 + 120 * spread; // 60°..180°
  const sBoost = 1.1 + 0.4 * spread;  // more chroma at higher spread
  const lDark = clamp01(l * 0.2 + 0.05);       // push dark toward 0
  const lLight = clamp01(1 - (1 - l) * 0.2 - 0.05); // push light toward 1

  const inks: Array<[number, number, number]> = [
    [wrapHue(h - hueSwing), clamp01(s * sBoost), lDark],   // base hue dark
    [wrapHue(h + hueSwing), clamp01(s * sBoost), lLight],  // base hue light
    [wrapHue(h + 180 - hueSwing), clamp01(s * sBoost), lDark],  // complement dark
    [wrapHue(h + 180 + hueSwing), clamp01(s * sBoost), lLight], // complement light
  ];

  const paletteUnits = inks.map(([hh, ss, ll]) => {
    const [rr, gg, bb] = hslToRgb(hh, ss, ll);
    return [rr / 255, gg / 255, bb / 255];
  });

  return alignToBase(paletteUnits, 0.9).map(toRgbString);
};


const normalizePressureSettings = (settings: BrushSettings) => {
  const range = resolveBrushPressureRange(settings);
  return {
    enabled: range.enabled,
    min: range.enabled ? range.minPercent : 100,
    max: range.enabled ? range.maxPercent : 100,
  };
};

type Rect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type StrokeBounds = Rect;

const mergeRectBounds = (current: Rect | null, next: Rect): Rect => {
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

const inflateRect = (rect: Rect, padding: number): Rect => ({
  x: rect.x - padding,
  y: rect.y - padding,
  width: rect.width + padding * 2,
  height: rect.height + padding * 2
});

const normalizeRectForCanvas = (
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

const pick2D = (c: HTMLCanvasElement | OffscreenCanvas | null): TwoDContext | null =>
  (c?.getContext?.('2d') as TwoDContext | null) ?? null;

const pick2DRead = (c: HTMLCanvasElement | OffscreenCanvas | null): TwoDContext | null =>
  (c?.getContext?.('2d', { willReadFrequently: true } as CanvasRenderingContext2DSettings) as
    | TwoDContext
    | null) ?? null;

const sampleMaskA = (
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

const maskHasAlphaNear = (
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
    // If reading pixels fails (e.g., due to cross-origin data), allow painting to avoid false negatives.
    return true;
  }
};

const sampleRGBA = (ctx: CanvasRenderingContext2D, x: number, y: number) => {
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

const ensureCanvasPixelSize = (canvas: HTMLCanvasElement): void => {
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

const bindBrushToCanvas = (
  brush: ColorCycleBrushImplementation | null | undefined,
  canvas: HTMLCanvasElement | null | undefined
): void => {
  if (!brush || !canvas) {
    return;
  }
  const brushWithTarget = brush as ColorCycleBrushImplementation & {
    setTargetCanvas?: (canvas: HTMLCanvasElement | null) => void;
  };
  if (typeof brushWithTarget.setTargetCanvas === 'function') {
    const isConnected =
      typeof (canvas as { isConnected?: unknown }).isConnected === 'boolean'
        ? Boolean((canvas as { isConnected?: unknown }).isConnected)
        : false;
    if (isConnected) {
      ensureCanvasPixelSize(canvas);
    }
    brushWithTarget.setTargetCanvas(canvas);
  }
};

export const refreshLayerCCSurface = (
  brush: ColorCycleBrushImplementation,
  layerId: string
): HTMLCanvasElement | null => {
  const state = useAppStore.getState();
  const layer = state.layers.find((candidate) => candidate.id === layerId);
  if (!layer) {
    return null;
  }

  const storedCanvas = layer.colorCycleData?.canvas as HTMLCanvasElement | undefined;
  const liveCanvas = brush.getCanvas?.() as HTMLCanvasElement | undefined;

  if (liveCanvas && (!storedCanvas || storedCanvas !== liveCanvas)) {
    try {
      state.updateLayer(layerId, {
        colorCycleData: {
          ...(layer.colorCycleData ?? {}),
          canvas: liveCanvas
        }
      } as Partial<Layer>);
      return liveCanvas;
    } catch {
      // fall through; return best-known surface
    }
  }

  return storedCanvas ?? liveCanvas ?? null;
};

const renderBrushToLayerCanvas = (
  brush: ColorCycleBrushImplementation | null | undefined,
  layerId: string | null | undefined
): void => {
  if (!brush || !layerId) {
    return;
  }
  const layerCanvas = refreshLayerCCSurface(brush, layerId);
  if (!layerCanvas) {
    return;
  }
  bindBrushToCanvas(brush, layerCanvas);
  if (layerCanvas.isConnected) {
    ensureCanvasPixelSize(layerCanvas);
  }
  if (typeof brush.renderDirectToCanvas === 'function') {
    try {
      brush.renderDirectToCanvas(layerCanvas, layerId);
    } catch (error) {
      console.warn('[ColorCycle] renderDirectToCanvas failed:', error);
    }
  }
};

export const useBrushEngineSimplified = () => {
  const { tools, project, activeLayerId } = useAppStore();
  const layers = useAppStore((state) => state.layers);
  // Track per-layer CC brush speed for the active layer
  const activeLayerBrushSpeed = useAppStore((state) => {
    const layer = state.layers.find(l => l.id === state.activeLayerId);
    return layer?.colorCycleData?.brushSpeed;
  });
  const activeLayerFlowMode = useAppStore((state) => {
    const layer = state.layers.find(l => l.id === state.activeLayerId);
    return layer?.colorCycleData?.flowMode;
  });
  const activeLayerTransparencyLock = useAppStore((state) => {
    const layer = state.layers.find(l => l.id === state.activeLayerId);
    return layer?.transparencyLocked === true;
  });
  const mirrorScheduledRef = useRef(false);
  const firstStampImmediateRef = useRef(true);

  const getActiveLayerBitmapCanvas = useCallback((): HTMLCanvasElement | OffscreenCanvas | null => {
    const state = useAppStore.getState();
    const layer = state.layers.find(l => l.id === state.activeLayerId);
    if (!layer) {
      return null;
    }

    if (layer.layerType === 'color-cycle') {
      const ccCanvas = layer.colorCycleData?.canvas;
      if (ccCanvas && typeof ccCanvas.getContext === 'function') {
        if (typeof window !== 'undefined') {
          window.__AL_maskSrc = 'ccCanvas';
        }
        return ccCanvas as HTMLCanvasElement | OffscreenCanvas;
      }

      const brush = typeof state.getLayerColorCycleBrush === 'function'
        ? state.getLayerColorCycleBrush(layer.id)
        : null;

      const internalCanvas = brush?.getCanvas?.();
      if (internalCanvas && typeof (internalCanvas as HTMLCanvasElement | OffscreenCanvas).getContext === 'function') {
        if (typeof window !== 'undefined') {
          window.__AL_maskSrc = 'ccInternal';
        }
        return internalCanvas as HTMLCanvasElement | OffscreenCanvas;
      }

      const paintBuffer = (brush as { getPaintBuffer?: () => HTMLCanvasElement | OffscreenCanvas | null } | null)
        ?.getPaintBuffer?.();
      if (paintBuffer && typeof (paintBuffer as HTMLCanvasElement | OffscreenCanvas).getContext === 'function') {
        if (typeof window !== 'undefined') {
          window.__AL_maskSrc = 'ccPaintBuffer';
        }
        return paintBuffer as HTMLCanvasElement | OffscreenCanvas;
      }

      if (typeof window !== 'undefined') {
        window.__AL_maskSrc = 'null-cc';
      }
      return null;
    }

    const framebuffer = layer.framebuffer;
    if (framebuffer && typeof framebuffer.getContext === 'function') {
      if (typeof window !== 'undefined') {
        window.__AL_maskSrc = 'framebuffer';
      }
      return framebuffer as HTMLCanvasElement | OffscreenCanvas;
    }

    if (typeof window !== 'undefined') {
      window.__AL_maskSrc = 'null-bitmap';
    }
    return null;
  }, []);

  const withTransparencyLock = useCallback((
    ctx: CanvasRenderingContext2D,
    draw: () => void
  ) => {
    if (!activeLayerTransparencyLock) {
      draw();
      return;
    }

    const previousComposite = ctx.globalCompositeOperation;
    try {
      ctx.globalCompositeOperation = 'source-atop';
      draw();
    } finally {
      ctx.globalCompositeOperation = previousComposite;
    }
  }, [activeLayerTransparencyLock]);

  const setBlendIfUnlocked = useCallback((ctx: CanvasRenderingContext2D) => {
    if (!activeLayerTransparencyLock) {
      ctx.globalCompositeOperation = tools.brushSettings.blendMode || 'source-over';
    }
  }, [activeLayerTransparencyLock, tools.brushSettings.blendMode]);

  const setMultiplyIfUnlocked = useCallback((ctx: CanvasRenderingContext2D) => {
    if (!activeLayerTransparencyLock) {
      ctx.globalCompositeOperation = 'multiply';
    }
  }, [activeLayerTransparencyLock]);

  const alphaPresenceCacheRef = useRef<{
    canvas: HTMLCanvasElement | OffscreenCanvas | null;
    hasAlpha: boolean;
    sampledAt: number;
  }>({
    canvas: null,
    hasAlpha: true,
    sampledAt: 0
  });
  const alphaProbeCanvasRef = useRef<HTMLCanvasElement | OffscreenCanvas | null>(null);
  const strokeBoundsRef = useRef<Rect | null>(null);
  const liveStrokeRawRef = useRef<HTMLCanvasElement | OffscreenCanvas | null>(null);
  const liveStrokeDitherRef = useRef<HTMLCanvasElement | OffscreenCanvas | null>(null);
  const bgOffTempCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const bgOffTempCtxRef = useRef<CanvasRenderingContext2D | null>(null);
  const bgOffHoleCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const bgOffHoleCtxRef = useRef<CanvasRenderingContext2D | null>(null);
  const bgOffMaskImageRef = useRef<ImageData | null>(null);
  const liveStrokeBoundsRef = useRef<Rect | null>(null);
  const liveDirtyRectRef = useRef<Rect | null>(null);
  const lastSegmentBoundsRef = useRef<Rect | null>(null);
  const strokePhaseOriginRef = useRef<{ x: number; y: number } | null>(null);
  const liveRenderScheduledRef = useRef(false);
  const ditherCoverageMapRef = useRef<Map<string, {
    canvas: HTMLCanvasElement | OffscreenCanvas;
    ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
  }>>(new Map());

  const clearCoverageMaps = useCallback(() => {
    ditherCoverageMapRef.current.clear();
  }, []);

  const clearBgOffHoleCanvas = useCallback(() => {
    const holeCanvas = bgOffHoleCanvasRef.current;
    if (!holeCanvas) {
      bgOffMaskImageRef.current = null;
      return;
    }
    const holeCtx = bgOffHoleCtxRef.current ?? holeCanvas.getContext('2d');
    if (holeCtx) {
      holeCtx.clearRect(0, 0, holeCanvas.width, holeCanvas.height);
    }
    bgOffMaskImageRef.current = null;
  }, []);

  const ensureBgOffTemp = useCallback((width: number, height: number) => {
    if (typeof document === 'undefined') {
      return null;
    }
    if (!bgOffTempCanvasRef.current) {
      bgOffTempCanvasRef.current = document.createElement('canvas');
    }
    const canvas = bgOffTempCanvasRef.current;
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return null;
    }
    bgOffTempCtxRef.current = ctx;
    return { canvas, ctx };
  }, []);

  const ensureBgOffHole = useCallback((width: number, height: number) => {
    if (typeof document === 'undefined') {
      return null;
    }
    if (!bgOffHoleCanvasRef.current) {
      bgOffHoleCanvasRef.current = document.createElement('canvas');
    }
    const canvas = bgOffHoleCanvasRef.current;
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return null;
    }
    bgOffHoleCtxRef.current = ctx;
    return { canvas, ctx };
  }, []);

  const ensureLiveStrokeBuffers = useCallback((ctx: CanvasRenderingContext2D): boolean => {
    if (typeof document === 'undefined') {
      return false;
    }
    const width = ctx.canvas?.width ?? 0;
    const height = ctx.canvas?.height ?? 0;
    if (!width || !height) {
      return false;
    }

    const ensureCanvas = (ref: { current: HTMLCanvasElement | OffscreenCanvas | null }) => {
      const existing = ref.current as HTMLCanvasElement | null;
      if (!existing) {
        const c = document.createElement('canvas');
        c.width = width;
        c.height = height;
        ref.current = c;
        return;
      }
      if (existing.width !== width || existing.height !== height) {
        existing.width = width;
        existing.height = height;
        const bufferCtx = pick2D(existing);
        bufferCtx?.clearRect(0, 0, width, height);
      }
    };

    ensureCanvas(liveStrokeRawRef);
    ensureCanvas(liveStrokeDitherRef);
    return Boolean(liveStrokeRawRef.current && liveStrokeDitherRef.current);
  }, []);

  const clearLiveStrokeBuffers = useCallback(() => {
    const raw = liveStrokeRawRef.current;
    const dither = liveStrokeDitherRef.current;
    if (raw) {
      const rawCtx = pick2D(raw);
      rawCtx?.clearRect(0, 0, (raw as { width?: number }).width ?? 0, (raw as { height?: number }).height ?? 0);
    }
    if (dither) {
      const ditherCtx = pick2D(dither);
      ditherCtx?.clearRect(0, 0, (dither as { width?: number }).width ?? 0, (dither as { height?: number }).height ?? 0);
    }
    liveStrokeBoundsRef.current = null;
    lastSegmentBoundsRef.current = null;
    liveRenderScheduledRef.current = false;
    strokePhaseOriginRef.current = null;
    committedPixelSizeRef.current = null;
    pendingPixelSizeRef.current = null;
    pendingSinceRef.current = 0;
    clearBgOffHoleCanvas();
  }, [clearBgOffHoleCanvas]);

  useEffect(() => {
    const ids = new Set(layers.map((layer) => layer.id));
    const map = ditherCoverageMapRef.current;
    for (const key of Array.from(map.keys())) {
      if (!ids.has(key)) {
        map.delete(key);
      }
    }
  }, [layers]);

  // Reset pressure-linked resolution caches whenever the mode toggles
  useEffect(() => {
    strokePressureRef.current = {
      min: 1,
      max: 0,
      lastNonZero: 0,
      last: 0,
      stable: 0,
      isTail: false,
      lastTime: 0,
      sampleCount: 0
    };
    lastPressureDitherTimeRef.current = 0;
    lastPressureDitherPixelSizeRef.current = null;
    strokePressureResStateRef.current = createPressureResolutionState(1);
  }, [tools.brushSettings.pressureLinkedFillResolution]);

  const layerHasAnyAlpha = useCallback(() => {
    const mask = getActiveLayerBitmapCanvas();
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const cache = alphaPresenceCacheRef.current;

    if (!mask) {
      cache.canvas = null;
      cache.hasAlpha = true;
      cache.sampledAt = now;
      return true;
    }

    if (cache.canvas === mask) {
      const ttlMs = cache.hasAlpha ? 32 : 250;
      if (now - cache.sampledAt < ttlMs) {
        return cache.hasAlpha;
      }
    }

    const width = ((mask as HTMLCanvasElement | OffscreenCanvas).width ?? 0) | 0;
    const height = ((mask as HTMLCanvasElement | OffscreenCanvas).height ?? 0) | 0;
    if (!width || !height) {
      return true;
    }

    const sampleW = Math.max(1, Math.min(MAX_ALPHA_PROBE_SIZE, width));
    const sampleH = Math.max(1, Math.min(MAX_ALPHA_PROBE_SIZE, height));

    let probeCanvas = alphaProbeCanvasRef.current;
    if (!probeCanvas || probeCanvas.width !== sampleW || probeCanvas.height !== sampleH) {
      const globalAny = globalThis as Record<string, unknown>;
      const offscreenCtor = (globalAny as { OffscreenCanvas?: unknown }).OffscreenCanvas;

      if (typeof offscreenCtor === 'function') {
        probeCanvas = new (offscreenCtor as { new(w: number, h: number): unknown })(sampleW, sampleH) as HTMLCanvasElement | OffscreenCanvas;
      } else if (typeof document !== 'undefined' && typeof document.createElement === 'function') {
        const canvas = document.createElement('canvas');
        canvas.width = sampleW;
        canvas.height = sampleH;
        probeCanvas = canvas;
      } else {
        // Unable to create a canvas in this environment; assume alpha to avoid blocking.
        return true;
      }
      alphaProbeCanvasRef.current = probeCanvas;
    }

    const probeCtx = typeof probeCanvas.getContext === 'function'
      ? probeCanvas.getContext('2d', { willReadFrequently: true } as CanvasRenderingContext2DSettings)
      : null;
    if (!probeCtx) {
      return true;
    }

    if (typeof (probeCtx as CanvasRenderingContext2D).clearRect !== 'function') {
      return true;
    }

    const probeCtx2D = probeCtx as CanvasRenderingContext2D;
    probeCtx2D.clearRect(0, 0, sampleW, sampleH);
    try {
      probeCtx2D.drawImage(mask as CanvasImageSource, 0, 0, width, height, 0, 0, sampleW, sampleH);
    } catch {
      return true;
    }

    const data = probeCtx2D.getImageData(0, 0, sampleW, sampleH).data;
    let hasAlpha = false;
    for (let i = 3; i < data.length; i += 4) {
      if (data[i] > 0) {
        hasAlpha = true;
        break;
      }
    }

    if (!hasAlpha) {
      const maskCtx = pick2DRead(mask);
      if (maskCtx) {
        const stepY = Math.max(1, Math.floor(height / sampleH));
        const stepX = Math.max(1, Math.floor(width / sampleW));
        for (let y = 0; y < height && !hasAlpha; y += stepY) {
          try {
            const row = maskCtx.getImageData(0, y, width, 1).data;
            for (let x = 3; x < row.length; x += stepX * 4) {
              if (row[x] > 0) {
                hasAlpha = true;
                break;
              }
            }
          } catch {
            break;
          }
        }
      }
    }

    cache.canvas = mask as HTMLCanvasElement | OffscreenCanvas;
    cache.hasAlpha = hasAlpha;
    cache.sampledAt = now;
    return hasAlpha;
  }, [getActiveLayerBitmapCanvas]);

  const alphaLockEmptyMaskWarnedRef = useRef(false);

  const withAlphaLock = useCallback((
    dstCtx: CanvasRenderingContext2D,
    paint: (targetCtx: CanvasRenderingContext2D) => void,
    bounds?: Rect
  ) => {
    const dstW = dstCtx.canvas.width | 0;
    const dstH = dstCtx.canvas.height | 0;
    const alphaLockDebugLevel = getAlphaLockDebugLevel();
    const sample = (typeof window !== 'undefined' && window.__AL_sample) || {
      x: dstW ? dstW / 2 : 0,
      y: dstH ? dstH / 2 : 0,
      tag: '(center)'
    };

    const lockOn = activeLayerTransparencyLock;
    AL('ENTER', { tag: sample.tag, lockOn, dst: `${dstW}x${dstH}` });

    if (!lockOn || !dstW || !dstH) {
      alphaLockEmptyMaskWarnedRef.current = false;
      paint(dstCtx);
      return;
    }

    const mask = getActiveLayerBitmapCanvas();
    const hasLayerAlpha = layerHasAnyAlpha();
    const maskWidth = (mask as { width?: number })?.width ?? 0;
    const maskHeight = (mask as { height?: number })?.height ?? 0;
    const stateSnapshot = useAppStore.getState();
    const currentLayerId = stateSnapshot.activeLayerId ?? null;
    const activeLayer = currentLayerId
      ? stateSnapshot.layers.find((candidate) => candidate.id === currentLayerId)
      : undefined;
    const isColorCycleLayer =
      Boolean(activeLayer?.layerType === 'color-cycle' || activeLayer?.colorCycleData);
    const shouldBlock = !mask || !maskWidth || !maskHeight || !hasLayerAlpha;

    if (typeof window !== 'undefined') {
      const probeWindow = window as typeof window & {
        __AL_probe?: { hits: number; blocks: number; bypasses: number };
      };
      probeWindow.__AL_probe ??= { hits: 0, blocks: 0, bypasses: 0 };
      probeWindow.__AL_probe.hits += 1;
      if (lockOn && shouldBlock) {
        const payload = {
          activeLayerId: currentLayerId,
          isColorCycleLayer,
          hasVisibleAlpha: hasLayerAlpha
        };
        if (isColorCycleLayer) {
          probeWindow.__AL_probe.bypasses += 1;
          if (alphaLockDebugLevel > 0 && typeof console !== 'undefined') {
            console.warn('[AL:bypass-cc]', payload);
          }
        } else {
          probeWindow.__AL_probe.blocks += 1;
          if (alphaLockDebugLevel > 0 && typeof console !== 'undefined') {
            console.warn('[AL:block]', payload);
          }
        }
      }
    }

    if (shouldBlock && isColorCycleLayer) {
      alphaLockEmptyMaskWarnedRef.current = false;
      paint(dstCtx);
      return;
    }

    if (shouldBlock && !isColorCycleLayer) {
      if (!alphaLockEmptyMaskWarnedRef.current && alphaLockDebugLevel > 0 && typeof console !== 'undefined') {
        console.warn('[AlphaLock] Active layer shows no visible alpha; lock prevents new pixels.');
        alphaLockEmptyMaskWarnedRef.current = true;
      }
      return;
    }
    alphaLockEmptyMaskWarnedRef.current = false;

    const region = normalizeRectForCanvas(bounds, dstW, dstH);
    const scratch = canvasPool.acquire(region.width, region.height);

    try {
      const sctx = scratch.getContext('2d', { willReadFrequently: true } as CanvasRenderingContext2DSettings);
      if (!sctx) {
        return;
      }

      sctx.clearRect(0, 0, region.width, region.height);
      sctx.save();
      sctx.translate(-region.x, -region.y);

      const originalGetImageData = sctx.getImageData.bind(sctx);
      sctx.getImageData = ((x: number, y: number, w: number, h: number) =>
        dstCtx.getImageData(x + region.x, y + region.y, w, h)
      ) as typeof sctx.getImageData;

      try {
        paint(sctx as unknown as CanvasRenderingContext2D);
      } finally {
        sctx.getImageData = originalGetImageData;
        sctx.restore();
      }

      const scratchSampleX = sample.x - region.x;
      const scratchSampleY = sample.y - region.y;
      const scratchPre = sampleRGBA(sctx as unknown as CanvasRenderingContext2D, scratchSampleX, scratchSampleY);

      const maskSrc = (typeof window !== 'undefined' && window.__AL_maskSrc) || 'unknown';
      const dstBefore = sampleRGBA(dstCtx, sample.x, sample.y);
      AL('SETUP', {
        maskSrc,
        maskSize: `${maskWidth}x${maskHeight}`,
        sampleXY: `${Math.round(sample.x)},${Math.round(sample.y)}`,
        dstBefore,
        region
      });
      AL('PAINT', { scratchRGBA_preMask: scratchPre });

      const sx = (region.x * maskWidth) / dstW;
      const sy = (region.y * maskHeight) / dstH;
      const sw = (region.width * maskWidth) / dstW;
      const sh = (region.height * maskHeight) / dstH;

      sctx.globalCompositeOperation = 'destination-in';
      sctx.drawImage(
        mask as unknown as CanvasImageSource,
        sx,
        sy,
        sw,
        sh,
        0,
        0,
        region.width,
        region.height
      );
      sctx.globalCompositeOperation = 'source-over';

      const scratchPost = sampleRGBA(sctx as unknown as CanvasRenderingContext2D, scratchSampleX, scratchSampleY);
      AL('MASK', { scratchRGBA_afterMask: scratchPost, region });

      const blendMode = (tools.brushSettings.blendMode || 'source-over') as GlobalCompositeOperation;
      dstCtx.save();
      dstCtx.globalCompositeOperation = blendMode;
      dstCtx.drawImage(scratch, region.x, region.y);
      dstCtx.restore();

      const dstAfter = sampleRGBA(dstCtx, sample.x, sample.y);
      AL('COMPOSITE', { gco: blendMode, dstAfter });

      const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
      alphaPresenceCacheRef.current = {
        canvas: mask as HTMLCanvasElement | OffscreenCanvas,
        hasAlpha: true,
        sampledAt: now
      };
    } finally {
      canvasPool.release(scratch);
    }
  }, [activeLayerTransparencyLock, getActiveLayerBitmapCanvas, layerHasAnyAlpha, tools.brushSettings.blendMode]);

  const renderCCWithBlendAndLock = useCallback((
    targetCtx: CanvasRenderingContext2D,
    sourceCanvas: HTMLCanvasElement | OffscreenCanvas,
    blendMode: GlobalCompositeOperation
  ) => {
    const width = targetCtx.canvas.width;
    const height = targetCtx.canvas.height;
    if (!width || !height) {
      return;
    }

    const sampleDefault = { x: width / 2, y: height / 2, tag: 'cc(center)' };
    const sample = (typeof window !== 'undefined' && window.__AL_sample) || sampleDefault;
    AL('CC_ENTER', { lock: activeLayerTransparencyLock, dst: `${width}x${height}` });

    const mask = getActiveLayerBitmapCanvas();
    const maskWidth = (mask as { width?: number })?.width ?? 0;
    const maskHeight = (mask as { height?: number })?.height ?? 0;
    const hasMaskAlpha = layerHasAnyAlpha();
    const maskSrc = (typeof window !== 'undefined' && window.__AL_maskSrc) || 'unknown';
    const maskA = sampleMaskA(mask, width, height, sample.x, sample.y);
    AL('CC_SETUP', {
      sampleTag: sample.tag,
      maskSrc,
      maskSize: `${maskWidth}x${maskHeight}`,
      maskA,
      hasMaskAlpha,
      lock: activeLayerTransparencyLock
    });

    const tempCanvas = canvasPool.acquire(width, height);
    try {
      const tempCtx = tempCanvas.getContext('2d', { willReadFrequently: true } as CanvasRenderingContext2DSettings);
      if (!tempCtx) {
        return;
      }

      tempCtx.clearRect(0, 0, width, height);
      tempCtx.drawImage(sourceCanvas as unknown as CanvasImageSource, 0, 0, width, height);

      if (activeLayerTransparencyLock && hasMaskAlpha) {
        if (mask && maskWidth && maskHeight) {
          tempCtx.globalCompositeOperation = 'destination-in';
          tempCtx.drawImage(
            mask as unknown as CanvasImageSource,
            0,
            0,
            maskWidth,
            maskHeight,
            0,
            0,
            width,
            height
          );
          tempCtx.globalCompositeOperation = 'source-over';

          try {
            const sx = clamp(Math.floor(sample.x), 0, width - 1);
            const sy = clamp(Math.floor(sample.y), 0, height - 1);
            const px = tempCtx.getImageData(sx, sy, 1, 1).data;
            AL('CC_MASK', { tempSampleRGBA_afterMask: px ? Array.from(px) : null });
          } catch {
            AL('CC_MASK', { tempSampleRGBA_afterMask: 'read-failed' });
          }
        } else {
          AL('CC_MASK_SKIP', { reason: 'missing-mask' });
        }
      }

      targetCtx.save();
      targetCtx.globalCompositeOperation = blendMode;
      targetCtx.drawImage(tempCanvas, 0, 0);
      targetCtx.restore();

      if (activeLayerTransparencyLock) {
        const layerMask = getActiveLayerBitmapCanvas();
        if (layerMask) {
          const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
          alphaPresenceCacheRef.current = {
            canvas: layerMask as HTMLCanvasElement | OffscreenCanvas,
            hasAlpha: true,
            sampledAt: now
          };
        }
      }
    } finally {
      canvasPool.release(tempCanvas);
    }
  }, [activeLayerTransparencyLock, getActiveLayerBitmapCanvas, layerHasAnyAlpha]);
  
  // Cache for brush stamps
  const brushStampCacheRef = useRef(new Map<string, HTMLCanvasElement>());
  const patternTempCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const rotationTempCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const brushSizePendingRef = useRef(Math.max(1, Math.round(tools.brushSettings.size || 1)));
  const brushPressurePendingRef = useRef(normalizePressureSettings(tools.brushSettings));
  type StrokePressureState = {
    min: number;
    max: number;
    lastNonZero: number;
    last: number;
    stable: number;   // latched pressure during tail to prevent collapse
    isTail: boolean;  // legacy; kept for compatibility but unused in ratchet logic
    lastTime: number;
    sampleCount: number;
  };
  const strokePressureRef = useRef<StrokePressureState>({
    min: 1,
    max: 0,
    lastNonZero: 0,
    last: 0,
    stable: 0,
    isTail: false,
    lastTime: 0,
    sampleCount: 0
  });
  const strokePressureResStateRef = useRef<PressureResolutionState>(createPressureResolutionState(1));
  // Pressure ratchet: limit decay by elapsed time so fast lift-offs keep peak resolution.
  const MAX_PRESSURE_DECAY_PER_MS = 0.003;
  const MIN_DROP_PER_EVENT = 0.01;
  const INSTANT_PRESSURE_SAMPLE_WINDOW = 5;
  const lastPressureDitherTimeRef = useRef(0);
  const lastPressureDitherPixelSizeRef = useRef<number | null>(null);
  const committedPixelSizeRef = useRef<number | null>(null);
  const pendingPixelSizeRef = useRef<number | null>(null);
  const pendingSinceRef = useRef(0);
  const PRESSURE_DITHER_MIN_INTERVAL_MS = 30; // ~33 FPS throttle
  const PRESSURE_DITHER_MIN_DELTA_RES = 0.75; // px; revert to previous threshold
  const brushSizeDeferredHandleRef = useRef<IdleHandle>(null);

  // Get color cycle brush from active layer instead of single instance
  const getActiveLayerColorCycleBrush = useCallback((): ColorCycleBrushImplementation | null => {
    if (!activeLayerId) return null;
    return useAppStore.getState().getLayerColorCycleBrush(activeLayerId);
  }, [activeLayerId]);

  const applyPendingBrushSizing = useCallback(() => {
    const colorCycleBrush = getActiveLayerColorCycleBrush();
    if (!colorCycleBrush) {
      return;
    }
    const pressure = brushPressurePendingRef.current;
    try {
      colorCycleBrush.setBrushSize(brushSizePendingRef.current);
      colorCycleBrush.setPressureEnabled(pressure.enabled);
      colorCycleBrush.setMinPressure(pressure.min);
      colorCycleBrush.setMaxPressure(pressure.max);
    } catch (error) {
      console.error('[CC Effect] Failed to sync pressure settings:', error);
    }
  }, [getActiveLayerColorCycleBrush]);
  
  // Performance: Cache expensive computations
  const isPixelBrush = useMemo(() =>
    tools.brushSettings.brushShape === BrushShape.PIXEL_ROUND ||
    tools.brushSettings.brushShape === BrushShape.PIXEL_DITHER ||
    (tools.brushSettings.brushShape === BrushShape.SQUARE &&
     !tools.brushSettings.antialiasing),
    [tools.brushSettings.brushShape, tools.brushSettings.antialiasing]
  );
  
  // Pattern temp context getter - also returns the canvas
  const getPatternTempContext = useCallback((width: number, height: number) => {
    if (!patternTempCanvasRef.current) {
      patternTempCanvasRef.current = document.createElement('canvas');
    }
    
    const canvas = patternTempCanvasRef.current;
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    
    const ctx = canvas.getContext('2d');
    // Store canvas on context for easy access
    if (ctx) {
      const contextWithCanvas = ctx as CanvasRenderingContext2D & { _canvas?: HTMLCanvasElement };
      contextWithCanvas._canvas = canvas;
    }
    return ctx;
  }, []);

  // Rotation temp context getter for pixel-perfect rotation
  const getRotationTempContext = useCallback((width: number, height: number) => {
    if (!rotationTempCanvasRef.current) {
      rotationTempCanvasRef.current = document.createElement('canvas');
    }
    
    const canvas = rotationTempCanvasRef.current;
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    
    return canvas.getContext('2d');
  }, []);

  // Create pixel square stamp for non-antialiased squares
  const createPixelSquareStamp = useCallback((size: number) => {
    const cacheKey = `pixel_square_${size}`;
    let stamp = brushStampCacheRef.current.get(cacheKey);
    
    if (!stamp) {
      stamp = document.createElement('canvas');
      stamp.width = size;
      stamp.height = size;
      const ctx = stamp.getContext('2d', { colorSpace: 'srgb' });
      
      if (ctx) {
        ctx.imageSmoothingEnabled = false;
        ctx.fillStyle = 'white';
        ctx.fillRect(0, 0, size, size);
      }
      
      brushStampCacheRef.current.set(cacheKey, stamp);
    }
    
    return stamp;
  }, []);
  
  // Create pixel circle stamp (matching monolithic implementation exactly)
  
  const createPixelCircleStamp = useCallback((size: number) => {
    const cacheKey = `pixel_circle_${size}`;
    let stamp = brushStampCacheRef.current.get(cacheKey);
    
    if (!stamp) {
      // Define hardcoded patterns for small sizes (1-8) - EXACT COPY from monolithic
      const patterns: Record<number, Array<{x: number, y: number}>> = {
        1: [{x: 0, y: 0}],
        2: [{x: 0, y: 0}, {x: 1, y: 0}, {x: 0, y: 1}, {x: 1, y: 1}],
        3: [{x: 0, y: 1}, {x: 1, y: 0}, {x: 1, y: 1}, {x: 1, y: 2}, {x: 2, y: 1}],
        4: [
          {x: 0, y: 1}, {x: 0, y: 2},
          {x: 1, y: 0}, {x: 1, y: 1}, {x: 1, y: 2}, {x: 1, y: 3},
          {x: 2, y: 0}, {x: 2, y: 1}, {x: 2, y: 2}, {x: 2, y: 3},
          {x: 3, y: 1}, {x: 3, y: 2}
        ],
        5: [
          {x: 0, y: 2},
          {x: 1, y: 1}, {x: 1, y: 2}, {x: 1, y: 3},
          {x: 2, y: 0}, {x: 2, y: 1}, {x: 2, y: 2}, {x: 2, y: 3}, {x: 2, y: 4},
          {x: 3, y: 1}, {x: 3, y: 2}, {x: 3, y: 3},
          {x: 4, y: 2}
        ],
        6: [
          {x: 0, y: 2}, {x: 0, y: 3},
          {x: 1, y: 1}, {x: 1, y: 2}, {x: 1, y: 3}, {x: 1, y: 4},
          {x: 2, y: 0}, {x: 2, y: 1}, {x: 2, y: 2}, {x: 2, y: 3}, {x: 2, y: 4}, {x: 2, y: 5},
          {x: 3, y: 0}, {x: 3, y: 1}, {x: 3, y: 2}, {x: 3, y: 3}, {x: 3, y: 4}, {x: 3, y: 5},
          {x: 4, y: 1}, {x: 4, y: 2}, {x: 4, y: 3}, {x: 4, y: 4},
          {x: 5, y: 2}, {x: 5, y: 3}
        ],
        7: [
          {x: 0, y: 2}, {x: 0, y: 3}, {x: 0, y: 4},
          {x: 1, y: 1}, {x: 1, y: 2}, {x: 1, y: 3}, {x: 1, y: 4}, {x: 1, y: 5},
          {x: 2, y: 0}, {x: 2, y: 1}, {x: 2, y: 2}, {x: 2, y: 3}, {x: 2, y: 4}, {x: 2, y: 5}, {x: 2, y: 6},
          {x: 3, y: 0}, {x: 3, y: 1}, {x: 3, y: 2}, {x: 3, y: 3}, {x: 3, y: 4}, {x: 3, y: 5}, {x: 3, y: 6},
          {x: 4, y: 0}, {x: 4, y: 1}, {x: 4, y: 2}, {x: 4, y: 3}, {x: 4, y: 4}, {x: 4, y: 5}, {x: 4, y: 6},
          {x: 5, y: 1}, {x: 5, y: 2}, {x: 5, y: 3}, {x: 5, y: 4}, {x: 5, y: 5},
          {x: 6, y: 2}, {x: 6, y: 3}, {x: 6, y: 4}
        ],
        8: [
          {x: 0, y: 2}, {x: 0, y: 3}, {x: 0, y: 4}, {x: 0, y: 5},
          {x: 1, y: 1}, {x: 1, y: 2}, {x: 1, y: 3}, {x: 1, y: 4}, {x: 1, y: 5}, {x: 1, y: 6},
          {x: 2, y: 0}, {x: 2, y: 1}, {x: 2, y: 2}, {x: 2, y: 3}, {x: 2, y: 4}, {x: 2, y: 5}, {x: 2, y: 6}, {x: 2, y: 7},
          {x: 3, y: 0}, {x: 3, y: 1}, {x: 3, y: 2}, {x: 3, y: 3}, {x: 3, y: 4}, {x: 3, y: 5}, {x: 3, y: 6}, {x: 3, y: 7},
          {x: 4, y: 0}, {x: 4, y: 1}, {x: 4, y: 2}, {x: 4, y: 3}, {x: 4, y: 4}, {x: 4, y: 5}, {x: 4, y: 6}, {x: 4, y: 7},
          {x: 5, y: 0}, {x: 5, y: 1}, {x: 5, y: 2}, {x: 5, y: 3}, {x: 5, y: 4}, {x: 5, y: 5}, {x: 5, y: 6}, {x: 5, y: 7},
          {x: 6, y: 1}, {x: 6, y: 2}, {x: 6, y: 3}, {x: 6, y: 4}, {x: 6, y: 5}, {x: 6, y: 6},
          {x: 7, y: 2}, {x: 7, y: 3}, {x: 7, y: 4}, {x: 7, y: 5}
        ]
      };

      let pixels: Array<{x: number, y: number}>;

      if (patterns[size]) {
        pixels = patterns[size];
      } else {
        // Fallback to calculated circle for larger sizes (EXACT MATCH to monolithic)
        pixels = [];
        const radius = size / 2;
        const centerX = radius - 0.5;
        const centerY = radius - 0.5;
        
        for (let y = 0; y < size; y++) {
          for (let x = 0; x < size; x++) {
            const dx = x - centerX;
            const dy = y - centerY;
            if (dx * dx + dy * dy <= radius * radius) {
              pixels.push({x, y});
            }
          }
        }
      }

      // Create an offscreen canvas for the stamp - match monolithic implementation exactly
      stamp = document.createElement('canvas');
      stamp.width = size;
      stamp.height = size;
      const ctx = stamp.getContext('2d', { colorSpace: 'srgb' });
      
      if (ctx) {
        // Ensure pixel-perfect rendering from the start
        ctx.imageSmoothingEnabled = false;
        
        // Clear canvas first (defensive programming)
        ctx.clearRect(0, 0, size, size);
        
        // Draw the pixel pattern in white (color will be applied during drawing)
        ctx.fillStyle = 'white';
        pixels.forEach(pixel => {
          ctx.fillRect(pixel.x, pixel.y, 1, 1);
        });
      }
      
      brushStampCacheRef.current.set(cacheKey, stamp);
    }
    
    return stamp;
  }, []);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.transparencyLockEnabled = activeLayerTransparencyLock;
    }
  }, [activeLayerTransparencyLock]);

  const estimateStrokeBounds = useCallback((
    from: { x: number; y: number },
    to: { x: number; y: number },
    pressure: number = 1,
    customBrushData?: {
      width?: number;
      height?: number;
      isResampler?: boolean;
    }
  ): Rect => {
    const brushSettings = tools.brushSettings;
    const brushSize = Math.max(brushSettings.size || 1, 1);
    const pressureFactor = Number.isFinite(pressure) ? Math.max(pressure, 1) : 1;
    let effectiveSize = brushSize * pressureFactor;

    if (customBrushData) {
      const maxDimension = Math.max(customBrushData.width || 0, customBrushData.height || 0);
      if (maxDimension > 0) {
        const stampSize = customBrushData.isResampler
          ? brushSize * pressureFactor
          : Math.max(1, (brushSize / 100) * maxDimension * pressureFactor);
        effectiveSize = Math.max(effectiveSize, stampSize);
      }
    }

    if (
      brushSettings.brushShape === BrushShape.PIXEL_DITHER &&
      brushSettings.ditherStrokeTipShape === 'diamond'
    ) {
      effectiveSize *= Math.SQRT2;
    }

    const spacing = brushSettings.spacing || 0;
    const halfExtent = Math.max(1, effectiveSize * 0.5);
    const safetyMargin = Math.max(halfExtent, spacing * 0.5, 32);
    const padding = halfExtent + safetyMargin;

    const minX = Math.min(from.x, to.x);
    const minY = Math.min(from.y, to.y);
    const width = Math.abs(to.x - from.x);
    const height = Math.abs(to.y - from.y);

    return inflateRect(
      {
        x: minX,
        y: minY,
        width,
        height
      },
      padding
    );
  }, [tools.brushSettings]);

  // Create brush engine facade - only recreate when structural dependencies change
  const brushEngine = useMemo(() => {
    const config: BrushEngineConfig = {
      brushSettings: tools.brushSettings,
      transparencyLockEnabled: Boolean(activeLayerTransparencyLock),
      getPatternTempContext,
      brushStampCache: brushStampCacheRef.current,
      createPixelCircleStamp,
      createPixelSquareStamp,
      getRotationTempContext,
      customBrushes: project?.customBrushes || []
    };
    
    return createBrushEngineFacade(config);
  }, [tools.brushSettings, project?.customBrushes, getPatternTempContext, createPixelCircleStamp, createPixelSquareStamp, getRotationTempContext, activeLayerTransparencyLock]);

  // Update engine config when settings change
  useEffect(() => {
    brushEngine.updateConfig({
      brushSettings: tools.brushSettings,
      transparencyLockEnabled: Boolean(activeLayerTransparencyLock),
      getPatternTempContext,
      brushStampCache: brushStampCacheRef.current,
      getRotationTempContext
    });

    // Initialize spam text when the Spam Text brush is selected
    if (tools.brushSettings.brushShape === BrushShape.SPAM_TEXT) {
      const contentType = tools.brushSettings.spamContentType || 'mixed';
      const customText = tools.brushSettings.spamCustomText;
      brushEngine.initializeSpamText(contentType, customText);
    }
  }, [brushEngine, tools.brushSettings, getPatternTempContext, getRotationTempContext, activeLayerTransparencyLock]);

  const shouldApplyStrokeDither = useMemo(() => {
    const shape = tools.brushSettings.brushShape;
    if (isColorCycleBrush(shape)) {
      return false;
    }
    if (
      shape === BrushShape.RECTANGLE_GRADIENT ||
      shape === BrushShape.POLYGON_GRADIENT ||
      shape === BrushShape.SHAPE_FILL
    ) {
      return false;
    }
    return Boolean(tools.brushSettings.ditherEnabled);
  }, [tools.brushSettings.brushShape, tools.brushSettings.ditherEnabled]);

  const strokeDitherPalette = useMemo(() => {
    const basePalette = buildDitherPalette(
      tools.brushSettings.color || '#000',
      tools.brushSettings.ditherPaletteSpread ?? 0
    );

    // For BG-fill-off, force a 2-ink palette (darkest + lightest) so one ink always becomes transparent
    if (tools.brushSettings.ditherBackgroundFill === false && basePalette.length >= 2) {
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
      return [darkest, lightest];
    }

    return basePalette;
  }, [tools.brushSettings.color, tools.brushSettings.ditherPaletteSpread, tools.brushSettings.ditherBackgroundFill]);

  // Pick a single palette entry to represent "off"/transparent ink: choose the darkest ink for stability
  const transparentInk = useMemo(() => {
    const palette = strokeDitherPalette;
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
  }, [strokeDitherPalette]);

  const currentBrushPreset = useAppStore((state) => state.currentBrushPreset);
  const isDitherPreset = useMemo(() => {
    const id = currentBrushPreset?.id;
    if (!id) return false;
    return id === 'pixel-dither' || id === 'polygon-dither' || id === 'shape-dither';
  }, [currentBrushPreset]);
  const isDitherStrokeBrush = tools.brushSettings.brushShape === BrushShape.PIXEL_DITHER;

  const isPixelDitherNoBg = useMemo(() => {
    return (
      isDitherPreset &&
      shouldApplyStrokeDither &&
      tools.brushSettings.ditherBackgroundFill === false
    );
  }, [isDitherPreset, shouldApplyStrokeDither, tools.brushSettings.ditherBackgroundFill]);

  const computePressureScaledResolution = useCallback((pressure: number) => {
    return computePressureResolution(
      tools.brushSettings.fillResolution || 1,
      pressure,
      tools.brushSettings.pressureLinkedFillResolution ?? false,
      strokePressureResStateRef.current,
      undefined,
      PRESSURE_RESOLUTION_MAX_PX
    );
  }, [tools.brushSettings.fillResolution, tools.brushSettings.pressureLinkedFillResolution]);

  const getStrokeDitherPixelSize = useCallback(() => {
    const stats = strokePressureRef.current;
    // Use latched stable pressure so lift-off doesn't collapse to 1px
    let p = stats.stable;
    if (typeof p !== 'number' || p === 0) {
      p = stats.max || stats.last || 0.5;
    }
    p = Math.max(0, Math.min(1, p));
    const size = computePressureScaledResolution(p);
    return size;
  }, [computePressureScaledResolution]);

  // Erode stroke alpha before dithering to keep the pattern intact.
  const applyLostEdgeToStrokeAlpha = useCallback((
    data: Uint8ClampedArray,
    width: number,
    height: number,
    lostEdgePercent?: number
  ) => {
    const p = lostEdgePercent ?? 0;
    if (!p || p <= 0) return;

    const clamped = Math.max(0, Math.min(100, p));
    const totalPixels = width * height;
    if (!totalPixels) return;

    const coverage = new Uint8Array(totalPixels);
    // Build coverage purely from stroke alpha
    for (let i = 3, idx = 0; i < data.length; i += 4, idx++) {
      coverage[idx] = data[i];
    }

    let mask: Uint8ClampedArray;
    try {
      mask = applySierraLiteLostEdgeMask(coverage, width, height, clamped);
    } catch (error) {
      console.warn('[Dither] Lost-edge mask failed (pre-dither):', error);
      return;
    }

    // Modulate the stroke alpha by the mask; leave RGB alone.
    for (let i = 3, idx = 0; i < data.length; i += 4, idx++) {
      const mv = mask[idx];
      data[i] = Math.round(data[i] * (mv / 255));
    }
  }, []);

  const applyLostEdgeMaskInRegion = useCallback((
    ctx: CanvasRenderingContext2D,
    region: Rect | null,
    lostEdgePercent?: number
  ) => {
    const p = lostEdgePercent ?? 0;
    if (!ctx || !region || p <= 0) return;

    const canvasWidth = ctx.canvas?.width ?? 0;
    const canvasHeight = ctx.canvas?.height ?? 0;
    const x = Math.max(0, Math.floor(region.x));
    const y = Math.max(0, Math.floor(region.y));
    const w = Math.max(1, Math.min(canvasWidth - x, Math.ceil(region.width)));
    const h = Math.max(1, Math.min(canvasHeight - y, Math.ceil(region.height)));
    if (w <= 0 || h <= 0) return;

    let image: ImageData;
    try {
      image = ctx.getImageData(x, y, w, h);
    } catch {
      return;
    }

    applyLostEdgeToStrokeAlpha(image.data, w, h, p);

    try {
      ctx.putImageData(image, x, y);
    } catch {
      // best effort; ignore failures to keep stroke alive
    }
  }, [applyLostEdgeToStrokeAlpha]);

  const ditherRegionWithCurrentPressure = useCallback((
    ctx: CanvasRenderingContext2D,
    region: { x: number; y: number; width: number; height: number },
    sampleCtx?: CanvasRenderingContext2D,
    options?: {
      mergeExisting?: boolean;
      overridePressure?: number;
      overridePixelSize?: number;
      bgOffMode?: 'direct' | 'accumulate';
      bgOffComposite?: 'copy' | 'source-over';
    }
  ) => {
    const overridePressure = options?.overridePressure;
    const overridePixelSize = options?.overridePixelSize;
    // For shape-mode dither presets we need to respect the BG Fill toggle just like strokes
    const fillBackground = tools.brushSettings.ditherBackgroundFill !== false;
    const bgOffMode = options?.bgOffMode ?? 'accumulate';
    const bgOffComposite = options?.bgOffComposite ?? 'source-over';
    const [bgR, bgG, bgB] = (() => {
      const candidate =
        strokeDitherPalette[1] ??
        strokeDitherPalette[0] ??
        tools.brushSettings.color ??
        '#000';
      const [r, g, b] = parseColor(candidate);
      return [r, g, b] as [number, number, number];
    })();
    const [offR, offG, offB] = transparentInk;

    const { x, y, width, height } = region;
    if (width <= 0 || height <= 0) return;

    let src: ImageData;
    try {
      const sourceCtx = sampleCtx ?? ctx;
      src = sourceCtx.getImageData(x, y, width, height);
    } catch (err) {
      console.warn('[Dither] Failed to sample region for pressure dither:', err);
      return;
    }

    // Decide whether we’re in pressure-linked mode
    const pressureMode = !!tools.brushSettings.pressureLinkedFillResolution || overridePressure != null || overridePixelSize != null;

    // Algorithm/pattern always come from the dropdown
    const algorithm = tools.brushSettings.ditherAlgorithm || 'sierra-lite';
    const patternStyle = tools.brushSettings.patternStyle || 'dots';

    // Base pixel size from slider
    const baseFillRes = Math.max(1, Math.round(tools.brushSettings.fillResolution || 1));

    // Pressure-resolved pixel size (hard override takes precedence)
    const resolvedOverridePixelSize = overridePixelSize != null
      ? Math.max(1, Math.round(overridePixelSize))
      : null;

    const pressureFillRes = resolvedOverridePixelSize ?? Math.max(
      1,
      overridePressure != null
        ? computePressureScaledResolution(Math.max(0, Math.min(1, overridePressure)))
        : getStrokeDitherPixelSize() | 0
    );

    // Shape dither should still respond to pressure when enabled via the toggle
    const pixelSize = resolvedOverridePixelSize
      ?? (pressureMode ? pressureFillRes : baseFillRes);

    DD('pixel-size', {
      overridePixelSize,
      resolvedOverridePixelSize,
      overridePressure,
      settingsFillRes: tools.brushSettings.fillResolution,
      pressureLinkedFillResolution: tools.brushSettings.pressureLinkedFillResolution,
      baseFillRes,
      pressureFillRes,
      pixelSizeBeforeClamp: pixelSize
    });

    DD('region-enter', {
      fillBackground,
      algorithm,
      patternStyle,
      region: { x, y, width, height },
      pixelSize
    });

    // Erode stroke coverage before dithering so the pattern stays clean.
    if (tools.brushSettings.lostEdge && tools.brushSettings.lostEdge > 0) {
      applyLostEdgeToStrokeAlpha(
        src.data,
        width,
        height,
        tools.brushSettings.lostEdge
      );
    }

    // Use the shared dithering helpers for ALL algorithms.
    const phaseOffset = !fillBackground
      ? (strokePhaseOriginRef.current ?? { x: 0, y: 0 })
      : undefined;

    const dithered = pixelSize > 1
      ? applyDitheringWithFillResolution(
          src,
          strokeDitherPalette.length,
          pixelSize,
          algorithm,
          patternStyle,
          strokeDitherPalette,
          phaseOffset
        )
      : applyDitheringImport(
          src,
          strokeDitherPalette.length,
          algorithm,
          patternStyle,
          strokeDitherPalette,
          phaseOffset
        );

    const data = dithered.data;
    const srcData = src.data;
    const canvasW = ctx.canvas?.width ?? 0;
    const canvasH = ctx.canvas?.height ?? 0;

    const isOffColor = (idx: number) =>
      data[idx] === offR &&
      data[idx + 1] === offG &&
      data[idx + 2] === offB;

    if (fillBackground) {
      // First pass: default alpha = source alpha so fresh strokes are visible
      for (let i = 0; i < data.length; i += 4) {
        data[i + 3] = srcData[i + 3];
      }
      // Classic “fill background” behaviour
      for (let i = 0; i < data.length; i += 4) {
        const alpha = data[i + 3];
        if (alpha === 0 && srcData[i + 3] !== 0) {
          data[i] = bgR;
          data[i + 1] = bgG;
          data[i + 2] = bgB;
          data[i + 3] = srcData[i + 3];
        }
      }
    } else {
      const temp = ensureBgOffTemp(width, height);
      const hole = bgOffMode === 'accumulate' ? ensureBgOffHole(canvasW, canvasH) : null;
      if (!temp || (bgOffMode === 'accumulate' && !hole)) {
        ctx.putImageData(dithered, x, y);
        return;
      }

      let maskImage = bgOffMaskImageRef.current;
      if (!maskImage || maskImage.width !== width || maskImage.height !== height) {
        maskImage = new ImageData(width, height);
        bgOffMaskImageRef.current = maskImage;
      }
      const maskData = maskImage.data;

      for (let i = 0; i < data.length; i += 4) {
        const srcA = srcData[i + 3];
        if (srcA === 0) {
          data[i + 3] = 0;
          maskData[i + 3] = 0;
        } else {
          const off = isOffColor(i);
          if (off) {
            data[i + 3] = 0;
            maskData[i + 3] = srcA;
          } else {
            data[i + 3] = srcA;
            maskData[i + 3] = 0;
          }
        }

        maskData[i] = 0;
        maskData[i + 1] = 0;
        maskData[i + 2] = 0;
      }

      temp.ctx.setTransform(1, 0, 0, 1, 0, 0);
      temp.ctx.clearRect(0, 0, width, height);
      temp.ctx.putImageData(maskImage, 0, 0);

      if (bgOffMode === 'accumulate' && hole) {
        hole.ctx.save();
        hole.ctx.globalCompositeOperation = 'source-over';
        hole.ctx.drawImage(temp.canvas, x, y);
        hole.ctx.restore();
      }

      temp.ctx.setTransform(1, 0, 0, 1, 0, 0);
      temp.ctx.clearRect(0, 0, width, height);
      temp.ctx.putImageData(dithered, 0, 0);

      ctx.save();
      ctx.globalCompositeOperation = bgOffMode === 'direct' ? bgOffComposite : 'source-over';
      ctx.drawImage(temp.canvas, x, y);
      ctx.restore();

      ctx.save();
      ctx.globalCompositeOperation = 'destination-out';
      if (bgOffMode === 'accumulate' && hole) {
        ctx.drawImage(hole.canvas, x, y, width, height, x, y, width, height);
      } else {
        temp.ctx.setTransform(1, 0, 0, 1, 0, 0);
        temp.ctx.clearRect(0, 0, width, height);
        temp.ctx.putImageData(maskImage, 0, 0);
        ctx.drawImage(temp.canvas, x, y);
      }
      ctx.restore();
      return;
    }

    DD('pixel-size-final', {
      finalPixelSize: pixelSize
    });

    const prev = ctx.imageSmoothingEnabled;
    ctx.imageSmoothingEnabled = false;
    try {
      ctx.putImageData(dithered, x, y);
    } catch (err) {
      console.warn('[Dither] Failed to write dithered region:', err);
    } finally {
      ctx.imageSmoothingEnabled = prev;
    }
  }, [
    applyLostEdgeToStrokeAlpha,
    computePressureScaledResolution,
    getStrokeDitherPixelSize,
    tools.brushSettings.color,
    tools.brushSettings.pressureLinkedFillResolution,
    tools.brushSettings.fillResolution,
    tools.brushSettings.ditherAlgorithm,
    tools.brushSettings.patternStyle,
    tools.brushSettings.lostEdge,
    tools.brushSettings.ditherBackgroundFill,
    transparentInk,
    strokeDitherPalette,
    ensureBgOffHole,
    ensureBgOffTemp
  ]);

  const applyStrokeDither = useCallback((
    ctx: CanvasRenderingContext2D,
    bounds: Rect | null,
    sampleCtx?: CanvasRenderingContext2D,
    options?: {
      mergeExisting?: boolean;
      overridePressure?: number;
      overridePixelSize?: number;
      bgOffMode?: 'direct' | 'accumulate';
      bgOffComposite?: 'copy' | 'source-over';
    }
  ) => {
    if (!shouldApplyStrokeDither || !ctx || !bounds) return;
    const { width: canvasWidth = 0, height: canvasHeight = 0 } = ctx.canvas || {};
    const region = normalizeRectForCanvas(bounds, canvasWidth, canvasHeight);
    ditherRegionWithCurrentPressure(ctx, region, sampleCtx, options);
  }, [ditherRegionWithCurrentPressure, shouldApplyStrokeDither]);

  const applyStrokeRisographOverlay = useCallback((ctx: CanvasRenderingContext2D, bounds: Rect | null, source?: HTMLCanvasElement | null) => {
    const intensity = tools.brushSettings.risographIntensity || 0;
    if (!bounds || !ctx || intensity <= 0) {
      return;
    }
    const { x, y, width, height } = bounds;
    const prevOp = ctx.globalCompositeOperation;
    const prevAlpha = ctx.globalAlpha;
    try {
      ctx.globalCompositeOperation = 'multiply';
      ctx.globalAlpha = Math.min(1, Math.max(0, intensity / 100));
      if (source) {
        ctx.drawImage(source, x, y, width, height, x, y, width, height);
      }
    } catch {
      // best-effort overlay; ignore failures
    } finally {
      ctx.globalCompositeOperation = prevOp;
      ctx.globalAlpha = prevAlpha;
    }
  }, [tools.brushSettings.risographIntensity]);

  const renderLiveStrokePreview = useCallback((visibleCtx: CanvasRenderingContext2D) => {
    liveRenderScheduledRef.current = false;

    const rawCanvas = liveStrokeRawRef.current;
    const ditherCanvas = liveStrokeDitherRef.current;
    const strokeBounds = liveStrokeBoundsRef.current ?? strokeBoundsRef.current;
    if (!rawCanvas || !strokeBounds) {
      return;
    }

    const canvasWidth = visibleCtx.canvas?.width ?? 0;
    const canvasHeight = visibleCtx.canvas?.height ?? 0;
    const region = normalizeRectForCanvas(strokeBounds, canvasWidth, canvasHeight);
    const { x, y, width, height } = region;
    if (width <= 0 || height <= 0) {
      return;
    }

    const rawCtx = pick2DRead(rawCanvas) as CanvasRenderingContext2D | null;
    if (!rawCtx) {
      return;
    }

    // Pressure-linked path: only blit the newly dithered region; do NOT re-dither old stamps.
    if (
      shouldApplyStrokeDither &&
      tools.brushSettings.pressureLinkedFillResolution &&
      ditherCanvas
    ) {
      const regionToBlit = liveDirtyRectRef.current ?? strokeBounds;
      liveDirtyRectRef.current = null;
      if (regionToBlit) {
        const dCtx = pick2D(ditherCanvas) as CanvasRenderingContext2D | null;
        if (dCtx) {
          const { x: bx, y: by, width: bw, height: bh } = normalizeRectForCanvas(
            regionToBlit,
            dCtx.canvas?.width ?? 0,
            dCtx.canvas?.height ?? 0
          );
          if (isDitherStrokeBrush && tools.brushSettings.ditherBackgroundFill === false) {
            visibleCtx.clearRect(bx, by, bw, bh);
          }
          const ditherSource = ditherCanvas instanceof HTMLCanvasElement ? ditherCanvas : null;
          if (isPixelDitherNoBg) {
            visibleCtx.drawImage(
              ditherCanvas as CanvasImageSource,
              bx, by, bw, bh,
              bx, by, bw, bh
            );
          } else {
            withAlphaLock(visibleCtx, (targetCtx) => {
              targetCtx.drawImage(ditherCanvas as CanvasImageSource, bx, by, bw, bh, bx, by, bw, bh);
            }, strokeBounds);
          }
          applyStrokeRisographOverlay(visibleCtx, strokeBounds, ditherSource);
        }
      }
      return;
    }

    if (shouldApplyStrokeDither && ditherCanvas) {
      const dCtx = pick2D(ditherCanvas) as CanvasRenderingContext2D | null;
      if (dCtx) {
        const fullDirty = liveDirtyRectRef.current ?? strokeBounds;
        liveDirtyRectRef.current = null;

        const ditherRegion = fullDirty;

        const { x: dx, y: dy, width: dw, height: dh } = normalizeRectForCanvas(
          ditherRegion,
          dCtx.canvas?.width ?? 0,
          dCtx.canvas?.height ?? 0
        );

        if (tools.brushSettings.ditherBackgroundFill !== false) {
          // BG fill on: redraw raw patch then dither full dirty rect
          dCtx.drawImage(rawCanvas as CanvasImageSource, dx, dy, dw, dh, dx, dy, dw, dh);
          applyStrokeDither(dCtx, ditherRegion, rawCtx);
        } else {
          // BG fill off: re-dither the full dirty rect to avoid stamp seams
          applyStrokeDither(dCtx, ditherRegion, rawCtx, { mergeExisting: false });
        }

        const blitRect = normalizeRectForCanvas(
          fullDirty,
          dCtx.canvas?.width ?? 0,
          dCtx.canvas?.height ?? 0
        );

        const ditherSource = ditherCanvas instanceof HTMLCanvasElement ? ditherCanvas : null;
        if (isPixelDitherNoBg) {
          visibleCtx.drawImage(
            ditherCanvas as CanvasImageSource,
            blitRect.x, blitRect.y, blitRect.width, blitRect.height,
            blitRect.x, blitRect.y, blitRect.width, blitRect.height
          );
        } else {
          withAlphaLock(visibleCtx, (targetCtx) => {
            targetCtx.drawImage(
              ditherCanvas as CanvasImageSource,
              blitRect.x, blitRect.y, blitRect.width, blitRect.height,
              blitRect.x, blitRect.y, blitRect.width, blitRect.height
            );
          }, fullDirty);
        }
        applyStrokeRisographOverlay(visibleCtx, fullDirty, ditherSource ?? (rawCanvas instanceof HTMLCanvasElement ? rawCanvas : null));
        return;
      }
    }

    const rawSource = rawCanvas instanceof HTMLCanvasElement ? rawCanvas : null;
    if (isPixelDitherNoBg) {
      visibleCtx.drawImage(rawCanvas as CanvasImageSource, x, y, width, height, x, y, width, height);
    } else {
      withAlphaLock(visibleCtx, (targetCtx) => {
        targetCtx.drawImage(rawCanvas as CanvasImageSource, x, y, width, height, x, y, width, height);
      }, strokeBounds);
    }
    applyStrokeRisographOverlay(visibleCtx, strokeBounds, rawSource);
  }, [
    applyStrokeDither,
    applyStrokeRisographOverlay,
    isPixelDitherNoBg,
    isDitherStrokeBrush,
    shouldApplyStrokeDither,
    tools.brushSettings.ditherBackgroundFill,
    tools.brushSettings.pressureLinkedFillResolution,
    withAlphaLock
  ]);

  const scheduleLiveStrokeRender = useCallback((visibleCtx: CanvasRenderingContext2D) => {
    if (liveRenderScheduledRef.current) {
      return;
    }
    liveRenderScheduledRef.current = true;
    const cb = () => renderLiveStrokePreview(visibleCtx);
    if (typeof requestAnimationFrame !== 'undefined') {
      requestAnimationFrame(cb);
    } else {
      setTimeout(cb, 16);
    }
  }, [renderLiveStrokePreview]);

  const resetPressureDitherState = useCallback(() => {
    strokePressureRef.current = {
      min: 1,
      max: 0,
      lastNonZero: 0,
      last: 0,
      stable: 0,
      isTail: false,
      lastTime: 0,
      sampleCount: 0
    };
    lastPressureDitherTimeRef.current = 0;
    lastPressureDitherPixelSizeRef.current = null;
    committedPixelSizeRef.current = null;
    pendingPixelSizeRef.current = null;
    pendingSinceRef.current = 0;
    strokePressureResStateRef.current = createPressureResolutionState(1);
    clearBgOffHoleCanvas();
  }, [clearBgOffHoleCanvas]);

  /**
   * Main drawing function - simplified interface
   */
  const drawBrush = useCallback((
    ctx: CanvasRenderingContext2D,
    from: { x: number; y: number },
    to: { x: number; y: number },
    cursor: { 
      pressure?: number;
      customBrushData?: { 
        imageData: ImageData; 
        width: number; 
        height: number; 
        isColorizable?: boolean 
      } 
    } = {}
  ) => {
    // New stroke: if no bounds yet, clear cached pressure/dither state to avoid inheriting stale resolution
    if (!strokeBoundsRef.current) {
      resetPressureDitherState();
      strokePhaseOriginRef.current = { x: Math.floor(to.x), y: Math.floor(to.y) };
    }

    // High-res timestamp minimizes zero-delta frames (batched pointer events)
    const nowHighRes = typeof performance !== 'undefined' ? performance.now() : Date.now();

    // Calculate velocity
    const distance = Math.sqrt(
      Math.pow(to.x - from.x, 2) + 
      Math.pow(to.y - from.y, 2)
    );
    const velocity = distance; // Simplified velocity calculation

    // Create stroke parameters
    const strokeParams: BrushStrokeParams = {
      from,
      to,
      pressure: cursor.pressure || 1.0,
      velocity,
      timestamp: Date.now(),
      customBrushData: cursor.customBrushData
    };
    const rawPressure = strokeParams.pressure ?? 0;
    const p = Math.max(0, Math.min(1, rawPressure));

    const stats = strokePressureRef.current;
    // Time-based ratchet: smooth input then allow only time-bounded (and minimum) decay.
    const alpha = 0.6;
    const smoothed = stats.last === 0 ? p : (stats.last + (p - stats.last) * alpha);

    const now = nowHighRes;
    if (stats.lastTime === 0) {
      stats.lastTime = now;
    }
    const elapsed = now - stats.lastTime;
    stats.lastTime = now;

    stats.sampleCount += 1;
    const isEarlySample = stats.sampleCount <= INSTANT_PRESSURE_SAMPLE_WINDOW;
    const isPenLift = p <= 0.02;

    if (isPenLift) {
      // Freeze stable on pen-lift; do not decay or collapse.
      // Keep last for debugging/analytics, but leave stable untouched.
    } else if (smoothed >= stats.stable || isEarlySample) {
      // Rising pressure or early samples settle immediately to avoid start-of-stroke lock.
      stats.stable = smoothed;
    } else {
      // Falling pressure: accelerate decay when intentionally light; always drop at least a small step.
      const isLowPressure = smoothed < 0.25;
      const decayMultiplier = isLowPressure ? 4.0 : 1.0;
      const timeDrop = Math.max(0, elapsed * MAX_PRESSURE_DECAY_PER_MS * decayMultiplier);
      const maxDrop = Math.max(timeDrop, MIN_DROP_PER_EVENT);
      stats.stable = Math.max(smoothed, stats.stable - maxDrop);
    }

    if (p > 0.01) {
      stats.min = Math.min(stats.min, p);
      stats.max = Math.max(stats.max, p);
      stats.lastNonZero = p;
      stats.last = p;
    } else {
      stats.last = p;
    }

    // Render the stroke
    if (typeof window !== 'undefined') {
      window.__AL_sample = { x: to.x, y: to.y, tag: 'drawBrush' };
    }
    if (!ensureLiveStrokeBuffers(ctx)) {
      return;
    }
    const rawCtx = pick2DRead(liveStrokeRawRef.current) as CanvasRenderingContext2D | null;
    if (!rawCtx) {
      return;
    }
    const segmentBounds = estimateStrokeBounds(
      from,
      to,
      strokeParams.pressure,
      cursor.customBrushData
    );
    strokeBoundsRef.current = mergeRectBounds(strokeBoundsRef.current, segmentBounds);
    liveStrokeBoundsRef.current = mergeRectBounds(liveStrokeBoundsRef.current, segmentBounds);
    lastSegmentBoundsRef.current = segmentBounds;
    // Track what changed since last preview frame.
    // Inflate to reduce diffusion edge seams.
    const pixelSizeForOverlap =
      tools.brushSettings.ditherBackgroundFill === false
        ? Math.max(1, Math.round(tools.brushSettings.fillResolution || 1))
        : Math.max(1, Math.round(tools.brushSettings.fillResolution || 1));

    const OVERLAP = Math.max(8, pixelSizeForOverlap * 2);
    const dirty = inflateRect(segmentBounds, OVERLAP);
    liveDirtyRectRef.current = mergeRectBounds(liveDirtyRectRef.current, dirty);

    // Let brush size respond to pressure even when PresRes is enabled
    const sizePressure = strokeParams.pressure ?? 1;
    const adjustedStrokeParams = { ...strokeParams, pressure: sizePressure };

    brushEngine.renderBrushStroke(rawCtx, adjustedStrokeParams);

    // Apply lost-edge fade even when dithering is disabled (stroke brushes)
    if (
      !shouldApplyStrokeDither &&
      tools.brushSettings.lostEdge &&
      tools.brushSettings.lostEdge > 0
    ) {
      const region = inflateRect(segmentBounds, 2);
      applyLostEdgeMaskInRegion(rawCtx, region, tools.brushSettings.lostEdge);
    }

    // Pressure-linked dither: re-dither the entire stroke so far, but throttled
    if (tools.brushSettings.pressureLinkedFillResolution && shouldApplyStrokeDither) {
      const ditherCtx = pick2D(liveStrokeDitherRef.current) as CanvasRenderingContext2D | null;
      const fullBounds = strokeBoundsRef.current ?? segmentBounds;
      const bgOff = tools.brushSettings.ditherBackgroundFill === false;

      if (ditherCtx && rawCtx && fullBounds) {
        const canvasW = ditherCtx.canvas?.width ?? 0;
        const canvasH = ditherCtx.canvas?.height ?? 0;
        const region = normalizeRectForCanvas(fullBounds, canvasW, canvasH);
        const { width, height } = region;

        if (width > 0 && height > 0) {
          const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
          const desiredPixelSize = Math.max(1, Math.round(getStrokeDitherPixelSize()));
          const committedPixelSize = committedPixelSizeRef.current ?? desiredPixelSize;
          if (desiredPixelSize !== committedPixelSize) {
            if (pendingPixelSizeRef.current !== desiredPixelSize) {
              pendingPixelSizeRef.current = desiredPixelSize;
              pendingSinceRef.current = now;
            }
            const STABLE_MS = 70;
            if (now - pendingSinceRef.current >= STABLE_MS) {
              committedPixelSizeRef.current = desiredPixelSize;
              pendingPixelSizeRef.current = null;
            }
          } else {
            pendingPixelSizeRef.current = null;
          }
          const activePixelSize = committedPixelSizeRef.current ?? desiredPixelSize;
          // Protect against re-dithering extremely large stroke regions, which
          // was causing a “wall” of lag mid-stroke when the bounding box grows
          // huge. Fall back to incremental dithering in that case.
          const PRESSURE_DITHER_AREA_LIMIT = 1_200_000; // ~1.2 MP
          const PRESSURE_DITHER_DIM_LIMIT = 2200; // guard single-axis runaway
          const regionArea = width * height;
          const regionTooBig =
            regionArea > PRESSURE_DITHER_AREA_LIMIT ||
            width > PRESSURE_DITHER_DIM_LIMIT ||
            height > PRESSURE_DITHER_DIM_LIMIT;

          if (regionTooBig) {
            // Only dither the latest segment instead of the whole stroke.
            const halo = Math.max(32, activePixelSize * 3);
            const fallbackRegion = inflateRect(segmentBounds, halo);
            const safeRegion = normalizeRectForCanvas(
              fallbackRegion,
              canvasW,
              canvasH
            );
            const { x: fx, y: fy, width: fw, height: fh } = safeRegion;
            if (fw > 0 && fh > 0) {
              if (!bgOff) {
                ditherCtx.clearRect(fx, fy, fw, fh);
              }
              ditherRegionWithCurrentPressure(ditherCtx, safeRegion, rawCtx, {
                overridePixelSize: activePixelSize,
                bgOffMode: bgOff ? 'direct' : undefined,
                bgOffComposite: bgOff ? 'copy' : undefined
              });
              liveStrokeBoundsRef.current = mergeRectBounds(liveStrokeBoundsRef.current, safeRegion);
              liveDirtyRectRef.current = mergeRectBounds(liveDirtyRectRef.current, safeRegion);
            }
          } else {
            const lastPixelSize = lastPressureDitherPixelSizeRef.current ?? activePixelSize;

            const minInterval = bgOff ? 55 : PRESSURE_DITHER_MIN_INTERVAL_MS;
            const minDeltaRes = bgOff ? 1.25 : PRESSURE_DITHER_MIN_DELTA_RES;

            const tooSoon =
              now - lastPressureDitherTimeRef.current < minInterval;
            const tinyDelta =
              Math.abs(activePixelSize - lastPixelSize) < minDeltaRes;

            const resolutionDecreased = activePixelSize < lastPixelSize;
            // Skip only when throttled AND change is tiny AND resolution did not get finer
            if (!(tooSoon && tinyDelta && !resolutionDecreased)) {
              lastPressureDitherTimeRef.current = now;
              const prevCommitted = lastPressureDitherPixelSizeRef.current ?? activePixelSize;
              const pixelSizeChanged = activePixelSize !== prevCommitted;
              lastPressureDitherPixelSizeRef.current = activePixelSize;

              const dirtyRegion = liveDirtyRectRef.current ?? region;
              const dirtySafe = normalizeRectForCanvas(dirtyRegion, canvasW, canvasH);
              const targetRegion = pixelSizeChanged ? region : dirtySafe;
              if (!bgOff) {
                ditherCtx.clearRect(targetRegion.x, targetRegion.y, targetRegion.width, targetRegion.height);
              }
              ditherRegionWithCurrentPressure(ditherCtx, targetRegion, rawCtx, {
                overridePixelSize: activePixelSize,
                bgOffMode: bgOff ? 'direct' : undefined,
                bgOffComposite: bgOff ? 'copy' : undefined
              });

              // Mark the whole stroke region as needing preview
              liveStrokeBoundsRef.current = mergeRectBounds(liveStrokeBoundsRef.current, targetRegion);
              liveDirtyRectRef.current = mergeRectBounds(liveDirtyRectRef.current, targetRegion);
            }
          }
        }
      }
    }

    scheduleLiveStrokeRender(ctx);
    // Dithering is applied in live preview (from raw buffer) and once more in finalizeStroke
  }, [
    brushEngine,
    ensureLiveStrokeBuffers,
    estimateStrokeBounds,
    scheduleLiveStrokeRender,
    getStrokeDitherPixelSize,
    tools.brushSettings.fillResolution,
    tools.brushSettings.ditherBackgroundFill,
    tools.brushSettings.pressureLinkedFillResolution,
    tools.brushSettings.lostEdge,
    shouldApplyStrokeDither,
    ditherRegionWithCurrentPressure,
    applyLostEdgeMaskInRegion,
    resetPressureDitherState
  ]);

  /**
   * Draw a single stamp at a position
   */
  const drawStamp = useCallback((
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    pressure: number = 1.0
  ) => {
    if (!strokeBoundsRef.current) {
      resetPressureDitherState();
      strokePhaseOriginRef.current = { x: Math.floor(x), y: Math.floor(y) };
    }

    const nowHighRes = typeof performance !== 'undefined' ? performance.now() : Date.now();

    // Keep size responsive to pressure even when PresRes is enabled
    const sizePressure = pressure;

    const strokeParams: BrushStrokeParams = {
      from: { x, y },
      to: { x, y },
      pressure: sizePressure,
      velocity: 0,
      timestamp: Date.now()
    };
    const rawPressure = pressure ?? 0;
    const p = Math.max(0, Math.min(1, rawPressure));

    const stats = strokePressureRef.current;
    const alpha = 0.6;
    const smoothed = stats.last === 0 ? p : (stats.last + (p - stats.last) * alpha);

    const now = nowHighRes;
    if (stats.lastTime === 0) {
      stats.lastTime = now;
    }
    const elapsed = now - stats.lastTime;
    stats.lastTime = now;

    stats.sampleCount += 1;
    const isEarlySample = stats.sampleCount <= INSTANT_PRESSURE_SAMPLE_WINDOW;
    const isPenLift = p <= 0.02;

    if (isPenLift) {
      // Freeze stable on pen-lift; leave latched value intact.
    } else if (smoothed >= stats.stable || isEarlySample) {
      stats.stable = smoothed;
    } else {
      const isLowPressure = smoothed < 0.25;
      const decayMultiplier = isLowPressure ? 4.0 : 1.0;
      const timeDrop = Math.max(0, elapsed * MAX_PRESSURE_DECAY_PER_MS * decayMultiplier);
      const maxDrop = Math.max(timeDrop, MIN_DROP_PER_EVENT);
      stats.stable = Math.max(smoothed, stats.stable - maxDrop);
    }

    if (p > 0.01) {
      stats.min = Math.min(stats.min, p);
      stats.max = Math.max(stats.max, p);
      stats.lastNonZero = p;
      stats.last = p;
    } else {
      stats.last = p;
    }

    if (typeof window !== 'undefined') {
      window.__AL_sample = { x, y, tag: 'drawStamp' };
    }
    const segmentBounds = estimateStrokeBounds(
      { x, y },
      { x, y },
      sizePressure
    );
    strokeBoundsRef.current = mergeRectBounds(strokeBoundsRef.current, segmentBounds);
    liveStrokeBoundsRef.current = mergeRectBounds(liveStrokeBoundsRef.current, segmentBounds);
    lastSegmentBoundsRef.current = segmentBounds;
    // Track what changed since last preview frame.
    // Inflate to reduce diffusion edge seams.
    const pixelSizeForOverlap =
      tools.brushSettings.ditherBackgroundFill === false
        ? Math.max(1, Math.round(tools.brushSettings.fillResolution || 1))
        : Math.max(1, Math.round(tools.brushSettings.fillResolution || 1));

    const OVERLAP = Math.max(8, pixelSizeForOverlap * 2);
    const dirty = inflateRect(segmentBounds, OVERLAP);
    liveDirtyRectRef.current = mergeRectBounds(liveDirtyRectRef.current, dirty);

    if (!ensureLiveStrokeBuffers(ctx)) {
      return;
    }
    const rawCtx = pick2DRead(liveStrokeRawRef.current) as CanvasRenderingContext2D | null;
    if (!rawCtx) {
      return;
    }

    brushEngine.renderBrushStroke(rawCtx, { ...strokeParams, pressure: sizePressure });

    // Apply lost-edge fade even without dithering
    if (
      !shouldApplyStrokeDither &&
      tools.brushSettings.lostEdge &&
      tools.brushSettings.lostEdge > 0
    ) {
      const region = inflateRect(segmentBounds, 2);
      applyLostEdgeMaskInRegion(rawCtx, region, tools.brushSettings.lostEdge);
    }

    if (tools.brushSettings.pressureLinkedFillResolution && shouldApplyStrokeDither) {
      const ditherCtx = pick2D(liveStrokeDitherRef.current) as CanvasRenderingContext2D | null;
      const fullBounds = strokeBoundsRef.current ?? segmentBounds;
      const bgOff = tools.brushSettings.ditherBackgroundFill === false;

      if (ditherCtx && rawCtx && fullBounds) {
        const canvasW = ditherCtx.canvas?.width ?? 0;
        const canvasH = ditherCtx.canvas?.height ?? 0;
        const region = normalizeRectForCanvas(fullBounds, canvasW, canvasH);
        const { width: rw, height: rh } = region;

        if (rw > 0 && rh > 0) {
          const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
          const desiredPixelSize = Math.max(1, Math.round(getStrokeDitherPixelSize()));
          const committedPixelSize = committedPixelSizeRef.current ?? desiredPixelSize;
          if (desiredPixelSize !== committedPixelSize) {
            if (pendingPixelSizeRef.current !== desiredPixelSize) {
              pendingPixelSizeRef.current = desiredPixelSize;
              pendingSinceRef.current = now;
            }
            const STABLE_MS = 70;
            if (now - pendingSinceRef.current >= STABLE_MS) {
              committedPixelSizeRef.current = desiredPixelSize;
              pendingPixelSizeRef.current = null;
            }
          } else {
            pendingPixelSizeRef.current = null;
          }

          const activePixelSize = committedPixelSizeRef.current ?? desiredPixelSize;
          const lastPixelSize = lastPressureDitherPixelSizeRef.current ?? activePixelSize;

          const minInterval = bgOff ? 55 : PRESSURE_DITHER_MIN_INTERVAL_MS;
          const minDeltaRes = bgOff ? 1.25 : PRESSURE_DITHER_MIN_DELTA_RES;

          const tooSoon =
            now - lastPressureDitherTimeRef.current < minInterval;
          const tinyDelta =
            Math.abs(activePixelSize - lastPixelSize) < minDeltaRes;

          const resolutionDecreased = activePixelSize < lastPixelSize;
          if (!(tooSoon && tinyDelta && !resolutionDecreased)) {
            lastPressureDitherTimeRef.current = now;
            const prevCommitted = lastPressureDitherPixelSizeRef.current ?? activePixelSize;
            const pixelSizeChanged = activePixelSize !== prevCommitted;
            lastPressureDitherPixelSizeRef.current = activePixelSize;

            const dirtyRegion = liveDirtyRectRef.current ?? region;
            const dirtySafe = normalizeRectForCanvas(dirtyRegion, canvasW, canvasH);
            const targetRegion = pixelSizeChanged ? region : dirtySafe;
            if (!bgOff) {
              ditherCtx.clearRect(targetRegion.x, targetRegion.y, targetRegion.width, targetRegion.height);
            }
            ditherRegionWithCurrentPressure(ditherCtx, targetRegion, rawCtx, {
              overridePixelSize: activePixelSize,
              bgOffMode: bgOff ? 'direct' : undefined,
              bgOffComposite: bgOff ? 'copy' : undefined
            });

            liveStrokeBoundsRef.current = mergeRectBounds(liveStrokeBoundsRef.current, targetRegion);
            liveDirtyRectRef.current = mergeRectBounds(liveDirtyRectRef.current, targetRegion);
          }
        }
      }
    }

    scheduleLiveStrokeRender(ctx);
    // Dithering is applied in live preview (from raw buffer) and once more in finalizeStroke
  }, [
    brushEngine,
    ensureLiveStrokeBuffers,
    estimateStrokeBounds,
    scheduleLiveStrokeRender,
    getStrokeDitherPixelSize,
    tools.brushSettings.fillResolution,
    tools.brushSettings.ditherBackgroundFill,
    tools.brushSettings.pressureLinkedFillResolution,
    tools.brushSettings.lostEdge,
    shouldApplyStrokeDither,
    ditherRegionWithCurrentPressure,
    applyLostEdgeMaskInRegion,
    resetPressureDitherState
  ]);

  /**
   * Finalize the current stroke (draw any waiting pixels)
   */
  const finalizeStroke = useCallback((ctx: CanvasRenderingContext2D): Rect | null => {
    const strokeBounds = strokeBoundsRef.current ?? liveStrokeBoundsRef.current ?? null;
    const rawCanvas = liveStrokeRawRef.current;
    const ditherCanvas = liveStrokeDitherRef.current;
    const canvasWidth = ctx.canvas?.width ?? 0;
    const canvasHeight = ctx.canvas?.height ?? 0;
    const region = strokeBounds ? normalizeRectForCanvas(strokeBounds, canvasWidth, canvasHeight) : null;

    const rawCtx = rawCanvas ? (pick2DRead(rawCanvas) as CanvasRenderingContext2D | null) : null;
    const ditherCtx = ditherCanvas ? (pick2D(ditherCanvas) as CanvasRenderingContext2D | null) : null;

    if (rawCtx) {
      // Finalize without emitting a new stamp; finalizeStroke() may currently place a tail stamp.
      // Guard against the final "large stamp" by flushing normally (finalizeStroke currently ignores pressure).
      brushEngine.finalizeStroke(rawCtx);
    } else {
      withAlphaLock(ctx, (targetCtx) => {
        brushEngine.finalizeStroke(targetCtx);
      }, strokeBounds ?? undefined);
    }

    // Non-dither strokes: apply lost-edge fade to the final stamp(s) and blit once.
    if (
      !shouldApplyStrokeDither &&
      rawCtx &&
      strokeBounds &&
      region &&
      region.width > 0 &&
      region.height > 0
    ) {
      if (tools.brushSettings.lostEdge && tools.brushSettings.lostEdge > 0) {
        applyLostEdgeMaskInRegion(rawCtx, inflateRect(region, 2), tools.brushSettings.lostEdge);
      }
      const { x, y, width, height } = region;
      withAlphaLock(ctx, (targetCtx) => {
        targetCtx.drawImage(
          rawCanvas as CanvasImageSource,
          x, y, width, height,
          x, y, width, height
        );
      }, strokeBounds);
      clearLiveStrokeBuffers();
      clearCoverageMaps();
      strokeBoundsRef.current = null;
      return strokeBounds ? { ...strokeBounds } : null;
    }

    if (
      tools.brushSettings.pressureLinkedFillResolution &&
      shouldApplyStrokeDither &&
      strokeBounds &&
      ditherCanvas &&
      region
    ) {
      // Force a final, unthrottled dither pass so the committed stroke reflects the latest pressure.
      const rawCtxForFinal = rawCanvas ? pick2DRead(rawCanvas) : null;
      const ditherCtxForFinal = ditherCanvas ? pick2DRead(ditherCanvas) : null;
      const finalPixelSize =
        committedPixelSizeRef.current ??
        lastPressureDitherPixelSizeRef.current ??
        getStrokeDitherPixelSize();
      const bgOff = tools.brushSettings.ditherBackgroundFill === false;
      if (rawCtxForFinal && ditherCtxForFinal) {
        const { x, y, width, height } = region;
        if (!bgOff) {
          ditherCtxForFinal.clearRect(x, y, width, height);
        }
        ditherRegionWithCurrentPressure(ditherCtxForFinal as CanvasRenderingContext2D, region, rawCtxForFinal as CanvasRenderingContext2D, {
          overridePixelSize: finalPixelSize,
          bgOffMode: bgOff ? 'direct' : undefined,
          bgOffComposite: bgOff ? 'copy' : undefined
        });
      }

      const { x, y, width, height } = region;
      const ditherSource = ditherCanvas instanceof HTMLCanvasElement ? ditherCanvas : null;
      if (isDitherStrokeBrush && bgOff) {
        ctx.clearRect(x, y, width, height);
      }
      if (isPixelDitherNoBg) {
        ctx.drawImage(ditherCanvas as CanvasImageSource, x, y, width, height, x, y, width, height);
      } else {
        withAlphaLock(ctx, (targetCtx) => {
          targetCtx.drawImage(ditherCanvas as CanvasImageSource, x, y, width, height, x, y, width, height);
        }, strokeBounds);
      }
      applyStrokeRisographOverlay(ctx, strokeBounds, ditherSource);
      clearLiveStrokeBuffers();
      clearCoverageMaps();
      strokeBoundsRef.current = null;
      return strokeBounds ? { ...strokeBounds } : null;
    }

    if (!tools.brushSettings.pressureLinkedFillResolution && strokeBounds && region && region.width > 0 && region.height > 0 && rawCtx && ditherCtx) {
      const { x, y, width, height } = region;
      if (tools.brushSettings.ditherBackgroundFill === false) {
        // BG fill off: re-dither the whole stroke region before commit to avoid stamp seams
        ditherCtx.clearRect(x, y, width, height);
        ditherRegionWithCurrentPressure(ditherCtx, region, rawCtx, { mergeExisting: false });

        const ditherSource = ditherCanvas instanceof HTMLCanvasElement ? ditherCanvas : null;
        if (isPixelDitherNoBg) {
          ctx.drawImage(ditherCanvas as CanvasImageSource, x, y, width, height, x, y, width, height);
        } else {
          withAlphaLock(ctx, (targetCtx) => {
            targetCtx.drawImage(ditherCanvas as CanvasImageSource, x, y, width, height, x, y, width, height);
          }, strokeBounds);
        }
        applyStrokeRisographOverlay(ctx, strokeBounds, ditherSource ?? (rawCanvas instanceof HTMLCanvasElement ? rawCanvas : null));
      } else {
        let src: ImageData;
        try {
          src = rawCtx.getImageData(x, y, width, height);
        } catch {
          clearLiveStrokeBuffers();
          strokeBoundsRef.current = null;
          return strokeBounds ? { ...strokeBounds } : null;
        }

        ditherCtx.clearRect(x, y, width, height);
        ditherCtx.putImageData(src, x, y);
        applyStrokeDither(ditherCtx, strokeBounds, rawCtx);

        const ditherSource = ditherCanvas instanceof HTMLCanvasElement ? ditherCanvas : null;
        if (isPixelDitherNoBg) {
          ctx.drawImage(ditherCanvas as CanvasImageSource, x, y, width, height, x, y, width, height);
        } else {
          withAlphaLock(ctx, (targetCtx) => {
            targetCtx.drawImage(ditherCanvas as CanvasImageSource, x, y, width, height, x, y, width, height);
          }, strokeBounds);
        }

        applyStrokeRisographOverlay(ctx, strokeBounds, ditherSource ?? (rawCanvas instanceof HTMLCanvasElement ? rawCanvas : null));
      }
    }

    clearLiveStrokeBuffers();
    clearCoverageMaps();
    strokeBoundsRef.current = null;
    return strokeBounds ? { ...strokeBounds } : null;
  }, [
    applyStrokeDither,
    applyStrokeRisographOverlay,
    brushEngine,
    clearLiveStrokeBuffers,
    clearCoverageMaps,
    applyLostEdgeMaskInRegion,
    ditherRegionWithCurrentPressure,
    getStrokeDitherPixelSize,
    isDitherStrokeBrush,
    isPixelDitherNoBg,
    shouldApplyStrokeDither,
    tools.brushSettings.ditherBackgroundFill,
    tools.brushSettings.lostEdge,
    tools.brushSettings.pressureLinkedFillResolution,
    withAlphaLock
  ]);

  /**
   * Reset for new stroke
   */
  const resetStroke = useCallback(() => {
    brushEngine.resetStroke();
    strokeBoundsRef.current = null;
    strokePhaseOriginRef.current = null;
    clearLiveStrokeBuffers();
    clearCoverageMaps();
    clearBgOffHoleCanvas();
    strokePressureRef.current = {
      min: 1,
      max: 0,
      lastNonZero: 0,
      last: 0,
      stable: 0,
      isTail: false,
      lastTime: 0,
      sampleCount: 0
    };
    lastPressureDitherTimeRef.current = 0;
    lastPressureDitherPixelSizeRef.current = null;
    committedPixelSizeRef.current = null;
    pendingPixelSizeRef.current = null;
    pendingSinceRef.current = 0;
    strokePressureResStateRef.current = createPressureResolutionState(1);
  }, [brushEngine, clearCoverageMaps, clearLiveStrokeBuffers, clearBgOffHoleCanvas]);

  /**
   * Apply dithering effect
   */
  const applyDithering = useCallback((
    imageData: ImageData,
    numColors: number,
    algorithm?: string,
    patternStyle?: string,
    customPalette?: string[]
  ) => {
    return brushEngine.applyDithering(imageData, numColors, algorithm, patternStyle, customPalette);
  }, [brushEngine]);

  /**
   * Draw rectangle with gradient
   */
  const drawRectangleGradient = useCallback((
    ctx: CanvasRenderingContext2D,
    startX: number,
    startY: number,
    endX: number,
    endY: number,
    width: number,
    colors: string[],
    isPreview: boolean = false
  ) => {
    if (typeof window !== 'undefined') {
      const cx = (startX + endX) / 2;
      const cy = (startY + endY) / 2;
      window.__AL_sample = { x: cx, y: cy, tag: 'rectGrad' };
    }

    // Use cached isPixelBrush value for crisp edges
    // Calculate rectangle geometry (matching monolithic exactly)
    const dx = endX - startX;
    const dy = endY - startY;
    const length = Math.hypot(dx, dy);
    
    if (length === 0 || width === 0) return;
    
    // Calculate perpendicular vector for width
    const perpX = -dy / length * (width / 2);
    const perpY = dx / length * (width / 2);
    
    // Rectangle corners
    const corners = [
      { x: startX + perpX, y: startY + perpY },
      { x: startX - perpX, y: startY - perpY },
      { x: endX - perpX, y: endY - perpY },
      { x: endX + perpX, y: endY + perpY }
    ];

    withTransparencyLock(ctx, () => {
      // Save context state
      ctx.save();
    
    // Use pixel-perfect rendering for pixel brushes, antialiasing for others
    ctx.imageSmoothingEnabled = !isPixelBrush;
    
    // Apply opacity and blend mode
    ctx.globalAlpha = tools.brushSettings.opacity;
    setBlendIfUnlocked(ctx);

    // Create gradient - use actual start/end positions to respect direction
    const gradient = ctx.createLinearGradient(startX, startY, endX, endY);
    
    // Add all color stops (matching preview behavior exactly)
    if (colors.length > 0) {
      if (colors.length === 1) {
        // For single color, add it at both start and end
        gradient.addColorStop(0, colors[0]);
        gradient.addColorStop(1, colors[0]);
      } else {
        // Multiple colors - distribute them evenly
        colors.forEach((color, index) => {
          const position = index / (colors.length - 1);
          gradient.addColorStop(position, color);
        });
      }
    } else {
      // Fallback to default color
      const defaultColor = tools.brushSettings.color;
      gradient.addColorStop(0, defaultColor);
      gradient.addColorStop(1, defaultColor);
    }

    // First, always draw the clean rectangle with smooth edges
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.moveTo(corners[0].x, corners[0].y);
    corners.slice(1).forEach(corner => ctx.lineTo(corner.x, corner.y));
    ctx.closePath();
    ctx.fill();
    
    // Apply dithering if enabled, using clipping to preserve clean edges
    if (tools.brushSettings.ditherEnabled && !isPreview) {
      const minX = Math.floor(Math.min(...corners.map(c => c.x)));
      const minY = Math.floor(Math.min(...corners.map(c => c.y)));
      const maxX = Math.ceil(Math.max(...corners.map(c => c.x)));
      const maxY = Math.ceil(Math.max(...corners.map(c => c.y)));
      const boundWidth = maxX - minX;
      const boundHeight = maxY - minY;
      
      if (boundWidth > 0 && boundHeight > 0) {
        // Create temp canvas for dithering
        const tempCanvas = canvasPool.acquire(boundWidth, boundHeight);
        const tempCtx = tempCanvas.getContext('2d', { willReadFrequently: true });
        
        if (tempCtx) {
          // Clear temp canvas
          tempCtx.clearRect(0, 0, boundWidth, boundHeight);
          
          // Create gradient in local space
          const localGradient = tempCtx.createLinearGradient(
            startX - minX, startY - minY,
            endX - minX, endY - minY
          );
          
          // Add color stops with banding effect if gradientBands is set
          if (colors.length > 0) {
            if (colors.length === 1) {
              // For single color, add it at both start and end
              localGradient.addColorStop(0, colors[0]);
              localGradient.addColorStop(1, colors[0]);
            } else if (tools.brushSettings.gradientBands && tools.brushSettings.gradientBands > 0) {
              // Create stepped gradient for visible bands
              const bandCount = Math.min(tools.brushSettings.gradientBands, colors.length);
              for (let i = 0; i < bandCount; i++) {
                const colorIndex = Math.floor((i / Math.max(1, bandCount - 1)) * (colors.length - 1));
                const color = colors[colorIndex];
                
                const startPos = i / bandCount;
                const endPos = (i + 1) / bandCount;
                
                // Add color at start of band
                if (i === 0) {
                  localGradient.addColorStop(0, color);
                } else {
                  localGradient.addColorStop(startPos, color);
                }
                
                // Add color at end of band (creates hard edge)
                if (i === bandCount - 1) {
                  localGradient.addColorStop(1, color);
                } else {
                  localGradient.addColorStop(endPos - 0.001, color);
                }
              }
            } else {
              // Multiple colors - distribute them evenly (smooth gradient)
              colors.forEach((color, index) => {
                const position = index / (colors.length - 1);
                localGradient.addColorStop(position, color);
              });
            }
          } else {
            const defaultColor = tools.brushSettings.color;
            localGradient.addColorStop(0, defaultColor);
            localGradient.addColorStop(1, defaultColor);
          }
          
          // Fill the ENTIRE temp canvas with gradient (no shape clipping)
          tempCtx.fillStyle = localGradient;
          tempCtx.fillRect(0, 0, boundWidth, boundHeight);
          
          // Get and dither the full gradient
          const imageData = tempCtx.getImageData(0, 0, boundWidth, boundHeight);
          
          const numColors = tools.brushSettings.gradientBands || tools.brushSettings.colors || 2;
          const fillResolution = tools.brushSettings.fillResolution || 1;
          const algorithm = tools.brushSettings.ditherAlgorithm || 'sierra-lite';
          const patternStyle = tools.brushSettings.patternStyle || 'dots';
          
          // Pass the gradient colors to dithering
          const paletteColors = colors.length > 0 ? colors : [tools.brushSettings.color];
          const ditheredData = fillResolution > 1 
            ? applyDitheringWithFillResolution(imageData, numColors, fillResolution, algorithm, patternStyle, paletteColors)
            : applyDitheringImport(imageData, numColors, algorithm, patternStyle, paletteColors);
          
          // Put dithered data back on temp canvas
          tempCtx.putImageData(ditheredData, 0, 0);
          
          // Save state and set up clipping
          ctx.save();
          ctx.imageSmoothingEnabled = !isPixelBrush; // Use pixel-perfect for pixel brushes
          ctx.beginPath();
          ctx.moveTo(corners[0].x, corners[0].y);
          corners.slice(1).forEach(corner => ctx.lineTo(corner.x, corner.y));
          ctx.closePath();
          ctx.clip();
          
          // Draw the dithered pattern (will be clipped to rectangle shape)
          ctx.imageSmoothingEnabled = false; // Don't smooth the dither pattern itself
          ctx.drawImage(tempCanvas, minX, minY);
          
          // Restore state
          ctx.restore();
          
          // Release temp canvas
          canvasPool.release(tempCanvas);
        }
      }
    }
    
    // Apply risograph effect if enabled (matching monolithic)
    const risographIntensity = tools.brushSettings.risographIntensity || 0;
    if (risographIntensity > 0 && !isPreview) {
      const pattern = getRisographPattern(ctx);
      
      if (pattern) {
        const effect = getRisographEffectSettings(risographIntensity, { isPixelBrush });
        if (effect.alpha > 0) {
          // Save current state
          ctx.save();
          
          const minX = Math.floor(Math.min(...corners.map(c => c.x)));
          const minY = Math.floor(Math.min(...corners.map(c => c.y)));
          const maxX = Math.ceil(Math.max(...corners.map(c => c.x)));
          const maxY = Math.ceil(Math.max(...corners.map(c => c.y)));
          if ((maxX - minX) * (maxY - minY) < 16) {
            ctx.restore();
            return;
          }

          const seed = hashNumbers(minX, minY, maxX, maxY, risographIntensity);
          const rng = createSeededRng(seed);
          const misregXBase = (rng() - 0.5) * effect.jitter;
          const misregYBase = (rng() - 0.5) * effect.jitter;
          const misregX = isPixelBrush ? 0 : misregXBase;
          const misregY = isPixelBrush ? 0 : misregYBase;
          const rotation = isPixelBrush ? 0 : (rng() - 0.5) * 0.08; // keep pixel edges clean
          const scale = isPixelBrush ? 1 : 1 + (rng() - 0.5) * 0.04;
          const filter = isPixelBrush
            ? 'none'
            : getRisographFilter(
                tools.brushSettings.color || '#000',
                tools.brushSettings.risographColorShift ?? 3,
                rng
              );

          const cx = (minX + maxX) / 2;
          const cy = (minY + maxY) / 2;
          ctx.translate(misregX, misregY);
          ctx.translate(cx, cy);
          ctx.rotate(rotation);
          ctx.scale(scale, scale);
          ctx.translate(-cx, -cy);

          // Create clipping path for the rotated rectangle (transforms already applied)
          ctx.beginPath();
          if (isPixelBrush) {
            ctx.moveTo(Math.round(corners[0].x), Math.round(corners[0].y));
            corners.slice(1).forEach(corner => {
              ctx.lineTo(Math.round(corner.x), Math.round(corner.y));
            });
          } else {
            ctx.moveTo(corners[0].x, corners[0].y);
            corners.slice(1).forEach(corner => {
              ctx.lineTo(corner.x, corner.y);
            });
          }
          ctx.closePath();
          ctx.clip();
          
          const width = maxX - minX;
          const height = maxY - minY;
          const drawPatternPass = (
            mask: HTMLCanvasElement | undefined,
            alpha: number,
            passFilter: string
          ) => {
            if (alpha <= 0) return;
            if (!mask) {
              setMultiplyIfUnlocked(ctx);
              ctx.fillStyle = pattern;
              ctx.globalAlpha = alpha;
              ctx.filter = passFilter;
              ctx.fillRect(minX, minY, width, height);
              return;
            }
            const temp = canvasPool.acquire(width, height);
            const tctx = temp.getContext('2d');
            if (!tctx) {
              canvasPool.release(temp);
              return;
            }
            tctx.setTransform(1, 0, 0, 1, 0, 0);
            tctx.clearRect(0, 0, width, height);
            tctx.filter = passFilter;
            tctx.globalAlpha = alpha;
            tctx.fillStyle = pattern;
            tctx.fillRect(0, 0, width, height);
            tctx.globalCompositeOperation = 'destination-in';
            tctx.drawImage(mask, 0, 0, width, height);

        ctx.filter = 'none';
        ctx.globalAlpha = 1;
        setMultiplyIfUnlocked(ctx);
        ctx.drawImage(temp, minX, minY, width, height);
        canvasPool.release(temp);
      };

          // Pass 1: neutral pattern everywhere
          drawPatternPass(undefined, effect.alpha, 'none');
          // Pass 2: subtle CMYK tint on edge/patch mask
          const tintMask = createRisoTintMask(width, height, isPixelBrush, rng);
          const tintAlpha = Math.min(effect.alpha * 0.45, 0.5);
          drawPatternPass(tintMask, tintAlpha, filter);
          
          // Restore state
          ctx.restore();
        }
      }
    }
    
    // Restore context state
      ctx.restore();
    });
  }, [withTransparencyLock, setBlendIfUnlocked, setMultiplyIfUnlocked, tools.brushSettings.color, tools.brushSettings.risographIntensity, tools.brushSettings.ditherEnabled, tools.brushSettings.colors, tools.brushSettings.gradientBands, tools.brushSettings.fillResolution, tools.brushSettings.ditherAlgorithm, tools.brushSettings.patternStyle, tools.brushSettings.opacity, tools.brushSettings.risographColorShift, isPixelBrush]);

  // Helper function to apply risograph effect
  const applyRisographEffect = useCallback((
    ctx: CanvasRenderingContext2D,
    vertices: Array<{ x: number; y: number }>,
    risographIntensity: number
  ) => {
    const pattern = getRisographPattern(ctx);
    
    if (pattern) {
      // Save current state
      ctx.save();
      
      const effect = getRisographEffectSettings(risographIntensity, { isPixelBrush });
      if (effect.alpha <= 0) {
        ctx.restore();
        return;
      }

      const minX = Math.floor(Math.min(...vertices.map(v => v.x)));
      const minY = Math.floor(Math.min(...vertices.map(v => v.y)));
      const maxX = Math.ceil(Math.max(...vertices.map(v => v.x)));
      const maxY = Math.ceil(Math.max(...vertices.map(v => v.y)));
      if ((maxX - minX) * (maxY - minY) < 16) {
        ctx.restore();
        return;
      }

      const seed = hashNumbers(minX, minY, maxX, maxY, risographIntensity);
      const rng = createSeededRng(seed);
      const misregXBase = (rng() - 0.5) * effect.jitter;
      const misregYBase = (rng() - 0.5) * effect.jitter;
      const misregX = isPixelBrush ? 0 : misregXBase;
      const misregY = isPixelBrush ? 0 : misregYBase;
      const rotation = isPixelBrush ? 0 : (rng() - 0.5) * 0.08; // ~±4.5°
      const scale = isPixelBrush ? 1 : 1 + (rng() - 0.5) * 0.04; // 0.98–1.02
      const filter = isPixelBrush
        ? 'none'
        : getRisographFilter(
            tools.brushSettings.color || '#000',
            tools.brushSettings.risographColorShift ?? 3,
            rng
          );

      const cx = (minX + maxX) / 2;
      const cy = (minY + maxY) / 2;
      ctx.translate(misregX, misregY);
      ctx.translate(cx, cy);
      ctx.rotate(rotation);
      ctx.scale(scale, scale);
      ctx.translate(-cx, -cy);

      // Create clipping path for the polygon with transform applied
      ctx.beginPath();
      if (isPixelBrush) {
        ctx.moveTo(Math.round(vertices[0].x), Math.round(vertices[0].y));
        for (let i = 1; i < vertices.length; i++) {
          ctx.lineTo(Math.round(vertices[i].x), Math.round(vertices[i].y));
        }
      } else {
        ctx.moveTo(vertices[0].x, vertices[0].y);
        for (let i = 1; i < vertices.length; i++) {
          ctx.lineTo(vertices[i].x, vertices[i].y);
        }
      }
      ctx.closePath();
      ctx.clip();
      
      // Apply texture with multiply blend mode
      const width = maxX - minX;
      const height = maxY - minY;

      const drawPatternPass = (
        mask: HTMLCanvasElement | undefined,
        alpha: number,
        passFilter: string
      ) => {
        if (alpha <= 0) return;
        if (!mask) {
          setMultiplyIfUnlocked(ctx);
          ctx.fillStyle = pattern;
          ctx.globalAlpha = alpha;
          ctx.filter = passFilter;
          ctx.fillRect(minX, minY, width, height);
          return;
        }
        const temp = canvasPool.acquire(width, height);
        const tctx = temp.getContext('2d');
        if (!tctx) {
          canvasPool.release(temp);
          return;
        }
        tctx.setTransform(1, 0, 0, 1, 0, 0);
        tctx.clearRect(0, 0, width, height);
        tctx.filter = passFilter;
        tctx.globalAlpha = alpha;
        tctx.fillStyle = pattern;
        tctx.fillRect(0, 0, width, height);
        tctx.globalCompositeOperation = 'destination-in';
        tctx.drawImage(mask, 0, 0, width, height);

        ctx.filter = 'none';
        ctx.globalAlpha = 1;
        setMultiplyIfUnlocked(ctx);
        ctx.drawImage(temp, minX, minY, width, height);
        canvasPool.release(temp);
      };

      // Pass 1: neutral pattern everywhere
      drawPatternPass(undefined, effect.alpha, 'none');

      // Pass 2: subtle CMYK tint on edge/patch mask
      const tintMask = createRisoTintMask(width, height, isPixelBrush, rng);
      const tintAlpha = Math.min(effect.alpha * 0.45, 0.5);
      drawPatternPass(tintMask, tintAlpha, filter);
      
      // Restore state
      ctx.restore();
    }
  }, [setMultiplyIfUnlocked, isPixelBrush, tools.brushSettings.color, tools.brushSettings.risographColorShift]);

  const applyColorCycleRisographOverlay = useCallback((
    ctx: CanvasRenderingContext2D,
    sourceCanvas: HTMLCanvasElement | OffscreenCanvas,
    outputOpacity: number
  ) => {
    const intensity = tools.brushSettings.risographIntensity || 0;
    if (intensity <= 0) {
      return;
    }

    const width = ctx.canvas.width;
    const height = ctx.canvas.height;
    if (!width || !height) {
      return;
    }

    const pattern = getRisographPattern(ctx);
    if (!pattern) {
      return;
    }

    const effect = getRisographEffectSettings(intensity, { isPixelBrush: false });
    if (effect.alpha <= 0) {
      return;
    }
    const normalizedIntensity = Math.max(0, Math.min(1, intensity / 100));
    const overlayBase = outputOpacity * (0.12 + normalizedIntensity * 0.08);
    const overlayStrength = Math.min(1, tools.brushSettings.ditherEnabled ? Math.max(overlayBase, 0.28) : overlayBase);
    if (overlayStrength <= 0.01) {
      return;
    }

    const tempCanvas = canvasPool.acquire(width, height);
    const tempCtx = tempCanvas.getContext('2d', { willReadFrequently: true } as CanvasRenderingContext2DSettings);
    if (!tempCtx) {
      canvasPool.release(tempCanvas);
      return;
    }

    tempCtx.imageSmoothingEnabled = false;
    tempCtx.setTransform(1, 0, 0, 1, 0, 0);
    tempCtx.globalCompositeOperation = 'source-over';
    tempCtx.globalAlpha = 1;
    tempCtx.clearRect(0, 0, width, height);
    tempCtx.drawImage(sourceCanvas as CanvasImageSource, 0, 0, width, height);
    tempCtx.globalCompositeOperation = 'source-in';
    tempCtx.fillStyle = 'rgba(255, 255, 255, 0.95)';
    tempCtx.fillRect(0, 0, width, height);

    const seed = hashNumbers(width, height, intensity, tools.brushSettings.risographColorShift ?? 3);
    const rng = createSeededRng(seed);
    const misregX = (rng() - 0.5) * effect.jitter;
    const misregY = (rng() - 0.5) * effect.jitter;
    const rotation = (rng() - 0.5) * 0.08;
    const scale = 1 + (rng() - 0.5) * 0.04;
    const filter = getRisographFilter(
      tools.brushSettings.color || '#000',
      tools.brushSettings.risographColorShift ?? 3,
      rng
    );

    tempCtx.translate(misregX, misregY);
    tempCtx.globalCompositeOperation = 'source-over';
    tempCtx.globalAlpha = 1;
    tempCtx.translate(width / 2, height / 2);
    tempCtx.rotate(rotation);
    tempCtx.scale(scale, scale);
    tempCtx.translate(-width / 2, -height / 2);
    tempCtx.filter = filter;
    tempCtx.fillStyle = pattern;
    tempCtx.fillRect(-misregX, -misregY, width, height);
    tempCtx.setTransform(1, 0, 0, 1, 0, 0);
    tempCtx.globalCompositeOperation = 'source-over';
    tempCtx.filter = 'none';

    ctx.save();
    ctx.globalCompositeOperation = 'soft-light';
    ctx.globalAlpha = overlayStrength;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(tempCanvas, 0, 0, width, height);
    ctx.restore();

    canvasPool.release(tempCanvas);
  }, [tools.brushSettings.risographIntensity, tools.brushSettings.risographColorShift, tools.brushSettings.color, tools.brushSettings.ditherEnabled]);

  /**
   * Draw polygon with gradient - DEBUG VERSION
   */
  const drawPolygonGradient = useCallback((
    ctx: CanvasRenderingContext2D,
    polygonData: { vertices: Array<{ x: number; y: number }>, colors: string[] },
    isPreview: boolean = false
  ) => {
    const { vertices, colors } = polygonData || {};
    
    // Early return if no polygon data
    if (!polygonData || !vertices || !Array.isArray(vertices) || vertices.length < 3) {
      console.warn('[drawPolygonGradient] Skipping - insufficient vertices:', vertices?.length || 0);
      return;
    }
    
    // Validate all vertices are defined
    const validVertices = vertices.filter(v => v && typeof v.x === 'number' && typeof v.y === 'number');
    if (validVertices.length < 3) return;

    if (typeof window !== 'undefined') {
      const firstVertex = validVertices[0];
      if (firstVertex) {
        window.__AL_sample = { x: firstVertex.x, y: firstVertex.y, tag: 'polyGrad' };
      }
    }

    // Calculate bounds for gradient
    const minX = Math.floor(Math.min(...validVertices.map(v => v.x)));
    const minY = Math.floor(Math.min(...validVertices.map(v => v.y)));
    const maxX = Math.ceil(Math.max(...validVertices.map(v => v.x)));
    const maxY = Math.ceil(Math.max(...validVertices.map(v => v.y)));
    const boundWidth = maxX - minX;
    const boundHeight = maxY - minY;
    
    // Find the two furthest points in the polygon for gradient direction
    let maxDistance = 0;
    let point1 = validVertices[0];
    let point2 = validVertices[1];
    
    for (let i = 0; i < validVertices.length; i++) {
      for (let j = i + 1; j < validVertices.length; j++) {
        const dist = Math.sqrt(
          Math.pow(validVertices[j].x - validVertices[i].x, 2) + 
          Math.pow(validVertices[j].y - validVertices[i].y, 2)
        );
        if (dist > maxDistance) {
          maxDistance = dist;
          point1 = validVertices[i];
          point2 = validVertices[j];
        }
      }
    }
    
    //   point1,
    //   point2,
    //   distance: maxDistance,
    //   bounds: { minX, minY, maxX, maxY },
    //   numVertices: validVertices.length
    // });
    
    // Create gradient between the two furthest points
    const gradient = ctx.createLinearGradient(point1.x, point1.y, point2.x, point2.y);
    
    // Add color stops - using unique colors that progress across the shape
    const validColors = colors?.filter(c => c !== undefined && c !== null && typeof c === 'string') || [];

    if (validColors.length === 0) {
      // Fallback to current brush color
      const defaultColor = tools.brushSettings.color || '#000000';
      gradient.addColorStop(0, defaultColor);
      gradient.addColorStop(1, defaultColor);
    } else if (validColors.length === validVertices.length) {
      // Project vertices onto gradient line to get their positions
      const gradientVector = { x: point2.x - point1.x, y: point2.y - point1.y };
      const gradientLength = Math.sqrt(gradientVector.x * gradientVector.x + gradientVector.y * gradientVector.y);
      const gradientDir = { x: gradientVector.x / gradientLength, y: gradientVector.y / gradientLength };
      
      // Map each vertex to its position along the gradient
      const colorPositions = validVertices.map((vertex, index) => {
        const toVertex = { x: vertex.x - point1.x, y: vertex.y - point1.y };
        const projectionDistance = toVertex.x * gradientDir.x + toVertex.y * gradientDir.y;
        const position = Math.max(0, Math.min(1, projectionDistance / gradientLength));
        return { position, color: validColors[index], index };
      });
      
      // Sort by position along gradient
      colorPositions.sort((a, b) => a.position - b.position);
      
      // Get unique colors while preserving order along gradient
      const uniqueColorsMap = new Map();
      const orderedUniqueColors = [];
      
      for (const item of colorPositions) {
        if (!uniqueColorsMap.has(item.color)) {
          uniqueColorsMap.set(item.color, item.position);
          orderedUniqueColors.push({ color: item.color, position: item.position });
        }
      }
      
      // Get the number of colors to use from brush settings
      // Use gradientBands if available, otherwise fall back to colors setting
      const numColors = tools.brushSettings.gradientBands || tools.brushSettings.colors || orderedUniqueColors.length;
      
      // Create stepped gradient for visible bands effect
      if (tools.brushSettings.gradientBands && tools.brushSettings.gradientBands > 0) {
        // Create hard-edged bands by duplicating color stops
        const bandCount = Math.min(numColors, orderedUniqueColors.length);
        for (let i = 0; i < bandCount; i++) {
          const sourceIndex = Math.floor((i / Math.max(1, bandCount - 1)) * (orderedUniqueColors.length - 1));
          const color = orderedUniqueColors[sourceIndex].color;
          
          const startPos = i / bandCount;
          const endPos = (i + 1) / bandCount;
          
          // Add color at start of band
          if (i === 0) {
            gradient.addColorStop(0, color);
          } else {
            gradient.addColorStop(startPos, color);
          }
          
          // Add color at end of band (creates hard edge)
          if (i === bandCount - 1) {
            gradient.addColorStop(1, color);
          } else {
            gradient.addColorStop(endPos - 0.001, color);
          }
        }
      } else {
        // Original smooth gradient code
        if (orderedUniqueColors.length <= numColors) {
          // Use all unique colors, distributed evenly
          orderedUniqueColors.forEach((item, index) => {
            const position = index / Math.max(1, orderedUniqueColors.length - 1);
            gradient.addColorStop(position, item.color);
          });
        } else {
          // Sample colors evenly from the unique set
          for (let i = 0; i < numColors; i++) {
            const sourceIndex = Math.floor((i / Math.max(1, numColors - 1)) * (orderedUniqueColors.length - 1));
            const position = i / Math.max(1, numColors - 1);
            gradient.addColorStop(position, orderedUniqueColors[sourceIndex].color);
          }
        }
      }
      
    } else {
      // Fallback: use first and last colors
      if (validColors.length === 1) {
        gradient.addColorStop(0, validColors[0]);
        gradient.addColorStop(1, validColors[0]);
      } else {
        gradient.addColorStop(0, validColors[0]);
        gradient.addColorStop(1, validColors[validColors.length - 1]);
      }
    }

    withTransparencyLock(ctx, () => {
    // Save context state
    ctx.save();
    
    // Apply opacity and blend mode
    ctx.globalAlpha = tools.brushSettings.opacity;
    setBlendIfUnlocked(ctx);
      
      // Check if we'll be applying dithering
      const willApplyDithering = tools.brushSettings.ditherEnabled && !isPreview;
      
      if (willApplyDithering && boundWidth > 0 && boundHeight > 0) {
        // Create temp canvas for dithering - add padding for antialiasing
        const padding = 2;
        const paddedWidth = boundWidth + padding * 2;
        const paddedHeight = boundHeight + padding * 2;
        const tempCanvas = canvasPool.acquire(paddedWidth, paddedHeight);
        const tempCtx = tempCanvas.getContext('2d', { willReadFrequently: true });
        
        if (tempCtx && tempCanvas.width > 0 && tempCanvas.height > 0) {
          // Clear the temp canvas
          tempCtx.clearRect(0, 0, paddedWidth, paddedHeight);
          
          // Create gradient in local space using the same two furthest points
          const localGradient = tempCtx.createLinearGradient(
            point1.x - minX + padding, point1.y - minY + padding,
            point2.x - minX + padding, point2.y - minY + padding
          );
          
          // Add color stops (same as main gradient) - use ordered unique colors
          if (validColors.length === 0) {
            const defaultColor = tools.brushSettings.color || '#000000';
            localGradient.addColorStop(0, defaultColor);
            localGradient.addColorStop(1, defaultColor);
          } else if (validColors.length === validVertices.length) {
            // Recreate the same logic for consistency
            const gradientVector = { x: point2.x - point1.x, y: point2.y - point1.y };
            const gradientLength = Math.sqrt(gradientVector.x * gradientVector.x + gradientVector.y * gradientVector.y);
            const gradientDir = { x: gradientVector.x / gradientLength, y: gradientVector.y / gradientLength };
            
            const colorPositions = validVertices.map((vertex, index) => {
              const toVertex = { x: vertex.x - point1.x, y: vertex.y - point1.y };
              const projectionDistance = toVertex.x * gradientDir.x + toVertex.y * gradientDir.y;
              const position = Math.max(0, Math.min(1, projectionDistance / gradientLength));
              return { position, color: validColors[index], index };
            });
            
            colorPositions.sort((a, b) => a.position - b.position);
            
            const uniqueColorsMap = new Map();
            const orderedUniqueColors = [];
            
            for (const item of colorPositions) {
              if (!uniqueColorsMap.has(item.color)) {
                uniqueColorsMap.set(item.color, item.position);
                orderedUniqueColors.push({ color: item.color, position: item.position });
              }
            }
            
            const numColors = tools.brushSettings.gradientBands || tools.brushSettings.colors || orderedUniqueColors.length;
            
            if (orderedUniqueColors.length <= numColors) {
              orderedUniqueColors.forEach((item, index) => {
                const position = index / Math.max(1, orderedUniqueColors.length - 1);
                localGradient.addColorStop(position, item.color);
              });
            } else {
              for (let i = 0; i < numColors; i++) {
                const sourceIndex = Math.floor((i / Math.max(1, numColors - 1)) * (orderedUniqueColors.length - 1));
                const position = i / Math.max(1, numColors - 1);
                localGradient.addColorStop(position, orderedUniqueColors[sourceIndex].color);
              }
            }
          } else {
            // Fallback: use first and last colors
            if (validColors.length === 1) {
              localGradient.addColorStop(0, validColors[0]);
              localGradient.addColorStop(1, validColors[0]);
            } else {
              localGradient.addColorStop(0, validColors[0]);
              localGradient.addColorStop(1, validColors[validColors.length - 1]);
            }
          }
          
          // Fill the ENTIRE temp canvas with gradient (no clipping)
          tempCtx.fillStyle = localGradient;
          tempCtx.fillRect(0, 0, paddedWidth, paddedHeight);
          
          // Get the full gradient data
          const gradientImageData = tempCtx.getImageData(0, 0, paddedWidth, paddedHeight);
          
          // Apply dithering
          const numColors = tools.brushSettings.gradientBands || tools.brushSettings.colors || 2;
          const fillResolution = tools.brushSettings.fillResolution || 1;
          const algorithm = tools.brushSettings.ditherAlgorithm || 'sierra-lite';
          const patternStyle = tools.brushSettings.patternStyle || 'dots';
          
          // Pass the gradient colors directly to the dithering function
          const ditheredData = fillResolution > 1 
            ? applyDitheringWithFillResolution(gradientImageData, numColors, fillResolution, algorithm, patternStyle, validColors)
            : applyDitheringImport(gradientImageData, numColors, algorithm, patternStyle, validColors);
          
          // Put the dithered result back
          tempCtx.putImageData(ditheredData, 0, 0);

          // Mask gradient to polygon locally so edges stay pixel sharp when drawn later
          const localVertices = validVertices.map(vertex => ({
            x: Math.round(vertex.x - minX + padding),
            y: Math.round(vertex.y - minY + padding),
          }));

          if (localVertices.length >= 3) {
            tempCtx.save();
            tempCtx.imageSmoothingEnabled = false;
            tempCtx.globalCompositeOperation = 'destination-in';
            tempCtx.lineJoin = 'miter';
            tempCtx.lineCap = 'butt';
            tempCtx.fillStyle = '#fff';
            tempCtx.beginPath();
            tempCtx.moveTo(localVertices[0].x, localVertices[0].y);
            for (let i = 1; i < localVertices.length; i++) {
              tempCtx.lineTo(localVertices[i].x, localVertices[i].y);
            }
            tempCtx.closePath();
            tempCtx.fill();
            tempCtx.restore();

            // Force binary alpha after masking so diagonal edges stay pixel-crisp
            const maskData = tempCtx.getImageData(0, 0, paddedWidth, paddedHeight);
            const pixels = maskData.data;
            for (let i = 3; i < pixels.length; i += 4) {
              pixels[i] = pixels[i] > 0 ? 255 : 0;
            }
            tempCtx.putImageData(maskData, 0, 0);
          }

          // Draw the already-masked dithered pattern without additional smoothing
          ctx.imageSmoothingEnabled = false;
          ctx.drawImage(tempCanvas, minX - padding, minY - padding);

          // Release temp canvas
          canvasPool.release(tempCanvas);

          // Apply risograph effect if enabled
          const risographIntensity = tools.brushSettings.risographIntensity || 0;
          if (risographIntensity > 0 && !isPreview) {
            applyRisographEffect(ctx, validVertices, risographIntensity);
          }
        } else {
          // Fallback if temp canvas creation fails
          canvasPool.release(tempCanvas);
          
          // Draw directly without dithering
          ctx.imageSmoothingEnabled = true;
          ctx.fillStyle = gradient;
          ctx.beginPath();
          ctx.moveTo(validVertices[0].x, validVertices[0].y);
          validVertices.slice(1).forEach(vertex => ctx.lineTo(vertex.x, vertex.y));
          ctx.closePath();
          ctx.fill();
        }
      } else {
        // No dithering - draw directly with antialiasing
        ctx.imageSmoothingEnabled = true;
        ctx.fillStyle = gradient;
        
        // quiet
        
        ctx.beginPath();
        ctx.moveTo(validVertices[0].x, validVertices[0].y);
        validVertices.slice(1).forEach(vertex => ctx.lineTo(vertex.x, vertex.y));
        ctx.closePath();
        ctx.fill();
        
        // quiet
        
        // Apply risograph effect if enabled
        const risographIntensity = tools.brushSettings.risographIntensity || 0;
        if (risographIntensity > 0 && !isPreview) {
          applyRisographEffect(ctx, validVertices, risographIntensity);
        }
      }
      
      // Restore context state
      ctx.restore();
    });
  }, [withTransparencyLock, setBlendIfUnlocked, tools.brushSettings.risographIntensity, tools.brushSettings.opacity, tools.brushSettings.ditherEnabled, tools.brushSettings.colors, tools.brushSettings.gradientBands, tools.brushSettings.fillResolution, tools.brushSettings.ditherAlgorithm, tools.brushSettings.patternStyle, tools.brushSettings.color, applyRisographEffect]);


  /**
   * Draw contour polygon - creates contour lines like a topographic map using distance fields
   */
  const drawContourPolygon = useCallback((
    _ctx: CanvasRenderingContext2D,
    _polygonData: { vertices: Array<{ x: number; y: number }>; fillColor?: string },
    _isPreview: boolean = false,
    _options?: ShapeFillOptions
  ) => {
    warnShapeFillRemoved('drawContourPolygon');
    void _ctx;
    void _polygonData;
    void _isPreview;
    void _options;
  }, []);

  /**
   * Draw cross-hatch polygon - fills with rough, hand-drawn cross-hatching pattern
   */
  const drawCrossHatchPolygon = useCallback((
    _ctx: CanvasRenderingContext2D,
    _polygonData: {
      vertices: Array<{ x: number; y: number }>;
      fillColor?: string;
      spacingOverride?: number;
      rotationOverride?: number;
      lineWidthOverride?: number;
    },
    _isPreview: boolean = false
  ) => {
    warnShapeFillRemoved('drawCrossHatchPolygon');
    void _ctx;
    void _polygonData;
    void _isPreview;
  }, []);

  /**
   * Draw Delaunay polygon - fills with triangulated network of lines
   */
  const drawDelaunayPolygon = useCallback((
    _ctx: CanvasRenderingContext2D,
    _polygonData: { vertices: Array<{ x: number; y: number }>; fillColor?: string },
    _isPreview: boolean = false,
    _options?: ShapeFillOptions
  ) => {
    warnShapeFillRemoved('drawDelaunayPolygon');
    void _ctx;
    void _polygonData;
    void _isPreview;
    void _options;
  }, []);

  /**
   * Initialize Color Cycle Brush for the active layer
   */
  const initializeColorCycleBrush = useCallback(() => {
    if (!activeLayerId) return null;
    
    // CRITICAL: Check if the active layer is a color-cycle layer
    const state = useAppStore.getState();
    const activeLayer = state.layers.find(l => l.id === activeLayerId);
    if (!activeLayer || activeLayer.layerType !== 'color-cycle') {
      // quiet
      return null;
    }
    // Do not initialize brush for recolor-mode layers
    if (activeLayer.colorCycleData?.mode === 'recolor') {
      return null;
    }
    
    try {
      // Check if layer already has a color cycle brush
      let colorCycleBrush = getActiveLayerColorCycleBrush();
      
      if (!colorCycleBrush) {
        // Initialize color cycle for the active layer
        const targetWidth = Math.max(project?.width || 1024, 1);
        const targetHeight = Math.max(project?.height || 1024, 1);
        
        // Initialize color cycle for this layer in the store
        useAppStore.getState().initColorCycleForLayer(activeLayerId, targetWidth, targetHeight);
        colorCycleBrush = getActiveLayerColorCycleBrush();
        
        if (!colorCycleBrush) {
          console.error('[ColorCycle] Failed to initialize brush for layer:', activeLayerId);
          return null;
        }
        
        // Set up frame callback for new brush
        colorCycleBrush.setOnFrameRendered(() => {
          // Dispatch event for main canvas to update
          window.dispatchEvent(new CustomEvent('colorCycleFrameReady'));
        });
      } else {
        // IMPORTANT: Reset the brush state when switching back to an existing CC layer
        // This ensures clean state after layer switches
        colorCycleBrush.endStroke(activeLayerId);
      }
      
      // Apply settings (for both new and existing brushes)
      colorCycleBrush.setBrushSize(tools.brushSettings.size || 20);
      if (tools.brushSettings.colorCycleFPS) {
        colorCycleBrush.setFPS(tools.brushSettings.colorCycleFPS);
      }
      // Prefer per-layer CC brush speed when available; fallback to global brush setting
      try {
        const state = useAppStore.getState();
        const activeLayer = state.layers.find(l => l.id === activeLayerId);
        const perLayerSpeed = activeLayer?.colorCycleData?.brushSpeed;
        const speed = perLayerSpeed ?? tools.brushSettings.colorCycleSpeed;
        if (speed) {
          colorCycleBrush.setSpeed(speed);
        }
      } catch {}
      if (tools.brushSettings.gradientBands) {
        colorCycleBrush.setGradientBands(tools.brushSettings.gradientBands);
      }
      const useShapeSpacing = tools.brushSettings.brushShape === BrushShape.COLOR_CYCLE_SHAPE;
      const resolvedBandSpacing = clampColorCycleBandSpacing(
        useShapeSpacing
          ? tools.brushSettings.colorCycleBandSpacingPx ?? tools.brushSettings.spacing ?? DEFAULT_CC_BAND_SPACING
          : tools.brushSettings.spacing ?? DEFAULT_CC_BAND_SPACING
      );
      colorCycleBrush.setBandSpacing(resolvedBandSpacing);
      // Set pressure enabled state and min/max values
      // quiet
      try {
        const { enabled, minPercent, maxPercent } = resolveBrushPressureRange(tools.brushSettings);
        colorCycleBrush.setPressureEnabled(enabled);
        colorCycleBrush.setMinPressure(enabled ? minPercent : 100);
        colorCycleBrush.setMaxPressure(enabled ? maxPercent : 100);
      } catch (error) {
        console.error('[CC Init] Failed to set pressure settings:', error);
      }

      try {
        const stampShape =
          tools.brushSettings.brushShape === BrushShape.COLOR_CYCLE_TRIANGLE
            ? 'triangle'
            : (tools.brushSettings.colorCycleStampShape ?? 'square');
        colorCycleBrush.setStampShape(stampShape);
      } catch (error) {
        console.error('[CC Init] Failed to set stamp shape:', error);
      }
      
      // Hydrate all layer gradients and set active slot (no global overwrite)
      const storeSnapshot = useAppStore.getState();
      const activeLayer = storeSnapshot.layers.find(l => l.id === activeLayerId);
      const { slotPalettes, activeSlot, fallbackStops } = resolveColorCycleGradientsForLayer(
        activeLayer,
        tools.brushSettings
      );
      slotPalettes.forEach((entry, index) => {
        const stops =
          entry.stops && entry.stops.length > 0 ? entry.stops : fallbackStops;
        const slot = Number.isFinite(entry.slot) ? entry.slot : index;
        colorCycleBrush.setGradientSlot(activeLayerId, slot, stops);
      });
      colorCycleBrush.setActiveGradientSlot(activeLayerId, activeSlot);
      
      const layerFlowMode = activeLayer?.colorCycleData?.flowMode;
      const flowMode = tools.brushSettings.colorCycleFlowMode ?? layerFlowMode ?? 'reverse';
      const legacyFlowMode = layerFlowMode ?? flowMode;
      if (typeof (colorCycleBrush as { setLegacyFlowMode?: (mode: typeof flowMode) => void }).setLegacyFlowMode === 'function') {
        (colorCycleBrush as { setLegacyFlowMode: (mode: typeof flowMode) => void }).setLegacyFlowMode(legacyFlowMode);
      }
      if (typeof colorCycleBrush.setFlowMode === 'function') {
        colorCycleBrush.setFlowMode(flowMode);
      } else {
        colorCycleBrush.setFlowDirection(flowMode === 'reverse' ? 'backward' : 'forward');
      }
      
      return colorCycleBrush;
    } catch (error) {
      console.error('[ColorCycle] Error initializing brush:', error);
      return null;
    }
  }, [
    tools.brushSettings,
    project?.width,
    project?.height,
    activeLayerId,
    getActiveLayerColorCycleBrush
  ]);

  const ensureColorCycleAnimation = useCallback((shouldPlay: boolean) => {
    if (typeof window === 'undefined') {
      return;
    }
    const manager = getColorCycleBrushManager();
    const { layers } = useAppStore.getState();
    layers.forEach((layer) => {
      if (layer.layerType !== 'color-cycle') {
        return;
      }
      const brush = manager.getBrush(layer.id) as Partial<ColorCycleBrushImplementation> | undefined;
      if (!brush) {
        return;
      }
      if (shouldPlay) {
        if (typeof brush.startAnimation === 'function') {
          brush.startAnimation();
        } else if (typeof brush.setPlaying === 'function') {
          brush.setPlaying(true);
        }
      } else {
        if (typeof brush.stopAnimation === 'function') {
          brush.stopAnimation();
        } else if (typeof brush.setPlaying === 'function') {
          brush.setPlaying(false);
        }
      }
    });
  }, []);

  useEffect(() => {
    const colorCycleBrush = getActiveLayerColorCycleBrush();
    if (!colorCycleBrush) {
      return;
    }
    const flowMode = tools.brushSettings.colorCycleFlowMode ?? activeLayerFlowMode ?? 'reverse';
    if (typeof colorCycleBrush.setFlowMode === 'function') {
      colorCycleBrush.setFlowMode(flowMode);
    } else {
      colorCycleBrush.setFlowDirection(flowMode === 'reverse' ? 'backward' : 'forward');
    }
  }, [getActiveLayerColorCycleBrush, tools.brushSettings.colorCycleFlowMode, activeLayerId, activeLayerFlowMode]);

  /**
   * Render Color Cycle output onto the provided context.
   * Applies opacity and optionally combines blend mode with transparency lock.
   */
  const renderColorCycle = useCallback((
    ctx: CanvasRenderingContext2D,
    applyOpacity: boolean = true,
    options?: { withOverlay?: boolean }
  ) => {
    const colorCycleBrush = getActiveLayerColorCycleBrush();
    if (!colorCycleBrush || !activeLayerId) {
      return;
    }

    const layerCanvas = refreshLayerCCSurface(colorCycleBrush, activeLayerId);
    if (!layerCanvas) {
      return;
    }

    ensureCanvasPixelSize(layerCanvas);

    try {
      bindBrushToCanvas(colorCycleBrush, layerCanvas);
      colorCycleBrush.renderDirectToCanvas(layerCanvas, activeLayerId);
    } catch (error) {
      console.warn('[ColorCycle] Failed to render to layer canvas:', error);
      return;
    }

    if (ctx.canvas === layerCanvas) {
      return;
    }

    const previousComposite = ctx.globalCompositeOperation;
    const previousAlpha = ctx.globalAlpha;
    const drawOpacity = applyOpacity ? (tools.brushSettings.opacity ?? 1) : 1;
    const shouldApplyOverlay = options?.withOverlay ?? true;

    try {
      const blendMode = (tools.brushSettings.blendMode || 'source-over') as GlobalCompositeOperation;
      ctx.globalAlpha = drawOpacity;

      if (activeLayerTransparencyLock) {
        renderCCWithBlendAndLock(ctx, layerCanvas, blendMode);
      } else {
        ctx.globalCompositeOperation = blendMode;
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(layerCanvas, 0, 0, ctx.canvas.width, ctx.canvas.height);
      }

      if (shouldApplyOverlay) {
        applyColorCycleRisographOverlay(ctx, layerCanvas, drawOpacity);
      }
    } finally {
      ctx.globalCompositeOperation = previousComposite;
      ctx.globalAlpha = previousAlpha;
    }
  }, [
    activeLayerId,
    getActiveLayerColorCycleBrush,
    tools.brushSettings.opacity,
    tools.brushSettings.blendMode,
    activeLayerTransparencyLock,
    renderCCWithBlendAndLock,
    applyColorCycleRisographOverlay
  ]);
  
  /**
   * Draw with Color Cycle Brush - only paints to Canvas2D buffer, no immediate rendering
   */
  const drawColorCycle = useCallback((
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    pressure: number = 1.0,
    rotation: number = 0,
    options?: DrawColorCycleOptions
  ) => {
    // Compute effective pressure settings shared with raster brushes
    const baseBrushSize = Math.max(1, Math.round(tools.brushSettings.size || 1));
    const pressureRange = resolveBrushPressureRange(tools.brushSettings);
    const pressureActive = pressureRange.enabled;
    const minPercent = pressureActive ? pressureRange.minPercent : 100;
    const maxPercent = pressureActive ? pressureRange.maxPercent : 100;

    try {
      // DEFENSIVE GUARD: Check if color cycle brush should be used
      // This prevents crashes when incompatible layer types are used
      const colorCycleBrush = getActiveLayerColorCycleBrush();
      if (!colorCycleBrush) {
        return;
      }

      // Ensure pressure settings are applied (might be a newly created brush)
      // Log current settings to debug - only once per stroke to avoid spam
      if (!ctx.canvas.dataset.loggedSettings) {
        ctx.canvas.dataset.loggedSettings = 'true';
        // Reset flag after a short delay
        setTimeout(() => {
          if (ctx.canvas.dataset) {
            delete ctx.canvas.dataset.loggedSettings;
          }
        }, 1000);
      }
      
      // Set pressure settings FIRST before painting
      try {
        colorCycleBrush.setPressureEnabled(pressureActive);
        // Always set pressure values, using sensible defaults if not specified
        colorCycleBrush.setMinPressure(minPercent);
        colorCycleBrush.setMaxPressure(maxPercent);
      } catch (error) {
        console.error('[CC DrawCycle] Error setting pressure:', error);
      }

      try {
        const stampShape =
          tools.brushSettings.brushShape === BrushShape.COLOR_CYCLE_TRIANGLE
            ? 'triangle'
            : (tools.brushSettings.colorCycleStampShape ?? 'square');
        colorCycleBrush.setStampShape(stampShape);
      } catch (error) {
        console.error('[CC DrawCycle] Error setting stamp shape:', error);
      }
      
      let brushSizeSetting = baseBrushSize;
      if (options?.customStamp) {
        const stamp = options.customStamp;
        if (stamp.isResampler) {
          brushSizeSetting = tools.brushSettings.size || brushSizeSetting;
        } else {
          const sizeValue = tools.brushSettings.size;
          brushSizeSetting = Math.max(1, typeof sizeValue === 'number' ? sizeValue : Math.max(stamp.width, stamp.height) || 1);
        }
      }

      if (!Number.isFinite(brushSizeSetting) || brushSizeSetting <= 0) {
        brushSizeSetting = 1;
      }

      colorCycleBrush.setBrushSize(brushSizeSetting);
      
      // Paint to the Canvas2D buffer only - AFTER setting pressure
      const layerId = activeLayerId;
      if (!layerId) {
        return;
      }

      if (activeLayerTransparencyLock) {
        const mask = getActiveLayerBitmapCanvas();
        if (mask) {
          const canvasWidth = ctx.canvas.width || 1;
          const canvasHeight = ctx.canvas.height || 1;
          const scaleToMaskX = mask.width / canvasWidth;
          const scaleToMaskY = mask.height / canvasHeight;
          const mx = Math.floor(x * scaleToMaskX);
          const my = Math.floor(y * scaleToMaskY);
          const brushSize = tools.brushSettings.size || 1;
          let radius = Math.max(
            1,
            Math.round(brushSize * Math.max(scaleToMaskX, scaleToMaskY) * 0.5)
          );

          if (options?.customStamp) {
            const { width = 0, height = 0 } = options.customStamp;
            const maxDimension = Math.max(width, height);
            if (maxDimension > 0) {
              const stampRadius = Math.round(
                maxDimension * Math.max(scaleToMaskX, scaleToMaskY) * 0.5
              );
              radius = Math.max(radius, stampRadius);
            }
          }

          if (!maskHasAlphaNear(mask, mx, my, radius)) {
            return;
          }
        }
      }

      // Convert canvas coordinates to internal canvas coordinates
      const internalCanvas = colorCycleBrush.getCanvas();
      if (!internalCanvas || !internalCanvas.width || !internalCanvas.height) {
        console.error('[ColorCycle] Invalid internal canvas');
        return;
      }
      
      const scaleX = internalCanvas.width / (ctx.canvas.width || 1);
      const scaleY = internalCanvas.height / (ctx.canvas.height || 1);
      
      // Pass the active layer ID to ensure proper stroke tracking
      const paintX = Math.floor(x * scaleX);
      const paintY = Math.floor(y * scaleY);
      
      // Bounds check
      if (paintX >= 0 && paintX < internalCanvas.width && 
          paintY >= 0 && paintY < internalCanvas.height) {
        // THEN paint with pressure and rotation
        if (options?.customStamp && typeof colorCycleBrush.paintCustomStamp === 'function') {
          colorCycleBrush.paintCustomStamp(
            options.customStamp,
            paintX,
            paintY,
            layerId,
            pressure,
            rotation
          );
        } else {
          colorCycleBrush.paint(paintX, paintY, layerId, pressure, rotation);
        }
      }

      if (firstStampImmediateRef.current) {
        firstStampImmediateRef.current = false;
        renderColorCycle(ctx, true, { withOverlay: false });
      } else if (!mirrorScheduledRef.current) {
        mirrorScheduledRef.current = true;
        const scheduleRender = () => {
          mirrorScheduledRef.current = false;
          renderColorCycle(ctx, true);
        };
        if (typeof requestAnimationFrame === 'function') {
          requestAnimationFrame(scheduleRender);
        } else {
          scheduleRender();
        }
      }
    } catch (error) {
      console.error('[ColorCycle] Error in drawColorCycle:', error);
    }
    
    // Don't composite here - let renderColorCycle handle all rendering
    // This prevents visible brush stamps and ensures only animated strokes show
  }, [
    tools.brushSettings,
    activeLayerId,
    getActiveLayerColorCycleBrush,
    getActiveLayerBitmapCanvas,
    renderColorCycle,
    activeLayerTransparencyLock
  ]);
  
  /**
   * Reset Color Cycle - starts a new stroke with the existing brush
   */
  const resetColorCycle = useCallback((clearBuffer: boolean = false) => {
    // quiet
    // DEFENSIVE GUARD: Add try-catch to prevent crashes during initialization
    try {
      // Reuse existing brush or create if needed
      const brush = initializeColorCycleBrush();
      
      if (brush) {
        const layerId = activeLayerId;
        if (!layerId) {
          return;
        }
        brush.setLayerId?.(layerId);
        brush.setActiveLayer?.(layerId);
        // If there is visible content on the internal canvas, proactively
        // separate it by committing to the layer and clearing buffers so
        // this new stroke is stored distinctly in history.
        try {
          const state = useAppStore.getState();
          const layer = state.layers.find(l => l.id === layerId);
          const layerCanvas = layer?.colorCycleData?.canvas || null;
          if (layer && layer.layerType === 'color-cycle' && layerCanvas) {
            const internal = brush.getCanvas();
            const ictx = internal.getContext?.('2d');
            let hasAlpha = false;
            try {
              const img = ictx?.getImageData(0, 0, Math.min(8, internal.width), Math.min(8, internal.height));
              const data = img?.data ?? null;
              if (data) {
                for (let i = 3; i < data.length; i += 4) {
                  if (data[i] > 0) { hasAlpha = true; break; }
                }
              }
            } catch {}
              if (hasAlpha) {
                bindBrushToCanvas(brush, layerCanvas);
                // quiet
                brush.commitCurrentStroke?.(layerId);
                if (typeof brush.commitToLayer === 'function') {
                  brush.commitToLayer(layerCanvas, layerId);
                } else {
                brush.renderDirectToCanvas?.(layerCanvas, layerId);
              }
              // Only clear animatable data when global playback is not desired.
              if (!selectColorCycleDesiredPlaying(useAppStore.getState())) {
                brush.clearPaintBuffer?.(layerId);
              }
            }
          }
        } catch {
          // quiet
        }

        // Ensure any in-progress stroke is finalized before starting a new one
        try {
          if (typeof brush.finalizeCurrentStroke === 'function') {
            brush.finalizeCurrentStroke(layerId);
          } else if (typeof brush.endStroke === 'function') {
            brush.endStroke(layerId);
          }
        } catch {
          // quiet
        }

        // quiet
        // Start a new stroke with the existing brush, passing layer ID and clearBuffer flag
        brush.startStroke(layerId, clearBuffer);
        firstStampImmediateRef.current = true;
      }
    } catch {
      // quiet
      // Fail gracefully - don't crash the app
    }
  }, [initializeColorCycleBrush, activeLayerId]);
  
  /**
   * End color cycle stroke
   */
  const endColorCycleStroke = useCallback(() => {
    const colorCycleBrush = getActiveLayerColorCycleBrush();
    const layerId = activeLayerId;
    if (colorCycleBrush && layerId) {
      colorCycleBrush.endStroke(layerId);
    }
  }, [activeLayerId, getActiveLayerColorCycleBrush]);
  
  /**
   * Fill a shape with linear color cycle gradient in specified direction
   */
  const fillColorCycleShapeLinear = useCallback(async (
    vertices: Array<{ x: number; y: number }>,
    direction: { x: number; y: number }
  ) => {
    // quiet
    
    // Initialize brush if needed
    const brush = initializeColorCycleBrush();
    
    const layerId = activeLayerId;

    if (brush && layerId) {
      // Ensure brush routes subsequent writes to the active layer
      brush.setLayerId?.(layerId);
      brush.setActiveLayer?.(layerId);
      // Ensure we have a layer by setting the gradient if needed
      const currentBrushLayerId = brush.getLayerId();
      if (!currentBrushLayerId || currentBrushLayerId !== layerId) {
        // quiet
        const state = useAppStore.getState();
        const layer = state.layers.find((entry) => entry.id === layerId);
        const { slotPalettes, activeSlot, fallbackStops } = resolveColorCycleGradientsForLayer(
          layer,
          tools.brushSettings
        );
        slotPalettes.forEach((entry, index) => {
          const stops =
            entry.stops && entry.stops.length > 0 ? entry.stops : fallbackStops;
          const slot = Number.isFinite(entry.slot) ? entry.slot : index;
          brush.setGradientSlot(layerId, slot, stops);
        });
        brush.setActiveGradientSlot(layerId, activeSlot);
      }
      
      // Ensure bands are set before filling
      const bands = tools.brushSettings.gradientBands || 12;
      brush.setGradientBands(bands);
      const useShapeSpacing = tools.brushSettings.brushShape === BrushShape.COLOR_CYCLE_SHAPE;
      const bandSpacingPx = clampColorCycleBandSpacing(
        useShapeSpacing
          ? tools.brushSettings.colorCycleBandSpacingPx ?? tools.brushSettings.spacing ?? DEFAULT_CC_BAND_SPACING
          : tools.brushSettings.spacing ?? DEFAULT_CC_BAND_SPACING
      );
      brush.setBandSpacing(bandSpacingPx);
      
      // quiet
      // Fill the shape with linear gradient
      await Promise.resolve(brush.fillShapeLinear?.(vertices, direction, layerId, bandSpacingPx));

      // quiet
      // End the stroke to ensure texture is updated
      brush.endStroke(layerId);

      // quiet
      // Force a render to ensure the shape is visible
      renderBrushToLayerCanvas(brush, layerId);
    }
  }, [
    initializeColorCycleBrush,
    activeLayerId,
    tools.brushSettings,
  ]);
  
  /**
   * Fill a shape with color cycle gradient from edges to center
   */
  const fillColorCycleShape = useCallback(async (vertices: Array<{ x: number; y: number }>) => {
    // quiet
    
    // Initialize brush if needed
    const brush = initializeColorCycleBrush();
    
    const layerId = activeLayerId;

    if (brush && layerId) {
      // Ensure brush routes subsequent writes to the active layer
      brush.setLayerId?.(layerId);
      brush.setActiveLayer?.(layerId);
      // quiet
      // DON'T call startStroke here - resetColorCycle() already called it
      // This was causing the double startStroke issue that accumulated shapes
      
      // Ensure we have a layer by setting the gradient if needed
      const currentBrushLayerId = brush.getLayerId();
      if (!currentBrushLayerId || currentBrushLayerId !== layerId) {
        // quiet
        // Set the gradient to create a layer
        const state = useAppStore.getState();
        const layer = state.layers.find((entry) => entry.id === layerId);
        const { slotPalettes, activeSlot, fallbackStops } = resolveColorCycleGradientsForLayer(
          layer,
          tools.brushSettings
        );
        slotPalettes.forEach((entry, index) => {
          const stops =
            entry.stops && entry.stops.length > 0 ? entry.stops : fallbackStops;
          const slot = Number.isFinite(entry.slot) ? entry.slot : index;
          brush.setGradientSlot(layerId, slot, stops);
        });
        brush.setActiveGradientSlot(layerId, activeSlot);
      }
      
      // Ensure bands are set before filling
      const bands = tools.brushSettings.gradientBands || 12;
      brush.setGradientBands(bands);
      
      // The vertices are already in the correct coordinate space
      // The ColorCycleBrush internal canvas should match the project dimensions
      // No scaling needed - just pass vertices directly
      
      // quiet
      // Fill the shape with layer ID and spacing
      const bandSpacingPx = clampColorCycleBandSpacing(
        tools.brushSettings.colorCycleBandSpacingPx ?? tools.brushSettings.spacing ?? DEFAULT_CC_BAND_SPACING
      );
      await Promise.resolve(brush.fillShape?.(vertices, layerId, bandSpacingPx));

      // quiet
      // End the stroke to ensure texture is updated
      brush.endStroke(layerId);

      // quiet
      // Force a render to ensure the shape is visible
      renderBrushToLayerCanvas(brush, layerId);
    }
  }, [
    initializeColorCycleBrush,
    activeLayerId,
    tools.brushSettings,
  ]);

  // Color cycle functions removed - now defined inline in return object to avoid stale closures
  
  // Update color cycle speed when it changes
  useEffect(() => {
    const colorCycleBrush = getActiveLayerColorCycleBrush();
    const state = useAppStore.getState();
    const activeLayer = state.layers.find(l => l.id === activeLayerId);
    const perLayerSpeed = activeLayer?.colorCycleData?.brushSpeed;
    if (colorCycleBrush && perLayerSpeed) {
      colorCycleBrush.setSpeed(perLayerSpeed);
    }
  }, [activeLayerId, activeLayerBrushSpeed, getActiveLayerColorCycleBrush]);
  
  // Update color cycle FPS when it changes
  useEffect(() => {
    const colorCycleBrush = getActiveLayerColorCycleBrush();
    if (colorCycleBrush && tools.brushSettings.colorCycleFPS) {
      colorCycleBrush.setFPS(tools.brushSettings.colorCycleFPS);
    }
  }, [tools.brushSettings.colorCycleFPS, activeLayerId, getActiveLayerColorCycleBrush]);
  
  // Update gradient bands when it changes
  useEffect(() => {
    // First check if we're actually using a color cycle brush/layer
    const state = useAppStore.getState();
    const activeLayer = state.layers.find(l => l.id === activeLayerId);
    
    // Only proceed if this is a color-cycle layer
    if (activeLayer?.layerType === 'color-cycle') {
      let colorCycleBrush = getActiveLayerColorCycleBrush();
      
      // Initialize the brush if it doesn't exist yet
      if (!colorCycleBrush) {
        colorCycleBrush = initializeColorCycleBrush();
      }
      
      if (colorCycleBrush) {
        const bands = tools.brushSettings.gradientBands || 12;
        colorCycleBrush.setGradientBands(bands);
        // quiet
        
        // Force a render to show the change immediately
        renderBrushToLayerCanvas(colorCycleBrush, activeLayerId);
        
        // Dispatch event for canvas update
        window.dispatchEvent(new CustomEvent('colorCycleFrameReady'));
      }
    }
  }, [tools.brushSettings.gradientBands, getActiveLayerColorCycleBrush, activeLayerId, initializeColorCycleBrush]);

  useEffect(() => {
    const state = useAppStore.getState();
    const activeLayer = state.layers.find(l => l.id === activeLayerId);

    if (activeLayer?.layerType === 'color-cycle') {
      let colorCycleBrush = getActiveLayerColorCycleBrush();

      if (!colorCycleBrush) {
        colorCycleBrush = initializeColorCycleBrush();
      }

      if (colorCycleBrush) {
        const useShapeSpacing = tools.brushSettings.brushShape === BrushShape.COLOR_CYCLE_SHAPE;
        const spacingValue = clampColorCycleBandSpacing(
          useShapeSpacing
            ? tools.brushSettings.colorCycleBandSpacingPx ?? tools.brushSettings.spacing ?? DEFAULT_CC_BAND_SPACING
            : tools.brushSettings.spacing ?? DEFAULT_CC_BAND_SPACING
        );
        colorCycleBrush.setBandSpacing(spacingValue);
        renderBrushToLayerCanvas(colorCycleBrush, activeLayerId);
        window.dispatchEvent(new CustomEvent('colorCycleFrameReady'));
      }
    }
  }, [
    tools.brushSettings.colorCycleBandSpacingPx,
    tools.brushSettings.spacing,
    tools.brushSettings.brushShape,
    getActiveLayerColorCycleBrush,
    activeLayerId,
    initializeColorCycleBrush,
  ]);
  
// Update band spacing when it changes
useEffect(() => {
  const { spacing, colorCycleBandSpacingPx, brushShape } = tools.brushSettings;
  const colorCycleBrush = getActiveLayerColorCycleBrush();
  if (colorCycleBrush && spacing) {
    const useShapeSpacing = brushShape === BrushShape.COLOR_CYCLE_SHAPE;
    const resolvedBandSpacing = clampColorCycleBandSpacing(
      useShapeSpacing
        ? colorCycleBandSpacingPx ?? spacing ?? DEFAULT_CC_BAND_SPACING
        : spacing ?? DEFAULT_CC_BAND_SPACING
    );
    colorCycleBrush.setBandSpacing(resolvedBandSpacing);
  }
}, [
  tools.brushSettings,
  tools.brushSettings.spacing,
  tools.brushSettings.colorCycleBandSpacingPx,
  tools.brushSettings.brushShape,
  activeLayerId,
  getActiveLayerColorCycleBrush,
]);

  // Update dithering toggle for color-cycle shape fills
  useEffect(() => {
    const colorCycleBrush = getActiveLayerColorCycleBrush();
    if (colorCycleBrush) {
      try {
        colorCycleBrush.setDitherEnabled(!!tools.brushSettings.ditherEnabled);
        colorCycleBrush.setStampDitherEnabled(
          !!tools.brushSettings.colorCycleStampDitherEnabled
        );
        if (typeof colorCycleBrush.setStampDitherAlgorithm === 'function') {
          colorCycleBrush.setStampDitherAlgorithm(
            tools.brushSettings.ditherAlgorithm ?? 'sierra-lite'
          );
        }
        if (typeof colorCycleBrush.setStampDitherPatternStyle === 'function') {
          colorCycleBrush.setStampDitherPatternStyle(
            tools.brushSettings.patternStyle ?? 'dots'
          );
        }
        if (typeof colorCycleBrush.setStampDitherPressureLinked === 'function') {
          colorCycleBrush.setStampDitherPressureLinked(
            !!tools.brushSettings.colorCycleStampDitherPressureLinked
          );
        }
        const stampBgFill =
          typeof tools.brushSettings.colorCycleStampDitherBgFill === 'boolean'
            ? tools.brushSettings.colorCycleStampDitherBgFill
            : !Boolean(tools.brushSettings.colorCycleStampDitherClears);
        if (typeof (colorCycleBrush as { setStampDitherBgFill?: (v: boolean) => void }).setStampDitherBgFill === 'function') {
          (colorCycleBrush as { setStampDitherBgFill: (v: boolean) => void }).setStampDitherBgFill(stampBgFill);
        } else if (typeof colorCycleBrush.setStampDitherClears === 'function') {
          colorCycleBrush.setStampDitherClears(!stampBgFill);
        }
      } catch (error) {
        void error;
        // Non-fatal; older brushes may not support dithering
      }
    }
  }, [
    tools.brushSettings.ditherEnabled,
    tools.brushSettings.colorCycleStampDitherEnabled,
    tools.brushSettings.colorCycleStampDitherBgFill,
    tools.brushSettings.colorCycleStampDitherClears,
    tools.brushSettings.colorCycleStampDitherPressureLinked,
    tools.brushSettings.ditherAlgorithm,
    tools.brushSettings.patternStyle,
    activeLayerId,
    getActiveLayerColorCycleBrush
  ]);

  // Update dither pixel size (fillResolution) for color-cycle shape fills
  useEffect(() => {
    const colorCycleBrush = getActiveLayerColorCycleBrush();
    if (colorCycleBrush && tools.brushSettings.fillResolution) {
      try {
        colorCycleBrush.setDitherPixelSize(Math.max(1, Math.floor(tools.brushSettings.fillResolution)));
      } catch {}
    }
  }, [tools.brushSettings.fillResolution, activeLayerId, getActiveLayerColorCycleBrush]);

  // Update stamp dithering pixel size for color-cycle strokes
  useEffect(() => {
    const colorCycleBrush = getActiveLayerColorCycleBrush();
    if (colorCycleBrush) {
      try {
        const resolution = Math.max(
          1,
          Math.floor(tools.brushSettings.colorCycleStampDitherPixelSize ?? 1)
        );
        colorCycleBrush.setStampDitherPixelSize(resolution);
      } catch {}
    }
  }, [
    tools.brushSettings.colorCycleStampDitherPixelSize,
    activeLayerId,
    getActiveLayerColorCycleBrush
  ]);

  // Perceptual dithering removed
  
  // Sync brush size + pressure with debounce so rapid slider changes don't stall UI
  useEffect(() => {
    const targetSize = Math.max(1, Math.round(tools.brushSettings.size || 1));
    brushSizePendingRef.current = targetSize;
    brushPressurePendingRef.current = normalizePressureSettings(tools.brushSettings);

    cancelDeferred(brushSizeDeferredHandleRef.current);
    brushSizeDeferredHandleRef.current = scheduleDeferred(() => {
      brushSizeDeferredHandleRef.current = null;
      applyPendingBrushSizing();
    }, 150);

    return () => {
      cancelDeferred(brushSizeDeferredHandleRef.current);
      brushSizeDeferredHandleRef.current = null;
    };
  }, [
    tools.brushSettings,
    tools.brushSettings.size,
    tools.brushSettings.pressureEnabled,
    tools.brushSettings.minPressure,
    tools.brushSettings.maxPressure,
    tools.brushSettings.brushShape,
    applyPendingBrushSizing,
    activeLayerId,
  ]);

  const lastActiveLayerIdRef = useRef<string | null>(activeLayerId);
  useEffect(() => {
    if (lastActiveLayerIdRef.current !== activeLayerId) {
      lastActiveLayerIdRef.current = activeLayerId;
      applyPendingBrushSizing();
    }
  }, [activeLayerId, applyPendingBrushSizing]);

  useEffect(() => {
    let previous = selectEffectiveColorCyclePlaying(useAppStore.getState());
    ensureColorCycleAnimation(previous);

    const unsubscribe = useAppStore.subscribe((state) => {
      const next = selectEffectiveColorCyclePlaying(state);
      if (next === previous) {
        return;
      }
      previous = next;
      ensureColorCycleAnimation(next);
    });

    return () => {
      unsubscribe();
    };
  }, [ensureColorCycleAnimation, activeLayerId]);

  // Clean up resources
  useEffect(() => {
    const cache = brushStampCacheRef.current;
    return () => {
      // Clear brush stamp cache on unmount
      cache.clear();

      // DON'T cleanup color cycle brush when switching layers!
      // This was causing the crash - the brush was being destroyed
      // but the layer still thought it had a CC brush.
      // CC brushes should persist with their layers.
    };
  }, []); // Empty dependency array - only cleanup on unmount

  // Return simplified API - NO useMemo to avoid stale closures
  return {
    // Core drawing functions
    drawBrush,
    drawStamp,
    finalizeStroke,
    resetStroke,
    
    // Shape drawing
    drawRectangleGradient,
    drawPolygonGradient,
    drawContourPolygon,
    drawCrossHatchPolygon,
    drawDelaunayPolygon,
    
    // Color cycle brush
    drawColorCycle,
    renderColorCycle,
    resetColorCycle,
    endColorCycleStroke,
    fillColorCycleShape,
    fillColorCycleShapeLinear,
    
    // Force immediate texture update for color cycle brush
    updateColorCycleTexture: () => {
      const colorCycleBrush = getActiveLayerColorCycleBrush();
      if (colorCycleBrush) {
        renderBrushToLayerCanvas(colorCycleBrush, activeLayerId);
      }
    },
    
    // These need fresh ref access, define inline:
    updateColorCycleGradient: (stops: Array<{ position: number; color: string }>) => {
      const colorCycleBrush = getActiveLayerColorCycleBrush();
      if (!colorCycleBrush || !activeLayerId) {
        return;
      }
      const state = useAppStore.getState();
      const layer = state.layers.find((entry) => entry.id === activeLayerId);
      const { activeSlot } = resolveColorCycleGradientsForLayer(layer, state.tools.brushSettings);
      colorCycleBrush.setGradientSlot(activeLayerId, activeSlot, stops);
      colorCycleBrush.setActiveGradientSlot(activeLayerId, activeSlot);

      // Force the brush to rebuild its palette caches immediately so the next render uses
      // the updated gradient without waiting for the animation loop.
      const { layers, setLayersNeedRecomposition } = useAppStore.getState();
      const activeLayer = layers.find(layer => layer.id === activeLayerId);
      const layerCanvas = activeLayer?.colorCycleData?.canvas;

      if (layerCanvas && typeof colorCycleBrush.renderDirectToCanvas === 'function') {
        try {
          bindBrushToCanvas(colorCycleBrush, layerCanvas);
          colorCycleBrush.renderDirectToCanvas?.(layerCanvas, activeLayerId);
        } catch (error) {
          console.warn('[ColorCycle] Failed to redraw layer canvas after gradient update:', error);
        }
      } else {
        renderBrushToLayerCanvas(colorCycleBrush, activeLayerId);
      }

      try {
        setLayersNeedRecomposition(true);
      } catch {}
    },
    
    updateColorCycleSpeed: (speed: number) => {
      const colorCycleBrush = getActiveLayerColorCycleBrush();
      if (colorCycleBrush) {
        colorCycleBrush.setSpeed(speed);
      }
    },
    
    setColorCycleFlowMode: (mode: 'forward' | 'reverse' | 'pingpong') => {
      const colorCycleBrush = getActiveLayerColorCycleBrush();
      if (colorCycleBrush) {
        if (typeof colorCycleBrush.setFlowMode === 'function') {
          colorCycleBrush.setFlowMode(mode);
        } else {
          colorCycleBrush.setFlowDirection(mode === 'reverse' ? 'backward' : 'forward');
        }
      }
    },

    ensureColorCycleAnimation: (shouldPlay: boolean) => {
      ensureColorCycleAnimation(shouldPlay);
    },
    
    updateColorCycleAnimation: () => {
      // Manually update animation state for external render loops
      const colorCycleBrush = getActiveLayerColorCycleBrush();
      if (colorCycleBrush) {
        colorCycleBrush.updateAnimation();
      }
    },
    
    isColorCycleAnimating: () => {
      const colorCycleBrush = getActiveLayerColorCycleBrush();
      if (!colorCycleBrush) return false;
      return colorCycleBrush.isPlaying();
    },
    
    clearColorCycleStrokes: () => {
      const colorCycleBrush = getActiveLayerColorCycleBrush();
      if (colorCycleBrush) {
        colorCycleBrush.clear();
      }
    },

    ensureColorCycleBrush: () => {
      // CRITICAL: Only ensure brush for color-cycle layers
      const state = useAppStore.getState();
      const activeLayer = state.layers.find(l => l.id === activeLayerId);
      if (!activeLayer || activeLayer.layerType !== 'color-cycle') {
        // Silently skip for non-CC layers
        return;
      }
      
      // Ensure brush exists without starting a stroke
      let colorCycleBrush = getActiveLayerColorCycleBrush();
      if (!colorCycleBrush) {
        initializeColorCycleBrush();
        colorCycleBrush = getActiveLayerColorCycleBrush();
      }
      // Make sure it's not in drawing mode for animation
      const layerId = activeLayerId;
      if (colorCycleBrush && layerId) {
        colorCycleBrush.endStroke(layerId);
      }
    },

    // Effects
    applyStrokeDither,
    applyDithering,
    
    // Utilities
    canDrawAt: (ctx: CanvasRenderingContext2D, x: number, y: number) => 
      brushEngine.canDrawAt(ctx, x, y),
    
    // Direct access to engine for advanced use
    engine: brushEngine
  };
};

// Export type for the hook return value
export type BrushEngine = ReturnType<typeof useBrushEngineSimplified>;
