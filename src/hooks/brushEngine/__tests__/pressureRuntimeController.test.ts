import {
  resetPressureDitherState,
  resolveStrokePressureForRender,
} from '../pressureRuntimeController';

describe('pressureRuntimeController', () => {
  it('resolves smoothed pressure and updates pres-res pressure state', () => {
    const updateStrokePresResPressure = jest.fn();

    const value = resolveStrokePressureForRender({
      rawPressure: 0.6,
      nowHighRes: 123,
      strokePressureRef: {
        current: {
          min: 1,
          max: 0,
          lastNonZero: 0,
          last: 0.5,
          stable: 0.5,
          isTail: false,
          lastTime: 120,
          sampleCount: 1,
        },
      },
      pressureEnabled: true,
      updateStrokePresResPressure,
      maxPressureDecayPerMs: 0.003,
      minDropPerEvent: 0.01,
      instantPressureSampleWindow: 5,
    });

    expect(updateStrokePresResPressure).toHaveBeenCalledWith(0.6, 123);
    expect(typeof value).toBe('number');
  });

  it('resets pressure dither state and clears bg-off hole canvas', () => {
    const resetStrokePressureDitherRuntime = jest.fn();
    const clearBgOffHoleCanvas = jest.fn();

    resetPressureDitherState({
      resetStrokePressureDitherRuntime,
      clearBgOffHoleCanvas,
    });

    expect(resetStrokePressureDitherRuntime).toHaveBeenCalled();
    expect(clearBgOffHoleCanvas).toHaveBeenCalled();
  });
});
