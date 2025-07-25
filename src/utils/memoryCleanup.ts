/**
 * Memory cleanup utilities for intensive drawing operations.
 * Helps prevent memory accumulation during long drawing sessions.
 */

class MemoryManager {
  private cleanupQueue: (() => void)[] = [];
  private cleanupInterval: NodeJS.Timeout | null = null;
  private readonly CLEANUP_INTERVAL = 5000; // 5 seconds
  private readonly MAX_QUEUE_SIZE = 50;

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
        } catch (error) {
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
      } catch (error) {
        // Ignore cleanup errors
      }
    }

    // Force garbage collection if available (development only)
    if (typeof (globalThis as any).gc === 'function' && process.env.NODE_ENV === 'development') {
      try {
        (globalThis as any).gc();
      } catch (error) {
        // GC not available, ignore
      }
    }
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
   * Get memory manager statistics
   */
  getStats(): { queueSize: number; maxQueueSize: number } {
    return {
      queueSize: this.cleanupQueue.length,
      maxQueueSize: this.MAX_QUEUE_SIZE
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
  useImageData: (imageData: ImageData) => T
): T | null {
  const imageData = createImageData();
  
  if (!imageData) {
    return null;
  }

  try {
    const result = useImageData(imageData);
    return result;
  } finally {
    // Schedule cleanup of the ImageData
    memoryManager.cleanupImageData(imageData);
  }
}