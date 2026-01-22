/**
 * Shared gradient management for Color Cycle brushes
 * Both Color Cycle Stroke and Color Cycle Shape brushes use this module
 * to ensure they share the same gradient settings
 */

import { getColorCycleBrushManager } from '@/stores/colorCycleBrushManager';
import { useAppStore } from '@/stores/useAppStore';
import { DEFAULT_GRADIENT_STOPS } from '@/utils/gradientPresets';
import { parseCssColor } from '@/utils/color/parseCssColor';
import { rgbToHsl, hslToRgb } from '@/utils/imageProcessing';
import type { DerivedGradientSpec } from '@/types';

export const DEFAULT_COLOR_CYCLE_GRADIENT = DEFAULT_GRADIENT_STOPS;

const fgPendingByLayer = new Map<string, boolean>();

export const setFgPending = (layerId: string, value: boolean): void => {
  fgPendingByLayer.set(layerId, value);
};

export const isFgPending = (layerId: string): boolean =>
  fgPendingByLayer.get(layerId) === true;

/**
 * Get the current shared gradient for color cycle brushes
 */
export function getSharedColorCycleGradient(): Array<{ position: number; color: string }> {
  const state = useAppStore.getState();
  const brushSettings = state.tools.brushSettings;
  return brushSettings.colorCycleGradient || DEFAULT_GRADIENT_STOPS;
}

/**
 * Set the shared gradient for both color cycle brushes
 */

const cloneStops = (stops: Array<{ position: number; color: string }>) =>
  stops.map(stop => ({ position: stop.position, color: stop.color }));

const getNextGradientSlot = (usedSlots: Set<number>): number | null => {
  for (let i = 0; i < 256; i += 1) {
    if (!usedSlots.has(i)) {
      return i;
    }
  }
  return null;
};

type ManagedColorCycleBrush = {
  commitCurrentStroke?: (layerId?: string) => void;
  finalizeCurrentStroke?: (layerId?: string) => void;
  flush?: (layerId?: string) => void;
  setGradientSlot?: (layerId: string, slot: number, stops: Array<{ position: number; color: string }>) => void;
  setActiveGradientSlot?: (layerId: string, slot: number) => void;
  renderDirectToCanvas?: (canvas: HTMLCanvasElement, layerId: string) => void;
  setTargetCanvas?: (canvas: HTMLCanvasElement | null) => void;
};

const applySelectedCCGradient = (
  layerId: string,
  nextSlot: number,
  nextStops: Array<{ position: number; color: string }>
): void => {
  const st = useAppStore.getState();
  if (st.tools.brushSettings.colorCycleUseForegroundGradient) {
    return;
  }
  const state = useAppStore.getState();
  const layer = state.layers.find(l => l.id === layerId);
  if (!layer || layer.layerType !== 'color-cycle') {
    return;
  }

  const manager = getColorCycleBrushManager();
  const brush = manager.getBrush(layerId) as ManagedColorCycleBrush | undefined;
  const canvas = layer.colorCycleData?.canvas as HTMLCanvasElement | undefined;

  try {
    brush?.commitCurrentStroke?.(layerId);
    brush?.finalizeCurrentStroke?.(layerId);
    brush?.flush?.(layerId);
  } catch {}

  try {
    brush?.setGradientSlot?.(layerId, nextSlot, nextStops);
    brush?.setActiveGradientSlot?.(layerId, nextSlot);
  } catch {}

  try {
    if (brush && canvas) {
      brush.setTargetCanvas?.(canvas);
      brush.renderDirectToCanvas?.(canvas, layerId);
    }
  } catch {}

  try {
    window.dispatchEvent(new CustomEvent('colorCycleFrameUpdate', { detail: { onlyActiveLayer: true } }));
  } catch {}
};

const applyColorCycleGradientEdit = (
  gradient: Array<{ position: number; color: string }>,
  layerId?: string,
  options?: { fork?: boolean }
): void => {
  const st = useAppStore.getState();
  if (st.tools.brushSettings.colorCycleUseForegroundGradient) {
    return;
  }
  const state = useAppStore.getState();
  const updateLayer = state.updateLayer;
  const targetLayerId = layerId ?? state.activeLayerId;
  if (!targetLayerId) return;

  const layer = state.layers.find(l => l.id === targetLayerId);
  if (!layer || layer.layerType !== 'color-cycle') {
    return;
  }

  const colorCycleData = layer.colorCycleData;
  if (!colorCycleData) {
    return;
  }

  // If recolor mode is active, do NOT mutate layer here to avoid partial state flashes
  if (colorCycleData.recolorSettings) {
    return;
  }

  const fallbackStops = colorCycleData.gradient ?? gradient ?? DEFAULT_GRADIENT_STOPS;
  const legacyGradients = colorCycleData.gradients ?? [];
  let gradientDefs = colorCycleData.gradientDefs?.length
    ? colorCycleData.gradientDefs.map(entry => ({
        id: entry.id,
        name: entry.name,
        currentSlot: entry.currentSlot,
      }))
    : legacyGradients.length > 0
      ? legacyGradients.map(entry => ({ id: entry.id, currentSlot: entry.slot }))
      : [{ id: 'g0', currentSlot: 0 }];
  let slotPalettes = colorCycleData.slotPalettes?.length
    ? colorCycleData.slotPalettes.map(entry => ({
        slot: entry.slot,
        stops: cloneStops(entry.stops),
      }))
    : legacyGradients.length > 0
      ? legacyGradients.map(entry => ({ slot: entry.slot, stops: cloneStops(entry.stops) }))
      : [{ slot: 0, stops: cloneStops(fallbackStops) }];

  const activeGradientId = colorCycleData.activeGradientId ?? gradientDefs[0].id;
  let activeDef = gradientDefs.find(entry => entry.id === activeGradientId) ?? gradientDefs[0];
  if (!activeDef) {
    activeDef = { id: activeGradientId, currentSlot: 0 };
    gradientDefs = [...gradientDefs, activeDef];
  }

  const shouldFork = options?.fork === true;
  if (shouldFork) {
    const usedSlots = new Set(slotPalettes.map(entry => entry.slot));
    const nextSlot = getNextGradientSlot(usedSlots);
    if (nextSlot !== null) {
      activeDef = { ...activeDef, currentSlot: nextSlot };
      gradientDefs = gradientDefs.map(entry => entry.id === activeDef.id ? activeDef : entry);
      slotPalettes = [
        ...slotPalettes,
        { slot: nextSlot, stops: cloneStops(gradient) },
      ];
    }
  }

  const slotIndex = slotPalettes.findIndex(entry => entry.slot === activeDef.currentSlot);
  if (slotIndex >= 0) {
    const updated = [...slotPalettes];
    updated[slotIndex] = { ...updated[slotIndex], stops: cloneStops(gradient) };
    slotPalettes = updated;
  } else {
    slotPalettes = [...slotPalettes, { slot: activeDef.currentSlot, stops: cloneStops(gradient) }];
  }

  applySelectedCCGradient(layer.id, activeDef.currentSlot, cloneStops(gradient));

  updateLayer(targetLayerId, {
    colorCycleData: {
      ...colorCycleData,
      gradientDefs,
      slotPalettes,
      activeGradientId: activeDef.id,
      gradient: cloneStops(gradient),
    },
  });
};

/**
 * Update a color-cycle layer's gradient without mutating global brush settings.
 */
export function setLayerColorCycleGradient(
  gradient: Array<{ position: number; color: string }>,
  layerId?: string,
  options?: { fork?: boolean }
): void {
  const state = useAppStore.getState();
  if (state.tools.brushSettings.colorCycleUseForegroundGradient) {
    return;
  }
  applyColorCycleGradientEdit(gradient, layerId, options);
}

/**
 * Set the shared gradient for both color cycle brushes.
 * Editing in the UI forks the active gradient once, then updates the fork in place.
 */
export function setSharedColorCycleGradient(
  gradient: Array<{ position: number; color: string }>,
  options?: { fork?: boolean }
): void {
  const state = useAppStore.getState();
  if (state.tools.brushSettings.colorCycleUseForegroundGradient) {
    return;
  }
  const setBrushSettings = state.setBrushSettings;
  const setEraserSettings = state.setEraserSettings;
  const activeLayerId = state.activeLayerId;
  
  // Update brush settings
  setBrushSettings({ ...state.tools.brushSettings, colorCycleGradient: gradient });
  
  // Also update eraser settings if using color cycle
  const eraserSettings = state.tools.eraserSettings;
  if (isColorCycleBrush(eraserSettings.brushShape)) {
    setEraserSettings({ colorCycleGradient: gradient });
  }

  // Propagate to active layer if it's a color-cycle layer (brush-mode only)
  if (activeLayerId) {
    applyColorCycleGradientEdit(gradient, activeLayerId, options);
  }
}

/**
 * Get all shared color cycle settings
 */
export function getSharedColorCycleSettings() {
  const state = useAppStore.getState();
  const settings = state.tools.brushSettings;
  
  return {
    gradient: settings.colorCycleGradient || DEFAULT_GRADIENT_STOPS,
    speed: settings.colorCycleSpeed || 0.1,
    fps: settings.colorCycleFPS || 30,
    flowMode: settings.colorCycleFlowMode ?? 'reverse',
    gradientBands: settings.gradientBands || 12
  };
}

/**
 * Check if a brush shape is a color cycle variant
 */
export function isColorCycleBrush(brushShape: string | undefined): boolean {
  const shapeStr = brushShape?.toString();
  return shapeStr === 'color_cycle' ||
         shapeStr === 'color_cycle_triangle' ||
         shapeStr === 'color_cycle_shape';
}

/**
 * Determine if shape mode should be forced for a brush
 */
export function getShapeModeForBrush(brushShape: string | undefined): boolean | undefined {
  const shapeStr = brushShape?.toString();
  if (shapeStr === 'color_cycle') {
    return false; // Force shape mode OFF for stroke variant
  }
  if (shapeStr === 'color_cycle_triangle') {
    return false; // Triangle variant behaves like stroke mode
  }
  if (shapeStr === 'color_cycle_shape') {
    return true; // Force shape mode ON for shape variant
  }
  return undefined; // Let user control for other brushes
}

const clamp = (value: number, min: number, max: number): number => {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.max(min, Math.min(max, value));
};

const toHex = (value: number): string => clamp(Math.round(value), 0, 255).toString(16).padStart(2, '0');

const rgbToHex = (r: number, g: number, b: number): string =>
  `#${toHex(r)}${toHex(g)}${toHex(b)}`;

const FG_DERIVED_ALGO_VERSION_LEGACY = 1;
const FG_DERIVED_ALGO_VERSION_SEPARATE = 2;
const FG_DERIVED_COLOR_BITS = 5;
const FG_DERIVED_LIGHTNESS_STEP = 5;
const FG_DERIVED_VARIANCE_STEP = 5;
const FG_DERIVED_HUE_SHIFT_STEP = 5;
const FG_DERIVED_SAT_SHIFT_STEP = 5;
const FG_DERIVED_OPACITY_STEP = 5;
const FG_DERIVED_MAX_BANDS = 6;
const FG_DERIVED_HUE_SHIFT_RANGE = 320;
const FG_DERIVED_SAT_SHIFT_RANGE = 45;

export const DEFAULT_FG_DERIVED_LIGHTNESS = 50;
export const DEFAULT_FG_DERIVED_VARIANCE = 0;

const quantizeStep = (value: number, step: number): number => {
  if (!Number.isFinite(value) || step <= 0) {
    return 0;
  }
  const clamped = clamp(value, 0, 100);
  return clamp(Math.round(clamped / step) * step, 0, 100);
};

const quantizeSignedStep = (value: number, step: number, min: number, max: number): number => {
  if (!Number.isFinite(value) || step <= 0) {
    return 0;
  }
  const clamped = clamp(value, min, max);
  return clamp(Math.round(clamped / step) * step, min, max);
};

const quantizeChannel = (value: number, bits: number): number => {
  const steps = Math.max(2, 1 << bits);
  const clamped = clamp(value, 0, 255);
  return Math.round((clamped / 255) * (steps - 1));
};

export const clampForegroundDerivedBands = (bands: number | undefined): number => {
  if (typeof bands !== 'number' || !Number.isFinite(bands)) {
    return 2;
  }
  return clamp(Math.round(bands), 2, FG_DERIVED_MAX_BANDS);
};

export const buildForegroundDerivedGradientSpec = (params: {
  baseColor: string;
  lightness?: number;
  variance?: number;
  hueShift?: number;
  saturationShift?: number;
  opacity?: number;
  bands?: number;
  algoVersion?: number;
}): DerivedGradientSpec => {
  const parsed = parseCssColor(params.baseColor, { r: 255, g: 255, b: 255, a: 255 });
  const normalizedBase = rgbToHex(parsed.r, parsed.g, parsed.b);
  const lightness = clamp(Math.round(params.lightness ?? DEFAULT_FG_DERIVED_LIGHTNESS), 0, 100);
  const opacity = clamp(Math.round(params.opacity ?? 100), 0, 100);
  const bands = clampForegroundDerivedBands(params.bands);
  const hasExplicitShift =
    Number.isFinite(params.hueShift) ||
    Number.isFinite(params.saturationShift);

  if (hasExplicitShift) {
    const hueShift = clamp(
      Math.round(params.hueShift ?? 0),
      -FG_DERIVED_HUE_SHIFT_RANGE,
      FG_DERIVED_HUE_SHIFT_RANGE
    );
    const saturationShift = clamp(
      Math.round(params.saturationShift ?? 0),
      -FG_DERIVED_SAT_SHIFT_RANGE,
      FG_DERIVED_SAT_SHIFT_RANGE
    );
    const algoVersion = params.algoVersion ?? FG_DERIVED_ALGO_VERSION_SEPARATE;
    const key = [
      'fg',
      algoVersion,
      normalizedBase,
      quantizeChannel(parsed.r, FG_DERIVED_COLOR_BITS),
      quantizeChannel(parsed.g, FG_DERIVED_COLOR_BITS),
      quantizeChannel(parsed.b, FG_DERIVED_COLOR_BITS),
      quantizeStep(lightness, FG_DERIVED_LIGHTNESS_STEP),
      quantizeStep(opacity, FG_DERIVED_OPACITY_STEP),
      quantizeSignedStep(hueShift, FG_DERIVED_HUE_SHIFT_STEP, -FG_DERIVED_HUE_SHIFT_RANGE, FG_DERIVED_HUE_SHIFT_RANGE),
      quantizeSignedStep(
        saturationShift,
        FG_DERIVED_SAT_SHIFT_STEP,
        -FG_DERIVED_SAT_SHIFT_RANGE,
        FG_DERIVED_SAT_SHIFT_RANGE
      ),
      bands,
    ].join(':');

    return {
      mode: 'fg-derived',
      baseColor: normalizedBase,
      lightness,
      hueShift,
      saturationShift,
      opacity,
      bands,
      algoVersion,
      key,
    };
  }

  const variance = clamp(Math.round(params.variance ?? DEFAULT_FG_DERIVED_VARIANCE), 0, 100);
  const algoVersion = params.algoVersion ?? FG_DERIVED_ALGO_VERSION_LEGACY;

  const key = [
    'fg',
    algoVersion,
    normalizedBase,
    quantizeChannel(parsed.r, FG_DERIVED_COLOR_BITS),
    quantizeChannel(parsed.g, FG_DERIVED_COLOR_BITS),
    quantizeChannel(parsed.b, FG_DERIVED_COLOR_BITS),
    quantizeStep(lightness, FG_DERIVED_LIGHTNESS_STEP),
    quantizeStep(opacity, FG_DERIVED_OPACITY_STEP),
    quantizeStep(variance, FG_DERIVED_VARIANCE_STEP),
    bands,
  ].join(':');

  return {
    mode: 'fg-derived',
    baseColor: normalizedBase,
    lightness,
    variance,
    opacity,
    bands,
    algoVersion,
    key,
  };
};

export const deriveForegroundGradientStops = (spec: DerivedGradientSpec): Array<{ position: number; color: string }> => {
  const parsed = parseCssColor(spec.baseColor, { r: 255, g: 255, b: 255, a: 255 });
  const [baseH, baseS, baseL] = rgbToHsl(parsed.r, parsed.g, parsed.b);
  const bands = Math.max(2, Math.round(spec.bands));
  const baseLAdjusted = clamp(baseL, 0, 100);
  let derivedH = baseH;
  let derivedS = baseS;
  let derivedL = clamp(spec.lightness, 0, 100);

  const opacity = clamp(spec.opacity ?? 100, 0, 100) / 100;

  if (spec.algoVersion >= FG_DERIVED_ALGO_VERSION_SEPARATE) {
    const hueShift = clamp(
      spec.hueShift ?? 0,
      -FG_DERIVED_HUE_SHIFT_RANGE,
      FG_DERIVED_HUE_SHIFT_RANGE
    );
    const satShift = clamp(
      spec.saturationShift ?? 0,
      -FG_DERIVED_SAT_SHIFT_RANGE,
      FG_DERIVED_SAT_SHIFT_RANGE
    );
    derivedH = (baseH + hueShift + 360) % 360;
    derivedS = clamp(Math.max(10, baseS + satShift + (baseS < 25 ? 20 : 0)), 0, 100);
    derivedL = clamp(spec.lightness, 0, 100);
  } else {
    const variance = clamp(spec.variance ?? DEFAULT_FG_DERIVED_VARIANCE, 0, 100);
    const varianceRange = clamp((variance / 100) * 70, 0, 70);
    const hueShift = clamp((variance / 100) * 60, 0, 60);
    const satShift = clamp((variance / 100) * 45, 0, 45);
    derivedH = (baseH + hueShift) % 360;
    derivedS = clamp(Math.max(10, baseS + satShift + (baseS < 25 ? 20 : 0)), 0, 100);
    const lPush = baseLAdjusted >= 50 ? -varianceRange : varianceRange;
    derivedL = clamp(spec.lightness + lPush, 0, 100);
  }
  const [derivedR, derivedG, derivedB] = hslToRgb(derivedH, derivedS, derivedL);
  const baseColor = rgbToHex(parsed.r, parsed.g, parsed.b);
  const derivedColor = opacity >= 1
    ? rgbToHex(derivedR, derivedG, derivedB)
    : `rgba(${derivedR}, ${derivedG}, ${derivedB}, ${opacity})`;
  const stops: Array<{ position: number; color: string }> = [];

  for (let i = 0; i < bands; i += 1) {
    const t = bands === 1 ? 0 : i / (bands - 1);
    const color = i % 2 === 0 ? baseColor : derivedColor;
    stops.push({ position: t, color });
  }

  return stops;
};
