/**
 * Memory cleanup utilities for intensive drawing operations.
 * Helps prevent memory accumulation during long drawing sessions.
 * Coordinates with caching systems for optimal memory usage.
 */

import { brushCache } from './brushCache';
import { pressureOptimizer } from './pressureOptimizer';
import { scaledBrushCache } from './scaledBrushCache';

class MemoryManager {
  private cleanupQueue: (() => void)[] = [];
  private cleanupInterval: NodeJS.Timeout | null = null;
  private readonly CLEANUP_INTERVAL = 10000; // 10 seconds - less aggressive for better caching
  private readonly MAX_QUEUE_SIZE = 50; // Larger queue to avoid premature cleanup
  private readonly MEMORY_PRESSURE_THRESHOLD = 150; // Higher threshold

  constructor() {
    this.startPeriodicCleanup();
  }

  /**
   * Schedule a cleanup function to be called later
   */
  scheduleCleanup(cleanupFn: () => void): void {
    this.cleanupQueue.push(cleanupFn);
    
    // If queue is getting large, run cleanup immediately
    if (this.cleanupQueue.length > this.MAX_QUEUE_SIZE) {
      this.runCleanup();
    }
  }

  /**
   * Helper to null out ImageData references
   */
  cleanupImageData(imageData: ImageData | null): void {
    if (imageData) {
      // Explicitly null the data reference to help GC
      this.scheduleCleanup(() => {
        (imageData as any).data = null;
      });
    }
  }

  /**
   * Helper to clean up canvas contexts
   */
  cleanupCanvasContext(ctx: CanvasRenderingContext2D | null): void {
    if (ctx) {
      this.scheduleCleanup(() => {
        // Clear any stored image data
        try {
          ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
        } catch {
          // Canvas might be destroyed, ignore
        }
      });
    }
  }

  /**
   * Force immediate cleanup of all queued items
   */
  runCleanup(): void {
    const toClean = this.cleanupQueue.splice(0);
    
    // Run cleanup functions
    for (const cleanup of toClean) {
      try {
        cleanup();
      } catch {
        // Ignore cleanup errors
      }
    }

    // Clean cache systems if under memory pressure
    if (toClean.length > this.MEMORY_PRESSURE_THRESHOLD || this.isMemoryPressure()) {
      this.cleanupCaches();
    }

    // Force garbage collection if available (development only)
    if (typeof (globalThis as any).gc === 'function' && process.env.NODE_ENV === 'development') {
      try {
        (globalThis as any).gc();
      } catch {
        // GC not available, ignore
      }
    }
  }

  /**
   * Clean up cache systems when under memory pressure
   */
  private cleanupCaches(): void {
    try {
      // Clean brush calculation cache
      brushCache.clear();
      
      // Clean pressure optimizer cache
      pressureOptimizer.clear();
      
      // Clean scaled brush cache
      scaledBrushCache.clear();
    } catch {
      // Ignore cache cleanup errors
    }
  }

  /**
   * Check if system is under memory pressure
   */
  private isMemoryPressure(): boolean {
    // Simple heuristic: check if cleanup queue is consistently large
    return this.cleanupQueue.length > this.MAX_QUEUE_SIZE * 0.8;
  }

  /**
   * Start periodic cleanup
   */
  private startPeriodicCleanup(): void {
    this.cleanupInterval = setInterval(() => {
      this.runCleanup();
    }, this.CLEANUP_INTERVAL);
  }

  /**
   * Stop periodic cleanup
   */
  stopCleanup(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    this.runCleanup(); // Final cleanup
  }

  /**
   * Get memory manager statistics including cache information
   */
  getStats(): { 
    queueSize: number; 
    maxQueueSize: number;
    cacheStats: {
      brushCache: ReturnType<typeof brushCache.getStats>;
      pressureOptimizer: ReturnType<typeof pressureOptimizer.getStats>;
      scaledBrushCache: ReturnType<typeof scaledBrushCache.getStats>;
    };
  } {
    return {
      queueSize: this.cleanupQueue.length,
      maxQueueSize: this.MAX_QUEUE_SIZE,
      cacheStats: {
        brushCache: brushCache.getStats(),
        pressureOptimizer: pressureOptimizer.getStats(),
        scaledBrushCache: scaledBrushCache.getStats()
      }
    };
  }
}

// Singleton instance
export const memoryManager = new MemoryManager();

/**
 * Convenience function to help with ImageData cleanup
 */
export function withImageDataCleanup<T>(
  createImageData: () => ImageData | null,
  processImageData: (imageData: ImageData) => T
): T | null {
  const imageData = createImageData();
  
  if (!imageData) {
    return null;
  }

  try {
    const result = processImageData(imageData);
    return result;
  } finally {
    // Schedule cleanup of the ImageData
    memoryManager.cleanupImageData(imageData);
  }
}