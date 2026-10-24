import { createHash } from 'node:crypto';

import { noiseFill } from '../noise';
import type { FillParams, ShapeDefinition } from '../../types';
import { renderFill } from '../../renderers/cpuRenderer';
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
  it('preserves the complete pre-Speck Size output at the default multiplier1', () => {
    const result = noiseFill(squareShape, { ...baseParams, spacing: 4, fillColor: '#000000' });
    expect(createHash('sha256').update(JSON.stringify(result)).digest('hex')).toMatchInlineSnapshot(`"6626867a5d9066da3d42505cbbb08816f673ad26c02663943cf2dfc83bbcfd8c"`);
  });

  it.each([0, 0.8])('scales specks without changing seeded cells or colors at randomness%s', randomness => {
    const params = { ...baseParams, spacing: 10, noiseRandomness: randomness, fillColor: '#2060c0' };
    const normal = noiseFill(squareShape, params).dotInstances ?? [];
    expect(normal.length).toBeGreaterThan(0);

    for (const multiplier of [0.2, 0.5, 3, 4]) {
      const scaled = noiseFill(squareShape, { ...params, thickness: multiplier }).dotInstances ?? [];
      expect(scaled).toHaveLength(normal.length);
      scaled.forEach((dot, index) => {
        const original = normal[index];
        if (original.size === undefined) throw new Error('Noise needs explicit square sizes');
        expect(dot.size).toBe(original.size * multiplier);
        expect(dot.radius).toBe(original.radius * multiplier);
        expect({ center: dot.center, color: dot.color, alpha: dot.alpha, shade: dot.shade, shape: dot.shape })
          .toEqual({ center: original.center, color: original.color, alpha: original.alpha,
            shade: original.shade, shape: original.shape });
      });
    }
  });

  it.each([[-1, 0.2], [5, 4]])('bounds imported Speck Size%s to the visible multiplier%s', (thickness, multiplier) => {
    const dots = noiseFill(squareShape, { ...baseParams, spacing: 4, noiseRandomness: 0, thickness }).dotInstances ?? [];
    expect(dots.length).toBeGreaterThan(0);
    for (const dot of dots) {
      expect(dot.size).toBe(4 * multiplier);
      expect(dot.radius).toBe(2 * multiplier);
    }
  });

  it('publishes different raster material through the actual square renderer for Speck Size0.5/1/3', () => {
    const rasterize = (thickness: number) => {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 100;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Canvas2D unavailable');
      const pixels = new Uint8ClampedArray(100 * 100 * 4);
      // Canvas I/O boundary for this opaque integer-square profile. The real
      // renderer supplies colors and rectangles; project bounds clip them.
      const draw = jest.spyOn(ctx, 'fillRect').mockImplementation((x, y, width, height) => {
        expect([x, y, width, height].every(Number.isInteger)).toBe(true);
        const color = parseCssColor(String(ctx.fillStyle));
        expect(color.a).toBe(255);
        expect(ctx.globalAlpha).toBe(1);
        for (let py = Math.max(0, y); py < Math.min(100, y + height); py++) {
          for (let px = Math.max(0, x); px < Math.min(100, x + width); px++) {
            pixels.set([color.r, color.g, color.b, 255], (py * 100 + px) * 4);
          }
        }
      });
      try {
        renderFill(ctx, noiseFill(squareShape, { ...baseParams, spacing: 4,
          noiseRandomness: 0, fillColor: '#000000', thickness }));
        expect(draw).toHaveBeenCalledTimes(625);
      } finally {
        draw.mockRestore();
      }
      return pixels;
    };
    const small = rasterize(0.5);
    const normal = rasterize(1);
    const large = rasterize(3);
    const occupied = (pixels: Uint8ClampedArray) => pixels.filter((_value, index) => index % 4 === 3 && pixels[index] > 0).length;
    expect(occupied(small)).toBe(2500);
    expect(occupied(normal)).toBe(10000);
    expect(occupied(large)).toBe(10000);
    expect(small).not.toEqual(normal);
    expect(large).not.toEqual(normal);
  });

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
