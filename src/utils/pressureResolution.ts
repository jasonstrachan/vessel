export const PRESSURE_RESOLUTION_MIN_PX = 1;
export const PRESSURE_RESOLUTION_EASING_EXPONENT = 1.5;
export const PRESSURE_RESOLUTION_MAX_MULTIPLIER = 16;

/**
 * Maps pressure to a pixel size for pressure-linked fill resolution.
 * 0% pressure -> 1px, 100% pressure -> sliderValue * multiplier.
 */
export const computePressureResolution = (
  sliderValue: number,
  pressure: number,
  pressureLinked: boolean
): number => {
  const base = Math.max(PRESSURE_RESOLUTION_MIN_PX, Math.round(sliderValue || 1));
  if (!pressureLinked) return base;

  const p = Math.max(0, Math.min(1, pressure));
  const maxSize = base * PRESSURE_RESOLUTION_MAX_MULTIPLIER;
  const t = Math.pow(p, PRESSURE_RESOLUTION_EASING_EXPONENT);
  const result = PRESSURE_RESOLUTION_MIN_PX + (maxSize - PRESSURE_RESOLUTION_MIN_PX) * t;

  return Math.max(PRESSURE_RESOLUTION_MIN_PX, Math.round(result));
};
