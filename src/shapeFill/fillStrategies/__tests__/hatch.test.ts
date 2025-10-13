import { hatchFill } from '../../fillStrategies/hatch';
import type { FillParams, ShapeDefinition, Vec2 } from '../../types';
import { hashPoints } from '../../utils/random';
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

const defaultParams = (): FillParams => ({
  spacing: 18,
  rotation: 0,
  thickness: 1.2,
  variance: 0.35,
  organic: 0.7,
  cross: false,
  seed: 0,
});

describe('hatchFill', () => {
  it('produces strokeSegments within clip path', () => {
    const shape = rectangle(120, 80);
    const params = defaultParams();
    params.seed = hashPoints(shape.points);

    const result = hatchFill(shape, params);

    expect(result.strokeSegments && result.strokeSegments.length).toBeGreaterThan(0);
    expect(result.lineWidth).toBeGreaterThan(0);
    expect(result.clipPath).toEqual(shape.points);

    result.strokeSegments?.forEach(segment => {
      segment.points.forEach(point => {
        expect(pointInPolygon(point, shape.points)).toBe(true);
      });
    });
  });

  it('applies crosshatch when enabled', () => {
    const shape = rectangle(160, 100, { x: -50, y: -40 });
    const baseParams = defaultParams();
    const crossParams = { ...baseParams, cross: true } as FillParams;

    const result = hatchFill(shape, crossParams);

    expect(result.strokeSegments && result.strokeSegments.length).toBeGreaterThan(0);

    const verticalCount = hatchFill(shape, { ...crossParams, cross: false }).strokeSegments?.length ?? 0;
    const crossCount = result.strokeSegments?.length ?? 0;
    expect(crossCount).toBeGreaterThan(verticalCount);
  });
});
