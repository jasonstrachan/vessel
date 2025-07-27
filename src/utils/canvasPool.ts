/**
 * Canvas pool to eliminate excessive canvas creation during brush rendering.
 * Reduces memory allocation and improves performance for custom brushes.
 */
class CanvasPool {
  private pool: HTMLCanvasElement[] = [];
  private readonly maxSize = 20; // Increased for better performance with custom brushes

  /**
   * Acquire a canvas from the pool or create a new one if pool is empty.
   * Canvas is automatically resized to the requested dimensions.
   */
  acquire(width: number, height: number): HTMLCanvasElement {
    const canvas = this.pool.pop() || document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    return canvas;
  }

  /**
   * Return a canvas to the pool for reuse.
   * Canvas is cleared and reset to default state.
   */
  release(canvas: HTMLCanvasElement): void {
    if (this.pool.length < this.maxSize) {
      const ctx = canvas.getContext('2d');
      if (ctx) {
        // Clear the canvas completely
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        // Reset all context properties to defaults
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = 1;
        ctx.imageSmoothingEnabled = true;
        // Reset transform matrix
        ctx.setTransform(1, 0, 0, 1, 0, 0);
      }
      this.pool.push(canvas);
    }
  }

  /**
   * Get current pool statistics for debugging/monitoring
   */
  getStats(): { poolSize: number; maxSize: number } {
    return {
      poolSize: this.pool.length,
      maxSize: this.maxSize
    };
  }
}

export const canvasPool = new CanvasPool();