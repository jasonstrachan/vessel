import type { Layer } from '@/types';
import { BrushShape } from '@/types';
import type { MaskManager } from '@/layers/MaskManager';
import type { EraseStrategy } from './types';
import type { BrushStampSource } from '@/tools/stamps/BrushStampSource';
import { applyPressureCurve } from '@/utils/pressureCurve';
import type { CustomBrushStrokeData } from '@/hooks/brushEngine/BrushEngineFacade';

type CanvasPoint = { x: number; y: number };

type BrushSnapshot = {
  size: number;
  pressureEnabled: boolean;
  minPressure: number;
  maxPressure: number;
  brushShape: BrushShape;
  customStamp?: CustomBrushStrokeData;
};

export class CCMaskEraseStrategy implements EraseStrategy {
  private ctx: CanvasRenderingContext2D | null = null;
  private readonly stampCanvasCache = new WeakMap<ImageData, HTMLCanvasElement>();

  constructor(
    private readonly maskManager: MaskManager,
    private readonly layerId: string,
    private readonly getBrushSnapshot: () => BrushSnapshot
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
    return this.ctx;
  }

  stamp(
    from: CanvasPoint,
    to: CanvasPoint,
    pressure: number,
    _stampSource: BrushStampSource | null
  ): void {
    if (!this.ctx) {
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

    return Math.max(1, Math.round(baseSize));
  }

  private interpolatePoints(from: CanvasPoint, to: CanvasPoint, size: number): CanvasPoint[] {
    const points: CanvasPoint[] = [];
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    const step = Math.max(1, size * 0.45);
    const steps = Math.max(1, Math.ceil(distance / step));
    for (let i = 0; i <= steps; i++) {
      const t = steps === 0 ? 0 : i / steps;
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

    const stamp = snapshot.customStamp;
    if (stamp?.imageData) {
      const source = this.getStampCanvas(stamp);
      const maxDim = Math.max(stamp.width, stamp.height) || 1;
      const scale = size / maxDim;
      const width = stamp.width * scale;
      const height = stamp.height * scale;
      ctx.drawImage(
        source,
        x - width / 2,
        y - height / 2,
        width,
        height
      );
      return;
    }

    if (snapshot.brushShape === BrushShape.COLOR_CYCLE_TRIANGLE) {
      this.drawTriangle(ctx, x, y, size);
    } else {
      this.drawSquare(ctx, x, y, size);
    }
  }

  private drawSquare(ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number): void {
    const half = size / 2;
    const left = Math.round(cx - half);
    const top = Math.round(cy - half);
    ctx.fillRect(left, top, size, size);
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
