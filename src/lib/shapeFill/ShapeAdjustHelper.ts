import type { Vec2 } from './types';
import { computeDragScaledValue } from '@/utils/dragScale';

interface ViewTransform {
  offsetX: number;
  offsetY: number;
  scale: number;
}

export type ShapeAdjustBandId = 'spacing' | 'density' | 'orientation';

export interface ShapeAdjustHelperUpdate {
  spacing: number;
  density?: number;
  orientation?: number;
  noiseStrength?: number;
  band: ShapeAdjustBandId;
}

export interface ShapeAdjustHelperOptions {
  getOverlayCanvas: () => HTMLCanvasElement | null;
  getViewTransform: () => ViewTransform;
  onUpdate: (update: ShapeAdjustHelperUpdate) => void;
  onCommit?: (update: ShapeAdjustHelperUpdate) => void;
  onCancel?: () => void;
  spacingBounds?: { min: number; max: number; exponent?: number };
  densityBounds?: { min: number; max: number; exponent?: number };
  noiseBounds?: { min: number; max: number };
  orientationSnap?: number;
}

export interface ShapeAdjustSessionConfig {
  centroid: Vec2;
  vertices?: readonly Vec2[];
  initialSpacing: number;
  initialDensity?: number;
  initialOrientation?: number;
  initialNoise?: number;
}

interface DragState {
  pointerId: number;
  band: ShapeAdjustBandId;
  startDistance: number;
  startSpacing: number;
  startDensity: number;
  startOrientation: number;
  startNoise: number;
}

const DEFAULT_SPACING_BOUNDS = { min: 4, max: 80, exponent: 1.05 } as const;
const DEFAULT_DENSITY_BOUNDS = { min: 32, max: 320, exponent: 1.08 } as const;
const DEFAULT_NOISE_BOUNDS = { min: 0, max: 1 } as const;

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

const worldDistance = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y);

const worldToScreen = (point: Vec2, transform: ViewTransform): Vec2 => ({
  x: point.x * transform.scale + transform.offsetX,
  y: point.y * transform.scale + transform.offsetY,
});

const normalizeAngle = (deg: number): number => ((deg % 360) + 360) % 360;

const computeBoundingRadius = (centroid: Vec2, vertices?: readonly Vec2[]): number => {
  if (!vertices || !vertices.length) {
    return 64;
  }
  let max = 0;
  for (const vertex of vertices) {
    const dist = worldDistance(vertex, centroid);
    if (dist > max) {
      max = dist;
    }
  }
  return Math.max(32, max * 0.5);
};

export class ShapeAdjustHelper {
  private readonly options: ShapeAdjustHelperOptions;

  private session: (ShapeAdjustSessionConfig & {
    boundingRadius: number;
    bandSpacing: number;
  }) | null = null;

  private drag: DragState | null = null;

  private currentSpacing = 18;

  private currentDensity = 120;

  private currentOrientation = 0;

  private currentNoise = 0.6;

  private pointerScreen: Vec2 | null = null;

  private animationFrame = 0;

  constructor(options: ShapeAdjustHelperOptions) {
    this.options = options;
  }

  beginSession(config: ShapeAdjustSessionConfig): void {
    const boundingRadius = computeBoundingRadius(config.centroid, config.vertices);
    this.session = {
      ...config,
      boundingRadius,
      bandSpacing: boundingRadius / 3,
    };
    this.currentSpacing = config.initialSpacing;
    this.currentDensity = config.initialDensity ?? 120;
    this.currentOrientation = config.initialOrientation ?? 0;
    this.currentNoise = config.initialNoise ?? 0.6;
    this.drag = null;
    this.pointerScreen = null;
    this.scheduleOverlay();
  }

  beginDrag(pointer: Vec2, pointerId: number, modifiers: { shiftKey?: boolean } = {}): void {
    if (!this.session) {
      return;
    }
    const band = this.pickBand(pointer);
    const distance = worldDistance(pointer, this.session.centroid);
    this.drag = {
      pointerId,
      band,
      startDistance: Math.max(distance, 1e-3),
      startSpacing: this.currentSpacing,
      startDensity: this.currentDensity,
      startOrientation: this.currentOrientation,
      startNoise: this.currentNoise,
    };
    this.applyUpdate(pointer, modifiers, band);
  }

  updateDrag(pointer: Vec2, pointerId: number, modifiers: { shiftKey?: boolean } = {}): void {
    if (!this.session || !this.drag || this.drag.pointerId !== pointerId) {
      return;
    }
    this.applyUpdate(pointer, modifiers, this.drag.band);
  }

  endDrag(pointerId: number, commit: boolean): ShapeAdjustHelperUpdate | null {
    if (!this.session || !this.drag || this.drag.pointerId !== pointerId) {
      return null;
    }
    const update: ShapeAdjustHelperUpdate = {
      spacing: this.currentSpacing,
      density: this.currentDensity,
      orientation: this.currentOrientation,
      noiseStrength: this.currentNoise,
      band: this.drag.band,
    };
    this.drag = null;
    if (commit && this.options.onCommit) {
      this.options.onCommit(update);
    }
    this.scheduleOverlay();
    return update;
  }

  cancel(): void {
    this.drag = null;
    this.session = null;
    this.pointerScreen = null;
    this.clearOverlay();
    this.options.onCancel?.();
  }

  isActive(): boolean {
    return Boolean(this.session);
  }

  isDragging(pointerId: number): boolean {
    return Boolean(this.drag && this.drag.pointerId === pointerId);
  }

  getCurrentValues(): ShapeAdjustHelperUpdate | null {
    if (!this.session) {
      return null;
    }
    return {
      spacing: this.currentSpacing,
      density: this.currentDensity,
      orientation: this.currentOrientation,
      noiseStrength: this.currentNoise,
      band: this.drag?.band ?? 'spacing',
    };
  }

  destroy(): void {
    this.cancel();
    if (this.animationFrame) {
      cancelAnimationFrame(this.animationFrame);
      this.animationFrame = 0;
    }
  }

  private pickBand(pointer: Vec2): ShapeAdjustBandId {
    const session = this.session;
    if (!session) {
      return 'spacing';
    }
    const distance = worldDistance(pointer, session.centroid);
    const spacingRadius = session.bandSpacing;
    const densityRadius = spacingRadius * 2;
    if (distance <= spacingRadius) {
      return 'spacing';
    }
    if (distance <= densityRadius) {
      return 'density';
    }
    return 'orientation';
  }

  private applyUpdate(pointer: Vec2, modifiers: { shiftKey?: boolean }, band: ShapeAdjustBandId): void {
    if (!this.session || !this.drag) {
      return;
    }

    const viewTransform = this.options.getViewTransform();
    this.pointerScreen = worldToScreen(pointer, viewTransform);

    const distance = Math.max(worldDistance(pointer, this.session.centroid), 1e-3);

    const spacingBounds = {
      ...DEFAULT_SPACING_BOUNDS,
      ...this.options.spacingBounds,
    };
    const densityBounds = {
      ...DEFAULT_DENSITY_BOUNDS,
      ...this.options.densityBounds,
    };
    const noiseBounds = {
      ...DEFAULT_NOISE_BOUNDS,
      ...this.options.noiseBounds,
    };

    if (band === 'spacing') {
      const newSpacing = computeDragScaledValue({
        startDistance: this.drag.startDistance,
        currentDistance: distance,
        startValue: this.drag.startSpacing,
        min: spacingBounds.min,
        max: spacingBounds.max,
        exponent: spacingBounds.exponent,
      });
      this.currentSpacing = clamp(newSpacing, spacingBounds.min, spacingBounds.max);
    } else if (band === 'density') {
      const newDensity = computeDragScaledValue({
        startDistance: this.drag.startDistance,
        currentDistance: distance,
        startValue: this.drag.startDensity,
        min: densityBounds.min,
        max: densityBounds.max,
        exponent: densityBounds.exponent,
      });
      this.currentDensity = clamp(newDensity, densityBounds.min, densityBounds.max);
    } else {
      const rawAngle = normalizeAngle((Math.atan2(pointer.y - this.session.centroid.y, pointer.x - this.session.centroid.x) * 180) / Math.PI);
      if (modifiers.shiftKey) {
        const noisePercent = clamp(rawAngle / 360, 0, 1);
        const range = noiseBounds.max - noiseBounds.min;
        this.currentNoise = noiseBounds.min + noisePercent * range;
      } else {
        const snap = this.options.orientationSnap && this.options.orientationSnap > 0
          ? this.options.orientationSnap
          : 1;
        const snapped = Math.round(rawAngle / snap) * snap;
        this.currentOrientation = normalizeAngle(snapped);
      }
    }

    const update: ShapeAdjustHelperUpdate = {
      spacing: this.currentSpacing,
      density: this.currentDensity,
      orientation: this.currentOrientation,
      noiseStrength: this.currentNoise,
      band,
    };

    this.options.onUpdate(update);
    this.scheduleOverlay();
  }

  private scheduleOverlay(): void {
    if (this.animationFrame) {
      return;
    }
    this.animationFrame = requestAnimationFrame(() => {
      this.animationFrame = 0;
      this.drawOverlay();
    });
  }

  private drawOverlay(): void {
    const session = this.session;
    if (!session) {
      this.clearOverlay();
      return;
    }

    const canvas = this.options.getOverlayCanvas();
    if (!canvas) {
      return;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return;
    }

    const { offsetX, offsetY, scale } = this.options.getViewTransform();
    const center = worldToScreen(session.centroid, { offsetX, offsetY, scale });

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();

    const spacingRadiusPx = session.bandSpacing * scale;
    const densityRadiusPx = spacingRadiusPx * 2;
    const orientationRadiusPx = spacingRadiusPx * 3;

    const drawRing = (radius: number, color: string, active: boolean) => {
      ctx.beginPath();
      ctx.arc(center.x, center.y, radius, 0, Math.PI * 2);
      ctx.strokeStyle = color;
      ctx.lineWidth = active ? 3 : 1;
      ctx.globalAlpha = active ? 0.9 : 0.4;
      ctx.stroke();
    };

    const activeBand = this.drag?.band ?? 'spacing';

    drawRing(spacingRadiusPx, '#7dd3fc', activeBand === 'spacing');
    drawRing(densityRadiusPx, '#fcd34d', activeBand === 'density');
    drawRing(orientationRadiusPx, '#fda4af', activeBand === 'orientation');

    if (this.pointerScreen) {
      ctx.beginPath();
      ctx.moveTo(center.x, center.y);
      ctx.lineTo(this.pointerScreen.x, this.pointerScreen.y);
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1;
      ctx.globalAlpha = 0.6;
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(this.pointerScreen.x, this.pointerScreen.y, 4, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff';
      ctx.globalAlpha = 0.9;
      ctx.fill();
    }

    ctx.restore();
  }

  private clearOverlay(): void {
    const canvas = this.options.getOverlayCanvas();
    if (!canvas) {
      return;
    }
    const ctx = canvas.getContext('2d');
    ctx?.clearRect(0, 0, canvas.width, canvas.height);
  }
}
