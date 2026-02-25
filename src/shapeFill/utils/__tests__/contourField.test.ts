import type { ShapeDefinition, Vec2 } from '../../types';
import { generateOrganicContourLines } from '../contourField';

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

const options = (
  overrides: Partial<{ spacing: number; variance: number; seed: number; spacingWobble: number }> = {}
) => ({
  spacing: overrides.spacing ?? 14,
  variance: overrides.variance ?? 0.4,
  spacingWobble:
    overrides.spacingWobble ??
    (typeof overrides.variance === 'number' ? overrides.variance : 0.4),
  seed: overrides.seed ?? 7,
});

const distanceToSegment = (point: Vec2, a: Vec2, b: Vec2): number => {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const lengthSq = abx * abx + aby * aby;
  if (lengthSq === 0) {
    return Math.hypot(point.x - a.x, point.y - a.y);
  }
  let t = ((point.x - a.x) * abx + (point.y - a.y) * aby) / lengthSq;
  t = Math.max(0, Math.min(1, t));
  const projX = a.x + abx * t;
  const projY = a.y + aby * t;
  return Math.hypot(point.x - projX, point.y - projY);
};

const distanceToPolygon = (point: Vec2, polygon: Vec2[]): number => {
  let min = Infinity;
  for (let i = 0; i < polygon.length; i += 1) {
    const a = polygon[i];
    const b = polygon[(i + 1) % polygon.length];
    min = Math.min(min, distanceToSegment(point, a, b));
  }
  return min;
};

const signature = (lines: Vec2[][]): string =>
  lines
    .map(line =>
      line
        .map(point => `${point.x.toFixed(2)},${point.y.toFixed(2)}`)
        .join('|')
    )
    .join(';');

describe('generateOrganicContourLines', () => {
  it('produces multiple contour loops for a simple rectangle', () => {
    const shape = rectangle(180, 120);
    const lines = generateOrganicContourLines(shape.points, options());
    expect(lines.length).toBeGreaterThanOrEqual(3);
    lines.forEach(line => {
      expect(line.length).toBeGreaterThan(1);
    });
  });

  it('keeps contours inside the polygon boundary', () => {
    const shape = rectangle(150, 90, { x: -20, y: 10 });
    const lines = generateOrganicContourLines(shape.points, options());
    lines.forEach(line => {
      line.forEach(point => {
        const inside =
          point.x >= shape.bounds.minX - 1 &&
          point.x <= shape.bounds.maxX + 1 &&
          point.y >= shape.bounds.minY - 1 &&
          point.y <= shape.bounds.maxY + 1;
        const nearEdge = distanceToPolygon(point, shape.points) <= 2;
        expect(inside || nearEdge).toBe(true);
      });
    });
  });

  it('reduces contour count when spacing increases', () => {
    const shape = rectangle(240, 140);
    const tight = generateOrganicContourLines(shape.points, options({ spacing: 10 }));
    const loose = generateOrganicContourLines(shape.points, options({ spacing: 28 }));
    expect(tight.length).toBeGreaterThan(loose.length);
  });

  it('variance produces distinct organic contours compared to zero variance', () => {
    const shape = rectangle(200, 150, { x: -30, y: 5 });
    const calm = generateOrganicContourLines(shape.points, options({ variance: 0, seed: 123 }));
    const organic = generateOrganicContourLines(shape.points, options({ variance: 0.8, seed: 123 }));

    expect(organic.length).toBeGreaterThan(0);
    expect(signature(organic)).not.toEqual(signature(calm));
  });

  it('spacing wobble slider alters contour spacing even with constant variance', () => {
    const shape = rectangle(260, 190, { x: -60, y: -20 });
    const low = generateOrganicContourLines(
      shape.points,
      options({ variance: 0.2, spacingWobble: 0.05, seed: 42 })
    );
    const high = generateOrganicContourLines(
      shape.points,
      options({ variance: 0.2, spacingWobble: 0.95, seed: 42 })
    );

    const serialize = (lines: Vec2[][]): string =>
      lines
        .map(line => line.map(point => `${point.x.toFixed(1)},${point.y.toFixed(1)}`).join('|'))
        .join(';');

    expect(serialize(high)).not.toEqual(serialize(low));
  });
});
