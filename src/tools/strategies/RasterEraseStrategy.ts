import type { BrushStampMotion, BrushStampSource } from '@/tools/stamps/BrushStampSource';
import type { EraseStrategy } from './types';

type CanvasPoint = { x: number; y: number };

export class RasterEraseStrategy implements EraseStrategy {
  constructor(private readonly ctx: CanvasRenderingContext2D) {}

  begin(): CanvasRenderingContext2D | null {
    this.ctx.save();
    this.ctx.globalCompositeOperation = 'destination-out';
    // Brush stamps already contain the eraser's opacity.
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
    if (!stampSource) {
      return;
    }
    stampSource.draw(this.ctx, from, to, { ...motion, pressure });
  }

  end(): void {
    this.ctx.restore();
  }
}
