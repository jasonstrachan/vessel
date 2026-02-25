import { FillParams, FillResult, ShapeDefinition, Vec2 } from '../types';
import { computeBounds, pointInPolygon } from '../utils/geometry';
import { clamp } from '../utils/math';
import { createRng, hashPoints } from '../utils/random';

const FALLBACK_WOBBLE = 0.45;
const MAX_DOTS = 8000;
const MIN_SHAPE_POINTS = 3;

export function stippleFill(shape: ShapeDefinition, params: FillParams): FillResult {
  if (shape.points.length < MIN_SHAPE_POINTS) {
    return { dotInstances: [], clipPath: [...shape.points] };
  }

  const bounds = shape.bounds ?? computeBounds(shape.points);
  const spacing = Math.max(2, params.spacing ?? 12);
  const wobble = clamp(resolveWobble(params), 0, 1);
  const dotScale = clamp(params.thickness ?? 1, 0.25, 5);
  const seed = (params.seed ?? 0) ^ hashPoints(shape.points);
  const rng = createRng(seed);

  const pad = Math.max(4, spacing * 1.5);
  const startX = bounds.minX - pad;
  const startY = bounds.minY - pad;
  const endX = bounds.maxX + pad;
  const endY = bounds.maxY + pad;

  const candidateStep = Math.max(1, spacing * lerp(0.65, 1.05, 1 - wobble));
  const jitterExtent = spacing * lerp(0.18, 0.95, wobble);
  const minDistance = Math.max(0.65, spacing * lerp(0.55, 0.95, 1 - wobble));
  const minDistanceSq = minDistance * minDistance;
  const maxSafeRadius = Math.max(0.2, minDistance * 0.45);
  const minSafeRadius = 0.2;
  const desiredRadius = clamp(dotScale * 0.65, minSafeRadius, 8);
  const baseRadius = clamp(desiredRadius, minSafeRadius, maxSafeRadius);
  const area = Math.max(1, (endX - startX) * (endY - startY));
  const estimatedDots = Math.max(4, Math.ceil(area / Math.max(1, spacing * spacing)));
  const maxDots = Math.min(MAX_DOTS, Math.ceil(estimatedDots * lerp(1.1, 1.5, wobble)));

  const cellSize = Math.max(1, minDistance / Math.SQRT2);
  const gridWidth = Math.max(1, Math.ceil((endX - startX) / cellSize) + 3);
  const gridHeight = Math.max(1, Math.ceil((endY - startY) / cellSize) + 3);
  const occupancy = new Int32Array(gridWidth * gridHeight).fill(-1);
  const accepted: Vec2[] = [];
  const dotInstances: NonNullable<FillResult['dotInstances']> = [];

  const polygon = shape.points;

  for (let gx = startX; gx <= endX && accepted.length < maxDots; gx += candidateStep) {
    for (let gy = startY; gy <= endY && accepted.length < maxDots; gy += candidateStep) {
      const anchor: Vec2 = {
        x: gx + candidateStep * 0.5,
        y: gy + candidateStep * 0.5,
      };
      const candidate = jitterPoint(anchor, jitterExtent, rng);
      if (!pointInPolygon(candidate, polygon)) {
        continue;
      }

      if (!placePoint(candidate)) {
        continue;
      }
    }
  }

  if (accepted.length === 0) {
    const radius = baseRadius;
    dotInstances.push({
      center: { ...shape.centroid },
      radius,
      alpha: 0.82,
      shape: 'circle',
    });
  }

  return {
    dotInstances,
    clipPath: [...shape.points],
  };

  function placePoint(point: Vec2): boolean {
    const gridX = Math.floor((point.x - startX) / cellSize);
    const gridY = Math.floor((point.y - startY) / cellSize);
    if (gridX < 0 || gridY < 0 || gridX >= gridWidth || gridY >= gridHeight) {
      return false;
    }

    for (let offsetY = -2; offsetY <= 2; offsetY += 1) {
      const neighborY = gridY + offsetY;
      if (neighborY < 0 || neighborY >= gridHeight) {
        continue;
      }
      for (let offsetX = -2; offsetX <= 2; offsetX += 1) {
        const neighborX = gridX + offsetX;
        if (neighborX < 0 || neighborX >= gridWidth) {
          continue;
        }
        const neighborIndex = occupancy[neighborY * gridWidth + neighborX];
        if (neighborIndex === -1) {
          continue;
        }
        const neighborPoint = accepted[neighborIndex];
        const dx = neighborPoint.x - point.x;
        const dy = neighborPoint.y - point.y;
        if (dx * dx + dy * dy < minDistanceSq) {
          return false;
        }
      }
    }

    const nextIndex = accepted.length;
    accepted.push(point);
    occupancy[gridY * gridWidth + gridX] = nextIndex;

    const radius = baseRadius;
    const alpha = 0.82;

    dotInstances.push({
      center: point,
      radius,
      alpha,
      shape: 'circle',
    });

    return true;
  }
}

function resolveWobble(params: FillParams): number {
  if (typeof params.wobble === 'number') {
    return params.wobble;
  }
  if (typeof params.variance === 'number') {
    return params.variance;
  }
  return FALLBACK_WOBBLE;
}

function jitterPoint(anchor: Vec2, extent: number, rng: () => number): Vec2 {
  if (extent <= 0) {
    return anchor;
  }
  const theta = rng() * Math.PI * 2;
  const distance = Math.pow(rng(), 0.6) * extent;
  return {
    x: anchor.x + Math.cos(theta) * distance,
    y: anchor.y + Math.sin(theta) * distance,
  };
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
