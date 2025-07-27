/**
 * Cache for pre-scaled custom brush canvases to eliminate expensive real-time scaling.
 * Dramatically improves performance at larger brush sizes by avoiding repeated drawImage scaling.
 */

import { CustomBrush } from '../types';
import { canvasPool } from './canvasPool';

interface ScaledBrushData {
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
  scale: number;
  rotation: number;
  color?: string;
  isColorizable: boolean;
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
    isPressureSensitive?: boolean
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
    
    const parts = [
      customBrushId,
      scaleStr,
      roundedRotation.toFixed(2),
      color || 'none',
      isColorizable ? '1' : '0'
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
   * Create and cache a pre-scaled custom brush canvas
   */
  createScaledBrush(
    customBrush: CustomBrush,
    scale: number,
    rotation: number,
    color?: string,
    isColorizable?: boolean,
    isPressureSensitive?: boolean
  ): HTMLCanvasElement {
    const cacheKey = this.getCacheKey(customBrush.id, scale, rotation, color, isColorizable, isPressureSensitive);
    
    // Check if already cached
    const cached = this.get(cacheKey);
    if (cached) {
      return cached.canvas;
    }

    // Clean cache if full
    if (this.cache.size >= this.maxEntries) {
      this.cleanup();
    }

    // Create the base brush canvas
    const baseCanvas = canvasPool.acquire(customBrush.width, customBrush.height);
    const baseCtx = baseCanvas.getContext('2d');
    if (!baseCtx) {
      canvasPool.release(baseCanvas);
      throw new Error('Failed to get 2D context for base canvas');
    }

    // Apply brush data to base canvas
    baseCtx.putImageData(customBrush.imageData, 0, 0);

    // Apply color if colorizable
    if (isColorizable && color) {
      baseCtx.globalCompositeOperation = 'source-atop';
      baseCtx.fillStyle = color;
      baseCtx.fillRect(0, 0, baseCanvas.width, baseCanvas.height);
      baseCtx.globalCompositeOperation = 'source-over';
    }

    // Calculate scaled dimensions
    const scaledWidth = Math.ceil(customBrush.width * scale);
    const scaledHeight = Math.ceil(customBrush.height * scale);

    // Create scaled canvas
    const scaledCanvas = canvasPool.acquire(scaledWidth, scaledHeight);
    const scaledCtx = scaledCanvas.getContext('2d');
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

    // Cache the scaled brush
    const cacheData: ScaledBrushData = {
      canvas: scaledCanvas,
      width: scaledWidth,
      height: scaledHeight,
      scale,
      rotation,
      color,
      isColorizable: isColorizable || false,
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
    const keysToDelete: string[] = [];
    
    for (const [key, data] of this.cache.entries()) {
      if (data.customBrushId === customBrushId) {
        keysToDelete.push(key);
        canvasPool.release(data.canvas);
      }
    }
    
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
    isPressureSensitive?: boolean
  ): void {
    // For pressure-sensitive brushes, cache more granular sizes
    const scales = isPressureSensitive 
      ? [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0, 1.2, 1.5, 2.0] // More pressure variations
      : this.commonScales; // Standard sizes for non-pressure
    
    // Use requestIdleCallback to avoid blocking the UI
    const precacheNext = (index: number) => {
      if (index >= scales.length) return;
      
      const scale = scales[index];
      const cacheKey = this.getCacheKey(customBrush.id, scale, 0, color, isColorizable, isPressureSensitive);
      
      // Skip if already cached
      if (!this.cache.has(cacheKey)) {
        try {
          this.createScaledBrush(customBrush, scale, 0, color, isColorizable, isPressureSensitive);
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