/**
 * Optimized pressure calculations with caching to eliminate redundant computations.
 * Reduces CPU usage during continuous drawing with pressure sensitivity.
 */

import { applyPressureCurve, type CurvePreset } from './pressureCurve';
import {
  clampPressurePercent,
  clampPressureDeltaPercent,
  PRESSURE_BASE_PERCENT,
} from './pressureSettings';

interface PressureResult {
  adjustedSize: number;
  adjustedPressure: number;
}

interface PressureSettings {
  pressureEnabled: boolean;
  minPressure: number; // percent under base (0-1000)
  maxPressure?: number; // percent over base (0-1000)
  rawPressure: number;
  curveType?: CurvePreset;
}

class PressureOptimizer {
  private cache = new Map<string, PressureResult>();
  private readonly maxAge = 1000; // 1 second - pressure changes frequently
  private readonly maxEntries = 200; // Higher limit for pressure variations

  /**
   * Generate cache key for pressure calculation parameters
   */
  private getCacheKey(
    baseSize: number,
    pressure: number,
    minPressure: number,
    maxPressure: number,
    pressureEnabled: boolean
  ): string {
    if (!pressureEnabled) {
      return `nopressure_${baseSize.toFixed(1)}`;
    }
    
    return [
      baseSize.toFixed(1),
      pressure.toFixed(3),
      minPressure.toFixed(1),
      maxPressure.toFixed(1)
    ].join('_');
  }

  /**
   * Calculate pressure-adjusted brush size with caching
   */
  calculatePressureSize(
    baseSize: number,
    settings: PressureSettings
  ): PressureResult {
    if (!settings.pressureEnabled) {
      return {
        adjustedSize: baseSize,
        adjustedPressure: 1.0
      };
    }

    // minPressure/maxPressure are deltas relative to base (100%)
    const minUnder = clampPressureDeltaPercent(settings.minPressure ?? 0);
    const maxOver = clampPressureDeltaPercent(settings.maxPressure ?? 0);
    const minPercent = clampPressurePercent(PRESSURE_BASE_PERCENT - minUnder);
    const maxPercent = clampPressurePercent(PRESSURE_BASE_PERCENT + maxOver);
    const clampedMax = Math.max(minPercent, maxPercent);
    
    const cacheKey = this.getCacheKey(
      baseSize,
      settings.rawPressure,
      minPercent,
      clampedMax,
      settings.pressureEnabled
    );

    // Check if already cached
    const cached = this.cache.get(cacheKey);
    if (cached) {
      return cached;
    }

    // Clean cache if full
    if (this.cache.size >= this.maxEntries) {
      this.cleanup();
    }

    // Apply smooth pressure curve
    const curveType = settings.curveType || 's-curve';
    const multiplier = applyPressureCurve(
      settings.rawPressure,
      minPercent,  // Percentage format (1-1000)
      clampedMax,  // Percentage format (1-1000)
      curveType
    );
    
    // Calculate adjusted size using the curved multiplier
    const adjustedSize = Math.max(1, Math.round(baseSize * multiplier));
    
    // Store the curved pressure value for reference
    const adjustedPressure = settings.rawPressure; // Keep raw pressure for other uses
    

    const result: PressureResult = {
      adjustedSize,
      adjustedPressure
    };

    this.cache.set(cacheKey, result);
    return result;
  }

  /**
   * Calculate scale factor for custom brushes with caching
   */
  calculateScaleFactor(
    adjustedSize: number,
    baseSize: number,
    isCurrentBrushTip: boolean,
    brushTipBaseSize?: number
  ): number {
    if (isCurrentBrushTip && brushTipBaseSize) {
      return adjustedSize / brushTipBaseSize;
    } else {
      return adjustedSize / baseSize;
    }
  }

  /**
   * Remove expired entries to prevent memory buildup
   */
  private cleanup(): void {
    // For pressure calculations, we can be more aggressive with cleanup
    // since pressure changes frequently
    this.cache.clear();
  }

  /**
   * Clear all cached data
   */
  clear(): void {
    this.cache.clear();
  }

  /**
   * Get cache statistics for debugging/monitoring
   */
  getStats(): { entries: number; maxEntries: number } {
    return {
      entries: this.cache.size,
      maxEntries: this.maxEntries
    };
  }
}

export const pressureOptimizer = new PressureOptimizer();
