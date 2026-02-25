import { unwrapAngle } from '../angles';

describe('angles utilities', () => {
  test('unwrapAngle returns raw angle when no previous value', () => {
    const base = Math.PI / 4;
    expect(unwrapAngle(undefined, base)).toBe(base);
  });

  test('unwrapAngle unwraps positive wrap-around', () => {
    const previous = Math.PI - 0.1; // just under π
    const raw = -Math.PI + 0.2; // raw atan2 wraps to negative side
    const unwrapped = unwrapAngle(previous, raw);
    expect(unwrapped).toBeCloseTo(Math.PI + 0.2, 6);
  });

  test('unwrapAngle unwraps negative wrap-around', () => {
    const previous = -Math.PI + 0.1;
    const raw = Math.PI - 0.2;
    const unwrapped = unwrapAngle(previous, raw);
    expect(unwrapped).toBeCloseTo(-Math.PI - 0.2, 6);
  });

  test('unwrapAngle maintains small deltas across wrap-around sequences', () => {
    let current = 0;
    const rawAngles = [
      Math.PI / 2,
      Math.PI,
      -Math.PI + 0.1,
      -Math.PI + 0.2,
      -Math.PI + 0.3,
    ];

    const unwrapped = rawAngles.map((raw) => {
      current = unwrapAngle(current, raw);
      return current;
    });

    expect(unwrapped[0]).toBeCloseTo(Math.PI / 2, 6);
    expect(unwrapped[1]).toBeCloseTo(Math.PI, 6);
    expect(unwrapped[2]).toBeCloseTo(Math.PI + 0.1, 6);
    expect(unwrapped[3]).toBeCloseTo(Math.PI + 0.2, 6);
    expect(unwrapped[4]).toBeCloseTo(Math.PI + 0.3, 6);
  });
});
