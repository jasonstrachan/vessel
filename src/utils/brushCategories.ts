/**
 * Brush categorization utilities
 * Determines which features are applicable to different brush types
 */

import { BrushShape } from '@/types';

/**
 * Stroke-based brushes that draw stamps along a path
 */
export const STROKE_BRUSHES: BrushShape[] = [
  BrushShape.ROUND,
  BrushShape.SQUARE,
  BrushShape.PIXEL_ROUND,
  BrushShape.CUSTOM,
  BrushShape.RESAMPLER,
  BrushShape.COLOR_CYCLE,
  BrushShape.COLOR_CYCLE_TRIANGLE,
  BrushShape.RISOGRAPH_SOFT,
  BrushShape.RISOGRAPH_ULTRA
];

/**
 * Shape-fill brushes that draw complete shapes in one action
 */
export const SHAPE_FILL_BRUSHES: BrushShape[] = [
  BrushShape.RECTANGLE_GRADIENT,
  BrushShape.POLYGON_GRADIENT,
  BrushShape.CONTOUR_POLYGON,
  BrushShape.CONTOUR_LINES2,
  BrushShape.COLOR_CYCLE_SHAPE,
  BrushShape.SHAPE_FILL
];

/**
 * Check if a brush is stroke-based (supports rotation)
 */
export function isStrokeBrush(brushShape: BrushShape | string): boolean {
  // Handle both enum values and string values
  const shape = typeof brushShape === 'string' ? brushShape : String(brushShape);
  return STROKE_BRUSHES.some(b => String(b) === shape);
}

/**
 * Check if a brush is shape-fill based (no rotation)
 */
export function isShapeFillBrush(brushShape: BrushShape | string): boolean {
  // Handle both enum values and string values
  const shape = typeof brushShape === 'string' ? brushShape : String(brushShape);
  return SHAPE_FILL_BRUSHES.some(b => String(b) === shape);
}

/**
 * Check if a brush supports rotation
 */
export function supportsRotation(brushShape: BrushShape | string): boolean {
  return isStrokeBrush(brushShape);
}

/**
 * Check if a brush supports pressure
 */
export function supportsPressure(brushShape: BrushShape | string): boolean {
  // All stroke brushes support pressure
  // Shape-fill brushes don't use pressure as they're single-click shapes
  return isStrokeBrush(brushShape);
}

/**
 * Check if a brush supports dashed strokes
 */
export function supportsDashedStroke(brushShape: BrushShape | string): boolean {
  // Only stroke-based brushes can have dashed patterns
  return isStrokeBrush(brushShape);
}

/**
 * Check if a brush supports spacing control
 */
export function supportsSpacing(brushShape: BrushShape | string): boolean {
  // Stroke brushes use spacing between stamps
  // Shape-fill brushes don't have spacing
  return isStrokeBrush(brushShape);
}

export function supportsDither(brushShape: BrushShape | string): boolean {
  const shape = typeof brushShape === 'string' ? brushShape : String(brushShape);

  // Exclude text/resampler by default; they can opt-in via preset capabilities.
  if (shape === BrushShape.SPAM_TEXT || shape === BrushShape.RESAMPLER) {
    return false;
  }

  return (
    isStrokeBrush(shape) ||
    shape === BrushShape.RECTANGLE_GRADIENT ||
    shape === BrushShape.POLYGON_GRADIENT ||
    shape === BrushShape.SHAPE_FILL
  );
}
