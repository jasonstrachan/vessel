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
  delaunayVariation: 1,
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

  it('changes output when seed differs', () => {
    const shape = rectangle(160, 160);
    const paramsSeedA = { ...baseParams(), seed: 3 } as FillParams;
    const paramsSeedB = { ...baseParams(), seed: 42 } as FillParams;

    const resultA = delaunayFill(shape, paramsSeedA);
    const resultB = delaunayFill(shape, paramsSeedB);

    const serialize = (result: ReturnType<typeof delaunayFill>) =>
      (result.strokeSegments ?? [])
        .slice(0, 10)
        .map(segment =>
          segment.points.map(point => `${point.x.toFixed(2)},${point.y.toFixed(2)}`).join('|')
        )
        .join(';');

    expect(serialize(resultA)).not.toEqual(serialize(resultB));
  });

  it('biases local spacing with noise-driven density', () => {
    const spacing = 28;
    const shape = rectangle(260, 260);
    const params = { ...baseParams(), spacing, variance: 0.25, seed: 7, delaunayVariation: 1.2 } as FillParams;

    const result = delaunayFill(shape, params);
    const segments = result.strokeSegments ?? [];
    expect(segments.length).toBeGreaterThan(0);

    const uniquePointsMap = new Map<string, Vec2>();
    for (const segment of segments) {
      for (const point of segment.points) {
        const key = `${point.x.toFixed(3)},${point.y.toFixed(3)}`;
        if (!uniquePointsMap.has(key)) {
          uniquePointsMap.set(key, { ...point });
        }
      }
    }
    const points = Array.from(uniquePointsMap.values());
    expect(points.length).toBeGreaterThan(16);

    const nearestDistances = points.map((point, index) => {
      let best = Number.POSITIVE_INFINITY;
      for (let j = 0; j < points.length; j += 1) {
        if (j === index) continue;
        const other = points[j];
        const dx = point.x - other.x;
        const dy = point.y - other.y;
        const dist = Math.hypot(dx, dy);
        if (dist < best) {
          best = dist;
        }
      }
      return best;
    }).filter(dist => Number.isFinite(dist) && dist > 0);

    expect(nearestDistances.length).toBe(points.length);

    const minNeighbor = Math.min(...nearestDistances);
    const maxNeighbor = Math.max(...nearestDistances);

    const baseMinDist = Math.max(spacing * 0.85, 4);
    expect(minNeighbor).toBeLessThan(baseMinDist * 0.95);
    expect(maxNeighbor / Math.max(minNeighbor, 1e-6)).toBeGreaterThan(1.35);
  });

  it('lets variation slider dial back density modulation', () => {
    const shape = rectangle(240, 240);
    const paramsHigh = {
      ...baseParams(),
      variance: 0,
      seed: 13,
      delaunayVariation: 1.25,
    } as FillParams;
    const paramsLow = {
      ...baseParams(),
      variance: 0,
      seed: 13,
      delaunayVariation: 0,
    } as FillParams;

    const distancesFor = (params: FillParams) => {
      const result = delaunayFill(shape, params);
      const segments = result.strokeSegments ?? [];
      const uniquePoints = new Map<string, Vec2>();
      for (const segment of segments) {
        for (const pt of segment.points) {
          const key = `${pt.x.toFixed(3)},${pt.y.toFixed(3)}`;
          if (!uniquePoints.has(key)) {
            uniquePoints.set(key, { ...pt });
          }
        }
      }
      const points = Array.from(uniquePoints.values());
      const nearest = points.map((point, index) => {
        let best = Number.POSITIVE_INFINITY;
        for (let j = 0; j < points.length; j += 1) {
          if (j === index) continue;
          const other = points[j];
          const dx = point.x - other.x;
          const dy = point.y - other.y;
          const dist = Math.hypot(dx, dy);
          if (dist < best) {
            best = dist;
          }
        }
        return best;
      }).filter(dist => Number.isFinite(dist) && dist > 0);
      const mean =
        nearest.reduce((sum, dist) => sum + dist, 0) / Math.max(nearest.length, 1);
      const variance =
        nearest.reduce((sum, dist) => sum + (dist - mean) * (dist - mean), 0) /
        Math.max(nearest.length, 1);
      const stddev = Math.sqrt(Math.max(variance, 0));
      return { range: Math.max(...nearest) - Math.min(...nearest), mean, stddev };
    };

    const high = distancesFor(paramsHigh);
    const low = distancesFor(paramsLow);

    expect(high.range).toBeGreaterThan(low.range * 1.05);
    expect(high.stddev / Math.max(high.mean, 1e-6)).toBeGreaterThan(
      low.stddev / Math.max(low.mean, 1e-6)
    );
  });
});
