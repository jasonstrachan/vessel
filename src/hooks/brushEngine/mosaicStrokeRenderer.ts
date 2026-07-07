import type { BrushSettings } from '@/types';
import { DEFAULT_GRADIENT_STOPS } from '@/utils/gradientPresets';

import type { BrushStampTracker } from './brushStampTracker';
import {
  createMosaicState,
  DEFAULT_MOSAIC_SIZE,
  rebuildMosaicStamp,
  shuffleMosaicPalette,
  type MosaicState,
} from './mosaic';

interface MosaicStrokeRendererOptions {
  getBrushSettings: () => BrushSettings;
  calculatePressureSize: (baseSize: number, pressure: number) => number;
  canDrawAt: (ctx: CanvasRenderingContext2D, x: number, y: number) => boolean;
  stampTracker: BrushStampTracker;
}

export class MosaicStrokeRenderer {
  private state: MosaicState | null = null;

  constructor(private options: MosaicStrokeRendererOptions) {}

  reset(): void {
    this.state = null;
  }

  renderStroke(
    ctx: CanvasRenderingContext2D,
    from: { x: number; y: number },
    to: { x: number; y: number },
    pressure: number,
    rotation: number,
  ): void {
    const state = this.ensureState(from.x, from.y);
    if (!state || !state.stampCanvas) {
      return;
    }

    if (!state.hasStamped) {
      this.drawStamp(ctx, from.x, from.y, state, pressure, rotation);
      state.hasStamped = true;
      state.spacingRemainingPx = state.spacingPx;
    }

    const dx = to.x - state.lastX;
    const dy = to.y - state.lastY;
    const distance = Math.hypot(dx, dy);

    if (distance <= 0) {
      return;
    }

    const dirX = dx / distance;
    const dirY = dy / distance;
    let remaining = distance;
    let cursorX = state.lastX;
    let cursorY = state.lastY;

    while (remaining > 0) {
      const step = Math.min(remaining, state.segmentRemainingPx);
      const nextX = cursorX + dirX * step;
      const nextY = cursorY + dirY * step;

      this.stampSegment(ctx, cursorX, cursorY, nextX, nextY, state, pressure, rotation);

      remaining -= step;
      state.segmentRemainingPx -= step;
      cursorX = nextX;
      cursorY = nextY;

      if (state.segmentRemainingPx <= 0) {
        shuffleMosaicPalette(state);
        rebuildMosaicStamp(state);
      }
    }

    state.lastX = to.x;
    state.lastY = to.y;
  }

  private stampSegment(
    ctx: CanvasRenderingContext2D,
    fromX: number,
    fromY: number,
    toX: number,
    toY: number,
    state: MosaicState,
    pressure: number,
    rotation: number,
  ): void {
    const dx = toX - fromX;
    const dy = toY - fromY;
    const distance = Math.hypot(dx, dy);
    if (distance <= 0) {
      return;
    }

    const dirX = dx / distance;
    const dirY = dy / distance;
    let remaining = distance;
    let cursorX = fromX;
    let cursorY = fromY;
    let spacingRemaining = state.spacingRemainingPx;

    if (spacingRemaining <= 0) {
      this.drawStamp(ctx, cursorX, cursorY, state, pressure, rotation);
      spacingRemaining = state.spacingPx;
    }

    while (remaining >= spacingRemaining) {
      cursorX += dirX * spacingRemaining;
      cursorY += dirY * spacingRemaining;
      remaining -= spacingRemaining;
      this.drawStamp(ctx, cursorX, cursorY, state, pressure, rotation);
      spacingRemaining = state.spacingPx;
    }

    spacingRemaining -= remaining;
    state.spacingRemainingPx = spacingRemaining;
  }

  private drawStamp(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    state: MosaicState,
    pressure: number,
    rotation: number,
  ): void {
    if (!state.stampCanvas) {
      return;
    }

    const brushSettings = this.options.getBrushSettings();
    const baseSize = brushSettings.size || DEFAULT_MOSAIC_SIZE;
    const pressureSize = this.options.calculatePressureSize(baseSize, pressure);
    const scale = pressureSize > 0 ? pressureSize / DEFAULT_MOSAIC_SIZE : 1;

    const drawW = Math.max(1, state.stampW * scale);
    const drawH = Math.max(1, state.stampH * scale);
    const centerX = Math.round(x);
    const centerY = Math.round(y);

    if (!this.options.canDrawAt(ctx, centerX, centerY)) {
      return;
    }

    const totalRotation = rotation + Math.PI / 2;

    ctx.save();
    ctx.imageSmoothingEnabled = Boolean(brushSettings.antialiasing);
    ctx.translate(centerX, centerY);
    if (totalRotation !== 0) {
      ctx.rotate(totalRotation);
    }
    ctx.drawImage(state.stampCanvas, -drawW / 2, -drawH / 2, drawW, drawH);
    ctx.restore();

    this.options.stampTracker.recordStamp(centerX, centerY, rotation, Math.max(drawW, drawH));
  }

  private ensureState(startX: number, startY: number): MosaicState | null {
    if (this.state) {
      return this.state;
    }

    const brushSettings = this.options.getBrushSettings();
    const stops = brushSettings.colorCycleGradient?.length
      ? brushSettings.colorCycleGradient
      : DEFAULT_GRADIENT_STOPS;

    this.state = createMosaicState({
      settings: brushSettings,
      gradientStops: stops,
      startX,
      startY,
    });

    return this.state;
  }
}
