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
});

