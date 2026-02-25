/**
 * ColorCycleBrushMigration - runtime shim for color cycle brush implementation
 * Uses Canvas2D rendering with optional WebGL acceleration controlled via feature flag.
 */

import { featureFlags } from '../../config/featureFlags';
import { ColorCycleBrushCanvas2D } from './ColorCycleBrushCanvas2D';

export type ColorCycleBrushImplementation = ColorCycleBrushCanvas2D;

/**
 * Factory function to create ColorCycleBrush implementation
 */
export function createColorCycleBrush(
  canvas: HTMLCanvasElement,
  options?: { brushSize?: number; fps?: number }
): ColorCycleBrushImplementation {
  const useCanvas2D = featureFlags.useCanvas2DColorCycle;

  if (featureFlags.logColorCycleOperations) {
    console.log(`[ColorCycle] Creating brush (mode=${useCanvas2D ? 'canvas2d' : 'webgl'})`);
  }

  try {
    return new ColorCycleBrushCanvas2D(canvas, {
      ...(options ?? {}),
      forceCanvas2D: useCanvas2D,
    });
  } catch (error) {
    console.error('[ColorCycle] Failed to create brush implementation:', error);
    throw new Error('Failed to create ColorCycleBrush instance');
  }
}


/**
 * Migration helper to detect which implementation is being used
 */
export function getImplementationType(): 'canvas2d' {
  return 'canvas2d';
}

