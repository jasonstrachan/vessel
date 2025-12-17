export const PRESSURE_RESOLUTION_MIN_PX = 1;
export const PRESSURE_RESOLUTION_MAX_PX = 32;
export const PRESSURE_RESOLUTION_EASING_EXPONENT = 1.5;
export const PRESSURE_RESOLUTION_HYSTERESIS = 0.15;
export const PRESSURE_RESOLUTION_TIME_CONSTANT_MS = 100;

export type PressureResolutionState = {
  smoothed: number;
  output: number;
  lastTime: number;
};

export const createPressureResolutionState = (
  initial: number = PRESSURE_RESOLUTION_MIN_PX
): PressureResolutionState => ({
  smoothed: initial,
  output: initial,
  lastTime: 0,
});

/**
 * Pressure-linked fill resolution with smoothing and hysteresis.
 * 0% pressure -> 1px, 100% pressure -> maxResolution (defaults to sliderValue).
 * If pressureLinked is false -> fixed pixel size = sliderValue (>= 1).
 */
export const computePressureResolution = (
  sliderValue: number,
  pressure: number,
  pressureLinked: boolean,
  state?: PressureResolutionState,
  now?: number,
  maxResolution?: number
): number => {
  const maxBase = pressureLinked ? maxResolution ?? sliderValue : sliderValue;
  const maxSize = Math.max(PRESSURE_RESOLUTION_MIN_PX, Math.round(maxBase || 1));
  if (!pressureLinked) return maxSize;

  const p = Math.max(0, Math.min(1, pressure));
  const t = Math.pow(p, PRESSURE_RESOLUTION_EASING_EXPONENT);
  const targetFloat = PRESSURE_RESOLUTION_MIN_PX + (maxSize - PRESSURE_RESOLUTION_MIN_PX) * t;

  if (!state) {
    return Math.max(PRESSURE_RESOLUTION_MIN_PX, Math.round(targetFloat));
  }

  const timestamp =
    typeof now === 'number'
      ? now
      : typeof performance !== 'undefined' && typeof performance.now === 'function'
        ? performance.now()
        : Date.now();
  const dt = state.lastTime ? Math.max(1, timestamp - state.lastTime) : 16;
  state.lastTime = timestamp;

  const alpha = 1 - Math.exp(-dt / PRESSURE_RESOLUTION_TIME_CONSTANT_MS);
  state.smoothed = state.smoothed + (targetFloat - state.smoothed) * alpha;

  const desired = Math.max(PRESSURE_RESOLUTION_MIN_PX, Math.min(maxSize, state.smoothed));
  const delta = desired - state.output;

  if (Math.abs(delta) >= PRESSURE_RESOLUTION_HYSTERESIS) {
    state.output = desired;
  }

  return Math.max(PRESSURE_RESOLUTION_MIN_PX, Math.min(maxSize, state.output));
};
