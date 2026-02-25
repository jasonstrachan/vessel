import { contourFill } from '../../fillStrategies/contour';
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

const baseParams = (overrides: Partial<FillParams> = {}): FillParams => ({
  spacing: 16,
  rotation: 0,
  thickness: 1.25,
  variance: 0.35,
  ...overrides,
});

const signature = (lines?: Vec2[][]): string =>
  (lines ?? [])
    .map(line => line.map(point => `${point.x.toFixed(1)},${point.y.toFixed(1)}`).join('|'))
    .join(';');

const distanceToPolygon = (point: Vec2, polygon: Vec2[]): number => {
  let minDistance = Infinity;
  for (let i = 0; i < polygon.length; i += 1) {
    const a = polygon[i];
    const b = polygon[(i + 1) % polygon.length];
    minDistance = Math.min(minDistance, distanceToSegment(point, a, b));
  }
  return minDistance;
};

const distanceToSegment = (p: Vec2, a: Vec2, b: Vec2): number => {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const abLenSq = abx * abx + aby * aby;
  if (abLenSq === 0) {
    return Math.hypot(p.x - a.x, p.y - a.y);
  }
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * abx + (p.y - a.y) * aby) / abLenSq));
  const projX = a.x + abx * t;
  const projY = a.y + aby * t;
  return Math.hypot(p.x - projX, p.y - projY);
};

describe('contourFill', () => {
  it('generates contour lines constrained to the polygon interior (within tolerance)', () => {
    const shape = rectangle(120, 80);
    const result = contourFill(shape, baseParams());

    expect(result.lines && result.lines.length).toBeGreaterThan(0);
    expect(result.clipPath).toEqual(shape.points);

    result.lines?.forEach(line => {
      line.forEach(point => {
        const inside = pointInPolygon(point, shape.points);
        const nearBoundary = distanceToPolygon(point, shape.points) <= 1.5;
        expect(inside || nearBoundary).toBe(true);
      });
    });
  });

  it('respects thickness parameter via lineWidth', () => {
    const shape = rectangle(90, 60);
    const params = baseParams({ thickness: 3.4 });

    const result = contourFill(shape, params);

    expect(result.lineWidth).toBeCloseTo(3.4, 1);
  });

  it('produces denser lines when spacing is smaller', () => {
    const shape = rectangle(200, 140);
    const dense = contourFill(shape, baseParams({ spacing: 10 }));
    const sparse = contourFill(shape, baseParams({ spacing: 36 }));

    const denseCount = dense.lines?.length ?? 0;
    const sparseCount = sparse.lines?.length ?? 0;

    expect(denseCount).toBeGreaterThan(sparseCount);
  });

  it('treats a zero seed the same as an auto-generated seed', () => {
    const shape = rectangle(140, 140);
    const autoSeed = contourFill(shape, baseParams());
    const zeroSeed = contourFill(shape, baseParams({ seed: 0 }));

    expect(zeroSeed.lines).toEqual(autoSeed.lines);
  });

  it('spacing wobble adjusts contour spacing even with constant variance', () => {
    const shape = rectangle(210, 150);
    const subtle = contourFill(shape, baseParams({ spacingWobble: 0.1, variance: 0.3 }));
    const bold = contourFill(shape, baseParams({ spacingWobble: 0.9, variance: 0.3 }));

    expect(signature(subtle.lines)).not.toEqual(signature(bold.lines));
  });
});
