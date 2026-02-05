/**
 * Shared gradient management for Color Cycle brushes
 * Both Color Cycle Stroke and Color Cycle Shape brushes use this module
 * to ensure they share the same gradient settings
 */

import { useAppStore } from '@/stores/useAppStore';
import { DEFAULT_GRADIENT_STOPS } from '@/utils/gradientPresets';
import { parseCssColor } from '@/utils/color/parseCssColor';
import { rgbToHsl, hslToRgb } from '@/utils/imageProcessing';
import { FLOW_SLOT_MASK } from '@/lib/colorCycle/flowEncoding';
import type { DerivedGradientSpec } from '@/types';
import { applyGradientEdit } from '@/hooks/brushEngine/ccGradientController';
import { cancelGradientApply } from '@/hooks/brushEngine/ccGradientApplyScheduler';
import { TEMP_SAMPLE_SLOT } from '@/constants/colorCycle';
import {
  rebuildGradientSlotUsageAndGC,
  rebuildOnDemandAndRetryAllocate,
  buildDefaultReservedSlots,
} from '@/utils/colorCycleSlotGC';

export const DEFAULT_COLOR_CYCLE_GRADIENT = DEFAULT_GRADIENT_STOPS;
export const EDITOR_SLOT = 255;

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

const normalizeEditorSlot = (slot: number): number =>
  slot & FLOW_SLOT_MASK;

function ensureGradientDefForGid(
  gradientDefs: Array<{ id: string; name?: string; currentSlot: number }>,
  gid: number
): { gradientDefs: Array<{ id: string; name?: string; currentSlot: number }>; activeGradientId: string } {
  const id = `g${gid}`;
  const existing = gradientDefs.find((entry) => entry.id === id);
  if (existing) {
    const updatedDefs = gradientDefs.map((entry) =>
      entry.id === id ? { ...entry, currentSlot: gid } : entry
    );
    return { gradientDefs: updatedDefs, activeGradientId: id };
  }
  return {
    gradientDefs: [...gradientDefs, { id, currentSlot: gid }],
    activeGradientId: id,
  };
}

const getNextGradientSlot = (usedSlots: Set<number>): number | null => {
  for (let i = 0; i <= FLOW_SLOT_MASK; i += 1) {
    if (i === EDITOR_SLOT) {
      continue;
    }
    if (!usedSlots.has(i)) {
      return i;
    }
  }
  return null;
};

const runProjectSlotRebuild = (layerId: string) => {
  const state = useAppStore.getState();
  const result = rebuildGradientSlotUsageAndGC({
    layers: state.layers,
    scope: 'project',
    reservedSlots: buildDefaultReservedSlots(),
  });
  if (!result) {
    return null;
  }
  if (result.missingDefLayers && result.missingDefLayers.length > 0) {
    if (process.env.NODE_ENV !== 'production') {
      console.error('[CC] Slot GC aborted due to missing defs', {
        layerId,
        missingDefLayers: result.missingDefLayers,
      });
    }
    return result;
  }
  result.updates.forEach((update) => {
    state.updateLayer(update.layerId, { colorCycleData: update.colorCycleData });
  });
  if (process.env.NODE_ENV !== 'production' && process.env.NODE_ENV !== 'test') {
    console.info('[CC] Slot GC rebuild summary', { layerId, ...result.stats });
  }
  return result;
};

type ForegroundSlotResult = {
  slot: number;
  stops: Array<{ position: number; color: string }>;
};

export const ensureForegroundGradientSlot = (layerId: string): ForegroundSlotResult | null => {
  const state = useAppStore.getState();
  const layer = state.layers.find(l => l.id === layerId);
  if (!layer || layer.layerType !== 'color-cycle') {
    return null;
  }

  const brushSettings = state.tools.brushSettings;
  const palette = state.palette;
  const baseColor = palette?.foregroundColor ?? brushSettings.color ?? '#ffffff';
  const bands = clampForegroundDerivedBands(brushSettings.colorCycleFgStops);
  const derivedSpec = buildForegroundDerivedGradientSpec({
    baseColor,
    lightness: brushSettings.colorCycleFgLightness,
    variance: brushSettings.colorCycleFgVariance,
    hueShift: brushSettings.colorCycleFgHueShift,
    saturationShift: brushSettings.colorCycleFgSaturationShift,
    opacity: brushSettings.colorCycleFgOpacity,
    bands,
  });
  const derivedStops = deriveForegroundGradientStops(derivedSpec);
  if (!derivedStops || derivedStops.length < 2) {
    return null;
  }

  const colorCycleData = layer.colorCycleData ?? {};
  const derivedGradients =
    colorCycleData.fgDerivedGradients ??
    colorCycleData.derivedGradients ??
    [];
  const existingDerived = derivedGradients.find((entry) => entry.key === derivedSpec.key);
  const existingSlot = existingDerived?.slot ?? null;
  const defSlots = new Set<number>();
  colorCycleData.gradientDefStore?.forEach((entry) => {
    if (typeof entry.slot === 'number') {
      defSlots.add(normalizeEditorSlot(entry.slot));
    }
  });

  const slotPalettes = colorCycleData.slotPalettes?.length
    ? colorCycleData.slotPalettes.map(entry => ({
        slot: normalizeEditorSlot(entry.slot),
        stops: cloneStops(entry.stops),
      }))
    : [];

  let targetSlot: number | null = existingSlot;
  let nextSlotPalettes = slotPalettes;
  let nextDerivedGradients = derivedGradients;

  if (targetSlot !== null) {
    if (defSlots.has(normalizeEditorSlot(targetSlot))) {
      targetSlot = null;
    }
    if (targetSlot !== null) {
      const resolvedSlot = normalizeEditorSlot(targetSlot);
      const existingPalette = slotPalettes.find((entry) => entry.slot === resolvedSlot);
      if (existingPalette) {
        nextSlotPalettes = slotPalettes.map((entry) =>
          entry.slot === resolvedSlot ? { slot: resolvedSlot, stops: cloneStops(derivedStops) } : entry
        );
      } else {
        nextSlotPalettes = [...slotPalettes, { slot: resolvedSlot, stops: cloneStops(derivedStops) }];
      }
    }
  } else {
    const usedSlots = new Set<number>();
    slotPalettes.forEach((entry) => usedSlots.add(entry.slot));
    colorCycleData.gradientDefs?.forEach((entry) => {
      usedSlots.add(normalizeEditorSlot(entry.currentSlot));
    });
    defSlots.forEach((slot) => usedSlots.add(slot));
    usedSlots.add(EDITOR_SLOT);
    usedSlots.add(TEMP_SAMPLE_SLOT);
    const tryAssign = (slot: number | null) => {
      if (slot !== null) {
        targetSlot = slot;
        nextSlotPalettes = [...slotPalettes, { slot, stops: cloneStops(derivedStops) }];
        nextDerivedGradients = [
          ...derivedGradients,
          { key: derivedSpec.key, slot, spec: derivedSpec },
        ];
      }
    };
    const nextSlot = getNextGradientSlot(usedSlots);
    if (nextSlot !== null) {
      tryAssign(nextSlot);
    } else {
      rebuildOnDemandAndRetryAllocate({
        attemptAllocate: () => {
          const retryUsed = new Set<number>();
          const latest = useAppStore.getState().layers.find((entry) => entry.id === layerId);
          const latestData = latest?.colorCycleData;
          latestData?.slotPalettes?.forEach((entry) => retryUsed.add(entry.slot));
          latestData?.gradientDefs?.forEach((entry) => retryUsed.add(normalizeEditorSlot(entry.currentSlot)));
          latestData?.gradientDefStore?.forEach((entry) => {
            if (typeof entry.slot === 'number') {
              retryUsed.add(normalizeEditorSlot(entry.slot));
            }
          });
          retryUsed.add(EDITOR_SLOT);
          retryUsed.add(TEMP_SAMPLE_SLOT);
          const retrySlot = getNextGradientSlot(retryUsed);
          if (retrySlot !== null) {
            tryAssign(retrySlot);
            return retrySlot;
          }
          return null;
        },
        runRebuild: () => runProjectSlotRebuild(layerId),
        throttleKey: `cc-slot-rebuild:fg:${layerId}`,
        throttleMs: process.env.NODE_ENV === 'test' ? 0 : undefined,
      });
    }
  }

  if (targetSlot === null) {
    return null;
  }

  try {
    state.updateLayer(layerId, {
      colorCycleData: {
        ...colorCycleData,
        slotPalettes: nextSlotPalettes,
        fgActiveSlot: targetSlot,
        fgDerivedKey: derivedSpec.key,
        fgDerivedGradients: nextDerivedGradients,
      },
    });
  } catch {}

  return { slot: targetSlot, stops: cloneStops(derivedStops) };
};

const applyColorCycleGradientEdit = (
  gradient: Array<{ position: number; color: string }>,
  layerId?: string,
  options?: { fork?: boolean; allowForegroundOverride?: boolean; skipRender?: boolean }
): void => {
  const state = useAppStore.getState();
  if (state.tools.brushSettings.colorCycleUseForegroundGradient && !options?.allowForegroundOverride) {
    return;
  }
  const targetLayerId = layerId ?? state.activeLayerId ?? undefined;
  const intent = options?.fork ? 'commitFuture' : 'commitRecolor';
  applyGradientEdit({ stops: gradient, layerId: targetLayerId, intent });
  if (options?.skipRender && targetLayerId) {
    // Real-time sampling manages brush updates directly; skip the scheduled apply.
    cancelGradientApply(targetLayerId);
  }
};

export const allocateSlotForNewShapeFill = (
  layerId: string,
  stops: Array<{ position: number; color: string }>,
  options?: { setActive?: boolean }
): { slot: number; stops: Array<{ position: number; color: string }> } | null => {
  const state = useAppStore.getState();
  const layer = state.layers.find(l => l.id === layerId);
  if (!layer || layer.layerType !== 'color-cycle') {
    return null;
  }

  const colorCycleData = layer.colorCycleData ?? {};
  const fallbackStops =
    stops && stops.length > 0
      ? stops
      : colorCycleData.gradient ?? DEFAULT_GRADIENT_STOPS;

  const gradientDefs = colorCycleData.gradientDefs?.length
    ? colorCycleData.gradientDefs.map((entry) => ({
        id: entry.id,
        name: entry.name,
        currentSlot: entry.currentSlot,
      }))
    : [{ id: 'g0', currentSlot: 0 }];
  const slotPalettes = colorCycleData.slotPalettes?.length
    ? colorCycleData.slotPalettes.map(entry => ({
        slot: entry.slot,
        stops: cloneStops(entry.stops),
      }))
    : [{ slot: 0, stops: cloneStops(fallbackStops) }];

  const usedSlots = new Set<number>();
  slotPalettes.forEach((entry) => usedSlots.add(entry.slot));
  gradientDefs.forEach((entry) => usedSlots.add(entry.currentSlot));
  usedSlots.add(EDITOR_SLOT);
  usedSlots.add(TEMP_SAMPLE_SLOT);
  usedSlots.add(TEMP_SAMPLE_SLOT);

  let nextSlot = getNextGradientSlot(usedSlots);
  if (nextSlot === null) {
    rebuildOnDemandAndRetryAllocate({
      attemptAllocate: () => {
        const retryUsed = new Set<number>();
        const latest = useAppStore.getState().layers.find((entry) => entry.id === layerId);
        const latestData = latest?.colorCycleData;
        latestData?.slotPalettes?.forEach((entry) => retryUsed.add(entry.slot));
        latestData?.gradientDefs?.forEach((entry) => retryUsed.add(entry.currentSlot));
        retryUsed.add(EDITOR_SLOT);
        retryUsed.add(TEMP_SAMPLE_SLOT);
        retryUsed.add(TEMP_SAMPLE_SLOT);
        const retrySlot = getNextGradientSlot(retryUsed);
        if (retrySlot !== null) {
          nextSlot = retrySlot;
          return retrySlot;
        }
        return null;
      },
      runRebuild: () => runProjectSlotRebuild(layerId),
      throttleKey: `cc-slot-rebuild:shape:${layerId}`,
      throttleMs: process.env.NODE_ENV === 'test' ? 0 : undefined,
    });
  }
  if (nextSlot === null) {
    return null;
  }

  const nextSlotPalettes = [
    ...slotPalettes,
    { slot: nextSlot, stops: cloneStops(fallbackStops) },
  ];

  const defUpdate = ensureGradientDefForGid(gradientDefs, nextSlot);
  const setActive = options?.setActive !== false;

  state.updateLayer(layerId, {
    colorCycleData: {
      ...colorCycleData,
      gradientDefs: defUpdate.gradientDefs,
      slotPalettes: nextSlotPalettes,
      activeGradientId: setActive ? defUpdate.activeGradientId : colorCycleData.activeGradientId,
    },
  });

  return { slot: nextSlot, stops: cloneStops(fallbackStops) };
};

/**
 * Update a color-cycle layer's gradient without mutating global brush settings.
 */
export function setLayerColorCycleGradient(
  gradient: Array<{ position: number; color: string }>,
  layerId?: string,
  options?: { fork?: boolean; allowForegroundOverride?: boolean; skipRender?: boolean }
): void {
  const state = useAppStore.getState();
  if (state.tools.brushSettings.colorCycleUseForegroundGradient && !options?.allowForegroundOverride) {
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
  
  // Update brush settings without re-sending unrelated fields (avoids side-effects)
  setBrushSettings({ colorCycleGradient: gradient });
  
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
    flowMode: settings.colorCycleFlowMode ?? 'forward',
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
