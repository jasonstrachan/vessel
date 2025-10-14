import { noiseFill } from '../noise';
import type { FillParams, ShapeDefinition } from '../../types';
import { parseCssColor } from '@/utils/color/parseCssColor';

const squareShape: ShapeDefinition = {
  id: 'square',
  points: [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 100 },
    { x: 0, y: 100 },
  ],
  centroid: { x: 50, y: 50 },
  bounds: { minX: 0, minY: 0, maxX: 100, maxY: 100 },
};

const baseParams: FillParams = {
  spacing: 0.5,
  rotation: 0,
  thickness: 1,
  variance: 0,
  seed: 42,
  noiseScale: 48,
  noiseContrast: 0.65,
  noiseThreshold: 0.5,
  noiseOctaves: 3,
  noiseRandomness: 0.25,
};

describe('noiseFill', () => {
  it('produces deterministic results for the same seed and parameters', () => {
    const dotsA = noiseFill(squareShape, baseParams).dotInstances ?? [];
    const dotsB = noiseFill(squareShape, baseParams).dotInstances ?? [];

    expect(dotsA.length).toBeGreaterThan(0);
    expect(dotsA.length).toBe(dotsB.length);

    dotsA.forEach((instance, index) => {
      const comparison = dotsB[index];
      if (!comparison) {
        throw new Error(`Missing comparison instance at index ${index}`);
      }
      expect(comparison.center).toEqual(instance.center);
      expect(comparison.radius).toBeCloseTo(instance.radius);
      expect(comparison.size).toBeCloseTo(instance.size ?? 0);
      expect(comparison.color).toBe(instance.color);
      const comparisonAlpha = comparison.alpha;
      const instanceAlpha = instance.alpha;
      if (comparisonAlpha === undefined || instanceAlpha === undefined) {
        throw new Error('Dot alpha should be defined for noise fill instances');
      }
      expect(comparisonAlpha).toBeCloseTo(instanceAlpha);
      expect(comparison.shade).toBe(instance.shade);
    });
  });

  it('responds to white bias adjustments', () => {
    const lowBias = noiseFill(squareShape, { ...baseParams, noiseThreshold: 0.2 });
    const highBias = noiseFill(squareShape, { ...baseParams, noiseThreshold: 0.85 });

    const lowDots = lowBias.dotInstances ?? [];
    const highDots = highBias.dotInstances ?? [];

    expect(lowDots.length).toBe(highDots.length);
    const lowWhite = lowDots.filter(instance => instance?.shade === 1).length;
    const highWhite = highDots.filter(instance => instance?.shade === 1).length;

    expect(lowWhite).toBeLessThan(highWhite);
  });

  it('introduces positional jitter when randomness increases', () => {
    const noRandom = noiseFill(squareShape, { ...baseParams, noiseRandomness: 0 });
    const highRandom = noiseFill(squareShape, { ...baseParams, noiseRandomness: 0.8 });

    const noRandomDots = noRandom.dotInstances ?? [];
    const highRandomDots = highRandom.dotInstances ?? [];

    expect(noRandomDots.length).toBe(highRandomDots.length);

    const differing = highRandomDots.findIndex((instance, index) => {
      const comparison = noRandomDots[index];
      if (!comparison) {
        return false;
      }
      return (
        Math.abs(instance.center.x - comparison.center.x) > 0.01 ||
        Math.abs(instance.center.y - comparison.center.y) > 0.01 ||
        Math.abs((instance.size ?? 0) - (comparison.size ?? 0)) > 0.01
      );
    });

    expect(differing).toBeGreaterThanOrEqual(0);
  });

  it('tints dots based on the provided fillColor', () => {
    const redParams: FillParams = {
      ...baseParams,
      fillColor: 'rgba(220, 40, 60, 0.6)',
    };
    const blueParams: FillParams = {
      ...baseParams,
      fillColor: '#2f4fff',
    };

    const redDots = noiseFill(squareShape, redParams).dotInstances ?? [];
    const blueDots = noiseFill(squareShape, blueParams).dotInstances ?? [];

    expect(redDots.length).toBeGreaterThan(0);
    expect(blueDots.length).toBeGreaterThan(0);

    const firstRed = redDots[0];
    const firstBlue = blueDots[0];

    if (!firstRed || !firstBlue) {
      throw new Error('Expected noise fill to produce at least one dot instance');
    }

    expect(firstRed.color).toBeDefined();
    expect(firstBlue.color).toBeDefined();

    const redColor = parseCssColor(firstRed.color ?? '');
    const blueColor = parseCssColor(firstBlue.color ?? '');

    expect(firstRed.color).not.toEqual(firstBlue.color);
    expect(redColor.a).toBeLessThan(255);
    expect(redColor.r).toBeGreaterThan(redColor.b);
    expect(blueColor.b).toBeGreaterThan(blueColor.r);
  });
});
