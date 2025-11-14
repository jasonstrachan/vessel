import type { ShapeDefinition, Vec2 } from '../types';
import { computeBounds, computeCentroid, pointInPolygon } from './geometry';
import { fbm2 } from './noise';
import { createRng } from './random';

const EPSILON = 1e-5;
const MAX_GRID_RES = 220;
const MIN_GRID_RES = 18;

type PolygonEdge = { a: Vec2; b: Vec2 };

export interface OrganicContourOptions {
  spacing: number;
  variance: number;
  seed: number;
  spacingWobble?: number;
}

export function generateOrganicContourLines(
  polygon: ShapeDefinition['points'],
  options: OrganicContourOptions
): Vec2[][] {
  if (!polygon || polygon.length < 3) {
    return [];
  }

  const bounds = computeBounds(polygon);
  const centroid = computeCentroid(polygon);
  const width = Math.max(bounds.maxX - bounds.minX, options.spacing * 2);
  const height = Math.max(bounds.maxY - bounds.minY, options.spacing * 2);
  const targetCell = Math.max(options.spacing * 0.6, 8);
  const cols = clampInt(
    Math.ceil(width / targetCell),
    MIN_GRID_RES,
    MAX_GRID_RES
  );
  const rows = clampInt(
    Math.ceil(height / targetCell),
    MIN_GRID_RES,
    MAX_GRID_RES
  );
  const dx = width / cols;
  const dy = height / rows;

  const edges = buildEdges(polygon);
  const centroidRadius = polygon.reduce((max, point) => {
    const dist = Math.hypot(point.x - centroid.x, point.y - centroid.y);
    return Math.max(max, dist);
  }, options.spacing);

  const values: number[][] = new Array(rows + 1);
  let maxScalar = 0;

  for (let row = 0; row <= rows; row += 1) {
    const y = bounds.minY + row * dy;
    values[row] = new Array(cols + 1);
    for (let col = 0; col <= cols; col += 1) {
      const x = bounds.minX + col * dx;
      const basePoint = { x, y };
      const inside = pointInPolygon(basePoint, polygon);
      const warpedPoint = warpPoint(basePoint, bounds, options);
      const distance = distanceToEdges(warpedPoint, edges);
      if (!inside) {
        values[row][col] = -distance;
        continue;
      }

      const centerDist = Math.hypot(warpedPoint.x - centroid.x, warpedPoint.y - centroid.y);
      const radialRatio = Math.max(0, 1 - centerDist / Math.max(centroidRadius, EPSILON));
      const centerBias = radialRatio * options.spacing * (0.4 + options.variance * 0.35);

      const textureScale = 1 / Math.max(options.spacing * 1.1, 10);
      const ridgeScale = 1 / Math.max(options.spacing * 0.9, 6);
      const organicNoise = fbm2(
        (warpedPoint.x - bounds.minX) * textureScale,
        (warpedPoint.y - bounds.minY) * textureScale,
        options.seed ^ 0x51633e2d,
        3,
        2.1,
        0.55
      );
      const ridgeNoise = fbm2(
        warpedPoint.x * ridgeScale,
        warpedPoint.y * ridgeScale,
        options.seed ^ 0x37a4b4c9,
        4,
        2.05,
        0.5
      );
      const flowNoise = fbm2(
        warpedPoint.x * (textureScale * 0.8),
        warpedPoint.y * (textureScale * 0.8),
        options.seed ^ 0x4b1f2cd3,
        2,
        2.2,
        0.55
      );

      const ridgeWeight = Math.pow(radialRatio, 0.85 + options.variance * 0.6);
      const ridgeContribution = ridgeWeight * options.spacing * (0.35 + options.variance * 0.6);
      const organicContribution = organicNoise * options.spacing * (0.2 + options.variance * 0.65);
      const flowContribution = flowNoise * options.spacing * 0.25 * options.variance;
      const sculptedDistance = distance * (0.7 + ridgeWeight * 0.6) + ridgeNoise * options.spacing * (0.15 + options.variance * 0.4);
      const value = sculptedDistance + centerBias + ridgeContribution + organicContribution + flowContribution;
      values[row][col] = value;
      if (value > maxScalar) {
        maxScalar = value;
      }
    }
  }

  if (maxScalar <= options.spacing * 0.5) {
    return [];
  }

  const isoLevels: number[] = [];
  const wobbleRng = createRng(options.seed ^ 0x9e3779b9);
  const varianceRamp = Math.pow(Math.min(Math.max(options.variance ?? 0, 0), 1), 0.85);
  const wobbleControl = options.spacingWobble ?? options.variance ?? 0.4;
  const wobbleRamp = Math.pow(Math.min(Math.max(wobbleControl, 0), 1), 0.9);
  // Apply a non-linear ramp so S Wobble can quickly add organic jitter while still
  // allowing subtle adjustments. Variance still influences the base contour shape,
  // but spacing wobble now explicitly controls how uneven the band spacing feels.
  const levelWobbleStrength = 0.25 + wobbleRamp * 0.85;
  const spacingJitterStrength = 0.05 + wobbleRamp * 0.75;
  const minStepFactor = 0.25 + wobbleRamp * 0.25;

  let nextLevel = options.spacing;
  const isoNoiseSeed = options.seed ^ 0x4f16b3d1;
  while (nextLevel <= maxScalar + options.spacing * 0.5 && isoLevels.length < 48) {
    const isoIndex = isoLevels.length + 1;
    const isoNoise = fbm2(
      (isoIndex * 0.73 + nextLevel * 0.015) * (1 + wobbleRamp * 0.5),
      (isoIndex * 0.41 - nextLevel * 0.01) * (1 + varianceRamp * 0.35),
      isoNoiseSeed ^ Math.imul(isoIndex, 0x9e3779b1),
      3,
      2.15,
      0.55
    );
    const wobble = (wobbleRng() - 0.5) * options.spacing * levelWobbleStrength;
    const extraIsoPerturb = isoNoise * options.spacing * (0.1 + wobbleRamp * 0.45);
    isoLevels.push(nextLevel + wobble + extraIsoPerturb);

    const spacingJitter = (wobbleRng() - 0.5) * options.spacing * spacingJitterStrength;
    const noiseStep = isoNoise * options.spacing * (0.08 + wobbleRamp * 0.5);
    const baseStep = options.spacing * (1 + varianceRamp * 0.15 + wobbleRamp * 0.35);
    const step = Math.max(options.spacing * minStepFactor, baseStep + spacingJitter + noiseStep);
    nextLevel += step;
  }
  if (isoLevels.length === 0) {
    isoLevels.push(options.spacing);
  }

  const allLines: Vec2[][] = [];
  for (const level of isoLevels) {
    const segments = marchingSquares(values, bounds, dx, dy, level);
    const lines = stitchSegments(segments, polygon, edges, options, level);
    if (lines.length > 0) {
      allLines.push(...lines);
    }
  }
  return allLines;
}

type Segment = { start: Vec2; end: Vec2 };

const marchingSquares = (
  values: number[][],
  bounds: ShapeDefinition['bounds'],
  dx: number,
  dy: number,
  level: number
): Segment[] => {
  const rows = values.length - 1;
  const cols = values[0].length - 1;
  const segments: Segment[] = [];

  for (let row = 0; row < rows; row += 1) {
    const y = bounds.minY + row * dy;
    for (let col = 0; col < cols; col += 1) {
      const x = bounds.minX + col * dx;
      const v0 = values[row][col];
      const v1 = values[row][col + 1];
      const v2 = values[row + 1][col + 1];
      const v3 = values[row + 1][col];

      const caseIndex =
        (v0 >= level ? 1 : 0) |
        (v1 >= level ? 2 : 0) |
        (v2 >= level ? 4 : 0) |
        (v3 >= level ? 8 : 0);

      if (caseIndex === 0 || caseIndex === 15) {
        continue;
      }

      const corners: Vec2[] = [
        { x, y },
        { x: x + dx, y },
        { x: x + dx, y: y + dy },
        { x, y: y + dy },
      ];
      const edges: Array<Vec2 | null> = [
        interpolateEdge(corners[0], corners[1], v0, v1, level),
        interpolateEdge(corners[1], corners[2], v1, v2, level),
        interpolateEdge(corners[2], corners[3], v2, v3, level),
        interpolateEdge(corners[3], corners[0], v3, v0, level),
      ];

      switch (caseIndex) {
        case 1:
        case 14:
          pushSegment(edges[3], edges[0], segments);
          break;
        case 2:
        case 13:
          pushSegment(edges[0], edges[1], segments);
          break;
        case 3:
        case 12:
          pushSegment(edges[3], edges[1], segments);
          break;
        case 4:
        case 11:
          pushSegment(edges[1], edges[2], segments);
          break;
        case 5:
          pushSegment(edges[0], edges[1], segments);
          pushSegment(edges[2], edges[3], segments);
          break;
        case 6:
        case 9:
          pushSegment(edges[0], edges[2], segments);
          break;
        case 7:
        case 8:
          pushSegment(edges[3], edges[2], segments);
          break;
        case 10:
          pushSegment(edges[0], edges[3], segments);
          pushSegment(edges[1], edges[2], segments);
          break;
        default:
          break;
      }
    }
  }

  return segments;
};

const pushSegment = (start: Vec2 | null, end: Vec2 | null, segments: Segment[]) => {
  if (!start || !end) {
    return;
  }
  if (Math.hypot(start.x - end.x, start.y - end.y) < EPSILON) {
    return;
  }
  segments.push({ start, end });
};

const stitchSegments = (
  segments: Segment[],
  polygon: Vec2[],
  edges: PolygonEdge[],
  options: OrganicContourOptions,
  levelSeed: number
): Vec2[][] => {
  if (segments.length === 0) {
    return [];
  }

  const key = (point: Vec2) => `${point.x.toFixed(2)}:${point.y.toFixed(2)}`;
  const adjacency = new Map<string, number[]>();
  segments.forEach((segment, index) => {
    const startKey = key(segment.start);
    const endKey = key(segment.end);
    if (!adjacency.has(startKey)) adjacency.set(startKey, []);
    if (!adjacency.has(endKey)) adjacency.set(endKey, []);
    adjacency.get(startKey)?.push(index);
    adjacency.get(endKey)?.push(index);
  });

  const visited = new Array<boolean>(segments.length).fill(false);
  const lines: Vec2[][] = [];

  const findNext = (point: Vec2, excludeIndex: number): [number, Vec2] | null => {
    const candidates = adjacency.get(key(point));
    if (!candidates) return null;
    for (const idx of candidates) {
      if (visited[idx] || idx === excludeIndex) continue;
      const segment = segments[idx];
      if (pointsClose(segment.start, point)) {
        return [idx, segment.end];
      }
      if (pointsClose(segment.end, point)) {
        return [idx, segment.start];
      }
    }
    return null;
  };

  for (let i = 0; i < segments.length; i += 1) {
    if (visited[i]) continue;
    visited[i] = true;
    const segment = segments[i];
    const line: Vec2[] = [segment.start, segment.end];

    let next = findNext(segment.end, i);
    while (next) {
      const [idx, point] = next;
      visited[idx] = true;
      line.push(point);
      next = findNext(point, idx);
    }

    let prev = findNext(segment.start, i);
    while (prev) {
      const [idx, point] = prev;
      visited[idx] = true;
      line.unshift(point);
      prev = findNext(point, idx);
    }

    const trimmed = trimLineToPolygon(line, polygon, edges);
    if (trimmed.length >= 2) {
      const smoothed = smoothLine(trimmed);
      const jitterSeed = levelSeed ^ ((i + 1) * 0x45d9f3b);
      const jittered = perturbLine(smoothed, polygon, options, jitterSeed);
      const finalLine = trimLineToPolygon(jittered, polygon, edges);
      if (finalLine.length >= 2) {
        lines.push(finalLine);
      }
    }
  }

  return lines;
};

const trimLineToPolygon = (line: Vec2[], polygon: Vec2[], edges: PolygonEdge[]): Vec2[] => {
  if (line.length === 0) {
    return line;
  }
  return line.filter((point) => {
    if (pointInPolygon(point, polygon)) {
      return true;
    }
    const dist = distanceToEdges(point, edges);
    return dist <= 1.5;
  });
};

const distanceToEdges = (point: Vec2, edges: PolygonEdge[]): number => {
  let minDist = Infinity;
  for (const edge of edges) {
    const dist = distanceToSegment(point, edge.a, edge.b);
    if (dist < minDist) {
      minDist = dist;
    }
  }
  return minDist === Infinity ? 0 : minDist;
};

const distanceToSegment = (point: Vec2, a: Vec2, b: Vec2): number => {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const lengthSq = abx * abx + aby * aby;
  if (lengthSq < EPSILON) {
    return Math.hypot(point.x - a.x, point.y - a.y);
  }
  let t = ((point.x - a.x) * abx + (point.y - a.y) * aby) / lengthSq;
  t = Math.max(0, Math.min(1, t));
  const projX = a.x + abx * t;
  const projY = a.y + aby * t;
  return Math.hypot(point.x - projX, point.y - projY);
};

const buildEdges = (polygon: Vec2[]): PolygonEdge[] => {
  const edges: PolygonEdge[] = [];
  for (let i = 0; i < polygon.length; i += 1) {
    edges.push({ a: polygon[i], b: polygon[(i + 1) % polygon.length] });
  }
  return edges;
};

const interpolateEdge = (
  a: Vec2,
  b: Vec2,
  valueA: number,
  valueB: number,
  level: number
): Vec2 | null => {
  const denom = valueB - valueA;
  if (Math.abs(denom) < EPSILON) {
    return null;
  }
  const t = (level - valueA) / denom;
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
  };
};

const clampInt = (value: number, min: number, max: number): number => {
  return Math.max(min, Math.min(max, value));
};

const pointsClose = (a: Vec2, b: Vec2): boolean => {
  return Math.hypot(a.x - b.x, a.y - b.y) < 0.5;
};

const smoothLine = (points: Vec2[]): Vec2[] => {
  if (points.length < 3) {
    return points;
  }
  const factor = 0.3;
  const smoothed: Vec2[] = [points[0]];
  for (let i = 1; i < points.length - 1; i += 1) {
    const prev = points[i - 1];
    const curr = points[i];
    const next = points[i + 1];
    smoothed.push({
      x: curr.x * (1 - factor) + ((prev.x + next.x) * factor) / 2,
      y: curr.y * (1 - factor) + ((prev.y + next.y) * factor) / 2,
    });
  }
  smoothed.push(points[points.length - 1]);
  return smoothed;
};

const warpPoint = (
  point: Vec2,
  bounds: ShapeDefinition['bounds'],
  options: OrganicContourOptions
): Vec2 => {
  if (options.variance <= 0.02) {
    return point;
  }
  const warpScale = 1 / Math.max(options.spacing * 3, 24);
  const warpStrength = options.spacing * (0.35 + options.variance * 1.1);
  const offsetX = fbm2(
    (point.x - bounds.minX) * warpScale,
    (point.y - bounds.minY) * warpScale,
    options.seed ^ 0x1f54d3b5,
    2,
    2.2,
    0.55
  );
  const offsetY = fbm2(
    (point.x - bounds.minX + 133.7) * warpScale,
    (point.y - bounds.minY - 97.3) * warpScale,
    options.seed ^ 0x23ad5b9d,
    2,
    2.2,
    0.55
  );
  return {
    x: point.x + offsetX * warpStrength,
    y: point.y + offsetY * warpStrength,
  };
};

const perturbLine = (
  points: Vec2[],
  polygon: Vec2[],
  options: OrganicContourOptions,
  seed: number
): Vec2[] => {
  if (points.length < 2 || options.variance <= 0.02) {
    return points;
  }
  const jitterScale = 1 / Math.max(options.spacing * 1.8, 14);
  const normalStrength = options.spacing * (0.12 + options.variance * 0.6);
  const tangentStrength = normalStrength * 0.4;
  return points.map((point, index) => {
    const prev = points[Math.max(0, index - 1)];
    const next = points[Math.min(points.length - 1, index + 1)];
    const tangent = normalise({ x: next.x - prev.x, y: next.y - prev.y });
    const normal = { x: -tangent.y, y: tangent.x };
    const noiseN = fbm2(
      point.x * jitterScale,
      point.y * jitterScale,
      seed ^ 0x6d2b79f5,
      3,
      2.1,
      0.55
    );
    const noiseT = fbm2(
      point.x * (jitterScale * 1.25),
      point.y * (jitterScale * 1.25),
      seed ^ 0x51f15af1,
      2,
      2.05,
      0.5
    );
    return {
      x: point.x + normal.x * noiseN * normalStrength + tangent.x * noiseT * tangentStrength,
      y: point.y + normal.y * noiseN * normalStrength + tangent.y * noiseT * tangentStrength,
    };
  });
};

const normalise = (vec: Vec2): Vec2 => {
  const len = Math.hypot(vec.x, vec.y);
  if (len < EPSILON) {
    return { x: 1, y: 0 };
  }
  return { x: vec.x / len, y: vec.y / len };
};
