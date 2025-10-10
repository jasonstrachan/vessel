import { FillParams, FillResult, ShapeDefinition, Vec2 } from '../types';
import { computeBounds, computeCentroid, pointInPolygon } from '../utils/geometry';
import { createRng, hashPoints } from '../utils/random';

interface HatchOptions {
  rotation: number;
  spacing: number;
  thickness: number;
  organic: number;
  seed: number;
}

export function hatchFill(shape: ShapeDefinition, params: FillParams): FillResult {
  const result: FillResult = { lines: [] };
  const baseSeed = params.seed ?? hashPoints(shape.points);

  const normalized: HatchOptions = {
    rotation: params.rotation ?? 0,
    spacing: Math.max(1, params.spacing ?? 10),
    thickness: Math.max(0.2, params.thickness ?? 1),
    organic: Math.max(0, Math.min(1, params.organic ?? 0)),
    seed: baseSeed,
  };

  const primary = buildHatchLines(shape, normalized);
  result.lines?.push(...primary);

  if (params.cross) {
    const crossOptions: HatchOptions = {
      ...normalized,
      rotation: normalized.rotation + 90,
      seed: baseSeed ^ 0x51633e2d,
    };
    result.lines?.push(...buildHatchLines(shape, crossOptions));
  }

  result.clipPath = [...shape.points];
  return result;
}

function buildHatchLines(shape: ShapeDefinition, options: HatchOptions): Vec2[][] {
  const centroid = computeCentroid(shape.points);
  const bounds = computeBounds(shape.points);
  const width = bounds.maxX - bounds.minX;
  const height = bounds.maxY - bounds.minY;
  const pad = Math.hypot(width, height) + options.spacing * 2;

  const angleRad = (options.rotation * Math.PI) / 180;
  const direction = { x: Math.cos(angleRad), y: Math.sin(angleRad) };
  const normal = { x: -direction.y, y: direction.x };

  const projections = shape.points.map(point => {
    const rel = { x: point.x - centroid.x, y: point.y - centroid.y };
    return rel.x * normal.x + rel.y * normal.y;
  });

  const minProj = Math.min(...projections) - pad;
  const maxProj = Math.max(...projections) + pad;

  const rng = createRng(options.seed);
  const lines: Vec2[][] = [];
  const step = Math.max(1, options.spacing);

  for (let offset = minProj; offset <= maxProj; offset += step) {
    const jitter = (rng() - 0.5) * 2 * options.spacing * options.organic;
    const center = {
      x: centroid.x + normal.x * (offset + jitter),
      y: centroid.y + normal.y * (offset + jitter),
    };

    const start = {
      x: center.x - direction.x * pad,
      y: center.y - direction.y * pad,
    };
    const end = {
      x: center.x + direction.x * pad,
      y: center.y + direction.y * pad,
    };

    const segments = sampleLineSegment(start, end, shape.points, Math.max(1, options.thickness));
    if (segments.length > 0) {
      lines.push(...segments);
    }
  }

  return lines;
}

function sampleLineSegment(start: Vec2, end: Vec2, polygon: Vec2[], step: number): Vec2[][] {
  const distance = Math.hypot(end.x - start.x, end.y - start.y);
  const steps = Math.max(1, Math.floor(distance / step));
  const direction = {
    x: (end.x - start.x) / steps,
    y: (end.y - start.y) / steps,
  };

  const segments: Vec2[][] = [];
  let currentSegment: Vec2[] = [];

  for (let i = 0; i <= steps; i += 1) {
    const point = {
      x: start.x + direction.x * i,
      y: start.y + direction.y * i,
    };
    if (pointInPolygon(point, polygon)) {
      currentSegment.push(point);
    } else if (currentSegment.length > 1) {
      segments.push(currentSegment);
      currentSegment = [];
    } else {
      currentSegment = [];
    }
  }

  if (currentSegment.length > 1) {
    segments.push(currentSegment);
  }

  return segments;
}
