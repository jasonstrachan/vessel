import type { MaskManager } from '@/layers/MaskManager';
import type { BrushStampMotion, BrushStampSource } from '@/tools/stamps/BrushStampSource';
import { BrushShape, type Layer } from '@/types';
import { observeCanvasAuthoring, type CanvasAuthoringObservation } from '@/utils/canvasAuthoringObserver';

import type { EraseStrategy } from './types';

type CanvasPoint = { x: number; y: number };

export const resolveCCMaskEraserStampSize = (
  requestedSize: number,
  brushShape: BrushShape
): number => {
  const roundedSize = Math.max(1, Math.round(requestedSize));
  if (brushShape === BrushShape.PIXEL_DITHER) {
    return 5 * Math.max(1, Math.round(roundedSize / 5));
  }
  return roundedSize;
};

export class CCMaskEraseStrategy implements EraseStrategy {
  private observation: CanvasAuthoringObservation | null = null;
  private ctx: CanvasRenderingContext2D | null = null;

  constructor(
    private readonly maskManager: MaskManager,
    private readonly layerId: string,
  ) {}

  begin(layer: Layer): CanvasRenderingContext2D | null {
    void layer;
    const maskCanvas = this.maskManager.getMask(this.layerId);
    const ctx = maskCanvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) {
      return null;
    }
    this.observation = observeCanvasAuthoring(ctx, { layerId: this.layerId, operation: 'destination-out' });
    this.ctx = this.observation.context;
    this.ctx.save();
    this.ctx.imageSmoothingEnabled = false;
    this.ctx.globalCompositeOperation = 'source-over';
    // The shared stroke buffer already contains the eraser opacity.
    this.ctx.globalAlpha = 1;
    return this.ctx;
  }

  stamp(
    from: CanvasPoint,
    to: CanvasPoint,
    pressure: number,
    stampSource: BrushStampSource | null,
    motion?: BrushStampMotion,
  ): void {
    if (!this.ctx || !stampSource) {
      return;
    }
    // A source is stateful: advance it once, on the canonical mask only.
    stampSource.draw(this.ctx, from, to, { ...motion, pressure });
  }

  end(cancelled = false): void {
    if (!this.ctx) {
      return;
    }
    this.ctx.restore();
    this.observation?.finish(cancelled);
    this.observation = null;
    this.maskManager.bumpVersion(this.layerId);
    this.ctx = null;
  }
}
