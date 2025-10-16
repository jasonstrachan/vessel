import { ShapeDefinition, Vec2 } from './types';
import { computeBounds, computeCentroid } from './utils/geometry';

export const SAMPLE_DISTANCE_PX = 6;
export const MAX_POINTS = 2000;

export function createShape(points: Vec2[]): ShapeDefinition {
  const constrainedPoints = points.slice(0, MAX_POINTS);
  const centroid = computeCentroid(constrainedPoints);
  const bounds = computeBounds(constrainedPoints);

  return {
    id: crypto.randomUUID(),
    points: constrainedPoints,
    centroid,
    bounds,
  };
}
