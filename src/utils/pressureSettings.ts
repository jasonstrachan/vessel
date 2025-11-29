import { BrushShape, type BrushSettings } from '@/types';

export const PRESSURE_MIN_PERCENT = 1;
export const PRESSURE_MAX_PERCENT = 1000;

export const clampPressurePercent = (value: number): number => {
  const normalized = Math.round(Number.isFinite(value) ? value : PRESSURE_MIN_PERCENT);
  return Math.min(PRESSURE_MAX_PERCENT, Math.max(PRESSURE_MIN_PERCENT, normalized));
};

export const getDefaultMaxPressurePercent = (shape?: BrushShape): number => {
  switch (shape) {
    case BrushShape.COLOR_CYCLE:
    case BrushShape.COLOR_CYCLE_TRIANGLE:
    case BrushShape.COLOR_CYCLE_SHAPE:
    case BrushShape.RESAMPLER:
    case BrushShape.SPAM_TEXT:
    case BrushShape.PIXEL_ROUND:
    case BrushShape.PIXEL_DITHER:
      return 200;
    default:
      return 100;
  }
};

export interface ResolvedPressureRange {
  enabled: boolean;
  minPercent: number;
  maxPercent: number;
}

export const resolveBrushPressureRange = (settings: BrushSettings): ResolvedPressureRange => {
  const enabled = Boolean(settings.pressureEnabled);
  return {
    enabled,
    minPercent: settings.minPressure ?? PRESSURE_MIN_PERCENT,
    maxPercent: settings.maxPressure ?? getDefaultMaxPressurePercent(settings.brushShape),
  };
};
