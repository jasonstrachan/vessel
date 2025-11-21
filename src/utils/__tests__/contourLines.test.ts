import {
  computeLines2ProjectionStats,
  generateContourLines,
  prepareContourLinesBasis,
  projectPointOntoLines2Side,
} from '@/utils/contourLines';

describe('contourLines geometry helpers', () => {
  it('rejects degenerate polygons when preparing a basis', () => {
    const basis = prepareContourLinesBasis([
      { x: 0, y: 0 },
      { x: 0, y: 0 },
      { x: 0, y: 0 },
    ]);

    expect(basis).toBeNull();
  });

  it('orients the basis normal toward the centroid and measures distances', () => {
    const rectangle = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 5 },
      { x: 0, y: 5 },
    ];

    const basis = prepareContourLinesBasis(rectangle);

    expect(basis).not.toBeNull();
    expect(basis?.baseEdge.a).toEqual(rectangle[0]);
    expect(basis?.baseEdge.b).toEqual(rectangle[1]);
    expect(basis?.normal.y ?? 0).toBeGreaterThan(0);
    expect(basis?.baseProjection ?? 0).toBeCloseTo(0);
    expect(basis?.maxDistance ?? 0).toBeCloseTo(5);
    expect(basis?.backDistance ?? 0).toBeCloseTo(0);
  });

  it('clamps projected points to slack around the detected band', () => {
    const square = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ];

    const stats = computeLines2ProjectionStats(square, 0);
    const projected = projectPointOntoLines2Side(stats, { x: 100, y: 100 }, 'min');

    expect(projected.x).toBeCloseTo(48);
    expect(projected.y).toBeCloseTo(42);
  });

  it('generates a minimum set of contour lines with clamped spacing', () => {
    const polygon = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 5 },
      { x: 0, y: 5 },
    ];
    const basis = prepareContourLinesBasis(polygon);
    expect(basis).not.toBeNull();

    const lines = generateContourLines(polygon, basis!, 1, 200);

    expect(lines).toHaveLength(3);
    lines.forEach((path) => {
      expect(path.points.length).toBeGreaterThan(0);
      path.points.forEach((point) => {
        expect(Number.isFinite(point.x)).toBe(true);
        expect(Number.isFinite(point.y)).toBe(true);
      });
    });
  });
});
