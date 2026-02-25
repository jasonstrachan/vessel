import {
  computeCustomBrushPhaseAtStamp,
  computeCustomBrushStampJitter,
  computeCustomBrushStrokeSeedPhase,
  resolveCustomBrushCcPhaseMode,
} from '@/hooks/brushEngine/customColorCyclePhase';

describe('customColorCyclePhase', () => {
  it('defaults unknown mode to global', () => {
    expect(resolveCustomBrushCcPhaseMode(undefined)).toBe('global');
  });

  it('keeps supported modes unchanged', () => {
    expect(resolveCustomBrushCcPhaseMode('global')).toBe('global');
    expect(resolveCustomBrushCcPhaseMode('per-stroke-seeded')).toBe('per-stroke-seeded');
    expect(resolveCustomBrushCcPhaseMode('jittered')).toBe('jittered');
  });

  it('creates deterministic stroke seeds', () => {
    const a = computeCustomBrushStrokeSeedPhase(12.3, 4.56, 12345);
    const b = computeCustomBrushStrokeSeedPhase(12.3, 4.56, 12345);
    const c = computeCustomBrushStrokeSeedPhase(12.31, 4.56, 12345);
    expect(a).toBeCloseTo(b, 8);
    expect(a).not.toBeCloseTo(c, 8);
  });

  it('returns no jitter when jitter amount is zero', () => {
    expect(computeCustomBrushStampJitter(0.33, 4, 0)).toBe(0);
  });

  it('keeps jitter bounded by configured amount', () => {
    const jitter = computeCustomBrushStampJitter(0.5, 12, 0.2);
    expect(jitter).toBeGreaterThanOrEqual(-0.2);
    expect(jitter).toBeLessThanOrEqual(0.2);
  });

  it('computes wrapped phase progression', () => {
    expect(computeCustomBrushPhaseAtStamp(0.9, 3, 0.1, 0)).toBeCloseTo(0.2, 8);
  });
});

