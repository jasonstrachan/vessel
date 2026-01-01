import { canvasPool } from '@/utils/canvasPool';

export interface Renderer2DOptions {
  width: number;
  height: number;
  lazyImageData?: boolean;
  willReadFrequently?: boolean;
}

export class Renderer2D {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private imageData: ImageData | null;

  constructor(options: Renderer2DOptions) {
    this.canvas = canvasPool.acquire(options.width, options.height);
    const ctx = this.canvas.getContext('2d', {
      willReadFrequently: Boolean(options.willReadFrequently),
      alpha: true,
    });

    if (!ctx) {
      throw new Error('Failed to create canvas context');
    }

    this.ctx = ctx;
    this.ctx.imageSmoothingEnabled = false;
    this.imageData = options.lazyImageData ? null : ctx.createImageData(options.width, options.height);
  }

  getCanvas(): HTMLCanvasElement {
    return this.canvas;
  }

  getContext(): CanvasRenderingContext2D {
    return this.ctx;
  }

  hasImageData(): boolean {
    return !!this.imageData;
  }

  ensureImageData(): ImageData {
    if (!this.imageData) {
      this.imageData = this.ctx.createImageData(this.canvas.width, this.canvas.height);
    }
    return this.imageData;
  }

  getImageData(): ImageData {
    return this.ensureImageData();
  }

  render(options: {
    indexData: Uint8Array;
    gradientIdData?: Uint8Array;
    paletteSlots: Uint32Array[];
    basePalette: Uint32Array;
    phase: number;
  }) {
    const imageData = this.ensureImageData();
    const pixels32 = new Uint32Array(imageData.data.buffer);
    const shift = (options.phase * 256) | 0;
    const gradientIdData = options.gradientIdData;

    for (let i = 0; i < options.indexData.length; i++) {
      const colorIndex = options.indexData[i];
      if (colorIndex === 0) {
        pixels32[i] = 0;
        continue;
      }
      const slot = gradientIdData ? gradientIdData[i] : 0;
      const palette = options.paletteSlots[slot] ?? options.basePalette;
      pixels32[i] = palette[(colorIndex - 1 + shift) & 255];
    }

    this.ctx.putImageData(imageData, 0, 0);
  }

  resize(width: number, height: number, options: { preserveImageData: boolean }) {
    const oldCanvas = this.canvas;
    const oldWidth = oldCanvas.width;
    const oldHeight = oldCanvas.height;

    let savedImageData: ImageData | null = null;
    if (options.preserveImageData && this.imageData && oldWidth > 0 && oldHeight > 0) {
      savedImageData = this.ctx.getImageData(0, 0, Math.min(oldWidth, width), Math.min(oldHeight, height));
    }

    this.canvas = canvasPool.acquire(width, height);
    const ctx = this.canvas.getContext('2d', {
      willReadFrequently: Boolean(this.imageData),
      alpha: true,
    });
    if (!ctx) {
      throw new Error('Failed to get context after resize');
    }

    this.ctx = ctx;
    this.ctx.imageSmoothingEnabled = false;
    this.imageData = this.ctx.createImageData(width, height);

    if (savedImageData) {
      this.ctx.putImageData(savedImageData, 0, 0);
    }

    canvasPool.release(oldCanvas);
  }

  drawFrom(source: HTMLCanvasElement, x: number = 0, y: number = 0) {
    this.ctx.drawImage(source, x, y);
  }

  cleanup() {
    if (this.canvas) {
      canvasPool.release(this.canvas);
    }
  }
}
