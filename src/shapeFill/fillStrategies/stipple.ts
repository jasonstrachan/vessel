import { FillParams, FillResult, ShapeDefinition, Vec2 } from '../types';
import { computeBounds, pointInPolygon } from '../utils/geometry';
import { createRng, hashPoints } from '../utils/random';

export function stippleFill(shape: ShapeDefinition, params: FillParams): FillResult {
  const bounds = computeBounds(shape.points);
  const spacing = Math.max(4, params.spacing ?? 12);
  const variance = Math.max(0, params.variance ?? 0);
  const seed = params.seed ?? hashPoints(shape.points);
  const rng = createRng(seed);

  const dots: Vec2[] = [];
  for (let x = bounds.minX; x <= bounds.maxX; x += spacing) {
    for (let y = bounds.minY; y <= bounds.maxY; y += spacing) {
      const jitterX = (rng() - 0.5) * variance * spacing * 2;
      const jitterY = (rng() - 0.5) * variance * spacing * 2;
      const candidate = { x: x + jitterX, y: y + jitterY };
      if (pointInPolygon(candidate, shape.points)) {
        dots.push(candidate);
      }
    }
  }

  return { dots, clipPath: [...shape.points] };
}
