import { debugWarn } from '@/utils/debug';
import { OffscreenRenderer } from './OffscreenRenderer';
import { supportsOffscreenComposite } from '@/utils/offscreenSupport';

export type CompositeDrawCallback = (
  ctx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D
) => void;

class CompositeBitmapManager {
  private renderer: OffscreenRenderer | null = null;
  private lastWidth = 0;
  private lastHeight = 0;
  private readonly supported: boolean;

  constructor() {
    this.supported = supportsOffscreenComposite();
  }

  isSupported(): boolean {
    return this.supported;
  }

  reset(): void {
    this.renderer = null;
    this.lastWidth = 0;
    this.lastHeight = 0;
  }

  async render(
    width: number,
    height: number,
    draw: CompositeDrawCallback,
    targetCanvas?: HTMLCanvasElement
  ): Promise<ImageBitmap | null> {
    if (!this.supported) {
      return null;
    }

    const renderer = this.ensureRenderer(width, height);
    const ctx = renderer.getContext();

    // Always start from clean slate before drawing
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.restore();

    draw(ctx);

    if (targetCanvas) {
      await renderer.transferToCanvas(targetCanvas);
    }

    try {
      const snapshot = await renderer.snapshot();
      if (snapshot instanceof ImageBitmap) {
        return snapshot;
      }
      if (typeof window !== 'undefined' && typeof window.createImageBitmap === 'function') {
        const bitmap = await window.createImageBitmap(snapshot);
        return bitmap;
      }
    } catch (error) {
      debugWarn('raw-console', '[CompositeBitmapManager] snapshot failed, falling back to canvas path', error);
    }

    return null;
  }

  private ensureRenderer(width: number, height: number): OffscreenRenderer {
    if (!this.renderer) {
      this.renderer = new OffscreenRenderer(width, height);
      this.lastWidth = width;
      this.lastHeight = height;
      return this.renderer;
    }

    if (width !== this.lastWidth || height !== this.lastHeight) {
      this.renderer.resize(width, height);
      this.lastWidth = width;
      this.lastHeight = height;
    }

    return this.renderer;
  }
}

export const compositeBitmapManager = new CompositeBitmapManager();
