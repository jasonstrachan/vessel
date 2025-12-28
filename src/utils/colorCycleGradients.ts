/**
 * Shared gradient management for Color Cycle brushes
 * Both Color Cycle Stroke and Color Cycle Shape brushes use this module
 * to ensure they share the same gradient settings
 */

import { useAppStore } from '@/stores/useAppStore';
import { DEFAULT_GRADIENT_STOPS } from '@/utils/gradientPresets';

export const DEFAULT_COLOR_CYCLE_GRADIENT = DEFAULT_GRADIENT_STOPS;

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

const applyColorCycleGradientEdit = (
  gradient: Array<{ position: number; color: string }>,
  layerId?: string,
  options?: { fork?: boolean }
): void => {
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

  let activeGradientId = colorCycleData.activeGradientId ?? gradientDefs[0].id;
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
 * Set the shared gradient for both color cycle brushes.
 * Editing in the UI forks the active gradient once, then updates the fork in place.
 */
export function setSharedColorCycleGradient(
  gradient: Array<{ position: number; color: string }>,
  options?: { fork?: boolean }
): void {
  const state = useAppStore.getState();
  const setBrushSettings = state.setBrushSettings;
  const setEraserSettings = state.setEraserSettings;
  const activeLayerId = state.activeLayerId;
  
  // Update brush settings
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
