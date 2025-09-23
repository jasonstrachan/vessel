/**
 * Utilities for aligning drawing coordinates to pixel boundaries.
 * These helpers centralize logic for "pixel sharp" rendering modes
 * where anti-aliasing should be avoided and strokes should land on
 * exact pixel centers.
 */

export type PixelSnapStrategy = 'nearest' | 'floor' | 'ceil' | 'center';

export interface PixelSnapOptions {
  strategy?: PixelSnapStrategy;
  /**
   * Optional manual offset applied after the main snapping step.
   * Useful when a brush requires a custom sub-pixel nudge.
   */
  offset?: number;
}

export interface PixelPoint {
  x: number;
  y: number;
}

/**
 * Snap a scalar value to a pixel boundary.
 * - `nearest` snaps to the nearest integer.
 * - `floor` snaps toward negative infinity.
 * - `ceil` snaps toward positive infinity.
 * - `center` snaps to the nearest pixel center (`n + 0.5`).
 */
export function snapScalarToPixel(value: number, strategy: PixelSnapStrategy = 'nearest'): number {
  if (!Number.isFinite(value)) return 0;

  switch (strategy) {
    case 'floor':
      return Math.floor(value);
    case 'ceil':
      return Math.ceil(value);
    case 'center':
      return Math.round(value) + 0.5;
    case 'nearest':
    default:
      return Math.round(value);
  }
}

/**
 * Snap a point to pixel boundaries using the provided strategy.
 * Returns a new point without mutating the input reference.
 */
export function snapPointToPixel(point: PixelPoint, options: PixelSnapOptions = {}): PixelPoint {
  const { strategy = 'nearest', offset = 0 } = options;

  return {
    x: snapScalarToPixel(point.x, strategy) + offset,
    y: snapScalarToPixel(point.y, strategy) + offset
  };
}

/**
 * Configure a canvas rendering context for pixel-sharp drawing.
 * Disables built-in image smoothing and ensures stroke alignment can
 * rely on pixel snapping helpers.
 */
export function enablePixelSharpContext(ctx: CanvasRenderingContext2D): void {
  ctx.imageSmoothingEnabled = false;
  if ('msImageSmoothingEnabled' in ctx) {
    (ctx as CanvasRenderingContext2D & { msImageSmoothingEnabled: boolean }).msImageSmoothingEnabled = false;
  }
}
