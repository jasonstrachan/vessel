/**
 * Cache for expensive brush calculations to eliminate redundant computations.
 * Reduces CPU usage during continuous drawing with identical brush settings.
 */

interface CachedBrushData {
  // Grid calculations
  gridDimensions?: { width: number; height: number };
  gridSize?: number;
  
  // Scale calculations
  scaleFactor: number;
  actualSize: number;
  
  // Pressure calculations
  pressureAdjustedSize?: number;
  
  // Rotation calculations  
  rotation: number;
  
  // Timing for cache expiry
  timestamp: number;
}

class BrushCache {
  private cache = new Map<string, CachedBrushData>();
  private readonly maxAge = 5000; // 5 seconds - reasonable for brush sessions
  private readonly maxEntries = 100; // Prevent memory buildup

  /**
   * Generate cache key from brush parameters that affect calculations
   */
  getCacheKey(
    brushShape: string,
    size: number, 
    pressure: number,
    rotation: number,
    gridSpacing?: number,
    customBrushId?: string,
    pressureEnabled?: boolean,
    minPressure?: number,
    maxPressure?: number
  ): string {
    const parts = [
      brushShape,
      size.toFixed(1),
      pressure.toFixed(3),
      rotation.toFixed(2),
      gridSpacing?.toFixed(1) || '0',
      customBrushId || 'none',
      pressureEnabled ? '1' : '0',
      minPressure?.toFixed(1) || '0',
      maxPressure?.toFixed(1) || '0'
    ];
    
    return parts.join('_');
  }

  /**
   * Get cached brush data if available and not expired
   */
  get(key: string): CachedBrushData | null {
    const cached = this.cache.get(key);
    
    if (cached && Date.now() - cached.timestamp < this.maxAge) {
      return cached;
    }
    
    if (cached) {
      this.cache.delete(key);
    }
    
    return null;
  }

  /**
   * Store brush calculation results in cache
   */
  set(key: string, data: Omit<CachedBrushData, 'timestamp'>): void {
    // Clean old entries if cache is full
    if (this.cache.size >= this.maxEntries) {
      this.cleanup();
    }
    
    this.cache.set(key, {
      ...data,
      timestamp: Date.now()
    });
  }

  /**
   * Remove expired entries to prevent memory buildup
   */
  private cleanup(): void {
    const now = Date.now();
    const toDelete: string[] = [];
    
    for (const [key, data] of this.cache.entries()) {
      if (now - data.timestamp > this.maxAge) {
        toDelete.push(key);
      }
    }
    
    for (const key of toDelete) {
      this.cache.delete(key);
    }
    
    // If still too many, remove oldest entries
    if (this.cache.size >= this.maxEntries) {
      const entries = Array.from(this.cache.entries()).sort((a, b) => a[1].timestamp - b[1].timestamp);
      const toRemove = entries.slice(0, this.cache.size - this.maxEntries + 10);
      
      for (const [key] of toRemove) {
        this.cache.delete(key);
      }
    }
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
  getStats(): { entries: number; maxEntries: number; hitRate?: number } {
    return {
      entries: this.cache.size,
      maxEntries: this.maxEntries
    };
  }
}

export const brushCache = new BrushCache();