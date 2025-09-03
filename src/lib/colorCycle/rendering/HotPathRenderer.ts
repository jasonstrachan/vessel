/**
 * HotPathRenderer - Highly optimized rendering for color cycle animation
 * 
 * This module focuses on the critical path: mapping indexed pixels to final colors
 * with maximum performance. Uses SIMD-friendly operations and minimal allocations.
 */

export interface RenderingContext {
  canvas: HTMLCanvasElement | OffscreenCanvas;
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
  imageData: ImageData;
  pixels32: Uint32Array; // View into imageData buffer for fast 32-bit ops
}

export interface FastRemapOptions {
  useWASM?: boolean; // Future: WebAssembly acceleration
  useSIMD?: boolean; // Future: SIMD.js if available
  batchSize?: number; // Process pixels in batches
}

export class HotPathRenderer {
  private contexts: Map<string, RenderingContext> = new Map();
  
  // Pre-computed lookup tables for common operations
  private static alphaMultiplyLUT: Uint8Array = new Uint8Array(256 * 256);
  private static initialized = false;
  
  constructor() {
    if (!HotPathRenderer.initialized) {
      this.initializeLUTs();
      HotPathRenderer.initialized = true;
    }
  }
  
  /**
   * Initialize lookup tables for common operations
   */
  private initializeLUTs(): void {
    console.time('[HotPathRenderer] LUT initialization');
    
    // Pre-compute alpha multiplication for all 256x256 combinations
    // This eliminates costly multiplication in the hot loop
    for (let alpha = 0; alpha < 256; alpha++) {
      for (let value = 0; value < 256; value++) {
        const index = alpha * 256 + value;
        HotPathRenderer.alphaMultiplyLUT[index] = Math.floor((alpha * value) / 255);
      }
    }
    
    console.timeEnd('[HotPathRenderer] LUT initialization');
  }
  
  /**
   * Create or reuse rendering context for a layer
   */
  acquireContext(layerId: string, width: number, height: number): RenderingContext {
    let context = this.contexts.get(layerId);
    
    if (context && 
        context.canvas.width === width && 
        context.canvas.height === height) {
      return context;
    }
    
    // Create new context
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d', {
      alpha: true,
      willReadFrequently: false // Optimize for writing
    });
    
    if (!ctx) {
      throw new Error('[HotPathRenderer] Failed to create rendering context');
    }
    
    ctx.imageSmoothingEnabled = false;
    
    const imageData = ctx.createImageData(width, height);
    const pixels32 = new Uint32Array(imageData.data.buffer);
    
    context = {
      canvas,
      ctx,
      imageData,
      pixels32
    };
    
    this.contexts.set(layerId, context);
    return context;
  }
  
  /**
   * Fast remapping: indices -> colors using optimized hot path
   * This is the most performance-critical function in the entire system
   */
  fastRemap(
    indices: Uint8Array,
    palette: Uint32Array,
    context: RenderingContext,
    options: FastRemapOptions = {}
  ): void {
    const { pixels32 } = context;
    const { batchSize = 4096 } = options;
    
    const perfStart = performance.now();
    
    // Strategy 1: Unrolled loop for small images (< 4KB pixels)
    if (indices.length < 4096) {
      this.fastRemapSmall(indices, palette, pixels32);
    }
    // Strategy 2: Batched processing for large images
    else {
      this.fastRemapBatched(indices, palette, pixels32, batchSize);
    }
    
    const perfTime = performance.now() - perfStart;
    
    // Only log if performance is concerning (>5ms for 1080p)
    if (perfTime > 5 && indices.length > 100000) {
      console.warn(`[HotPathRenderer] Slow remap: ${perfTime.toFixed(1)}ms for ${indices.length} pixels`);
    }
  }
  
  /**
   * Optimized remapping for small images (unrolled loop)
   */
  private fastRemapSmall(
    indices: Uint8Array,
    palette: Uint32Array,
    pixels32: Uint32Array
  ): void {
    const len = indices.length;
    
    // Process 4 pixels at a time (loop unrolling)
    const unrolledEnd = len - (len % 4);
    
    for (let i = 0; i < unrolledEnd; i += 4) {
      pixels32[i] = palette[indices[i]];
      pixels32[i + 1] = palette[indices[i + 1]];
      pixels32[i + 2] = palette[indices[i + 2]];
      pixels32[i + 3] = palette[indices[i + 3]];
    }
    
    // Handle remaining pixels
    for (let i = unrolledEnd; i < len; i++) {
      pixels32[i] = palette[indices[i]];
    }
  }
  
  /**
   * Batched processing for large images (better cache behavior)
   */
  private fastRemapBatched(
    indices: Uint8Array,
    palette: Uint32Array,
    pixels32: Uint32Array,
    batchSize: number
  ): void {
    const len = indices.length;
    
    for (let start = 0; start < len; start += batchSize) {
      const end = Math.min(start + batchSize, len);
      
      // Process batch with unrolled inner loop
      const batchUnrolledEnd = start + ((end - start) - ((end - start) % 4));
      
      for (let i = start; i < batchUnrolledEnd; i += 4) {
        pixels32[i] = palette[indices[i]];
        pixels32[i + 1] = palette[indices[i + 1]];
        pixels32[i + 2] = palette[indices[i + 2]];
        pixels32[i + 3] = palette[indices[i + 3]];
      }
      
      // Handle remaining pixels in batch
      for (let i = batchUnrolledEnd; i < end; i++) {
        pixels32[i] = palette[indices[i]];
      }
    }
  }
  
  /**
   * Animated remapping with offset (for color cycling)
   * Optimized version of the main animation loop
   */
  fastRemapAnimated(
    indices: Uint8Array,
    basePalette: Uint32Array,
    animationOffset: number,
    cycleColors: number,
    context: RenderingContext,
    flowDirection: 'forward' | 'reverse' = 'forward'
  ): void {
    const { pixels32 } = context;
    const len = indices.length;
    
    // Pre-calculate animation parameters
    const animOffset = Math.floor(animationOffset * cycleColors);
    const isReverse = flowDirection === 'reverse';
    
    // Use optimized path for common cycle sizes
    if (cycleColors === 16) {
      this.fastRemapAnimated16(indices, basePalette, animOffset, pixels32, isReverse);
    } else if (cycleColors === 32) {
      this.fastRemapAnimated32(indices, basePalette, animOffset, pixels32, isReverse);
    } else {
      this.fastRemapAnimatedGeneral(indices, basePalette, animOffset, cycleColors, pixels32, isReverse);
    }
  }
  
  /**
   * Specialized version for 16-color cycles (most common)
   */
  private fastRemapAnimated16(
    indices: Uint8Array,
    basePalette: Uint32Array,
    animOffset: number,
    pixels32: Uint32Array,
    isReverse: boolean
  ): void {
    const len = indices.length;
    const mask = 15; // 16 - 1 for fast modulo
    
    if (isReverse) {
      for (let i = 0; i < len; i++) {
        const colorIndex = indices[i];
        if (colorIndex === 0) {
          pixels32[i] = 0; // Transparent
        } else {
          const paletteIndex = (colorIndex - 1) & 255;
          const finalIndex = (paletteIndex - animOffset) & mask;
          pixels32[i] = basePalette[finalIndex];
        }
      }
    } else {
      for (let i = 0; i < len; i++) {
        const colorIndex = indices[i];
        if (colorIndex === 0) {
          pixels32[i] = 0; // Transparent
        } else {
          const paletteIndex = (colorIndex - 1) & 255;
          const finalIndex = (paletteIndex + animOffset) & mask;
          pixels32[i] = basePalette[finalIndex];
        }
      }
    }
  }
  
  /**
   * Specialized version for 32-color cycles
   */
  private fastRemapAnimated32(
    indices: Uint8Array,
    basePalette: Uint32Array,
    animOffset: number,
    pixels32: Uint32Array,
    isReverse: boolean
  ): void {
    const len = indices.length;
    const mask = 31; // 32 - 1 for fast modulo
    
    if (isReverse) {
      for (let i = 0; i < len; i++) {
        const colorIndex = indices[i];
        if (colorIndex === 0) {
          pixels32[i] = 0;
        } else {
          const paletteIndex = (colorIndex - 1) & 255;
          const finalIndex = (paletteIndex - animOffset) & mask;
          pixels32[i] = basePalette[finalIndex];
        }
      }
    } else {
      for (let i = 0; i < len; i++) {
        const colorIndex = indices[i];
        if (colorIndex === 0) {
          pixels32[i] = 0;
        } else {
          const paletteIndex = (colorIndex - 1) & 255;
          const finalIndex = (paletteIndex + animOffset) & mask;
          pixels32[i] = basePalette[finalIndex];
        }
      }
    }
  }
  
  /**
   * General version for arbitrary cycle sizes
   */
  private fastRemapAnimatedGeneral(
    indices: Uint8Array,
    basePalette: Uint32Array,
    animOffset: number,
    cycleColors: number,
    pixels32: Uint32Array,
    isReverse: boolean
  ): void {
    const len = indices.length;
    
    if (isReverse) {
      for (let i = 0; i < len; i++) {
        const colorIndex = indices[i];
        if (colorIndex === 0) {
          pixels32[i] = 0;
        } else {
          const paletteIndex = (colorIndex - 1) % 256;
          const finalIndex = (paletteIndex - animOffset + cycleColors * 100) % cycleColors;
          pixels32[i] = basePalette[finalIndex];
        }
      }
    } else {
      for (let i = 0; i < len; i++) {
        const colorIndex = indices[i];
        if (colorIndex === 0) {
          pixels32[i] = 0;
        } else {
          const paletteIndex = (colorIndex - 1) % 256;
          const finalIndex = (paletteIndex + animOffset) % cycleColors;
          pixels32[i] = basePalette[finalIndex];
        }
      }
    }
  }
  
  /**
   * Commit pixels to canvas (final step in rendering pipeline)
   */
  commitToCanvas(context: RenderingContext): void {
    context.ctx.putImageData(context.imageData, 0, 0);
  }
  
  /**
   * Get canvas for compositing into main display
   */
  getCanvas(layerId: string): HTMLCanvasElement | OffscreenCanvas | null {
    return this.contexts.get(layerId)?.canvas || null;
  }
  
  /**
   * Release context to free memory
   */
  releaseContext(layerId: string): void {
    this.contexts.delete(layerId);
  }
  
  /**
   * Clear all contexts (cleanup)
   */
  releaseAllContexts(): void {
    this.contexts.clear();
  }
  
  /**
   * Get performance statistics
   */
  getStats(): {
    activeContexts: number;
    memoryUsage: number;
  } {
    let totalMemory = 0;
    
    for (const context of Array.from(this.contexts.values())) {
      // Estimate memory usage: canvas buffer + imageData
      const pixelCount = context.canvas.width * context.canvas.height;
      totalMemory += pixelCount * 4; // RGBA bytes
    }
    
    return {
      activeContexts: this.contexts.size,
      memoryUsage: totalMemory
    };
  }
}