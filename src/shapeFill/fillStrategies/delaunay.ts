import type { FillParams, FillResult, FillStrokeSegment, ShapeDefinition, Vec2 } from '../types';
import { pointInPolygon } from '../utils/geometry';
import { clampParameterValue } from '../parameters';
import { createRng, hashPoints } from '../utils/random';

const DEG_TO_RAD = Math.PI / 180;

const clampNumber = (value: number, min: number, max: number): number => {
  if (!Number.isFinite(value)) {
    return min;
  }
  if (value < min) return min;
  if (value > max) return max;
  return value;
};

type Point = { x: number; y: number };

const edgeKey = (a: Vec2, b: Vec2): string => {
  const ax = Math.round(a.x * 1000);
  const ay = Math.round(a.y * 1000);
  const bx = Math.round(b.x * 1000);
  const by = Math.round(b.y * 1000);
  return ax < bx || (ax === bx && ay <= by)
    ? `${ax}:${ay}-${bx}:${by}`
    : `${bx}:${by}-${ax}:${ay}`;
};

const triangleArea = (p0: Point, p1: Point, p2: Point): number => {
  return Math.abs(
    (p0.x * (p1.y - p2.y) + p1.x * (p2.y - p0.y) + p2.x * (p0.y - p1.y)) / 2
  );
};

export function delaunayFill(shape: ShapeDefinition, params: FillParams): FillResult {
  if (shape.points.length < 3) {
    return { strokeSegments: [], clipPath: [...shape.points] };
  }

  const spacingRaw = params.spacing ?? 22;
  const spacing = clampNumber(clampParameterValue(spacingRaw, 'spacing'), 6, 240);
  const jitter = clampNumber(params.variance ?? 0.35, 0, 1);
  const rotation = params.rotation ?? 0;
  const lineWidth = Math.max(0.2, params.thickness ?? 1.1);

  const centroid = shape.centroid;

  const rotationRad = (rotation % 360) * DEG_TO_RAD;
  const cosR = Math.cos(rotationRad);
  const sinR = Math.sin(rotationRad);

  const toLocal = (point: Vec2): Point => {
    const dx = point.x - centroid.x;
    const dy = point.y - centroid.y;
    return {
      x: dx * cosR + dy * sinR,
      y: -dx * sinR + dy * cosR,
    };
  };

  const toWorld = (point: Point): Vec2 => {
    return {
      x: centroid.x + point.x * cosR - point.y * sinR,
      y: centroid.y + point.x * sinR + point.y * cosR,
    };
  };

  const polygonLocal = shape.points.map(toLocal);

  const minX = Math.min(...polygonLocal.map(p => p.x));
  const maxX = Math.max(...polygonLocal.map(p => p.x));
  const minY = Math.min(...polygonLocal.map(p => p.y));
  const maxY = Math.max(...polygonLocal.map(p => p.y));

  const bounds = {
    minX: minX - spacing,
    maxX: maxX + spacing,
    minY: minY - spacing,
    maxY: maxY + spacing,
  };

  const seed = hashPoints(shape.points);
  const rng = createRng(seed ^ 0x5f3759df);

  const isInside = (point: Point) => pointInPolygon(point, polygonLocal);

  const poissonPoints: Point[] = [];
  const minDist = Math.max(spacing * 0.85, 4);
  const minDistSq = minDist * minDist;

  const isFarEnough = (candidate: Point) => {
    for (const point of poissonPoints) {
      const dx = candidate.x - point.x;
      const dy = candidate.y - point.y;
      if (dx * dx + dy * dy < minDistSq) {
        return false;
      }
    }
    return true;
  };

  const attemptCount = Math.max(400, Math.floor(((maxX - minX) * (maxY - minY)) / (spacing * spacing)) * 6);

  for (let attempt = 0; attempt < attemptCount; attempt += 1) {
    const x = bounds.minX + rng() * (bounds.maxX - bounds.minX);
    const y = bounds.minY + rng() * (bounds.maxY - bounds.minY);
    const candidate: Point = { x, y };

    if (!isInside(candidate)) {
      continue;
    }
    if (!isFarEnough(candidate)) {
      continue;
    }

    poissonPoints.push(candidate);

    if (rng() < (0.22 + jitter * 0.5)) {
      const offsetMag = spacing * (0.12 + rng() * 0.4);
      const offsetAngle = rng() * Math.PI * 2;
      const companion: Point = {
        x: candidate.x + Math.cos(offsetAngle) * offsetMag,
        y: candidate.y + Math.sin(offsetAngle) * offsetMag,
      };
      if (isInside(companion)) {
        poissonPoints.push(companion);
      }
    }
  }

  if (poissonPoints.length < 3) {
    return { strokeSegments: [], clipPath: [...shape.points] };
  }

  const segments: FillStrokeSegment[] = [];
  const seenEdges = new Set<string>();

  const neighborCount = Math.max(2, Math.round(3 + jitter * 3));

  for (let i = 0; i < poissonPoints.length; i += 1) {
    const point = poissonPoints[i];
    const distances: Array<{ index: number; dist: number }> = [];

    for (let j = 0; j < poissonPoints.length; j += 1) {
      if (i === j) continue;
      const other = poissonPoints[j];
      const dx = point.x - other.x;
      const dy = point.y - other.y;
      distances.push({ index: j, dist: dx * dx + dy * dy });
    }

    distances.sort((a, b) => a.dist - b.dist);
    const limit = Math.min(neighborCount, distances.length);

    for (let k = 0; k < limit; k += 1) {
      const neighbor = poissonPoints[distances[k].index];

      const triangleCentroid = {
        x: (point.x + neighbor.x) / 2,
        y: (point.y + neighbor.y) / 2,
      };

      if (!isInside(triangleCentroid)) {
        continue;
      }

      const worldA = toWorld(point);
      const worldB = toWorld(neighbor);
      const key = edgeKey(worldA, worldB);
      if (seenEdges.has(key)) {
        continue;
      }
      seenEdges.add(key);

      segments.push({
        points: [worldA, worldB],
        lineWidth,
        alpha: 1,
      });
    }
  }

  return {
    strokeSegments: segments,
    lineWidth,
    clipPath: [...shape.points],
  };
}
