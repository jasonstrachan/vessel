import {
  FillDotInstance,
  FillParams,
  FillResult,
  FillStrokeSegment,
  ShapeDefinition,
  Vec2,
} from '../types';
import { computeBounds, pointInPolygon } from '../utils/geometry';
import { clamp } from '../utils/math';
import { createRng, hashPoints } from '../utils/random';
import { fbm2, jitterPoint } from '../utils/noise';

const DEG_TO_RAD = Math.PI / 180;

export function dashesFill(shape: ShapeDefinition, params: FillParams): FillResult {
  if (shape.points.length < 3) {
    return { lines: [], dots: [] };
  }

  const bounds = computeBounds(shape.points);
  const spacing = Math.max(2, params.spacing ?? 10);
  const thickness = Math.max(0.2, params.thickness ?? 3.5);
  const seed = params.seed ?? hashPoints(shape.points);
  const rng = createRng(seed);

  const rotationDeg = params.rotation ?? 0;
  const rotationRad = rotationDeg * DEG_TO_RAD;
  const baseDir = {
    x: Math.cos(rotationRad),
    y: Math.sin(rotationRad),
  };

  const dashLengthBase = Math.max(1, params.dashLength ?? Math.max(spacing * 0.65, thickness * 3));
  const lengthJitter = clamp01(params.dashLengthJitter ?? 0);
  const weightJitter = clamp01(params.dashWeightJitter ?? 0.25);
  const scatter = Math.max(0, params.scatter ?? 0);
  const angleDriftDeg = Math.max(0, params.angleDrift ?? 0);
  const angleDrift = angleDriftDeg * DEG_TO_RAD;
  const angleScale = Math.max(1, params.angleScale ?? 420);
  const nearScale = clamp(params.nearFalloff ?? 1, 0.15, 4);
  const farScale = clamp(params.farFalloff ?? 1, 0.15, 5);

  const baseAlignNear = Math.max(8, spacing * 2.8);
  const alignReachNear = baseAlignNear * nearScale;
  const baseAlignFar = Math.max(alignReachNear * 2.4, spacing * 6, dashLengthBase * 5, 36);
  const alignReachFar = baseAlignFar * farScale;
  const nearStrength = clamp(0.35 + nearScale * 0.55, 0.1, 1.2);
  const farWeight = clamp(0.25 + farScale * 0.25, 0.05, 0.9);

  const computeAlignment = (distance: number) => {
    const dist = Math.abs(distance);
    const nearFall = 1 - smoothstep(0, alignReachNear, dist);
    const farFall = 1 - smoothstep(0, alignReachFar, dist);
    const combined = Math.max(nearFall, farFall * farWeight);
    return clamp01(nearStrength * Math.pow(combined, 0.92));
  };

  const angleNoiseSeed = seed ^ 0x3f11c2d9;
  const angleNoise = angleDrift > 1e-4
    ? (x: number, y: number) => fbm2(x / angleScale, y / angleScale, angleNoiseSeed, 3)
    : null;

  const strokes: FillStrokeSegment[] = [];
  const caps: FillDotInstance[] = [];

  const cellJitter = spacing * 0.35;

  for (let x = bounds.minX; x <= bounds.maxX; x += spacing) {
    for (let y = bounds.minY; y <= bounds.maxY; y += spacing) {
      const baseCandidate = {
        x: x + (rng() - 0.5) * 2 * cellJitter,
        y: y + (rng() - 0.5) * 2 * cellJitter,
      };

      if (!pointInPolygon(baseCandidate, shape.points)) {
        continue;
      }

      const candidate = jitterPoint(baseCandidate, scatter, shape.points, rng);
      if (!pointInPolygon(candidate, shape.points)) {
        continue;
      }

      const edgeInfo = nearestEdgeInfo(candidate, shape.points);
      let dirX = baseDir.x;
      let dirY = baseDir.y;
      let alignStrength = 0;

      if (edgeInfo) {
        alignStrength = computeAlignment(edgeInfo.distance);
        let tangentX = edgeInfo.tangent.x;
        let tangentY = edgeInfo.tangent.y;

        if (tangentX * dirX + tangentY * dirY < 0) {
          tangentX = -tangentX;
          tangentY = -tangentY;
        }

        const blendedX = dirX * (1 - alignStrength) + tangentX * alignStrength;
        const blendedY = dirY * (1 - alignStrength) + tangentY * alignStrength;
        const mag = Math.hypot(blendedX, blendedY);

        if (mag > 1e-6) {
          dirX = blendedX / mag;
          dirY = blendedY / mag;
        }
      }

      let theta = Math.atan2(dirY, dirX);

      if (angleNoise) {
        const n = clamp(angleNoise(candidate.x, candidate.y), -1, 1);
        theta += n * angleDrift;
      }

      const lengthBase = dashLengthBase * lerp(0.85, 1.1, alignStrength);
      const length = Math.max(0.5, lengthBase * (1 + (rng() - 0.5) * 2 * lengthJitter));
      const half = length * 0.5;

      const width = Math.max(0.2, thickness * (1 + (rng() - 0.5) * 2 * weightJitter));
      const alpha = clamp(0.7 + (rng() - 0.5) * 0.45, 0.35, 1);

      const dx = Math.cos(theta) * half;
      const dy = Math.sin(theta) * half;
      const start = { x: candidate.x - dx, y: candidate.y - dy };
      const end = { x: candidate.x + dx, y: candidate.y + dy };

      const segments = clipSegmentToPolygon(start, end, shape.points, Math.max(1.5, width));
      for (const segment of segments) {
        if (segment.length < 2) {
          continue;
        }
        strokes.push({ points: segment, lineWidth: width, alpha });

        const first = segment[0];
        const last = segment[segment.length - 1];
        const capScale = 0.68 + (rng() - 0.5) * 0.24;
        const capRadius = Math.max(width * 0.6, width * capScale);
        caps.push(
          { center: first, radius: capRadius, alpha },
          { center: last, radius: capRadius, alpha }
        );
      }
    }
  }

  return {
    strokeSegments: strokes,
    dotInstances: caps,
    lineWidth: thickness,
    dotRadius: Math.max(0.4, thickness * 0.45),
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
