import { applyPressureCurve } from '@/utils/pressureCurve';
import { sanitizeBrushColorCycleSpeed } from '@/utils/colorCycleSpeed';
import { sanitizeColorCycleLayerSpeedMultiplier } from '@/utils/colorCycleLayerSpeed';

import type { StampShape } from './colorCycleBrushContracts';

export type ColorCycleCoreBrushSettingsSnapshot = {
  brushSize: number;
  cycleSpeed: number;
  layerBaseSpeed: number;
  pressureEnabled: boolean;
  minPressure: number;
  maxPressure: number;
  totalGradientSteps: number;
  stampShape: StampShape;
  preserveGradientPhaseOnChange: boolean;
};

export type ColorCycleLayerBaseSpeedChange = {
  previousBaseSpeed: number;
  nextBaseSpeed: number;
};

export class ColorCycleCoreBrushSettingsState {
  private brushSize: number;
  private cycleSpeed = 0.1;
  private layerBaseSpeed = 1;
  private pressureEnabled = false;
  private minPressure = 1;
  private maxPressure = 200;
  private totalGradientSteps = 256;
  private stampShape: StampShape = 'square';
  private preserveGradientPhaseOnChange = false;

  constructor(options: { brushSize?: number } = {}) {
    this.brushSize = options.brushSize || 20;
  }

  getBrushSize(): number {
    return this.brushSize;
  }

  setBrushSize(size: number): number | null {
    if (!Number.isFinite(size) || size <= 0) {
      return null;
    }
    this.brushSize = size;
    return this.brushSize;
  }

  getCycleSpeed(): number {
    return this.cycleSpeed;
  }

  setCycleSpeed(speed: number): number | null {
    if (!Number.isFinite(speed) || speed < 0) {
      return null;
    }
    this.cycleSpeed = sanitizeBrushColorCycleSpeed(speed);
    return this.cycleSpeed;
  }

  getLayerBaseSpeed(): number {
    return this.layerBaseSpeed;
  }

  setLayerBaseSpeed(speed: number): ColorCycleLayerBaseSpeedChange | null {
    if (!Number.isFinite(speed) || speed < 0) {
      return null;
    }

    const nextBaseSpeed = sanitizeColorCycleLayerSpeedMultiplier(speed);
    const previousBaseSpeed = sanitizeColorCycleLayerSpeedMultiplier(this.layerBaseSpeed);
    this.layerBaseSpeed = nextBaseSpeed;

    return {
      previousBaseSpeed,
      nextBaseSpeed,
    };
  }

  isPressureEnabled(): boolean {
    return this.pressureEnabled;
  }

  setPressureEnabled(enabled: boolean): void {
    this.pressureEnabled = enabled;
  }

  getMinPressure(): number {
    return this.minPressure;
  }

  setMinPressure(min: number): number {
    this.minPressure = Math.max(1, Math.min(1000, min));
    return this.minPressure;
  }

  getMaxPressure(): number {
    return this.maxPressure;
  }

  setMaxPressure(max: number): number {
    this.maxPressure = Math.max(1, Math.min(1000, max));
    if (this.maxPressure < this.minPressure) {
      this.maxPressure = this.minPressure;
    }
    return this.maxPressure;
  }

  getTotalGradientSteps(): number {
    return this.totalGradientSteps;
  }

  getStampShape(): StampShape {
    return this.stampShape;
  }

  setStampShape(shape: StampShape): StampShape {
    if (
      shape === 'triangle' ||
      shape === 'diamond' ||
      shape === 'diamond5' ||
      shape === 'diamond7' ||
      shape === 'diamond9' ||
      shape === 'checkered' ||
      shape === 'round'
    ) {
      this.stampShape = shape;
    } else {
      this.stampShape = 'square';
    }
    return this.stampShape;
  }

  shouldPreserveGradientPhaseOnChange(): boolean {
    return this.preserveGradientPhaseOnChange;
  }

  setPreserveGradientPhaseOnChange(enabled: boolean): void {
    this.preserveGradientPhaseOnChange = !!enabled;
  }

  resolvePressureBrushSize(pressure: number): number {
    if (!this.pressureEnabled) {
      return Math.max(1, this.brushSize);
    }

    const safePressure = Number.isFinite(pressure) ? Math.max(0, Math.min(1, pressure)) : 1;
    const multiplier = applyPressureCurve(
      safePressure,
      this.minPressure,
      this.maxPressure,
      'linear',
    );
    return Math.max(1, this.brushSize * multiplier);
  }

  getResolvedWriteCycleSpeed(rawSpeed?: number | null): number {
    const writeSpeed = sanitizeBrushColorCycleSpeed(
      rawSpeed,
      Number.isFinite(this.cycleSpeed) ? this.cycleSpeed : 0.1,
    );
    return writeSpeed;
  }

  getSettings(): ColorCycleCoreBrushSettingsSnapshot {
    return {
      brushSize: this.brushSize,
      cycleSpeed: this.cycleSpeed,
      layerBaseSpeed: this.layerBaseSpeed,
      pressureEnabled: this.pressureEnabled,
      minPressure: this.minPressure,
      maxPressure: this.maxPressure,
      totalGradientSteps: this.totalGradientSteps,
      stampShape: this.stampShape,
      preserveGradientPhaseOnChange: this.preserveGradientPhaseOnChange,
    };
  }
}
