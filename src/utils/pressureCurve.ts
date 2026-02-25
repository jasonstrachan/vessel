/**
 * Pressure Curve Utilities
 * Provides smooth pressure curves using cubic Bezier easing functions
 * for natural-feeling pressure response across all brush types
 */

export type CurvePreset = 'linear' | 'soft' | 'hard' | 's-curve';

/**
 * Curve preset configurations
 * Each preset defines control points for a cubic Bezier curve
 */
const CURVE_PRESETS = {
  linear: { p1x: 0.5, p1y: 0.5, p2x: 0.5, p2y: 0.5 },
  soft: { p1x: 0.42, p1y: 0, p2x: 0.58, p2y: 0.42 },   // Ease-in (slow start, fast end)
  hard: { p1x: 0.42, p1y: 0.58, p2x: 0.58, p2y: 1 },   // Ease-out (fast start, slow end)  
  's-curve': { p1x: 0.25, p1y: 0.1, p2x: 0.75, p2y: 0.9 } // Natural S-curve
} as const;

/**
 * Fast cubic Bezier approximation
 * Optimized for real-time pressure calculations
 * 
 * @param t - Input value (0-1)
 * @param p1x - First control point X (0-1)
 * @param p1y - First control point Y (0-1)
 * @param p2x - Second control point X (0-1)
 * @param p2y - Second control point Y (0-1)
 * @returns Eased value (0-1)
 */
function cubicBezier(t: number, p1x: number, p1y: number, p2x: number, p2y: number): number {
  // Clamp input
  t = Math.max(0, Math.min(1, t));
  
  // Ensure endpoints are anchored
  if (t === 0) return 0;
  if (t === 1) return 1;
  
  // Special case: linear
  if (p1x === 0.5 && p1y === 0.5 && p2x === 0.5 && p2y === 0.5) {
    return t;
  }
  
  // Use simplified cubic Bezier formula for Y coordinate
  // This is an approximation that's fast and good enough for pressure curves
  const t2 = t * t;
  const t3 = t2 * t;
  const mt = 1 - t;
  const mt2 = mt * mt;

  // Calculate Y position on the curve
  // B(t) = (1-t)³·P0 + 3(1-t)²t·P1 + 3(1-t)t²·P2 + t³·P3
  // Since P0 = (0,0) and P3 = (1,1), this simplifies to:
  const y = 3 * mt2 * t * p1y + 3 * mt * t2 * p2y + t3;
  
  return Math.max(0, Math.min(1, y));
}

/**
 * Apply pressure curve with percentage-based min/max values
 * 
 * @param pressure - Raw pressure input (0-1)
 * @param minPercent - Minimum size as percentage of base (1-1000)
 * @param maxPercent - Maximum size as percentage of base (1-1000)
 * @param curveType - Type of curve to apply
 * @returns Curved pressure value (0-1) to be multiplied with size
 */
export function applyPressureCurve(
  pressure: number,
  minPercent: number = 1,
  maxPercent: number = 200,
  curveType: CurvePreset = 's-curve'
): number {
  // Clamp pressure to valid range
  pressure = Math.max(0, Math.min(1, pressure));
  
  // Handle edge cases explicitly
  if (pressure <= 0.001) {
    // Very low pressure - use minimum
    return minPercent / 100;
  }
  if (pressure >= 0.999) {
    // Very high pressure - use maximum
    return maxPercent / 100;
  }
  
  // Get curve preset
  const preset = CURVE_PRESETS[curveType];
  
  // Apply cubic Bezier curve to pressure
  const curvedPressure = cubicBezier(
    pressure,
    preset.p1x,
    preset.p1y,
    preset.p2x,
    preset.p2y
  );
  
  // Convert percentages to multipliers (1-1000 -> 0.01-10.0)
  const minMultiplier = minPercent / 100;
  const maxMultiplier = maxPercent / 100;
  
  // Interpolate between min and max using curved pressure
  return minMultiplier + (maxMultiplier - minMultiplier) * curvedPressure;
}

/**
 * Calculate pressure-adjusted size with smooth curve
 * 
 * @param baseSize - Base brush size in pixels
 * @param pressure - Raw pressure input (0-1)
 * @param minPercent - Minimum size as percentage (1-1000)
 * @param maxPercent - Maximum size as percentage (1-1000)
 * @param curveType - Type of curve to apply
 * @returns Adjusted brush size in pixels
 */
export function calculatePressureSize(
  baseSize: number,
  pressure: number,
  minPercent: number = 50,
  maxPercent: number = 200,
  curveType: CurvePreset = 's-curve'
): number {
  const multiplier = applyPressureCurve(pressure, minPercent, maxPercent, curveType);
  return Math.max(1, Math.round(baseSize * multiplier));
}

/**
 * Cache for pressure calculations to avoid redundant computations
 * Optional - can be used for high-frequency pressure updates
 */
export class PressureCurveCache {
  private cache = new Map<string, number>();
  private readonly maxEntries = 100;
  
  private getCacheKey(
    pressure: number,
    minPercent: number,
    maxPercent: number,
    curveType: CurvePreset
  ): string {
    return `${pressure.toFixed(3)}_${minPercent}_${maxPercent}_${curveType}`;
  }
  
  apply(
    pressure: number,
    minPercent: number,
    maxPercent: number,
    curveType: CurvePreset = 's-curve'
  ): number {
    const key = this.getCacheKey(pressure, minPercent, maxPercent, curveType);
    
    let result = this.cache.get(key);
    if (result !== undefined) {
      return result;
    }
    
    // Clean cache if full
    if (this.cache.size >= this.maxEntries) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey) this.cache.delete(firstKey);
    }
    
    result = applyPressureCurve(pressure, minPercent, maxPercent, curveType);
    this.cache.set(key, result);
    
    return result;
  }
  
  clear(): void {
    this.cache.clear();
  }
}

// Export a singleton cache instance for shared use
export const pressureCurveCache = new PressureCurveCache();
