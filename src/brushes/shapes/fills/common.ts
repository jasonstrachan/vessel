import type { Point } from './types';

export const snapToPixel = (value: number): number => Math.floor(value) + 0.5;

const identity = (value: number): number => value;

export const resolveCoordinateSnap = (pixelMode?: boolean) => (
  pixelMode ? snapToPixel : identity
);

export const isPointInPolygonSDF = (point: Point, vertices: Point[]): boolean => {
  let inside = false;
  for (let i = 0, j = vertices.length - 1; i < vertices.length; j = i++) {
    const xi = vertices[i].x;
    const yi = vertices[i].y;
    const xj = vertices[j].x;
    const yj = vertices[j].y;

    const intersect = ((yi > point.y) !== (yj > point.y)) &&
      (point.x < (xj - xi) * (point.y - yi) / (yj - yi + 1e-6) + xi);
    if (intersect) {
      inside = !inside;
    }
  }
  return inside;
};

const distanceToSegmentSquared = (point: Point, start: Point, end: Point): number => {
  const l2 = (end.x - start.x) ** 2 + (end.y - start.y) ** 2;
  if (l2 === 0) return (point.x - start.x) ** 2 + (point.y - start.y) ** 2;

  let t = ((point.x - start.x) * (end.x - start.x) + (point.y - start.y) * (end.y - start.y)) / l2;
  t = Math.max(0, Math.min(1, t));

  const projection = {
    x: start.x + t * (end.x - start.x),
    y: start.y + t * (end.y - start.y),
  };
  return (point.x - projection.x) ** 2 + (point.y - projection.y) ** 2;
};

export const distanceToPolygonSDF = (point: Point, vertices: Point[]): number => {
  let minDist = Infinity;

  for (let i = 0; i < vertices.length; i++) {
    const start = vertices[i];
    const end = vertices[(i + 1) % vertices.length];
    const distSq = distanceToSegmentSquared(point, start, end);
    if (distSq < minDist) {
      minDist = distSq;
    }
  }

  return Math.sqrt(minDist);
};
