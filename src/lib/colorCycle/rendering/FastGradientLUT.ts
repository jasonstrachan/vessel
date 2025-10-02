/**
 * FastGradientLUT - Optimized gradient lookup table generation
 * 
 * Builds color palettes for animation frames with maximum performance.
 * Uses precomputed interpolation and SIMD-friendly operations.
 */

import { parseCssColor } from '@/utils/color/parseCssColor';

export interface GradientStop {
  position: number; // 0-1
  color: {
    r: number;
    g: number; 
    b: number;
    a: number;
  };
}

export interface LUTBuildOptions {
  size: number; // Usually 256 for indexed color
  cycleColors: number; // 8-256, default 16
  interpolationMode: 'linear' | 'smooth' | 'step';
}

export class FastGradientLUT {
  // Cached LUTs to avoid regeneration
  private static cache: Map<string, Uint32Array> = new Map();
  private static readonly MAX_CACHE_SIZE = 32;
  
  // Pre-computed interpolation weights for smooth gradients
  private static smoothWeights: Float32Array = new Float32Array(256);
  private static initialized = false;
  
  constructor() {
    if (!FastGradientLUT.initialized) {
      this.initializeWeights();
      FastGradientLUT.initialized = true;
    }
  }
  
  /**
   * Initialize smooth interpolation weights (cubic easing)
   */
  private initializeWeights(): void {
    for (let i = 0; i < 256; i++) {
      const t = i / 255;
      // Cubic ease-in-out for smoother gradients
      FastGradientLUT.smoothWeights[i] = t < 0.5 
        ? 4 * t * t * t 
        : 1 - Math.pow(-2 * t + 2, 3) / 2;
    }
  }
  
  /**
   * Build gradient LUT with animation offset
   * This is called once per animation frame
   */
  buildAnimatedLUT(
    gradientStops: GradientStop[],
    animationOffset: number,
    options: LUTBuildOptions
  ): Uint32Array {
    const { size, cycleColors, interpolationMode } = options;
    
    // Generate cache key
    const cacheKey = this.generateCacheKey(gradientStops, animationOffset, options);
    
    // Check cache first
    const cached = FastGradientLUT.cache.get(cacheKey);
    if (cached) {
      return cached;
    }
    
    // Build new LUT
    const lut = new Uint32Array(size);
    
    // Handle transparent pixel (index 0)
    lut[0] = 0;
    
    // Build gradient for remaining indices
    if (interpolationMode === 'step') {
      this.buildStepLUT(gradientStops, animationOffset, lut, cycleColors);
    } else if (interpolationMode === 'smooth') {
      this.buildSmoothLUT(gradientStops, animationOffset, lut, cycleColors);
    } else {
      this.buildLinearLUT(gradientStops, animationOffset, lut, cycleColors);
    }
    
    // Cache result
    this.cacheResult(cacheKey, lut);
    
    return lut;
  }
  
  /**
   * Build linear interpolation LUT (fastest)
   */
  private buildLinearLUT(
    stops: GradientStop[],
    offset: number,
    lut: Uint32Array,
    cycleColors: number
  ): void {
    const len = lut.length;
    
    for (let i = 1; i < len; i++) {
      // Map index to gradient position with animation offset
      const basePos = ((i - 1) % cycleColors) / cycleColors;
      let animatedPos = basePos + offset;
      
      // Wrap around [0, 1]
      animatedPos = ((animatedPos % 1) + 1) % 1;
      
      // Sample gradient at position
      const color = this.sampleGradientLinear(stops, animatedPos);
      
      // Pack RGBA into 32-bit value
      lut[i] = this.packRGBA(color.r, color.g, color.b, color.a);
    }
  }
  
  /**
   * Build smooth interpolation LUT (higher quality)
   */
  private buildSmoothLUT(
    stops: GradientStop[],
    offset: number,
    lut: Uint32Array,
    cycleColors: number
  ): void {
    const len = lut.length;
    
    for (let i = 1; i < len; i++) {
      const basePos = ((i - 1) % cycleColors) / cycleColors;
      let animatedPos = basePos + offset;
      animatedPos = ((animatedPos % 1) + 1) % 1;
      
      // Use smooth interpolation
      const smoothPos = FastGradientLUT.smoothWeights[Math.floor(animatedPos * 255)];
      const color = this.sampleGradientLinear(stops, smoothPos);
      
      lut[i] = this.packRGBA(color.r, color.g, color.b, color.a);
    }
  }
  
  /**
   * Build step interpolation LUT (sharp transitions)
   */
  private buildStepLUT(
    stops: GradientStop[],
    offset: number,
    lut: Uint32Array,
    cycleColors: number
  ): void {
    const len = lut.length;
    
    for (let i = 1; i < len; i++) {
      const basePos = ((i - 1) % cycleColors) / cycleColors;
      let animatedPos = basePos + offset;
      animatedPos = ((animatedPos % 1) + 1) % 1;
      
      // Find nearest stop (no interpolation)
      const color = this.sampleGradientStep(stops, animatedPos);
      
      lut[i] = this.packRGBA(color.r, color.g, color.b, color.a);
    }
  }
  
  /**
   * Sample gradient with linear interpolation
   */
  private sampleGradientLinear(stops: GradientStop[], position: number): GradientStop['color'] {
    if (stops.length === 0) {
      return { r: 255, g: 255, b: 255, a: 255 };
    }
    
    if (stops.length === 1) {
      return stops[0].color;
    }
    
    // Clamp position
    position = Math.max(0, Math.min(1, position));
    
    // Find surrounding stops
    let leftStop = stops[0];
    let rightStop = stops[stops.length - 1];
    
    for (let i = 0; i < stops.length - 1; i++) {
      if (position >= stops[i].position && position <= stops[i + 1].position) {
        leftStop = stops[i];
        rightStop = stops[i + 1];
        break;
      }
    }
    
    // Interpolate
    const range = rightStop.position - leftStop.position;
    const t = range > 0 ? (position - leftStop.position) / range : 0;
    
    return {
      r: Math.round(leftStop.color.r + (rightStop.color.r - leftStop.color.r) * t),
      g: Math.round(leftStop.color.g + (rightStop.color.g - leftStop.color.g) * t),
      b: Math.round(leftStop.color.b + (rightStop.color.b - leftStop.color.b) * t),
      a: Math.round(leftStop.color.a + (rightStop.color.a - leftStop.color.a) * t)
    };
  }
  
  /**
   * Sample gradient with step interpolation (nearest neighbor)
   */
  private sampleGradientStep(stops: GradientStop[], position: number): GradientStop['color'] {
    if (stops.length === 0) {
      return { r: 255, g: 255, b: 255, a: 255 };
    }
    
    // Find nearest stop
    let nearestStop = stops[0];
    let minDistance = Math.abs(position - stops[0].position);
    
    for (let i = 1; i < stops.length; i++) {
      const distance = Math.abs(position - stops[i].position);
      if (distance < minDistance) {
        minDistance = distance;
        nearestStop = stops[i];
      }
    }
    
    return nearestStop.color;
  }
  
  /**
   * Pack RGBA values into 32-bit integer (little-endian ABGR)
   */
  private packRGBA(r: number, g: number, b: number, a: number): number {
    return (a << 24) | (b << 16) | (g << 8) | r;
  }
  
  /**
   * Generate cache key for LUT
   */
  private generateCacheKey(
    stops: GradientStop[],
    offset: number,
    options: LUTBuildOptions
  ): string {
    const stopHash = stops.map(s => 
      `${s.position.toFixed(3)}-${s.color.r}-${s.color.g}-${s.color.b}-${s.color.a}`
    ).join('|');
    
    return `${stopHash}_${offset.toFixed(4)}_${options.size}_${options.cycleColors}_${options.interpolationMode}`;
  }
  
  /**
   * Cache LUT result with size management
   */
  private cacheResult(key: string, lut: Uint32Array): void {
    // Remove oldest entries if cache is full
    if (FastGradientLUT.cache.size >= FastGradientLUT.MAX_CACHE_SIZE) {
      const oldestKey = FastGradientLUT.cache.keys().next().value;
      if (typeof oldestKey === 'string') {
        FastGradientLUT.cache.delete(oldestKey);
      }
    }
    
    // Store copy to prevent mutations
    const copy = new Uint32Array(lut);
    FastGradientLUT.cache.set(key, copy);
  }
  
  /**
   * Parse CSS color string to RGBA (optimized common cases)
   */
  static parseColor(colorStr: string): GradientStop['color'] {
    return parseCssColor(colorStr, { r: 255, g: 255, b: 255, a: 255 });
  }
  
  /**
   * Create gradient stops from color strings
   */
  static createStops(colors: string[]): GradientStop[] {
    return colors.map((colorStr, index) => ({
      position: index / (colors.length - 1),
      color: this.parseColor(colorStr)
    }));
  }
  
  /**
   * Clear cache (for memory management)
   */
  static clearCache(): void {
    FastGradientLUT.cache.clear();
  }
  
  /**
   * Get cache statistics
   */
  static getCacheStats(): {
    size: number;
    memoryUsage: number;
  } {
    let memoryUsage = 0;
    for (const lut of Array.from(FastGradientLUT.cache.values())) {
      memoryUsage += lut.byteLength;
    }
    
    return {
      size: FastGradientLUT.cache.size,
      memoryUsage
    };
  }
}
