import type { BoundingBox } from '../types';

export interface ContourPoint {
  x: number;
  y: number;
}

export type Point = ContourPoint;

export interface ScalarGrid {
  values: Float32Array;
  cols: number;
  rows: number;
  resolution: number;
  originX: number;
  originY: number;
}

export interface SignedDistanceFieldResult {
  grid: ScalarGrid;
  bounds: BoundingBox;
  margin: number;
  seed: number;
}

export interface ContourFieldOptions {
  canvasWidth: number;
  canvasHeight: number;
  resolution?: number;
  margin?: number;
  seed?: number;
}

type Segment = [ContourPoint, ContourPoint];

type Bounds = { minX: number; minY: number; maxX: number; maxY: number; };

const FRACT = (value: number): number => value - Math.floor(value);

const seededRandom = (seed: number, index: number): number => {
  const n = seed * 0.3183099 + index * 0.3678794;
  return FRACT(Math.sin(n) * 43758.5453);
};

const clamp = (value: number, min: number, max: number): number => {
  if (value < min) {
    return min;
  }
  if (value > max) {
    return max;
  }
  return value;
};

const mulberry32 = (seed: number): (() => number) => {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let x = Math.imul(t ^ (t >>> 15), t | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
};

const smoothMix = (t: number, smoothness: number): number => {
  const s = clamp(smoothness, 0, 1);
  const cubic = t * t * (3 - 2 * t);
  return t * (1 - s) + cubic * s;
};

const isPointInsidePolygon = (point: Point, vertices: readonly Point[]): boolean => {
  let inside = false;
  for (let i = 0, j = vertices.length - 1; i < vertices.length; j = i++) {
    const xi = vertices[i].x;
    const yi = vertices[i].y;
    const xj = vertices[j].x;
    const yj = vertices[j].y;
    const intersects = (yi > point.y) !== (yj > point.y)
      && point.x < ((xj - xi) * (point.y - yi)) / (yj - yi + 1e-6) + xi;
    if (intersects) {
      inside = !inside;
    }
  }
  return inside;
};

const computeBounds = (vertices: readonly Point[]): Bounds => {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  vertices.forEach(vertex => {
    if (vertex.x < minX) minX = vertex.x;
    if (vertex.y < minY) minY = vertex.y;
    if (vertex.x > maxX) maxX = vertex.x;
    if (vertex.y > maxY) maxY = vertex.y;
  });
  return { minX, minY, maxX, maxY };
};

const computeCentroid = (vertices: readonly Point[]): Point => {
  let sumX = 0;
  let sumY = 0;
  const count = vertices.length;
  if (count === 0) {
    return { x: 0, y: 0 };
  }
  vertices.forEach(vertex => {
    sumX += vertex.x;
    sumY += vertex.y;
  });
  return {
    x: sumX / count,
    y: sumY / count,
  };
};

const generateRbfSeeds = (
  vertices: readonly Point[],
  bounds: Bounds,
  seed: number,
  desiredCount: number,
): { seeds: Point[]; weights: number[] } => {
  const seeds: Point[] = [];
  const weights: number[] = [];
  const rng = mulberry32(seed);
  const centroid = computeCentroid(vertices);
  if (isPointInsidePolygon(centroid, vertices)) {
    seeds.push({ ...centroid });
    weights.push(1.25);
  }

  const maxAttempts = 256;
  let attempts = 0;
  while (seeds.length < desiredCount && attempts < maxAttempts) {
    attempts += 1;
    const x = bounds.minX + (bounds.maxX - bounds.minX) * rng();
    const y = bounds.minY + (bounds.maxY - bounds.minY) * rng();
    const candidate = { x, y };
    if (!isPointInsidePolygon(candidate, vertices)) {
      continue;
    }
    seeds.push(candidate);
    weights.push(0.85 + rng() * 0.8);
  }

  if (seeds.length < 3) {
    seeds.push({ x: bounds.minX, y: bounds.minY });
    seeds.push({ x: bounds.maxX, y: bounds.maxY });
    weights.push(0.9, 0.9);
  }

  return { seeds, weights };
};

const buildScalarFieldRBF = (
  vertices: readonly Point[],
  bounds: Bounds,
  resolution: number,
  margin: number,
  seeds: Point[],
  sigmaPx: number,
  noiseAmt = 0.05,
  weights?: number[],
): ScalarGrid => {
  const width = bounds.maxX - bounds.minX;
  const height = bounds.maxY - bounds.minY;
  const originX = bounds.minX - margin;
  const originY = bounds.minY - margin;
  const cols = Math.max(2, Math.ceil((width + margin * 2) / resolution) + 1);
  const rows = Math.max(2, Math.ceil((height + margin * 2) / resolution) + 1);
  const values = new Float32Array(cols * rows);
  const W = weights && weights.length === seeds.length ? weights : seeds.map(() => 1);
  const invTwoSigma2 = 1 / (2 * sigmaPx * sigmaPx + 1e-6);

  const vnoise = (x: number, y: number) => {
    const xi = (x * 0.02) | 0;
    const yi = (y * 0.02) | 0;
    let h = (xi * 374761393 + yi * 668265263) | 0;
    h ^= h >>> 13;
    h = Math.imul(h, 1274126177);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296 - 0.5;
  };

  let uMin = Infinity;
  let uMax = -Infinity;
  for (let r = 0; r < rows; r += 1) {
    const y = originY + r * resolution;
    for (let c = 0; c < cols; c += 1) {
      const x = originX + c * resolution;
      const idx = r * cols + c;
      const p = { x, y };
      if (!isPointInsidePolygon(p, vertices)) {
        values[idx] = NaN;
        continue;
      }

      let u = 0;
      for (let i = 0; i < seeds.length; i += 1) {
        const dx = x - seeds[i].x;
        const dy = y - seeds[i].y;
        u += W[i] * Math.exp(-(dx * dx + dy * dy) * invTwoSigma2);
      }
      u += noiseAmt * vnoise(x, y);
      values[idx] = u;
      if (u < uMin) uMin = u;
      if (u > uMax) uMax = u;
    }
  }

  const scale = uMax > uMin ? 1 / (uMax - uMin) : 1;
  for (let i = 0; i < values.length; i += 1) {
    const value = values[i];
    if (!Number.isNaN(value)) {
      values[i] = (value - uMin) * scale;
    }
  }

  return { values, cols, rows, resolution, originX, originY };
};

const getGridValue = (grid: ScalarGrid, row: number, col: number): number => grid.values[row * grid.cols + col];

const computeContourLevelsPx = (
  grid: ScalarGrid,
  desiredPx: number,
  maxLevels = 48,
): number[] => {
  const spacingPx = clamp(desiredPx, 4, 18);
  const estimatedStep = clamp((grid.resolution / Math.max(spacingPx, 1)) * 0.5, 0.01, 0.12);
  const levels: number[] = [];
  for (let u = estimatedStep; u < 1; u += estimatedStep) {
    levels.push(u);
    if (levels.length >= maxLevels) {
      break;
    }
  }
  return levels;
};

const evaluateEdgeIntersection = (
  a: { diff: number; x: number; y: number },
  b: { diff: number; x: number; y: number },
  smoothness: number,
): ContourPoint | null => {
  const denom = a.diff - b.diff;
  if (Math.abs(denom) < 1e-6) {
    return null;
  }
  const rawT = clamp(a.diff / denom, 0, 1);
  const t = smoothMix(rawT, smoothness);
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
  };
};

export const extractContourSegments = (
  sdf: SignedDistanceFieldResult,
  level: number,
  smoothness = 0,
): Segment[] => {
  const { grid } = sdf;
  const { cols, rows, resolution, originX, originY } = grid;
  const segments: Segment[] = [];

  for (let row = 0; row < rows - 1; row += 1) {
    const y0 = originY + row * resolution;
    const y1 = y0 + resolution;
    for (let col = 0; col < cols - 1; col += 1) {
      const x0 = originX + col * resolution;
      const x1 = x0 + resolution;
      const tl = getGridValue(grid, row, col);
      const tr = getGridValue(grid, row, col + 1);
      const br = getGridValue(grid, row + 1, col + 1);
      const bl = getGridValue(grid, row + 1, col);

      if (
        Number.isNaN(tl)
        || Number.isNaN(tr)
        || Number.isNaN(br)
        || Number.isNaN(bl)
      ) {
        continue;
      }

      const min = Math.min(tl, tr, br, bl);
      const max = Math.max(tl, tr, br, bl);
      if (min > level || max < level) {
        continue;
      }

      const corners = [
        { diff: tl - level, x: x0, y: y0 },
        { diff: tr - level, x: x1, y: y0 },
        { diff: br - level, x: x1, y: y1 },
        { diff: bl - level, x: x0, y: y1 },
      ];
      const intersections: ContourPoint[] = [];

      const top = evaluateEdgeIntersection(corners[0], corners[1], smoothness);
      if (top) intersections.push(top);
      const right = evaluateEdgeIntersection(corners[1], corners[2], smoothness);
      if (right) intersections.push(right);
      const bottom = evaluateEdgeIntersection(corners[2], corners[3], smoothness);
      if (bottom) intersections.push(bottom);
      const left = evaluateEdgeIntersection(corners[3], corners[0], smoothness);
      if (left) intersections.push(left);

      if (intersections.length === 2) {
        segments.push([intersections[0], intersections[1]]);
      } else if (intersections.length === 4) {
        const center = (tl + tr + br + bl) * 0.25 - level;
        if (center > 0) {
          segments.push([intersections[0], intersections[3]]);
          segments.push([intersections[1], intersections[2]]);
        } else {
          segments.push([intersections[0], intersections[1]]);
          segments.push([intersections[2], intersections[3]]);
        }
      }
    }
  }

  return segments;
};

const simplifyRDP = (pts: ContourPoint[], epsilon: number): ContourPoint[] => {
  if (pts.length < 3 || epsilon <= 0) {
    return pts;
  }

  const stack: Array<[number, number]> = [[0, pts.length - 1]];
  const keep = new Uint8Array(pts.length);
  keep[0] = 1;
  keep[pts.length - 1] = 1;

  const perpendicularDistance = (p: ContourPoint, a: ContourPoint, b: ContourPoint): number => {
    const vx = b.x - a.x;
    const vy = b.y - a.y;
    const wx = p.x - a.x;
    const wy = p.y - a.y;
    const denom = vx * vx + vy * vy || 1e-6;
    const c = (vx * wx + vy * wy) / denom;
    const qx = a.x + c * vx;
    const qy = a.y + c * vy;
    return Math.hypot(p.x - qx, p.y - qy);
  };

  while (stack.length) {
    const segment = stack.pop();
    if (!segment) {
      continue;
    }
    const [start, end] = segment;
    let maxDistance = -1;
    let farthestIndex = -1;
    for (let i = start + 1; i < end; i += 1) {
      const distance = perpendicularDistance(pts[i], pts[start], pts[end]);
      if (distance > maxDistance) {
        maxDistance = distance;
        farthestIndex = i;
      }
    }
    if (maxDistance > epsilon && farthestIndex !== -1) {
      keep[farthestIndex] = 1;
      stack.push([start, farthestIndex], [farthestIndex, end]);
    }
  }

  const output: ContourPoint[] = [];
  for (let i = 0; i < pts.length; i += 1) {
    if (keep[i]) {
      output.push(pts[i]);
    }
  }
  return output;
};

const connectSegmentsHash = (segments: Segment[], snapTol: number, minPerimeter = 0): ContourPoint[][] => {
  if (!segments.length) {
    return [];
  }

  const loops: ContourPoint[][] = [];
  const used = new Uint8Array(segments.length);
  const buckets = new Map<number, Array<{ segIndex: number; endIndex: 0 | 1 }>>();
  const snapTol2 = snapTol * snapTol;
  const keyFor = (p: ContourPoint) => {
    const qx = Math.round(p.x / snapTol) & 0xffff;
    const qy = Math.round(p.y / snapTol) & 0xffff;
    return (qx << 16) | qy;
  };

  for (let i = 0; i < segments.length; i += 1) {
    const seg = segments[i];
    const bucketA = keyFor(seg[0]);
    const bucketB = keyFor(seg[1]);
    if (!buckets.has(bucketA)) buckets.set(bucketA, []);
    if (!buckets.has(bucketB)) buckets.set(bucketB, []);
    buckets.get(bucketA)!.push({ segIndex: i, endIndex: 0 });
    buckets.get(bucketB)!.push({ segIndex: i, endIndex: 1 });
  }

  const distance2 = (a: ContourPoint, b: ContourPoint) => {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    return dx * dx + dy * dy;
  };

  for (let s = 0; s < segments.length; s += 1) {
    if (used[s]) {
      continue;
    }

    const seg = segments[s];
    const loop: ContourPoint[] = [{ ...seg[0] }, { ...seg[1] }];
    used[s] = 1;

    let extended = true;
    while (extended) {
      extended = false;
      const tail = loop[loop.length - 1];
      const bucket = buckets.get(keyFor(tail));
      if (!bucket) {
        break;
      }

      for (const candidate of bucket) {
        const idx = candidate.segIndex;
        if (used[idx]) {
          continue;
        }
        const segment = segments[idx];
        const head = candidate.endIndex === 0 ? segment[0] : segment[1];
        if (distance2(tail, head) > snapTol2) {
          continue;
        }
        const other = candidate.endIndex === 0 ? segment[1] : segment[0];
        loop.push({ ...other });
        used[idx] = 1;
        extended = true;
        break;
      }
    }

    let headExtended = true;
    while (headExtended) {
      headExtended = false;
      const head = loop[0];
      const bucket = buckets.get(keyFor(head));
      if (!bucket) {
        break;
      }

      for (const candidate of bucket) {
        const idx = candidate.segIndex;
        if (used[idx]) {
          continue;
        }
        const segment = segments[idx];
        const attachPoint = candidate.endIndex === 0 ? segment[0] : segment[1];
        if (distance2(head, attachPoint) > snapTol2) {
          continue;
        }
        const other = candidate.endIndex === 0 ? segment[1] : segment[0];
        loop.unshift({ ...other });
        used[idx] = 1;
        headExtended = true;
        break;
      }
    }

    if (loop.length >= 3) {
      const first = loop[0];
      const last = loop[loop.length - 1];
      if (distance2(first, last) <= snapTol2) {
        loop[loop.length - 1] = { ...first };
      } else {
        loop.push({ ...first });
      }

      let perimeter = 0;
      for (let i = 1; i < loop.length; i += 1) {
        perimeter += Math.hypot(loop[i].x - loop[i - 1].x, loop[i].y - loop[i - 1].y);
      }

      if (perimeter >= minPerimeter) {
        loops.push(loop);
      }
    }
  }

  return loops;
};

const taubinSmooth = (loop: ContourPoint[], strength: number): ContourPoint[] => {
  if (loop.length < 4 || strength <= 0) {
    return loop;
  }

  const closed = Math.hypot(loop[0].x - loop[loop.length - 1].x, loop[0].y - loop[loop.length - 1].y) < 1e-3;
  const points = closed ? loop.slice(0, loop.length - 1) : loop.slice();
  const count = points.length;
  if (count < 3) {
    return loop;
  }

  const lambda = 0.45 * strength;
  const mu = -0.55 * strength;

  const step = (input: ContourPoint[], factor: number): ContourPoint[] => {
    const output: ContourPoint[] = new Array(count);
    for (let i = 0; i < count; i += 1) {
      const prev = input[(i - 1 + count) % count];
      const curr = input[i];
      const next = input[(i + 1) % count];
      const lx = (prev.x + next.x) * 0.5 - curr.x;
      const ly = (prev.y + next.y) * 0.5 - curr.y;
      output[i] = {
        x: curr.x + factor * lx,
        y: curr.y + factor * ly,
      };
    }
    return output;
  };

  const first = step(points, lambda);
  const second = step(first, mu);
  const result = second;

  if (closed) {
    result.push({ ...result[0] });
  }

  return result;
};

export interface ContourLevelConfig {
  spacing: number;
  variance: number;
  smoothness: number;
  maxLevels: number;
  maxDistance: number; // retained for compatibility, treated as upper bound hint
  seed: number;
}

export interface ContourLoopResult {
  level: number;
  distance: number;
  loop: ContourPoint[];
}

export const connectContourSegments = (
  segments: Segment[],
  tolerance = 3,
  minPerimeter = 0,
): ContourPoint[][] => connectSegmentsHash(segments, tolerance, minPerimeter);

export const createSignedDistanceField = (
  vertices: readonly ContourPoint[],
  {
    canvasWidth,
    canvasHeight,
    resolution = 2,
    margin,
    seed = 0,
  }: ContourFieldOptions,
): SignedDistanceFieldResult => {
  const bounds = computeBounds(vertices);
  const maxCanvas = Math.max(canvasWidth, canvasHeight, 1);
  const baseMargin = margin ?? clamp(Math.max(resolution * 6, Math.min(maxCanvas * 0.12, 160)), resolution * 2, maxCanvas * 0.5);
  const { seeds, weights } = generateRbfSeeds(vertices, bounds, seed >>> 0, 5);
  const sigma = Math.max(Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY) * 0.35, resolution * 6);
  const grid = buildScalarFieldRBF(vertices, bounds, resolution, baseMargin, seeds, sigma, 0.045, weights);

  return {
    grid,
    bounds: {
      minX: bounds.minX - baseMargin,
      minY: bounds.minY - baseMargin,
      maxX: bounds.maxX + baseMargin,
      maxY: bounds.maxY + baseMargin,
    },
    margin: baseMargin,
    seed: seed >>> 0,
  };
};

export const generateContourLoops = (
  field: SignedDistanceFieldResult,
  config: ContourLevelConfig,
): ContourLoopResult[] => {
  const { grid } = field;
  const desiredPx = 6 + ((clamp(config.spacing, 1, 10) - 1) / 9) * 6;
  const levels = computeContourLevelsPx(grid, desiredPx, config.maxLevels);
  if (!levels.length) {
    return [];
  }

  const loops: ContourLoopResult[] = [];
  const snapTol = Math.max(1.25, grid.resolution * 1.2);
  const minPerimeter = Math.max(desiredPx * 0.75, grid.resolution * 4);
  const varianceScale = clamp(config.variance, 0, 10) / 10;
  const smoothStrength = clamp(config.smoothness, 0, 5) / 5;

  for (let i = 0; i < levels.length; i += 1) {
    let level = levels[i];
    if (varianceScale > 1e-4) {
      const jitter = seededRandom(config.seed, i + 17) * 2 - 1;
      level = clamp(level * (1 + jitter * 0.25 * varianceScale), 0.02, 0.98);
    }

    const segments = extractContourSegments(field, level, smoothStrength);
    if (!segments.length) {
      continue;
    }

    const rawLoops = connectSegmentsHash(segments, snapTol, minPerimeter);
    if (!rawLoops.length) {
      continue;
    }

    rawLoops.forEach(loop => {
      if (loop.length < 3) {
        return;
      }
      const simplifyTolerance = Math.max(grid.resolution * 0.65, 0.5);
      const simplified = simplifyRDP(loop, simplifyTolerance);
      const smoothed = smoothStrength > 0 ? taubinSmooth(simplified, smoothStrength) : simplified;
      if (smoothed.length < 3) {
        return;
      }
      loops.push({
        level: i + 1,
        distance: level,
        loop: smoothed,
      });
    });
  }

  return loops;
};
