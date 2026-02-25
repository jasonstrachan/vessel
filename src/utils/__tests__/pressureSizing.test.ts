import { resolvePressureSizing } from '@/utils/pressureSizing';

describe('resolvePressureSizing', () => {
  it('returns constant radius when pressure disabled', () => {
    const sizing = resolvePressureSizing(20, {
      enabled: false,
      minPercent: 100,
      maxPercent: 100,
    });

    expect(sizing.enabled).toBe(false);
    expect(sizing.minRadius).toBe(10);
    expect(sizing.sample(0)).toBe(10);
    expect(sizing.sample(1)).toBe(10);
  });

  it('clamps min/max percentages and interpolates radius', () => {
    const sizing = resolvePressureSizing(20, {
      enabled: true,
      minPercent: 50,
      maxPercent: 200,
    });

    expect(sizing.minRadius).toBe(5);
    expect(sizing.maxRadius).toBe(20);
    expect(sizing.sample(0)).toBe(5);
    expect(sizing.sample(1)).toBe(20);
    const mid = sizing.sample(0.5);
    expect(mid).toBeGreaterThan(5);
    expect(mid).toBeLessThan(20);
  });
});
