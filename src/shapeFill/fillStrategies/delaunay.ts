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

const MAX_GENERATED_POINTS = 1800;
const MIN_GENERATED_POINTS = 12;
const GRID_RADIUS_DISTANCE_CHECK = 1;
const GRID_RADIUS_EDGE_SEARCH = 2;

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

  const poissonPoints: Point[] = [];
  const minDist = Math.max(spacing * 0.85, 4);
  const minDistSq = minDist * minDist;

  const isInside = (point: Point) => pointInPolygon(point, polygonLocal);

  const cellSize = Math.max(minDist, spacing);
  const invCellSize = 1 / cellSize;
  const cellKey = (ix: number, iy: number) => `${ix}:${iy}`;
  const grid = new Map<string, number[]>();

  const toCell = (point: Point) => {
    const ix = Math.floor((point.x - bounds.minX) * invCellSize);
    const iy = Math.floor((point.y - bounds.minY) * invCellSize);
    return { ix, iy };
  };

  const gatherNeighborIndices = (ix: number, iy: number, radius: number) => {
    const indices: number[] = [];
    for (let dx = -radius; dx <= radius; dx += 1) {
      for (let dy = -radius; dy <= radius; dy += 1) {
        const key = cellKey(ix + dx, iy + dy);
        const bucket = grid.get(key);
        if (bucket && bucket.length > 0) {
          indices.push(...bucket);
        }
      }
    }
    return indices;
  };

  const registerPoint = (point: Point, index: number) => {
    const { ix, iy } = toCell(point);
    const key = cellKey(ix, iy);
    const bucket = grid.get(key);
    if (bucket) {
      bucket.push(index);
    } else {
      grid.set(key, [index]);
    }
  };

  const tryAddPoint = (candidate: Point): boolean => {
    if (!isInside(candidate)) {
      return false;
    }

    const { ix, iy } = toCell(candidate);
    const neighbors = gatherNeighborIndices(ix, iy, GRID_RADIUS_DISTANCE_CHECK);

    for (const index of neighbors) {
      const neighbor = poissonPoints[index];
      const dx = candidate.x - neighbor.x;
      const dy = candidate.y - neighbor.y;
      if (dx * dx + dy * dy < minDistSq) {
        return false;
      }
    }

    const newIndex = poissonPoints.push(candidate) - 1;
    registerPoint(candidate, newIndex);
    return true;
  };

  const areaApprox = (maxX - minX) * (maxY - minY);
  const desiredPoints = Math.min(
    MAX_GENERATED_POINTS,
    Math.max(
      MIN_GENERATED_POINTS,
      Math.floor((areaApprox / (spacing * spacing)) * 0.9)
    )
  );
  const maxAttempts = Math.max(desiredPoints * 5, 400);

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const x = bounds.minX + rng() * (bounds.maxX - bounds.minX);
    const y = bounds.minY + rng() * (bounds.maxY - bounds.minY);
    const candidate: Point = { x, y };

    if (tryAddPoint(candidate) && poissonPoints.length >= desiredPoints) {
      break;
    }

    if (rng() < 0.22 + jitter * 0.5) {
      const offsetMag = spacing * (0.12 + rng() * 0.4);
      const offsetAngle = rng() * Math.PI * 2;
      const companion: Point = {
        x: candidate.x + Math.cos(offsetAngle) * offsetMag,
        y: candidate.y + Math.sin(offsetAngle) * offsetMag,
      };
      if (tryAddPoint(companion) && poissonPoints.length >= desiredPoints) {
        break;
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
    const { ix, iy } = toCell(point);
    const neighborIndices = gatherNeighborIndices(ix, iy, GRID_RADIUS_EDGE_SEARCH);
    const seenNeighbor = new Set<number>();
    const distances: Array<{ index: number; dist: number }> = [];

    for (const neighborIndex of neighborIndices) {
      if (neighborIndex === i || seenNeighbor.has(neighborIndex)) {
        continue;
      }
      seenNeighbor.add(neighborIndex);
      const other = poissonPoints[neighborIndex];
      const dx = point.x - other.x;
      const dy = point.y - other.y;
      distances.push({ index: neighborIndex, dist: dx * dx + dy * dy });
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
