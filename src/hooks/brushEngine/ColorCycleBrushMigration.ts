/**
 * ColorCycleBrushMigration - Canvas2D-only implementation
 * All WebGL code has been removed - using pure Canvas2D
 */

import { featureFlags } from '../../config/featureFlags';
import { ColorCycleBrushCanvas2D } from './ColorCycleBrushCanvas2D'; // Canvas2D implementation

export type ColorCycleBrushImplementation = ColorCycleBrushCanvas2D;

/**
 * Factory function to create ColorCycleBrush implementation
 * Now only uses Canvas2D - WebGL has been removed
 */
export function createColorCycleBrush(
  canvas: HTMLCanvasElement,
  options?: { brushSize?: number; fps?: number }
): ColorCycleBrushImplementation {
  
  if (featureFlags.logColorCycleOperations) {
    console.log('[ColorCycle] Creating Canvas2D implementation (WebGL removed)');
  }
  
  try {
    return new ColorCycleBrushCanvas2D(canvas, options);
  } catch (error) {
    console.error('[ColorCycle] Failed to create Canvas2D implementation:', error);
    throw new Error('Failed to create ColorCycleBrush: Canvas2D implementation failed');
  }
}


/**
 * Migration helper to detect which implementation is being used
 * Always returns 'canvas2d' now since WebGL has been removed
 */
export function getImplementationType(): 'canvas2d' {
  return 'canvas2d';
}

