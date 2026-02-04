import {
  computePressureResolution,
  createPressureResolutionState,
  PRESSURE_RESOLUTION_HYSTERESIS,
  PRESSURE_RESOLUTION_MAX_PX,
  PRESSURE_RESOLUTION_MIN_PX,
  PRESSURE_RESOLUTION_TIME_CONSTANT_MS,
} from '../pressureResolution';

describe('computePressureResolution smoothing', () => {
  const slider = 12; // acts as max size when linked
  const toPressure = (desiredSize: number) => {
    const maxSize = slider;
    const clamped = Math.max(
      PRESSURE_RESOLUTION_MIN_PX,
      Math.min(maxSize, desiredSize)
    );
    const t = (clamped - PRESSURE_RESOLUTION_MIN_PX) /
      (maxSize - PRESSURE_RESOLUTION_MIN_PX);
    return Math.pow(t, 1 / 1.5);
  };

  it('holds output within hysteresis band', () => {
    const state = createPressureResolutionState(5);
    const delta = PRESSURE_RESOLUTION_HYSTERESIS * 0.5;
    const nearRaw = state.output + delta;

    const result = computePressureResolution(slider, toPressure(nearRaw), true, state, 0);

    expect(result).toBe(5);
  });

  it('steps by one when outside hysteresis band', () => {
    const state = createPressureResolutionState(4);
    const delta = PRESSURE_RESOLUTION_HYSTERESIS + 0.2;
    const target = state.output + delta;

    const first = computePressureResolution(slider, toPressure(target), true, state, 0);
    const result = computePressureResolution(
      slider,
      toPressure(target),
      true,
      state,
      PRESSURE_RESOLUTION_TIME_CONSTANT_MS * 2
    );

    expect(first).toBeGreaterThanOrEqual(4);
    expect(result).toBeGreaterThanOrEqual(4);
  });

  it('clamps to min when not linked', () => {
    const result = computePressureResolution(0, 1, false);
    expect(result).toBe(PRESSURE_RESOLUTION_MIN_PX);
  });

  it('low-pass filters target changes over time', () => {
    const state = createPressureResolutionState(1);
    const target = 12;
    const pressure = toPressure(target);

    // single step should not jump all the way
    const first = computePressureResolution(slider, pressure, true, state, 0);
    expect(first).toBeGreaterThanOrEqual(1);
    expect(first).toBeLessThan(target);

    // after several time steps, it should move toward target
    for (let i = 0; i < 5; i += 1) {
      computePressureResolution(
        slider,
        pressure,
        true,
        state,
        (i + 1) * PRESSURE_RESOLUTION_TIME_CONSTANT_MS
      );
    }
    expect(state.output).toBeGreaterThan(1);
  });

  it('drops immediately when pressure decreases', () => {
    const state = createPressureResolutionState(12);
    const lowerTarget = 3;
    const pressure = toPressure(lowerTarget);

    const result = computePressureResolution(slider, pressure, true, state, 0);

    expect(result).toBeLessThanOrEqual(lowerTarget);
  });

  it('uses explicit maxResolution when pressure-linked', () => {
    const state = createPressureResolutionState(1);
    const sliderMax = 8;
    const explicitMax = PRESSURE_RESOLUTION_MAX_PX;
    const pressure = 1;

    const result = computePressureResolution(
      sliderMax,
      pressure,
      true,
      state,
      0,
      explicitMax
    );

    expect(result).toBe(explicitMax);
  });
});
