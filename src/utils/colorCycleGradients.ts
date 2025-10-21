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
export function setSharedColorCycleGradient(gradient: Array<{ position: number; color: string }>): void {
  const state = useAppStore.getState();
  const setBrushSettings = state.setBrushSettings;
  const setEraserSettings = state.setEraserSettings;
  const updateLayer = state.updateLayer;
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
    const layer = state.layers.find(l => l.id === activeLayerId);
    if (layer && layer.layerType === 'color-cycle') {
      // If recolor mode is active, do NOT mutate layer here to avoid partial state flashes
      // RecolorPanel handles its own gradient updates safely via RecolorManager
      const recolor = layer.colorCycleData?.recolorSettings;
      if (!recolor && layer.colorCycleData) {
        // Otherwise update brush-mode gradient field for consistency
        updateLayer(activeLayerId, {
          colorCycleData: {
            ...layer.colorCycleData,
            gradient
          }
        });
      }
    }
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
    flowForward: settings.colorCycleFlowForward !== false,
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
