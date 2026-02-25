import { BrushShape, type BrushSettings } from '@/types';

export const PRESSURE_BASE_PERCENT = 100;
export const PRESSURE_MIN_PERCENT = 1;
export const PRESSURE_MAX_PERCENT = 1000;

export const clampPressurePercent = (value: number): number => {
  const normalized = Math.round(Number.isFinite(value) ? value : PRESSURE_MIN_PERCENT);
  return Math.min(PRESSURE_MAX_PERCENT, Math.max(PRESSURE_MIN_PERCENT, normalized));
};

export const clampPressureDeltaPercent = (value: number): number => {
  const normalized = Math.round(Number.isFinite(value) ? value : 0);
  return Math.min(PRESSURE_MAX_PERCENT, Math.max(0, normalized));
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
  const minUnder = clampPressureDeltaPercent(settings.minPressure ?? 0);
  const maxOver = clampPressureDeltaPercent(
    settings.maxPressure ?? Math.max(0, getDefaultMaxPressurePercent(settings.brushShape) - PRESSURE_BASE_PERCENT)
  );
  const minPercent = clampPressurePercent(PRESSURE_BASE_PERCENT - minUnder);
  const maxPercent = clampPressurePercent(PRESSURE_BASE_PERCENT + maxOver);
  return {
    enabled,
    minPercent,
    maxPercent: Math.max(minPercent, maxPercent),
  };
};
