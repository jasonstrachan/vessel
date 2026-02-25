import { computeBounds, computeCentroid } from '../utils/geometry';
import { Vec2 } from '../types';

describe('geometry utilities', () => {
  it('computes centroid of point set', () => {
    const points: Vec2[] = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ];

    expect(computeCentroid(points)).toEqual({ x: 5, y: 5 });
  });

  it('returns zero centroid for empty input', () => {
    expect(computeCentroid([])).toEqual({ x: 0, y: 0 });
  });

  it('computes bounding box', () => {
    const points: Vec2[] = [
      { x: -5, y: 2 },
      { x: 3, y: 12 },
      { x: 7, y: -4 },
    ];

    expect(computeBounds(points)).toEqual({
      minX: -5,
      minY: -4,
      maxX: 7,
      maxY: 12,
    });
  });

  it('returns zero bounds for empty input', () => {
    expect(computeBounds([])).toEqual({
      minX: 0,
      minY: 0,
      maxX: 0,
      maxY: 0,
    });
  });
});
