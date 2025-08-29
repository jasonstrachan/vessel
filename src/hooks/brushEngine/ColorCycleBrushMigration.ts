/**
 * ColorCycleBrushMigration - Wrapper that switches between WebGL and Canvas2D implementations
 * Provides seamless migration path with fallback support
 */

import { featureFlags } from '../../config/featureFlags';
import { ColorCycleBrush } from './ColorCycleBrush'; // Original WebGL implementation
import { ColorCycleBrushCanvas2D } from './ColorCycleBrushCanvas2D'; // New Canvas2D implementation

export type ColorCycleBrushImplementation = ColorCycleBrush | ColorCycleBrushCanvas2D;

/**
 * Factory function to create the appropriate ColorCycleBrush implementation
 */
export function createColorCycleBrush(
  canvas: HTMLCanvasElement,
  options?: { brushSize?: number; fps?: number }
): ColorCycleBrushImplementation {
  
  // Check feature flag
  const useCanvas2D = featureFlags.useCanvas2DColorCycle;
  
  if (featureFlags.logColorCycleOperations) {
    console.log(`[ColorCycle] Creating ${useCanvas2D ? 'Canvas2D' : 'WebGL'} implementation`);
  }
  
  try {
    if (useCanvas2D) {
      // Try Canvas2D implementation first
      return new ColorCycleBrushCanvas2D(canvas, options);
    } else {
      // Use WebGL implementation
      return createWebGLBrush(canvas, options);
    }
  } catch (error) {
    console.warn('[ColorCycle] Failed to create primary implementation, falling back:', error);
    
    // Fallback logic
    if (useCanvas2D) {
      // If Canvas2D failed, try WebGL
      try {
        console.log('[ColorCycle] Falling back to WebGL implementation');
        return createWebGLBrush(canvas, options);
      } catch (webglError) {
        console.error('[ColorCycle] WebGL fallback also failed:', webglError);
        throw new Error('Failed to create ColorCycleBrush: Both Canvas2D and WebGL implementations failed');
      }
    } else {
      // If WebGL failed, try Canvas2D
      try {
        console.log('[ColorCycle] Falling back to Canvas2D implementation');
        return new ColorCycleBrushCanvas2D(canvas, options);
      } catch (canvas2dError) {
        console.error('[ColorCycle] Canvas2D fallback also failed:', canvas2dError);
        throw new Error('Failed to create ColorCycleBrush: Both WebGL and Canvas2D implementations failed');
      }
    }
  }
}

/**
 * Helper to create WebGL brush with proper error handling
 */
function createWebGLBrush(
  canvas: HTMLCanvasElement,
  options?: { brushSize?: number; fps?: number }
): ColorCycleBrush {
  // Check WebGL availability
  const testCanvas = document.createElement('canvas');
  const gl = testCanvas.getContext('webgl') || testCanvas.getContext('experimental-webgl');
  
  if (!gl) {
    throw new Error('WebGL not supported on this device');
  }
  
  return new ColorCycleBrush(canvas, options);
}

/**
 * Migration helper to detect which implementation is being used
 */
export function getImplementationType(brush: ColorCycleBrushImplementation): 'webgl' | 'canvas2d' {
  if (brush instanceof ColorCycleBrushCanvas2D) {
    return 'canvas2d';
  }
  return 'webgl';
}

/**
 * Performance comparison helper for testing
 */
export class ColorCycleBrushComparator {
  private webglBrush: ColorCycleBrush | null = null;
  private canvas2dBrush: ColorCycleBrushCanvas2D | null = null;
  private metrics: {
    webgl: { renderTime: number[]; paintTime: number[] };
    canvas2d: { renderTime: number[]; paintTime: number[] };
  } = {
    webgl: { renderTime: [], paintTime: [] },
    canvas2d: { renderTime: [], paintTime: [] }
  };
  
  constructor(
    private canvas1: HTMLCanvasElement,
    private canvas2: HTMLCanvasElement,
    private options?: { brushSize?: number; fps?: number }
  ) {
    this.initialize();
  }
  
  private initialize() {
    try {
      this.webglBrush = new ColorCycleBrush(this.canvas1, this.options);
    } catch (error) {
      console.warn('[Comparator] WebGL initialization failed:', error);
    }
    
    try {
      this.canvas2dBrush = new ColorCycleBrushCanvas2D(this.canvas2, this.options);
    } catch (error) {
      console.warn('[Comparator] Canvas2D initialization failed:', error);
    }
  }
  
  /**
   * Run paint operation on both implementations and measure performance
   */
  comparePaint(x: number, y: number, layerId?: string): void {
    if (this.webglBrush) {
      const start = performance.now();
      this.webglBrush.paint(x, y, layerId);
      const end = performance.now();
      this.metrics.webgl.paintTime.push(end - start);
    }
    
    if (this.canvas2dBrush) {
      const start = performance.now();
      this.canvas2dBrush.paint(x, y, layerId);
      const end = performance.now();
      this.metrics.canvas2d.paintTime.push(end - start);
    }
  }
  
  /**
   * Run render operation on both implementations and measure performance
   */
  compareRender(): void {
    if (this.webglBrush) {
      const start = performance.now();
      this.webglBrush.render(false);
      const end = performance.now();
      this.metrics.webgl.renderTime.push(end - start);
    }
    
    if (this.canvas2dBrush) {
      const start = performance.now();
      this.canvas2dBrush.render(false);
      const end = performance.now();
      this.metrics.canvas2d.renderTime.push(end - start);
    }
  }
  
  /**
   * Get performance comparison results
   */
  getMetrics(): {
    webgl: { avgPaintTime: number; avgRenderTime: number };
    canvas2d: { avgPaintTime: number; avgRenderTime: number };
    recommendation: 'webgl' | 'canvas2d';
  } {
    const avgWebGLPaint = this.average(this.metrics.webgl.paintTime);
    const avgWebGLRender = this.average(this.metrics.webgl.renderTime);
    const avgCanvas2DPaint = this.average(this.metrics.canvas2d.paintTime);
    const avgCanvas2DRender = this.average(this.metrics.canvas2d.renderTime);
    
    // Determine recommendation based on overall performance
    const webglTotal = avgWebGLPaint + avgWebGLRender;
    const canvas2dTotal = avgCanvas2DPaint + avgCanvas2DRender;
    
    return {
      webgl: { avgPaintTime: avgWebGLPaint, avgRenderTime: avgWebGLRender },
      canvas2d: { avgPaintTime: avgCanvas2DPaint, avgRenderTime: avgCanvas2DRender },
      recommendation: canvas2dTotal <= webglTotal ? 'canvas2d' : 'webgl'
    };
  }
  
  private average(numbers: number[]): number {
    if (numbers.length === 0) return 0;
    return numbers.reduce((a, b) => a + b, 0) / numbers.length;
  }
  
  /**
   * Cleanup both implementations
   */
  cleanup(): void {
    this.webglBrush?.destroy();
    this.canvas2dBrush?.destroy();
  }
}