import { noiseFill } from '../noise';
import type { FillParams, ShapeDefinition } from '../../types';

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
  spacing: 6,
  rotation: 0,
  thickness: 1.1,
  variance: 0.25,
  seed: 42,
  noiseScale: 48,
  noiseContrast: 0.65,
  noiseThreshold: 0.45,
  noiseOctaves: 3,
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
      const comparisonAlpha = comparison.alpha;
      const instanceAlpha = instance.alpha;
      if (comparisonAlpha === undefined || instanceAlpha === undefined) {
        throw new Error('Dot alpha should be defined for noise fill instances');
      }
      expect(comparisonAlpha).toBeCloseTo(instanceAlpha);
    });
  });

  it('responds to threshold adjustments', () => {
    const permissive = noiseFill(squareShape, { ...baseParams, noiseThreshold: 0.2 });
    const strict = noiseFill(squareShape, { ...baseParams, noiseThreshold: 0.85 });

    const permissiveCount = permissive.dotInstances?.length ?? 0;
    const strictCount = strict.dotInstances?.length ?? 0;

    expect(permissiveCount).toBeGreaterThan(strictCount);
    expect(strictCount).toBeLessThan(permissiveCount);
  });
});
