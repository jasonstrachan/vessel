import { getRisographEffectSettings } from '@/utils/risographTexture';

describe('getRisographEffectSettings', () => {
  it('returns zeroed settings when intensity is 0', () => {
    const effect = getRisographEffectSettings(0);
    expect(effect.alpha).toBe(0);
    expect(effect.jitter).toBe(0);
    expect(effect.outlineJitter).toBe(0);
  });

  it('grows alpha and jitter as intensity increases', () => {
    const low = getRisographEffectSettings(10);
    const mid = getRisographEffectSettings(50);
    const high = getRisographEffectSettings(100);

    expect(mid.alpha).toBeGreaterThan(low.alpha);
    expect(high.alpha).toBeGreaterThan(mid.alpha);

    expect(mid.jitter).toBeGreaterThan(low.jitter);
    expect(high.jitter).toBeGreaterThan(mid.jitter);
  });

  it('boosts alpha for pixel brushes relative to smooth brushes', () => {
    const smooth = getRisographEffectSettings(75, { isPixelBrush: false });
    const pixel = getRisographEffectSettings(75, { isPixelBrush: true });

    expect(pixel.alpha).toBeGreaterThan(smooth.alpha);
    expect(pixel.outlineJitter).toBeLessThanOrEqual(smooth.outlineJitter * 1.05);
  });
});
