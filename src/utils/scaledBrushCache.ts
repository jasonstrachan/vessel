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
  private readonly maxAge = 10000; // 10 seconds - longer for expensive scaled brushes
  private readonly maxEntries = 50; // Limit to prevent memory bloat

  /**
   * Generate cache key for scaled brush parameters
   */
  getCacheKey(
    customBrushId: string,
    scale: number,
    rotation: number,
    color?: string,
    isColorizable?: boolean
  ): string {
    const parts = [
      customBrushId,
      scale.toFixed(2),
      rotation.toFixed(2),
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
    isColorizable?: boolean
  ): HTMLCanvasElement {
    const cacheKey = this.getCacheKey(customBrush.id, scale, rotation, color, isColorizable);
    
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

    // Configure scaling
    scaledCtx.imageSmoothingEnabled = false; // Maintain pixel-perfect rendering

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
   * Get cache statistics for debugging/monitoring
   */
  getStats(): { entries: number; maxEntries: number; memoryUsage?: number } {
    let memoryUsage = 0;
    for (const data of this.cache.values()) {
      memoryUsage += data.width * data.height * 4; // 4 bytes per pixel (RGBA)
    }
    
    return {
      entries: this.cache.size,
      maxEntries: this.maxEntries,
      memoryUsage
    };
  }
}

export const scaledBrushCache = new ScaledBrushCache();