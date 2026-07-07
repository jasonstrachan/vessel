import { BrushShape, type SequentialStampPoint } from '@/types';

import type { createShapeDrawer } from './shapes';

type ShapeDrawer = ReturnType<typeof createShapeDrawer>;

export class BrushStampTracker {
  private recentStamps: SequentialStampPoint[] = [];
  private active = false;
  private pressure = 1;
  private alpha = 1;

  begin(pressure: number, alpha: number): void {
    this.recentStamps = [];
    this.active = true;
    this.pressure = Number.isFinite(pressure)
      ? Math.max(0, Math.min(1, pressure))
      : 1;
    this.alpha = Number.isFinite(alpha)
      ? Math.max(0, Math.min(1, alpha))
      : 1;
  }

  end(): void {
    this.active = false;
  }

  consume(): SequentialStampPoint[] {
    const stamps = this.recentStamps.map((stamp) => ({ ...stamp }));
    this.recentStamps = [];
    return stamps;
  }

  recordStamp(x: number, y: number, rotation: number, size: number): void {
    if (!this.active || !Number.isFinite(x) || !Number.isFinite(y)) {
      return;
    }

    this.recentStamps.push({
      x,
      y,
      pressure: this.pressure,
      rotation: Number.isFinite(rotation) ? rotation : 0,
      size: Number.isFinite(size) ? Math.max(0, size) : 0,
      alpha: this.alpha,
    });
  }

  shouldSkipNearDuplicateFinalStamp(point: { x: number; y: number }, shape: BrushShape): boolean {
    if (shape !== BrushShape.CUSTOM || this.recentStamps.length === 0) {
      return false;
    }

    const lastStamp = this.recentStamps[this.recentStamps.length - 1];
    if (!lastStamp) {
      return false;
    }

    const dx = point.x - lastStamp.x;
    const dy = point.y - lastStamp.y;
    return Math.hypot(dx, dy) < 1;
  }

  createTrackedShapeDrawer(drawer: ShapeDrawer): ShapeDrawer {
    return ((
      ctx: CanvasRenderingContext2D,
      x: number,
      y: number,
      size: number,
      shape: BrushShape,
      antiAliasing: boolean,
      rotation: number,
      risographIntensity: number,
      pattern?: ImageData,
      centerAlignment?: boolean,
      customPatternDimensions?: { width: number; height: number },
    ) => {
      drawer(
        ctx,
        x,
        y,
        size,
        shape,
        antiAliasing,
        rotation,
        risographIntensity,
        pattern,
        centerAlignment,
        customPatternDimensions,
      );

      this.recordStamp(x, y, rotation, size);
    }) as ShapeDrawer;
  }
}
