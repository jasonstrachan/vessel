import { stippleFill } from '../stipple';
import { FillParams, FillResult, ShapeDefinition, Vec2 } from '../../types';
import { computeBounds, computeCentroid } from '../../utils/geometry';

function createSquare(size = 120, offset = 0): ShapeDefinition {
  const points: Vec2[] = [
    { x: offset, y: offset },
    { x: offset + size, y: offset },
    { x: offset + size, y: offset + size },
    { x: offset, y: offset + size },
  ];
  return {
    id: 'square',
    points,
    centroid: computeCentroid(points),
    bounds: computeBounds(points),
  };
}

const baseParams: FillParams = {
  spacing: 12,
  rotation: 0,
  thickness: 1,
  wobble: 0.45,
  seed: 1234,
};

describe('stippleFill', () => {
  it('produces deterministic scatters for the same shape and params', () => {
    const shape = createSquare();
    const first = stippleFill(shape, baseParams);
    const second = stippleFill(shape, baseParams);

    expect(first.dotInstances?.length).toBeGreaterThan(0);
    expect(first.dotInstances?.length).toBe(second.dotInstances?.length);
    expect(serializeDots(first)).toEqual(serializeDots(second));
  });

  it('reduces density as spacing increases', () => {
    const shape = createSquare(160);
    const tight = stippleFill(shape, { ...baseParams, spacing: 8 });
    const wide = stippleFill(shape, { ...baseParams, spacing: 24 });

    const tightCount = tight.dotInstances?.length ?? 0;
    const wideCount = wide.dotInstances?.length ?? 0;

    expect(tightCount).toBeGreaterThan(wideCount);
  });

  it('loosens the minimum distance as wobble grows', () => {
    const shape = createSquare(140);
    const orderly = stippleFill(shape, { ...baseParams, wobble: 0 });
    const expressive = stippleFill(shape, { ...baseParams, wobble: 1 });

    const orderlyDistance = averageNeighborDistance(orderly.dotInstances);
    const expressiveDistance = averageNeighborDistance(expressive.dotInstances);

    expect(orderlyDistance).toBeGreaterThan(expressiveDistance);
  });

  it('scales dot radius via the thickness parameter', () => {
    const shape = createSquare(100);
    const smallDots = stippleFill(shape, { ...baseParams, thickness: 0.5 });
    const largeDots = stippleFill(shape, { ...baseParams, thickness: 2 });

    const avgSmall = averageRadius(smallDots.dotInstances);
    const avgLarge = averageRadius(largeDots.dotInstances);

    expect(avgLarge).toBeGreaterThan(avgSmall);
  });

  it('keeps dot radius stable when spacing changes', () => {
    const shape = createSquare(160);
    const tight = stippleFill(shape, { ...baseParams, spacing: 6 });
    const wide = stippleFill(shape, { ...baseParams, spacing: 28 });

    const diff = Math.abs(averageRadius(tight.dotInstances) - averageRadius(wide.dotInstances));
    expect(diff).toBeLessThan(0.01);
  });

  it('avoids overlapping dots by respecting radii sum', () => {
    const shape = createSquare(180);
    const result = stippleFill(shape, { ...baseParams, spacing: 10, wobble: 0.8 });
    const dots = result.dotInstances ?? [];
    for (let i = 0; i < dots.length; i += 1) {
      for (let j = i + 1; j < dots.length; j += 1) {
        const dx = dots[j].center.x - dots[i].center.x;
        const dy = dots[j].center.y - dots[i].center.y;
        const distance = Math.hypot(dx, dy);
        const sumRadius = (dots[i].radius ?? 0) + (dots[j].radius ?? 0);
        expect(distance + 1e-4).toBeGreaterThanOrEqual(sumRadius);
      }
    }
  });

  it('uses a consistent opacity for each dot instance', () => {
    const shape = createSquare(160);
    const result = stippleFill(shape, baseParams);
    const dots = result.dotInstances ?? [];
    const uniqueAlpha = new Set(dots.map(dot => Number((dot.alpha ?? 0).toFixed(3))));
    expect(uniqueAlpha.size).toBeLessThanOrEqual(1);
  });

  it('renders every dot with the exact same radius', () => {
    const shape = createSquare(200);
    const result = stippleFill(shape, { ...baseParams, spacing: 18, wobble: 0.9, thickness: 1.5 });
    const dots = result.dotInstances ?? [];
    const rounded = new Set(dots.map(dot => Number(dot.radius.toFixed(3))));
    expect(rounded.size).toBeLessThanOrEqual(1);
  });
});

function serializeDots(result: FillResult | undefined) {
  const dots = result?.dotInstances ?? [];
  return dots.map(dot => ({
    x: Number(dot.center.x.toFixed(4)),
    y: Number(dot.center.y.toFixed(4)),
    r: Number(dot.radius.toFixed(4)),
    a: Number((dot.alpha ?? 1).toFixed(4)),
  }));
}

function averageNeighborDistance(instances: FillResult['dotInstances']): number {
  const dots = instances ?? [];
  if (dots.length < 2) {
    return 0;
  }
  let sum = 0;
  let count = 0;
  dots.forEach((current, index) => {
    let nearest = Number.POSITIVE_INFINITY;
    dots.forEach((candidate, candidateIndex) => {
      if (candidateIndex === index) {
        return;
      }
      const dx = candidate.center.x - current.center.x;
      const dy = candidate.center.y - current.center.y;
      const distance = Math.hypot(dx, dy);
      if (distance < nearest) {
        nearest = distance;
      }
    });
    if (Number.isFinite(nearest)) {
      sum += nearest;
      count += 1;
    }
  });
  return count === 0 ? 0 : sum / count;
}

function averageRadius(instances: FillResult['dotInstances']): number {
  const dots = instances ?? [];
  if (dots.length === 0) {
    return 0;
  }
  const total = dots.reduce((acc, dot) => acc + dot.radius, 0);
  return total / dots.length;
}
