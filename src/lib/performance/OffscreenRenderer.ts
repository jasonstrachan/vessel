/**
 * OffscreenRenderer - Handles background rendering operations
 * Uses OffscreenCanvas when available for improved performance
 */

export class OffscreenRenderer {
  private offscreenCanvas: OffscreenCanvas | HTMLCanvasElement;
  private offscreenCtx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;
  private renderCallback?: (bitmap: ImageBitmap | HTMLCanvasElement) => void;
  private isOffscreenSupported: boolean;

  constructor(width: number, height: number) {
    this.isOffscreenSupported = typeof OffscreenCanvas !== 'undefined';
    
    if (this.isOffscreenSupported) {
      this.offscreenCanvas = new OffscreenCanvas(width, height);
      const ctx = this.offscreenCanvas.getContext('2d', {
        alpha: true,
        desynchronized: true,
        willReadFrequently: false
      });
      if (!ctx) throw new Error('Failed to create OffscreenCanvas context');
      this.offscreenCtx = ctx;
    } else {
      // Fallback to regular canvas
      this.offscreenCanvas = document.createElement('canvas');
      this.offscreenCanvas.width = width;
      this.offscreenCanvas.height = height;
      const ctx = this.offscreenCanvas.getContext('2d', {
        alpha: true,
        desynchronized: true,
        willReadFrequently: false
      });
      if (!ctx) throw new Error('Failed to create canvas context');
      this.offscreenCtx = ctx;
    }
  }

  resize(width: number, height: number) {
    this.offscreenCanvas.width = width;
    this.offscreenCanvas.height = height;
  }

  /**
   * Render ImageData in background
   */
  async renderImageData(imageData: ImageData): Promise<ImageBitmap | HTMLCanvasElement> {
    this.offscreenCtx.putImageData(imageData, 0, 0);
    
    if (this.isOffscreenSupported && this.offscreenCanvas instanceof OffscreenCanvas) {
      // Convert to ImageBitmap for efficient transfer
      return await createImageBitmap(this.offscreenCanvas, {
        premultiplyAlpha: 'none',
        colorSpaceConversion: 'none',
        resizeQuality: 'pixelated'
      });
    }
    
    return this.offscreenCanvas as HTMLCanvasElement;
  }

  /**
   * Batch render multiple operations
   */
  async batchRender(operations: Array<() => void>): Promise<ImageBitmap | HTMLCanvasElement> {
    // Save context state
    this.offscreenCtx.save();
    
    // Execute all operations
    for (const op of operations) {
      op.call(this.offscreenCtx);
    }
    
    // Restore context state
    this.offscreenCtx.restore();
    
    if (this.isOffscreenSupported && this.offscreenCanvas instanceof OffscreenCanvas) {
      return await createImageBitmap(this.offscreenCanvas);
    }
    
    return this.offscreenCanvas as HTMLCanvasElement;
  }

  /**
   * Get the rendering context for direct manipulation
   */
  getContext(): OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D {
    return this.offscreenCtx;
  }

  /**
   * Transfer to main canvas efficiently
   */
  async transferToCanvas(targetCanvas: HTMLCanvasElement) {
    const targetCtx = targetCanvas.getContext('2d');
    if (!targetCtx) return;
    
    if (this.isOffscreenSupported && this.offscreenCanvas instanceof OffscreenCanvas) {
      const bitmap = await createImageBitmap(this.offscreenCanvas);
      targetCtx.drawImage(bitmap, 0, 0);
      bitmap.close(); // Release resources
    } else {
      targetCtx.drawImage(this.offscreenCanvas as HTMLCanvasElement, 0, 0);
    }
  }

  /**
   * Snapshot current offscreen contents as an ImageBitmap (if supported)
   */
  async snapshot(): Promise<ImageBitmap | HTMLCanvasElement> {
    if (this.isOffscreenSupported && this.offscreenCanvas instanceof OffscreenCanvas) {
      return await createImageBitmap(this.offscreenCanvas);
    }
    return this.offscreenCanvas as HTMLCanvasElement;
  }

  /**
   * Clear the offscreen canvas
   */
  clear() {
    this.offscreenCtx.clearRect(0, 0, this.offscreenCanvas.width, this.offscreenCanvas.height);
  }

  /**
   * Check if OffscreenCanvas is supported
   */
  static isSupported(): boolean {
    return typeof OffscreenCanvas !== 'undefined';
  }
}
