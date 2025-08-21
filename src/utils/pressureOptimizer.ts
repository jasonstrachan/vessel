/**
 * Optimized pressure calculations with caching to eliminate redundant computations.
 * Reduces CPU usage during continuous drawing with pressure sensitivity.
 */

interface PressureResult {
  adjustedSize: number;
  adjustedPressure: number;
}

interface PressureSettings {
  pressureEnabled: boolean;
  minPressure: number;
  maxPressure?: number;
  rawPressure: number;
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

    // Convert min/max pressure percentages to actual pixel sizes
    // minPressure and maxPressure from UI are percentages (1-1000)
    // Convert to fraction of base brush size
    const minPressurePercent = settings.minPressure || 1; // Default 1%
    const maxPressurePercent = settings.maxPressure || 100; // Default 100% if not set
    
    const minSize = (minPressurePercent / 100) * baseSize;
    const maxSize = (maxPressurePercent / 100) * baseSize;
    
    const cacheKey = this.getCacheKey(
      baseSize,
      settings.rawPressure,
      minSize,
      maxSize,
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

    // Calculate pressure adjustment
    const pressureThreshold = 0.05; // 5% deadzone
    const adjustedPressure = Math.max(0, 
      (settings.rawPressure - pressureThreshold) / (1.0 - pressureThreshold)
    );
    
    // Interpolate between minSize and maxSize based on pressure
    const adjustedSize = minSize + (adjustedPressure * (maxSize - minSize));


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