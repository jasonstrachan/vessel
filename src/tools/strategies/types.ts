import type { Layer } from '@/types';
import type { BrushStampMotion, BrushStampSource } from '../stamps/BrushStampSource';

type CanvasPoint = { x: number; y: number };

export interface EraseStrategy {
  begin(
    target: CanvasRenderingContext2D | Layer,
    options: { opacity: number }
  ): CanvasRenderingContext2D | null;
  stamp(
    from: CanvasPoint,
    to: CanvasPoint,
    pressure: number,
    stampSource: BrushStampSource | null,
    motion?: BrushStampMotion,
  ): void;
  end(cancelled?: boolean): void;
}
