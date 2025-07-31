/**
 * Cache for pre-scaled custom brush canvases to eliminate expensive real-time scaling.
 * Dramatically improves performance at larger brush sizes by avoiding repeated drawImage scaling.
 */

import { CustomBrush } from '../types';
import { canvasPool } from './canvasPool';
import { adjustHueAndSaturation } from './imageProcessing';

interface ScaledBrushData {
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
  scale: number;
  rotation: number;
  color?: string;
  isColorizable: boolean;
  hueShift: number;
  saturation: number;
  timestamp: number;
  customBrushId: string;
}

class ScaledBrushCache {
  private cache = new Map<string, ScaledBrushData>();
  private readonly maxAge = 45000; // 45 seconds - longer retention for pressure-sensitive brushes
  private readonly maxEntries = 150; // Higher limit to accommodate pressure variations
  private readonly commonScales = [0.25, 0.5, 0.75, 1.0, 1.5, 2.0]; // Common brush sizes to pre-cache

  /**
   * Generate cache key for scaled brush parameters
   */
  getCacheKey(
    customBrushId: string,
    scale: number,
    rotation: number,
    color?: string,
    isColorizable?: boolean,
    isPressureSensitive?: boolean,
    hueShift?: number,
    saturation?: number
  ): string {
    // Adaptive cache key precision based on scale size
    // Larger brushes can use coarser precision without visible difference
    let scaleStr: string;
    
    if (isPressureSensitive) {
      // For pressure-sensitive drawing, use adaptive precision
      if (scale > 2.0) {
        // Large brushes: 0.1 increments
        scaleStr = (Math.round(scale * 10) / 10).toFixed(1);
      } else if (scale > 1.0) {
        // Medium brushes: 0.05 increments
        scaleStr = (Math.round(scale * 20) / 20).toFixed(2);
      } else {
        // Small brushes: 0.02 increments (improved from 0.005)
        scaleStr = (Math.round(scale * 50) / 50).toFixed(2);
      }
    } else {
      // Non-pressure: 0.05 increments for good caching
      scaleStr = (Math.round(scale * 20) / 20).toFixed(2);
    }
    
    const roundedRotation = Math.round(rotation * 100) / 100;
    const roundedHueShift = Math.round((hueShift || 0) * 10) / 10;
    const roundedSaturation = Math.round((saturation || 100) * 10) / 10;
    
    const parts = [
      customBrushId,
      scaleStr,
      roundedRotation.toFixed(2),
      color || 'none',
      isColorizable ? '1' : '0',
      roundedHueShift.toFixed(1),
      roundedSaturation.toFixed(1)
    ];
    
    return parts.join('_');
  }

  /**
   * Get cached scaled brush canvas if available and not expired
   */
  get(key: string): ScaledBrushData | null {
    const cached = this.cache.get(key);
    
    if (cached && Date.now() - cached.timestamp < this.maxAge) {
      return cached;
    }
    
    if (cached) {
      // Release expired canvas back to pool
      canvasPool.release(cached.canvas);
      this.cache.delete(key);
    }
    
    return null;
  }

  /**
   * Create a processed base canvas with all color transformations applied
   * Keeps everything on GPU until final draw
   */
  private createProcessedBaseCanvas(
    customBrush: CustomBrush,
    hueShift: number,
    saturationPercent: number,
    color?: string,
    isColorizable?: boolean
  ): HTMLCanvasElement {
    const canvas = canvasPool.acquire(customBrush.width, customBrush.height);
    const ctx = canvas.getContext('2d', { colorSpace: 'srgb' });
    if (!ctx) {
        canvasPool.release(canvas);
        throw new Error('Failed to get context for processing');
    }

    // If we are tinting the brush, that takes top priority. Jitter is ignored.
    if (isColorizable && color) {
      // Draw the original brush image data
      ctx.putImageData(customBrush.imageData, 0, 0);
      ctx.globalCompositeOperation = 'source-atop';
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    } else {
      // Apply hue/saturation adjustments using the unified function
      let processedImageData = customBrush.imageData;
      
      if (hueShift !== 0 || saturationPercent !== 100) {
        processedImageData = adjustHueAndSaturation(
          customBrush.imageData,
          hueShift,
          saturationPercent
        );
      }
      
      // Draw the processed image data
      ctx.putImageData(processedImageData, 0, 0);
    }
    
    // Reset composite operation for safety
    ctx.globalCompositeOperation = 'source-over';

    return canvas;
  }

  /**
   * Create and cache a pre-scaled custom brush canvas
   */
  createScaledBrush(
    customBrush: CustomBrush,
    scale: number,
    rotation: number,
    color?: string,
    isColorizable?: boolean,
    isPressureSensitive?: boolean,
    hueShift?: number,
    saturation?: number
  ): HTMLCanvasElement {
    // Always check the cache. The key is unique for static hue/saturation values.
    const cacheKey = this.getCacheKey(customBrush.id, scale, rotation, color, isColorizable, isPressureSensitive, hueShift, saturation);
    
    const cached = this.get(cacheKey);
    if (cached) {
      return cached.canvas;
    }

    // Clean cache if full
    if (this.cache.size >= this.maxEntries) {
      this.cleanup();
    }

    // Create processed base canvas with all color transformations applied
    const finalHueShift = hueShift || 0;
    const finalSaturation = saturation || 100;
    
    const baseCanvas = this.createProcessedBaseCanvas(
      customBrush,
      finalHueShift,
      finalSaturation,
      color,
      isColorizable
    );

    // Calculate scaled dimensions
    const scaledWidth = Math.ceil(customBrush.width * scale);
    const scaledHeight = Math.ceil(customBrush.height * scale);

    // Create scaled canvas
    const scaledCanvas = canvasPool.acquire(scaledWidth, scaledHeight);
    const scaledCtx = scaledCanvas.getContext('2d', { willReadFrequently: true, colorSpace: 'srgb' });
    if (!scaledCtx) {
      canvasPool.release(baseCanvas);
      canvasPool.release(scaledCanvas);
      throw new Error('Failed to get 2D context for scaled canvas');
    }

    // Configure scaling - maintain pixel-perfect rendering for custom brushes
    scaledCtx.imageSmoothingEnabled = false;

    // Apply rotation if needed
    if (rotation !== 0) {
      scaledCtx.translate(scaledWidth / 2, scaledHeight / 2);
      scaledCtx.rotate(rotation);
      scaledCtx.translate(-scaledWidth / 2, -scaledHeight / 2);
    }

    // Draw scaled brush
    scaledCtx.drawImage(
      baseCanvas,
      0, 0, baseCanvas.width, baseCanvas.height,
      0, 0, scaledWidth, scaledHeight
    );

    // Return base canvas to pool
    canvasPool.release(baseCanvas);

    // Always cache the result. The random jitter path doesn't call this function,
    // so anything that gets here should be cached.
    const cacheData: ScaledBrushData = {
      canvas: scaledCanvas,
      width: scaledWidth,
      height: scaledHeight,
      scale,
      rotation,
      color,
      isColorizable: isColorizable || false,
      hueShift: finalHueShift,
      saturation: finalSaturation,
      timestamp: Date.now(),
      customBrushId: customBrush.id
    };

    this.cache.set(cacheKey, cacheData);
    
    return scaledCanvas;
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
      const data = this.cache.get(key);
      if (data) {
        canvasPool.release(data.canvas);
        this.cache.delete(key);
      }
    }
    
    // If still too many, remove oldest entries
    if (this.cache.size >= this.maxEntries) {
      const entries = Array.from(this.cache.entries()).sort((a, b) => a[1].timestamp - b[1].timestamp);
      const toRemove = entries.slice(0, this.cache.size - this.maxEntries + 10);
      
      for (const [key, data] of toRemove) {
        canvasPool.release(data.canvas);
        this.cache.delete(key);
      }
    }
  }

  /**
   * Clear cache entries for a specific custom brush ID
   * Useful when brush colors change and we need immediate cache invalidation
   */
  clearForBrush(customBrushId: string): void {
    if (!customBrushId) {
      return; // Safety check for invalid brush ID
    }
    
    const keysToDelete: string[] = [];
    
    for (const [key, data] of this.cache.entries()) {
      if (data.customBrushId === customBrushId) {
        keysToDelete.push(key);
        // Safely release canvas back to pool with error handling
        try {
          canvasPool.release(data.canvas);
        } catch (error) {
          // Continue cleanup even if canvas release fails
          console.warn('Failed to release canvas during cache cleanup:', error);
        }
      }
    }
    
    // Remove entries from cache
    for (const key of keysToDelete) {
      this.cache.delete(key);
    }
  }

  /**
   * Clear all cached data and return canvases to pool
   */
  clear(): void {
    for (const data of this.cache.values()) {
      canvasPool.release(data.canvas);
    }
    this.cache.clear();
  }

  /**
   * Pre-cache common brush sizes to improve performance
   */
  precacheCommonSizes(
    customBrush: CustomBrush,
    color?: string,
    isColorizable?: boolean,
    isPressureSensitive?: boolean,
    hueShift?: number,
    saturation?: number
  ): void {
    // For pressure-sensitive brushes, cache more granular sizes
    const scales = isPressureSensitive 
      ? [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0, 1.2, 1.5, 2.0] // More pressure variations
      : this.commonScales; // Standard sizes for non-pressure
    
    // Use requestIdleCallback to avoid blocking the UI
    const precacheNext = (index: number) => {
      if (index >= scales.length) return;
      
      const scale = scales[index];
      const cacheKey = this.getCacheKey(customBrush.id, scale, 0, color, isColorizable, isPressureSensitive, hueShift, saturation);
      
      // Skip if already cached
      if (!this.cache.has(cacheKey)) {
        try {
          this.createScaledBrush(customBrush, scale, 0, color, isColorizable, isPressureSensitive, hueShift, saturation);
        } catch (error) {
          // Pre-caching failed silently - not critical for functionality
        }
      }
      
      // Schedule next with shorter timeout for pressure-sensitive brushes
      const timeout = isPressureSensitive ? 50 : 100;
      if ('requestIdleCallback' in window) {
        requestIdleCallback(() => precacheNext(index + 1), { timeout });
      } else {
        setTimeout(() => precacheNext(index + 1), 0);
      }
    };
    
    precacheNext(0);
  }

  /**
   * Check if any cache entries exist for a brush
   */
  hasCachedEntriesForBrush(customBrushId: string): boolean {
    for (const key of this.cache.keys()) {
      if (key.startsWith(customBrushId + '_')) {
        return true;
      }
    }
    return false;
  }

  /**
   * Get cache statistics for debugging/monitoring
   */
  getStats(): { entries: number; maxEntries: number; memoryUsage?: number; hitRate?: number } {
    let memoryUsage = 0;
    const totalHits = 0; // TODO: Implement hit tracking
    const totalMisses = 0; // TODO: Implement miss tracking
    
    for (const data of this.cache.values()) {
      memoryUsage += data.width * data.height * 4; // 4 bytes per pixel (RGBA)
    }
    
    // Calculate hit rate if we're tracking it
    const hitRate = totalHits + totalMisses > 0 
      ? (totalHits / (totalHits + totalMisses)) * 100 
      : 0;
    
    return {
      entries: this.cache.size,
      maxEntries: this.maxEntries,
      memoryUsage,
      hitRate
    };
  }
}

export const scaledBrushCache = new ScaledBrushCache();

// Clear cache on module load to ensure fresh scaling with fixed precision for pressure sensitivity
scaledBrushCache.clear();