import { FillParams, FillResult, ShapeDefinition, Vec2 } from '../types';
import { createRng, hashPoints } from '../utils/random';

export function contourFill(shape: ShapeDefinition, params: FillParams): FillResult {
  const centroid = shape.centroid;
  const variance = Math.max(0, params.variance ?? 0);
  const spacing = Math.max(2, params.spacing ?? 12);
  const seed = params.seed ?? hashPoints(shape.points);
  const rng = createRng(seed);

  const maxRadius = shape.points.reduce((max, point) => {
    const dx = point.x - centroid.x;
    const dy = point.y - centroid.y;
    return Math.max(max, Math.hypot(dx, dy));
  }, 0);

  const rings: Vec2[][] = [];
  const maxDistance = maxRadius + spacing * 4;

  for (let offset = spacing; offset <= maxDistance; offset += spacing) {
    const ring: Vec2[] = [];
    for (const point of shape.points) {
      const dx = point.x - centroid.x;
      const dy = point.y - centroid.y;
      const distance = Math.hypot(dx, dy);
      const dirX = distance === 0 ? 0 : dx / distance;
      const dirY = distance === 0 ? 0 : dy / distance;

      const jitter = variance * spacing * (rng() - 0.5) * 2;
      const radius = distance + offset + jitter;

      ring.push({
        x: centroid.x + dirX * radius,
        y: centroid.y + dirY * radius,
      });
    }

    if (ring.length > 0) {
      ring.push(ring[0]);
      rings.push(ring);
    }
  }

  return { lines: rings, clipPath: [...shape.points] };
}
