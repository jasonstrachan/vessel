import { toPixelPerfectFill } from '@/shapeFill/pixelPerfect';
import type { FillResult } from '@/shapeFill/types';

describe('toPixelPerfectFill', () => {
  it('converts stroke segments into pixel-aligned dot instances', () => {
    const result: FillResult = {
      strokeSegments: [
        {
          points: [
            { x: 0, y: 0 },
            { x: 3, y: 0 },
          ],
          lineWidth: 2,
        },
      ],
      clipPath: [
        { x: 0.2, y: 0.4 },
        { x: 4.6, y: 0.1 },
        { x: 4.2, y: 3.8 },
      ],
    };

    const pixelated = toPixelPerfectFill(result);
    expect(pixelated.strokeSegments).toBeUndefined();
    expect(pixelated.lines).toBeUndefined();
    expect(pixelated.dotInstances).toHaveLength(4);
    const centers = pixelated.dotInstances?.map(instance => instance.center.x);
    expect(centers).toEqual([0.5, 1.5, 2.5, 3.5]);
    pixelated.clipPath?.forEach(point => {
      expect(Number.isInteger(point.x)).toBe(true);
      expect(Number.isInteger(point.y)).toBe(true);
    });
  });

  it('snaps existing dots and polygons', () => {
    const result: FillResult = {
      dots: [
        { x: 1.2, y: 1.9 },
        { x: 5.7, y: 2.4 },
      ],
      dotRadius: 0.4,
      polygons: [
        [
          { x: 0.3, y: 0.7 },
          { x: 2.9, y: 0.4 },
          { x: 2.6, y: 3.3 },
        ],
      ],
    };

    const pixelated = toPixelPerfectFill(result);
    expect(pixelated.dotInstances).toHaveLength(2);
    pixelated.dotInstances?.forEach(instance => {
      expect(instance.shape).toBe('square');
      expect(instance.center.x % 1).toBeCloseTo(0.5, 5);
      expect(instance.center.y % 1).toBeCloseTo(0.5, 5);
      expect(instance.radius).toBeGreaterThan(0);
    });
    pixelated.polygons?.forEach(polygon => {
      polygon.forEach(point => {
        expect(Number.isInteger(point.x)).toBe(true);
        expect(Number.isInteger(point.y)).toBe(true);
      });
    });
  });
});
