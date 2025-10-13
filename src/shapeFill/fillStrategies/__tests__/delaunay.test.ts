import { delaunayFill } from '../../fillStrategies/delaunay';
import type { FillParams, ShapeDefinition, Vec2 } from '../../types';
import { pointInPolygon } from '../../utils/geometry';

const rectangle = (width: number, height: number, origin: Vec2 = { x: 0, y: 0 }): ShapeDefinition => {
  const points: Vec2[] = [
    { x: origin.x, y: origin.y },
    { x: origin.x + width, y: origin.y },
    { x: origin.x + width, y: origin.y + height },
    { x: origin.x, y: origin.y + height },
  ];
  return {
    id: 'rect',
    points,
    centroid: { x: origin.x + width / 2, y: origin.y + height / 2 },
    bounds: { minX: origin.x, minY: origin.y, maxX: origin.x + width, maxY: origin.y + height },
  };
};

const baseParams = (): FillParams => ({
  spacing: 24,
  rotation: 0,
  thickness: 1,
  variance: 0.3,
  seed: 0,
});

describe('delaunayFill', () => {
  it('produces stroke segments inside the polygon', () => {
    const shape = rectangle(140, 90);
    const result = delaunayFill(shape, baseParams());

    expect(result.strokeSegments && result.strokeSegments.length).toBeGreaterThan(0);
    expect(result.clipPath).toEqual(shape.points);

    result.strokeSegments?.forEach(segment => {
      segment.points.forEach(point => {
        expect(pointInPolygon(point, shape.points)).toBe(true);
      });
    });
  });

  it('respects jitter and thickness parameters', () => {
    const shape = rectangle(120, 120, { x: -60, y: -60 });
    const paramsA = { ...baseParams(), variance: 0 } as FillParams;
    const paramsB = { ...baseParams(), variance: 0.8, thickness: 2.5 } as FillParams;

    const resultA = delaunayFill(shape, paramsA);
    const resultB = delaunayFill(shape, paramsB);

    expect(resultA.strokeSegments && resultB.strokeSegments).toBeTruthy();
    expect((resultB.strokeSegments?.[0]?.lineWidth ?? 0)).toBeCloseTo(2.5, 1);
    // Higher jitter should generally produce more segments
    expect((resultB.strokeSegments?.length ?? 0)).toBeGreaterThan((resultA.strokeSegments?.length ?? 0));
  });
});
