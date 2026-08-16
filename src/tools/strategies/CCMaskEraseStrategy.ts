import { createPixelCircleStamp } from '@/hooks/brushEngine/brushStampController';
import type { CustomBrushStrokeData } from '@/hooks/brushEngine/BrushEngineFacade';
import type { MaskManager } from '@/layers/MaskManager';
import type { BrushStampSource } from '@/tools/stamps/BrushStampSource';
import { BrushShape, type Layer } from '@/types';
import { applyPressureCurve } from '@/utils/pressureCurve';

import type { EraseStrategy } from './types';

type CanvasPoint = { x: number; y: number };

type BrushSnapshot = {
  size: number;
  pressureEnabled: boolean;
  minPressure: number;
  maxPressure: number;
  brushShape: BrushShape;
  customStamp?: CustomBrushStrokeData;
};

const DIAMOND_5_MASK: ReadonlyArray<number> = [
  0, 0, 1, 0, 0,
  0, 1, 1, 1, 0,
  1, 1, 1, 1, 1,
  0, 1, 1, 1, 0,
  0, 0, 1, 0, 0,
];

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
  private ctx: CanvasRenderingContext2D | null = null;
  private overlayCtx: CanvasRenderingContext2D | null = null;
  private readonly stampCanvasCache = new WeakMap<ImageData, HTMLCanvasElement>();
  private readonly pixelRoundStampCache = new Map<string, HTMLCanvasElement>();

  constructor(
    private readonly maskManager: MaskManager,
    private readonly layerId: string,
    private readonly getBrushSnapshot: () => BrushSnapshot,
    private readonly previewOverlayCtx?: CanvasRenderingContext2D | null
  ) {}

  begin(layer: Layer, options: { opacity: number }): CanvasRenderingContext2D | null {
    void layer;
    const maskCanvas = this.maskManager.getMask(this.layerId);
    const ctx = maskCanvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) {
      return null;
    }
    this.ctx = ctx;
    this.ctx.save();
    try {
      this.ctx.imageSmoothingEnabled = false;
    } catch {}
    this.ctx.globalCompositeOperation = 'source-over';
    this.ctx.globalAlpha = options.opacity ?? 1;
    this.overlayCtx = this.previewOverlayCtx ?? null;
    if (this.overlayCtx) {
      this.overlayCtx.save();
      try {
        this.overlayCtx.imageSmoothingEnabled = false;
      } catch {}
      this.overlayCtx.globalCompositeOperation = 'destination-out';
      this.overlayCtx.globalAlpha = options.opacity ?? 1;
    }
    return this.ctx;
  }

  stamp(
    from: CanvasPoint,
    to: CanvasPoint,
    pressure: number,
    stampSource: BrushStampSource | null
  ): void {
    if (!this.ctx) {
      return;
    }
    if (stampSource) {
      stampSource.draw(this.ctx, from, to, { pressure });
      if (this.overlayCtx) {
        stampSource.draw(this.overlayCtx, from, to, { pressure });
      }
      return;
    }
    const snapshot = this.getBrushSnapshot();
    const effectiveSize = this.computeStampSize(pressure, snapshot);
    const points = this.interpolatePoints(from, to, effectiveSize);
    for (const point of points) {
      this.drawStamp(point.x, point.y, effectiveSize, snapshot);
    }
  }

  end(): void {
    if (!this.ctx) {
      return;
    }
    this.ctx.restore();
    this.maskManager.bumpVersion(this.layerId);
    this.ctx = null;
    if (this.overlayCtx) {
      this.overlayCtx.restore();
      this.overlayCtx = null;
    }
  }

  private computeStampSize(pressure: number, snapshot: BrushSnapshot): number {
    let baseSize = snapshot.size || 1;
    const stamp = snapshot.customStamp;
    if (stamp && !stamp.isResampler) {
      const maxDim = Math.max(stamp.width, stamp.height) || 1;
      baseSize = (baseSize / 100) * maxDim;
    }

    if (snapshot.pressureEnabled) {
      const minP = snapshot.minPressure ?? 50;
      const maxP = snapshot.maxPressure ?? 200;
      baseSize = baseSize * applyPressureCurve(pressure, minP, maxP, 's-curve');
    }

    return resolveCCMaskEraserStampSize(baseSize, snapshot.brushShape);
  }

  private interpolatePoints(from: CanvasPoint, to: CanvasPoint, size: number): CanvasPoint[] {
    const points: CanvasPoint[] = [];
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    if (distance === 0) {
      return [{ ...to }];
    }
    const step = Math.max(1, size * 0.45);
    const steps = Math.max(1, Math.ceil(distance / step));
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      points.push({
        x: from.x + dx * t,
        y: from.y + dy * t
      });
    }
    return points;
  }

  private drawStamp(
    x: number,
    y: number,
    size: number,
    snapshot: BrushSnapshot
  ): void {
    const ctx = this.ctx;
    if (!ctx) {
      return;
    }
    const overlayCtx = this.overlayCtx;

    const stamp = snapshot.customStamp;
    if (stamp?.imageData) {
      const source = this.getStampCanvas(stamp);
      const maxDim = Math.max(stamp.width, stamp.height) || 1;
      const scale = size / maxDim;
      const width = stamp.width * scale;
      const height = stamp.height * scale;
      const drawX = x - width / 2;
      const drawY = y - height / 2;
      ctx.drawImage(source, drawX, drawY, width, height);
      overlayCtx?.drawImage(source, drawX, drawY, width, height);
      return;
    }

    if (
      snapshot.brushShape === BrushShape.PIXEL_ROUND ||
      snapshot.brushShape === BrushShape.ROUND
    ) {
      this.drawRound(ctx, x, y, size);
      if (overlayCtx) {
        this.drawRound(overlayCtx, x, y, size);
      }
    } else if (snapshot.brushShape === BrushShape.PIXEL_DITHER) {
      this.drawDiamond5(ctx, x, y, size);
      if (overlayCtx) {
        this.drawDiamond5(overlayCtx, x, y, size);
      }
    } else if (snapshot.brushShape === BrushShape.COLOR_CYCLE_TRIANGLE) {
      this.drawTriangle(ctx, x, y, size);
      if (overlayCtx) {
        this.drawTriangle(overlayCtx, x, y, size);
      }
    } else {
      this.drawSquare(ctx, x, y, size);
      if (overlayCtx) {
        this.drawSquare(overlayCtx, x, y, size);
      }
    }
  }

  private drawSquare(ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number): void {
    const half = size / 2;
    const left = Math.round(cx - half);
    const top = Math.round(cy - half);
    ctx.fillRect(left, top, size, size);
  }

  private drawRound(ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number): void {
    const stampSize = Math.max(1, Math.round(size));
    const stamp = createPixelCircleStamp({
      size: stampSize,
      brushStampCache: this.pixelRoundStampCache,
    });
    ctx.drawImage(
      stamp,
      Math.round(cx - stampSize / 2),
      Math.round(cy - stampSize / 2)
    );
  }

  private drawDiamond5(ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number): void {
    const gridSize = 5;
    const pixelScale = Math.max(1, Math.round(size / gridSize));
    const stampSize = gridSize * pixelScale;
    const originX = Math.round(cx - stampSize / 2);
    const originY = Math.round(cy - stampSize / 2);

    for (let row = 0; row < gridSize; row += 1) {
      for (let col = 0; col < gridSize; col += 1) {
        if (DIAMOND_5_MASK[row * gridSize + col] === 0) {
          continue;
        }
        ctx.fillRect(
          originX + col * pixelScale,
          originY + row * pixelScale,
          pixelScale,
          pixelScale
        );
      }
    }
  }

  private drawTriangle(ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number): void {
    const half = size / 2;
    ctx.beginPath();
    ctx.moveTo(Math.round(cx), Math.round(cy - half));
    ctx.lineTo(Math.round(cx + half), Math.round(cy + half));
    ctx.lineTo(Math.round(cx - half), Math.round(cy + half));
    ctx.closePath();
    ctx.fill();
  }

  private getStampCanvas(stamp: CustomBrushStrokeData): HTMLCanvasElement {
    const existing = this.stampCanvasCache.get(stamp.imageData);
    if (existing) {
      return existing;
    }
    const canvas = document.createElement('canvas');
    canvas.width = stamp.width;
    canvas.height = stamp.height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D | null;
    if (ctx) {
      try {
        ctx.imageSmoothingEnabled = false;
      } catch {}
      ctx.putImageData(stamp.imageData, 0, 0);
    }
    this.stampCanvasCache.set(stamp.imageData, canvas);
    return canvas;
  }
}
