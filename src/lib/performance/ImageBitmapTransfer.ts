import { logError } from '@/utils/debug';
/**
 * ImageBitmap Transfer Manager for efficient canvas operations
 */

export interface TransferOptions {
  premultiplyAlpha?: 'none' | 'premultiply' | 'default';
  colorSpaceConversion?: 'none' | 'default';
  resizeQuality?: 'pixelated' | 'low' | 'medium' | 'high';
}

export class ImageBitmapTransfer {
  private bitmapCache = new Map<string, ImageBitmap>();
  private maxCacheSize = 50;
  private isSupported: boolean;

  constructor() {
    this.isSupported = typeof createImageBitmap !== 'undefined';
  }

  /**
   * Create ImageBitmap from ImageData
   */
  async fromImageData(
    imageData: ImageData,
    options?: TransferOptions
  ): Promise<ImageBitmap | ImageData> {
    if (!this.isSupported) {
      return imageData;
    }
    
    try {
      const bitmap = await createImageBitmap(imageData, {
        premultiplyAlpha: options?.premultiplyAlpha || 'none',
        colorSpaceConversion: options?.colorSpaceConversion || 'none',
        resizeQuality: options?.resizeQuality || 'pixelated'
      });

      return bitmap;
    } catch {
      return imageData;
    }
  }

  /**
   * Create ImageBitmap from Canvas
   */
  async fromCanvas(
    canvas: HTMLCanvasElement | OffscreenCanvas,
    options?: TransferOptions
  ): Promise<ImageBitmap | HTMLCanvasElement | OffscreenCanvas> {
    if (!this.isSupported) {
      return canvas;
    }
    
    try {
      const bitmap = await createImageBitmap(canvas, {
        premultiplyAlpha: options?.premultiplyAlpha || 'none',
        colorSpaceConversion: options?.colorSpaceConversion || 'none',
        resizeQuality: options?.resizeQuality || 'pixelated'
      });

      return bitmap;
    } catch {
      return canvas;
    }
  }

  /**
   * Create ImageBitmap from Blob
   */
  async fromBlob(
    blob: Blob,
    options?: TransferOptions
  ): Promise<ImageBitmap | null> {
    if (!this.isSupported) {
      return null;
    }
    
    try {
      const bitmap = await createImageBitmap(blob, {
        premultiplyAlpha: options?.premultiplyAlpha || 'none',
        colorSpaceConversion: options?.colorSpaceConversion || 'none',
        resizeQuality: options?.resizeQuality || 'pixelated'
      });
      
      return bitmap;
    } catch (error) {
      logError('Failed to create ImageBitmap from blob:', error);
      return null;
    }
  }

  /**
   * Transfer ImageBitmap to canvas efficiently
   */
  transferToCanvas(
    bitmap: ImageBitmap | ImageData | HTMLCanvasElement | OffscreenCanvas,
    targetCanvas: HTMLCanvasElement,
    x: number = 0,
    y: number = 0
  ): boolean {
    const ctx = targetCanvas.getContext('2d', {
      alpha: true,
      desynchronized: true
    });
    
    if (!ctx) return false;
    
    try {
      if (bitmap instanceof ImageData) {
        ctx.putImageData(bitmap, x, y);
      } else {
        ctx.drawImage(bitmap, x, y);
      }
      
      // Close ImageBitmap to free resources
      if (bitmap instanceof ImageBitmap) {
        bitmap.close();
      }
      
      return true;
    } catch (error) {
      logError('Failed to transfer to canvas:', error);
      return false;
    }
  }

  /**
   * Batch transfer multiple bitmaps
   */
  async batchTransfer(
    sources: Array<{ 
      data: ImageData | HTMLCanvasElement | OffscreenCanvas;
      x: number;
      y: number;
    }>,
    targetCanvas: HTMLCanvasElement
  ): Promise<void> {
    const ctx = targetCanvas.getContext('2d', {
      alpha: true,
      desynchronized: true
    });
    
    if (!ctx) return;
    
    // Create bitmaps in parallel
    const bitmapPromises = sources.map(async (source) => {
      if (source.data instanceof ImageData) {
        const bitmap = await this.fromImageData(source.data);
        return { bitmap, x: source.x, y: source.y };
      } else {
        const bitmap = await this.fromCanvas(source.data);
        return { bitmap, x: source.x, y: source.y };
      }
    });
    
    const bitmaps = await Promise.all(bitmapPromises);
    
    // Draw all bitmaps
    for (const { bitmap, x, y } of bitmaps) {
      if (bitmap instanceof ImageData) {
        ctx.putImageData(bitmap, x, y);
      } else {
        ctx.drawImage(bitmap, x, y);
      }
      
      // Close ImageBitmap to free resources
      if (bitmap instanceof ImageBitmap) {
        bitmap.close();
      }
    }
  }

  /**
   * Cache an ImageBitmap
   */
  cache(key: string, bitmap: ImageBitmap) {
    // Manage cache size
    if (this.bitmapCache.size >= this.maxCacheSize) {
      const firstKey = this.bitmapCache.keys().next().value;
      if (typeof firstKey === 'string') {
        const firstBitmap = this.bitmapCache.get(firstKey);
        if (firstBitmap) {
          firstBitmap.close();
        }
        this.bitmapCache.delete(firstKey);
      }
    }
    
    this.bitmapCache.set(key, bitmap);
  }

  /**
   * Get cached ImageBitmap
   */
  getCached(key: string): ImageBitmap | undefined {
    return this.bitmapCache.get(key);
  }

  /**
   * Clear cache
   */
  clearCache() {
    for (const bitmap of this.bitmapCache.values()) {
      bitmap.close();
    }
    this.bitmapCache.clear();
  }

  /**
   * Create tiled ImageBitmap for patterns
   */
  async createTiledBitmap(
    source: ImageData | HTMLCanvasElement,
    tileWidth: number,
    tileHeight: number,
    columns: number,
    rows: number
  ): Promise<ImageBitmap | null> {
    if (!this.isSupported) return null;
    
    try {
      // Create offscreen canvas for tiling
      const canvas = new OffscreenCanvas(
        tileWidth * columns,
        tileHeight * rows
      );
      const ctx = canvas.getContext('2d');
      
      if (!ctx) return null;
      
      // Create source bitmap
      const sourceBitmap = source instanceof ImageData
        ? await this.fromImageData(source)
        : await this.fromCanvas(source);
      
      // Draw tiles
      for (let row = 0; row < rows; row++) {
        for (let col = 0; col < columns; col++) {
          const x = col * tileWidth;
          const y = row * tileHeight;
          
          if (sourceBitmap instanceof ImageData) {
            ctx.putImageData(sourceBitmap, x, y);
          } else {
            ctx.drawImage(sourceBitmap, x, y, tileWidth, tileHeight);
          }
        }
      }
      
      // Create final bitmap
      const tiledBitmap = await createImageBitmap(canvas);
      
      // Clean up source bitmap
      if (sourceBitmap instanceof ImageBitmap) {
        sourceBitmap.close();
      }
      
      return tiledBitmap;
    } catch (error) {
      logError('Failed to create tiled bitmap:', error);
      return null;
    }
  }

  /**
   * Check if ImageBitmap is supported
   */
  static isSupported(): boolean {
    return typeof createImageBitmap !== 'undefined';
  }

  /**
   * Dispose of resources
   */
  dispose() {
    this.clearCache();
  }
}
