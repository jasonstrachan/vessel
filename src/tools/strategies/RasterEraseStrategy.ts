import type { BrushStampSource } from '@/tools/stamps/BrushStampSource';
import type { EraseStrategy } from './types';

type CanvasPoint = { x: number; y: number };

export class RasterEraseStrategy implements EraseStrategy {
  constructor(private readonly ctx: CanvasRenderingContext2D) {}

  begin(
    _target: CanvasRenderingContext2D,
    options: { opacity: number }
  ): CanvasRenderingContext2D | null {
    this.ctx.save();
    this.ctx.globalCompositeOperation = 'destination-out';
    this.ctx.globalAlpha = options.opacity ?? 1;
    return this.ctx;
  }

  stamp(
    from: CanvasPoint,
    to: CanvasPoint,
    pressure: number,
    stampSource: BrushStampSource | null
  ): void {
    if (!stampSource) {
      return;
    }
    stampSource.draw(this.ctx, from, to, { pressure });
  }

  end(): void {
    this.ctx.restore();
  }
}
