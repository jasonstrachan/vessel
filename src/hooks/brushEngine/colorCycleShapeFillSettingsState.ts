export type ColorCycleShapeFillSettingsSnapshot = {
  gradientBands: number;
  bandSpacing: number;
  ditherEnabled: boolean;
  ditherStrength: number;
  ditherPixelSize: number;
  pxlEdgeEnabled: boolean;
  perceptualDither: boolean;
};

export class ColorCycleShapeFillSettingsState {
  private gradientBands = 12;
  private bandSpacing = 5;
  private ditherEnabled = false;
  private ditherStrength = 1.0;
  private ditherPixelSize = 1;
  private pxlEdgeEnabled = false;
  private perceptualDither = false;

  getGradientBands(): number {
    return this.gradientBands;
  }

  setGradientBands(bands: number): number | null {
    if (!Number.isFinite(bands) || bands < 1) {
      return null;
    }
    this.gradientBands = Math.max(1, Math.min(254, Math.floor(bands)));
    return this.gradientBands;
  }

  getBandSpacing(): number {
    return this.bandSpacing;
  }

  setBandSpacing(spacing: number): number | null {
    if (!Number.isFinite(spacing) || spacing <= 0) {
      return null;
    }
    this.bandSpacing = Math.max(1, Math.min(512, Math.round(spacing)));
    return this.bandSpacing;
  }

  normalizeBandSpacingValue(spacing?: number): number {
    if (typeof spacing !== 'number' || !Number.isFinite(spacing) || spacing <= 0) {
      return Math.max(1, this.bandSpacing || 12);
    }
    return Math.max(1, Math.min(512, Math.round(spacing)));
  }

  deriveBandCountFromDistance(distance: number, spacing?: number): number {
    const fixedBands = Number.isFinite(this.gradientBands)
      ? Math.max(2, Math.min(254, Math.floor(this.gradientBands)))
      : null;
    if (fixedBands !== null) {
      return fixedBands;
    }
    if (!Number.isFinite(distance) || distance <= 0) {
      return 12;
    }
    const spacingPx = this.normalizeBandSpacingValue(spacing);
    const raw = Math.max(2, distance / spacingPx);
    return Math.max(2, Math.min(254, Math.round(raw)));
  }

  isDitherEnabled(): boolean {
    return this.ditherEnabled;
  }

  setDitherEnabled(enabled: boolean): boolean {
    this.ditherEnabled = !!enabled;
    if (this.ditherEnabled) {
      this.ditherStrength = 1.0;
    }
    return this.ditherEnabled;
  }

  getDitherStrength(): number {
    return this.ditherStrength;
  }

  setDitherStrength(strength: number): void {
    this.ditherStrength = Math.max(0, Math.min(1, strength));
  }

  getDitherPixelSize(): number {
    return this.ditherPixelSize;
  }

  setDitherPixelSize(size: number): void {
    this.ditherPixelSize = Math.max(1, Math.floor(size));
  }

  isPxlEdgeEnabled(): boolean {
    return this.pxlEdgeEnabled;
  }

  setPxlEdgeEnabled(enabled: boolean): void {
    this.pxlEdgeEnabled = !!enabled;
  }

  isPerceptualDitherEnabled(): boolean {
    return this.perceptualDither;
  }

  setPerceptualDither(enabled: boolean): void {
    this.perceptualDither = !!enabled;
  }

  getSettings(): ColorCycleShapeFillSettingsSnapshot {
    return {
      gradientBands: this.gradientBands,
      bandSpacing: this.bandSpacing,
      ditherEnabled: this.ditherEnabled,
      ditherStrength: this.ditherStrength,
      ditherPixelSize: this.ditherPixelSize,
      pxlEdgeEnabled: this.pxlEdgeEnabled,
      perceptualDither: this.perceptualDither,
    };
  }
}
