import {
  getStrokeDitherPixelSize,
  updateStrokePresResPressure,
} from '../pressureDitherSamplingController';

describe('pressureDitherSamplingController', () => {
  it('updates stable/last pressure for positive samples', () => {
    const statsRef = {
      current: { last: 0, stable: 0, lastTime: 0 },
    };

    updateStrokePresResPressure({
      pressure: 0.7,
      now: 100,
      statsRef,
      holdOnZeroMs: 40,
    });

    expect(statsRef.current.last).toBe(0.7);
    expect(statsRef.current.stable).toBe(0.7);
  });

  it('returns computed pixel size from resolved pressure', () => {
    const statsRef = {
      current: { last: 0.4, stable: 0.5, lastTime: 100 },
    };

    const size = getStrokeDitherPixelSize({
      statsRef,
      fallbackPressure: 0.01,
      computePressureScaledResolution: jest.fn(() => 3),
      isPresResDebugEnabled: () => false,
      presResLastLogAtRef: { current: 0 },
      presResLastLoggedPixelSizeRef: { current: null },
      appendPresResTrace: jest.fn(),
    });

    expect(size).toBe(3);
  });

  it('decays stable pressure near pen lift without abrupt collapse', () => {
    const statsRef = {
      current: { last: 0.9, stable: 0.9, lastTime: 100 },
    };

    updateStrokePresResPressure({
      pressure: 0.1,
      now: 116,
      statsRef,
      holdOnZeroMs: 120,
    });

    expect(statsRef.current.last).toBe(0.1);
    expect(statsRef.current.stable).toBeLessThan(0.9);
    expect(statsRef.current.stable).toBeGreaterThan(0.1);
  });

  it('eventually returns to minimum pressure after sustained low pressure', () => {
    const statsRef = {
      current: { last: 1, stable: 1, lastTime: 100 },
    };

    for (let step = 1; step <= 24; step += 1) {
      updateStrokePresResPressure({
        pressure: 0.02,
        now: 100 + step * 16,
        statsRef,
        holdOnZeroMs: 120,
      });
    }

    let sampledPressure = 0;
    const size = getStrokeDitherPixelSize({
      statsRef,
      fallbackPressure: 0.01,
      computePressureScaledResolution: jest.fn((pressure: number) => {
        sampledPressure = pressure;
        return pressure <= 0.1 ? 1 : 2;
      }),
      isPresResDebugEnabled: () => false,
      presResLastLogAtRef: { current: 0 },
      presResLastLoggedPixelSizeRef: { current: null },
      appendPresResTrace: jest.fn(),
    });

    expect(sampledPressure).toBeLessThanOrEqual(0.1);
    expect(size).toBe(1);
  });

  it('drops latched stable pressure after zero-pressure hold expires', () => {
    const statsRef = {
      current: { last: 0.8, stable: 0.8, lastTime: 100 },
    };

    updateStrokePresResPressure({
      pressure: 0,
      now: 260,
      statsRef,
      holdOnZeroMs: 120,
    });

    expect(statsRef.current.last).toBe(0);
    expect(statsRef.current.stable).toBe(0);
  });
});
