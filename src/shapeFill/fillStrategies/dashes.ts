import { FillParams, FillResult, ShapeDefinition, Vec2 } from '../types';
import { computeBounds, pointInPolygon } from '../utils/geometry';
import { clamp } from '../utils/math';
import { createRng, hashPoints } from '../utils/random';

const DEG_TO_RAD = Math.PI / 180;

export function dashesFill(shape: ShapeDefinition, params: FillParams): FillResult {
  if (shape.points.length < 3) {
    return { lines: [], dots: [] };
  }

  const bounds = computeBounds(shape.points);
  const spacing = Math.max(4, params.spacing ?? 18);
  const variance = clamp(params.variance ?? 0.3, 0, 1);
  const thickness = Math.max(0.2, params.thickness ?? 2.4);
  const seed = params.seed ?? hashPoints(shape.points);
  const rng = createRng(seed);

  const dashLengthBase = Math.max(spacing * 0.85, thickness * 4);
  const jitterDistance = spacing * variance;
  const angleJitterMax = variance * Math.PI * 0.5;
  const lengthJitter = variance * 0.65;

  const lines: Vec2[][] = [];
  const capCenters: Vec2[] = [];

  for (let x = bounds.minX; x <= bounds.maxX; x += spacing) {
    for (let y = bounds.minY; y <= bounds.maxY; y += spacing) {
      const candidate = {
        x: x + (rng() - 0.5) * 2 * jitterDistance,
        y: y + (rng() - 0.5) * 2 * jitterDistance,
      };

      if (!pointInPolygon(candidate, shape.points)) {
        continue;
      }

      const edgeInfo = nearestEdgeInfo(candidate, shape.points);
      const baseAngle = edgeInfo
        ? Math.atan2(edgeInfo.tangent.y, edgeInfo.tangent.x)
        : (rng() * Math.PI * 2);
      const alignStrength = edgeInfo
        ? computeAlignment(edgeInfo.distance, spacing)
        : 0;
      const angleJitter = (rng() - 0.5) * 2 * angleJitterMax * (1 - alignStrength * 0.85);
      const angle = baseAngle + angleJitter;

      const lengthBase = dashLengthBase * lerp(0.85, 1.1, alignStrength);
      const length = Math.max(0.5, lengthBase * (1 + (rng() - 0.5) * 2 * lengthJitter));
      const half = length * 0.5;

      const dx = Math.cos(angle) * half;
      const dy = Math.sin(angle) * half;
      const start = { x: candidate.x - dx, y: candidate.y - dy };
      const end = { x: candidate.x + dx, y: candidate.y + dy };

      const segments = clipSegmentToPolygon(start, end, shape.points, Math.max(1.5, thickness));
      for (const segment of segments) {
        if (segment.length < 2) {
          continue;
        }
        lines.push(segment);
        capCenters.push(segment[0], segment[segment.length - 1]);
      }
    }
  }

  return {
    lines,
    dots: capCenters,
    dotRadius: Math.max(0.4, thickness * 0.45),
    lineWidth: thickness,
    clipPath: [...shape.points],
  };
}

function clipSegmentToPolygon(start: Vec2, end: Vec2, polygon: Vec2[], stepSize: number): Vec2[][] {
  const distance = Math.hypot(end.x - start.x, end.y - start.y);
  if (distance < 1e-3) {
    return [];
  }

  const steps = Math.max(2, Math.ceil(distance / Math.max(1, stepSize)));
  const stepX = (end.x - start.x) / steps;
  const stepY = (end.y - start.y) / steps;

  const segments: Vec2[][] = [];
  let current: Vec2[] = [];

  for (let i = 0; i <= steps; i += 1) {
    const point = {
      x: start.x + stepX * i,
      y: start.y + stepY * i,
    };

    if (pointInPolygon(point, polygon)) {
      current.push(point);
    } else if (current.length > 1) {
      segments.push(current);
      current = [];
    } else {
      current = [];
    }
  }

  if (current.length > 1) {
    segments.push(current);
  }

  return segments;
}

function nearestEdgeInfo(point: Vec2, polygon: Vec2[]): {
  distance: number;
  signedDistance: number;
  tangent: Vec2;
} | null {
  if (polygon.length < 2) {
    return null;
  }

  let bestDistance = Infinity;
  let bestInfo: { distance: number; signedDistance: number; tangent: Vec2 } | null = null;

  for (let i = 0; i < polygon.length; i += 1) {
    const a = polygon[i];
    const b = polygon[(i + 1) % polygon.length];
    const edgeX = b.x - a.x;
    const edgeY = b.y - a.y;
    const lenSq = edgeX * edgeX + edgeY * edgeY;
    if (lenSq < 1e-6) {
      continue;
    }

    const t = clamp(((point.x - a.x) * edgeX + (point.y - a.y) * edgeY) / lenSq, 0, 1);
    const closest = {
      x: a.x + edgeX * t,
      y: a.y + edgeY * t,
    };

    const diffX = point.x - closest.x;
    const diffY = point.y - closest.y;
    const distance = Math.hypot(diffX, diffY);
    if (distance >= bestDistance) {
      continue;
    }

    const length = Math.sqrt(lenSq);
    const tangent = {
      x: edgeX / length,
      y: edgeY / length,
    };
    const normalX = -tangent.y;
    const normalY = tangent.x;
    const signedDistance = diffX * normalX + diffY * normalY;

    bestDistance = distance;
    bestInfo = {
      distance,
      signedDistance,
      tangent,
    };
  }

  return bestInfo;
}

function computeAlignment(distance: number, spacing: number): number {
  const nearReach = Math.max(spacing * 1.25, 8);
  const farReach = Math.max(spacing * 3.5, 24);
  const near = 1 - smoothstep(0, nearReach, Math.abs(distance));
  const far = 1 - smoothstep(0, farReach, Math.abs(distance));
  return clamp01(Math.max(near, far * 0.65));
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp01((x - edge0) / (edge1 - edge0 + Number.EPSILON));
  return t * t * (3 - 2 * t);
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
