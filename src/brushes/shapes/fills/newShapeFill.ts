import type { ShapeFillParams, Point } from './types';

type Bounds = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
};

type DistanceGrid = {
  values: Float32Array;
  cols: number;
  rows: number;
  resolution: number;
  originX: number;
  originY: number;
  maxDistance: number;
};

type Segment = [Point, Point];

const EPSILON = 1e-6;

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));
const MIN_CONTOUR_SPACING = 4;

const createPrng = (seed: number): (() => number) => {
  let state = seed >>> 0 || 1;
  return () => {
    state += 0x6d2b79f5;
    let result = Math.imul(state ^ (state >>> 15), 1 | state);
    result ^= result + Math.imul(result ^ (result >>> 7), 61 | result);
    return ((result ^ (result >>> 14)) >>> 0) / 4294967296;
  };
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
  return {
    minX,
    minY,
    maxX,
    maxY,
  };
};

const hashVertices = (vertices: readonly Point[]): number => {
  return vertices.reduce((acc, point) => (
    (acc * 1664525 + Math.floor(point.x * 3.7) + Math.floor(point.y * 5.3)) >>> 0
  ), 2166136261);
};

const centroidOf = (vertices: readonly Point[]): Point => {
  if (!vertices.length) {
    return { x: 0, y: 0 };
  }
  let sumX = 0;
  let sumY = 0;
  vertices.forEach(vertex => {
    sumX += vertex.x;
    sumY += vertex.y;
  });
  return {
    x: sumX / vertices.length,
    y: sumY / vertices.length,
  };
};

const isPointInsidePolygon = (point: Point, vertices: readonly Point[]): boolean => {
  let inside = false;
  for (let i = 0, j = vertices.length - 1; i < vertices.length; j = i++) {
    const xi = vertices[i].x;
    const yi = vertices[i].y;
    const xj = vertices[j].x;
    const yj = vertices[j].y;
    const intersects = yi > point.y !== yj > point.y
      && point.x < ((xj - xi) * (point.y - yi)) / (yj - yi + EPSILON) + xi;
    if (intersects) {
      inside = !inside;
    }
  }
  return inside;
};

const distanceToSegment = (point: Point, a: Point, b: Point): number => {
  const vx = b.x - a.x;
  const vy = b.y - a.y;
  const lenSq = vx * vx + vy * vy;
  if (lenSq < EPSILON) {
    return Math.hypot(point.x - a.x, point.y - a.y);
  }
  let t = ((point.x - a.x) * vx + (point.y - a.y) * vy) / lenSq;
  t = clamp(t, 0, 1);
  const projX = a.x + vx * t;
  const projY = a.y + vy * t;
  return Math.hypot(point.x - projX, point.y - projY);
};

const minimumEdgeDistance = (point: Point, vertices: readonly Point[]): number => {
  if (vertices.length < 2) {
    return 0;
  }
  let minDistance = Infinity;
  for (let i = 0; i < vertices.length; i += 1) {
    const a = vertices[i];
    const b = vertices[(i + 1) % vertices.length];
    const distance = distanceToSegment(point, a, b);
    if (distance < minDistance) {
      minDistance = distance;
    }
  }
  return minDistance;
};

const pickInteriorSeedPoint = (
  vertices: readonly Point[],
  bounds: Bounds,
  random: () => number,
): Point => {
  const base = centroidOf(vertices);
  const boundsWidth = bounds.maxX - bounds.minX;
  const boundsHeight = bounds.maxY - bounds.minY;
  let bestPoint = base;
  let bestScore = isPointInsidePolygon(base, vertices) ? minimumEdgeDistance(base, vertices) : -1;

  const attempts = Math.max(16, Math.min(64, vertices.length * 4));
  for (let i = 0; i < attempts; i += 1) {
    const candidate = {
      x: bounds.minX + random() * boundsWidth,
      y: bounds.minY + random() * boundsHeight,
    };
    if (!isPointInsidePolygon(candidate, vertices)) {
      continue;
    }
    const margin = minimumEdgeDistance(candidate, vertices);
    if (margin > bestScore + 0.5) {
      bestPoint = candidate;
      bestScore = margin;
    }
    if (bestScore >= Math.min(boundsWidth, boundsHeight) * 0.25) {
      break;
    }
  }

  if (bestScore < 0) {
    const fallback = vertices[0] ?? { x: bounds.minX, y: bounds.minY };
    return fallback;
  }
  return bestPoint;
};

const evaluateEdgeIntersection = (
  a: { diff: number; x: number; y: number },
  b: { diff: number; x: number; y: number },
  edge: number,
): { point: Point; edge: number } | null => {
  const diffA = a.diff;
  const diffB = b.diff;
  if (Math.abs(diffA) < EPSILON && Math.abs(diffB) < EPSILON) {
    return null;
  }
  if (Math.abs(diffA) < EPSILON) {
    return { point: { x: a.x, y: a.y }, edge };
  }
  if (Math.abs(diffB) < EPSILON) {
    return { point: { x: b.x, y: b.y }, edge };
  }
  if ((diffA < 0 && diffB > 0) || (diffA > 0 && diffB < 0)) {
    const denom = diffB - diffA;
    const t = denom === 0 ? 0.5 : clamp(-diffA / denom, 0, 1);
    return {
      point: {
        x: a.x + (b.x - a.x) * t,
        y: a.y + (b.y - a.y) * t,
      },
      edge,
    };
  }
  return null;
};

const marchIsoSegments = (grid: DistanceGrid, level: number): Segment[] => {
  const segments: Segment[] = [];
  const { values, cols, rows, resolution, originX, originY } = grid;

  for (let row = 0; row < rows - 1; row += 1) {
    const y0 = originY + row * resolution;
    const y1 = y0 + resolution;
    for (let col = 0; col < cols - 1; col += 1) {
      const x0 = originX + col * resolution;
      const x1 = x0 + resolution;

      const tl = values[row * cols + col];
      const tr = values[row * cols + col + 1];
      const bl = values[(row + 1) * cols + col];
      const br = values[(row + 1) * cols + col + 1];

      const diffTL = tl - level;
      const diffTR = tr - level;
      const diffBR = br - level;
      const diffBL = bl - level;

      const hasPositive = diffTL > 0 || diffTR > 0 || diffBR > 0 || diffBL > 0;
      const hasNegative = diffTL < 0 || diffTR < 0 || diffBR < 0 || diffBL < 0;

      if (!hasPositive || !hasNegative) {
        continue;
      }

      const corners = [
        { diff: diffTL, x: x0, y: y0 },
        { diff: diffTR, x: x1, y: y0 },
        { diff: diffBR, x: x1, y: y1 },
        { diff: diffBL, x: x0, y: y1 },
      ];

      const edgePoints = [
        evaluateEdgeIntersection(corners[0], corners[1], 0),
        evaluateEdgeIntersection(corners[1], corners[2], 1),
        evaluateEdgeIntersection(corners[2], corners[3], 2),
        evaluateEdgeIntersection(corners[3], corners[0], 3),
      ].filter((entry): entry is { point: Point; edge: number } => Boolean(entry));

      if (edgePoints.length === 2) {
        segments.push([edgePoints[0].point, edgePoints[1].point]);
      } else if (edgePoints.length === 4) {
        const centerValue = (tl + tr + br + bl) * 0.25 - level;
        if (centerValue > 0) {
          segments.push([edgePoints[0].point, edgePoints[3].point]);
          segments.push([edgePoints[1].point, edgePoints[2].point]);
        } else {
          segments.push([edgePoints[0].point, edgePoints[1].point]);
          segments.push([edgePoints[2].point, edgePoints[3].point]);
        }
      } else if (edgePoints.length > 1) {
        for (let i = 0; i < edgePoints.length - 1; i += 2) {
          const a = edgePoints[i];
          const b = edgePoints[i + 1];
          if (a && b) {
            segments.push([a.point, b.point]);
          }
        }
      }
    }
  }

  return segments;
};

const connectSegmentsToLoops = (segments: Segment[], tolerance: number): Point[][] => {
  if (!segments.length) {
    return [];
  }

  const loops: Point[][] = [];
  const used = new Uint8Array(segments.length);

  const distance = (a: Point, b: Point): number => Math.hypot(a.x - b.x, a.y - b.y);

  for (let startIndex = 0; startIndex < segments.length; startIndex += 1) {
    if (used[startIndex]) {
      continue;
    }
    const loop: Point[] = [
      { ...segments[startIndex][0] },
      { ...segments[startIndex][1] },
    ];
    used[startIndex] = 1;

    let extended = true;
    while (extended) {
      extended = false;
      const tail = loop[loop.length - 1];
      for (let segIndex = 0; segIndex < segments.length; segIndex += 1) {
        if (used[segIndex]) {
          continue;
        }
        const [a, b] = segments[segIndex];
        const distA = distance(tail, a);
        const distB = distance(tail, b);
        if (distA <= tolerance) {
          loop.push({ ...b });
          used[segIndex] = 1;
          extended = true;
          break;
        }
        if (distB <= tolerance) {
          loop.push({ ...a });
          used[segIndex] = 1;
          extended = true;
          break;
        }
      }
    }

    if (loop.length < 3) {
      continue;
    }

    const first = loop[0];
    const last = loop[loop.length - 1];
    if (distance(first, last) > tolerance) {
      loop.push({ ...first });
    } else {
      loop[loop.length - 1] = { ...first };
    }

    if (loop.length >= 4) {
      loops.push(loop);
    }
  }

  return loops;
};

const smoothClosedLoop = (loop: Point[], iterations: number, strength: number): Point[] => {
  if (iterations <= 0 || loop.length < 5 || strength <= 0) {
    return loop;
  }

  const closedLoop = loop.slice(0, loop.length - 1);
  let points = closedLoop.map(point => ({ ...point }));
  const alpha = clamp(strength, 0, 1);

  for (let iter = 0; iter < iterations; iter += 1) {
    const next: Point[] = new Array(points.length);
    for (let i = 0; i < points.length; i += 1) {
      const prev = points[(i - 1 + points.length) % points.length];
      const curr = points[i];
      const following = points[(i + 1) % points.length];
      next[i] = {
        x: curr.x * (1 - alpha) + (prev.x + following.x) * (alpha * 0.5),
        y: curr.y * (1 - alpha) + (prev.y + following.y) * (alpha * 0.5),
      };
    }
    points = next;
  }

  const result = points.slice();
  result.push({ ...points[0] });
  return result;
};

const runInDeviceSpace = (ctx: CanvasRenderingContext2D, fn: () => void): void => {
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  try {
    fn();
  } finally {
    ctx.restore();
  }
};

const toDeviceSpaceVertices = (
  ctx: CanvasRenderingContext2D,
  vertices: readonly Point[],
): Point[] => {
  const transform = ctx.getTransform();

  return vertices.map(vertex => ({
    x: vertex.x * transform.a + vertex.y * transform.c + transform.e,
    y: vertex.x * transform.b + vertex.y * transform.d + transform.f,
  }));
};

const clipToPolygon = (ctx: CanvasRenderingContext2D, vertices: readonly Point[]): void => {
  ctx.beginPath();
  ctx.moveTo(vertices[0].x, vertices[0].y);
  for (let i = 1; i < vertices.length; i += 1) {
    ctx.lineTo(vertices[i].x, vertices[i].y);
  }
  ctx.closePath();
  ctx.clip();
};

const buildDistanceGrid = (
  vertices: readonly Point[],
  bounds: Bounds,
  resolution: number,
  margin: number,
  seed: number,
): DistanceGrid => {
  const width = bounds.maxX - bounds.minX;
  const height = bounds.maxY - bounds.minY;
  const originX = bounds.minX - margin;
  const originY = bounds.minY - margin;
  const cols = Math.max(2, Math.ceil((width + margin * 2) / resolution) + 1);
  const rows = Math.max(2, Math.ceil((height + margin * 2) / resolution) + 1);
  const values = new Float32Array(cols * rows);

  const rng = createPrng(seed || 1);
  const noiseScale = Math.max(0.0001, resolution * 0.35);

  let maxDistance = 0;

  for (let row = 0; row < rows; row += 1) {
    const y = originY + row * resolution;
    for (let col = 0; col < cols; col += 1) {
      const x = originX + col * resolution;
      const index = row * cols + col;
      const samplePoint = { x, y };
      const inside = isPointInsidePolygon(samplePoint, vertices);
      const edgeDistance = minimumEdgeDistance(samplePoint, vertices);
      if (inside) {
        const noise = (rng() - 0.5) * noiseScale;
        const value = Math.max(0, edgeDistance + noise);
        values[index] = value;
        if (value > maxDistance) {
          maxDistance = value;
        }
      } else {
        values[index] = -edgeDistance;
      }
    }
  }

  return {
    values,
    cols,
    rows,
    resolution,
    originX,
    originY,
    maxDistance,
  };
};

export const drawNewShapeFill = ({
  ctx,
  vertices,
  brushSettings,
  isPreview = false,
  options,
}: ShapeFillParams): void => {
  const {
    spacingOverride,
    randomSeed,
    previewDetail = 'full',
    strokeColorOverride,
  } = options ?? {};
  if (vertices.length < 3) {
    return;
  }

  const deviceVertices = toDeviceSpaceVertices(ctx, vertices);
  const bounds = computeBounds(deviceVertices);

  const spacingSetting = spacingOverride ?? brushSettings.contourSpacing ?? 6;
  const baseSpacing = clamp(spacingSetting, 2, 240);
  const previewMultiplier = isPreview ? (previewDetail === 'minimal' ? 1.8 : 1.3) : 1;
  const spacing = baseSpacing * previewMultiplier;

  if (!Number.isFinite(spacing) || spacing <= 0) {
    console.warn('Invalid contour spacing, skipping render', { spacing, spacingSetting });
    return;
  }

  const varianceSetting = brushSettings.contourVariance ?? 0;
  const variance = clamp(varianceSetting > 1 ? varianceSetting / 10 : varianceSetting, 0, 1);
  const smoothnessSetting = brushSettings.contourSmoothness ?? 0;
  const smoothness = clamp(smoothnessSetting > 1 ? smoothnessSetting / 5 : smoothnessSetting, 0, 1);
  const pixelMode = brushSettings.shapeFillPixelMode ?? true;
  const lineWidth = Math.max(0.3, brushSettings.shapeFillLineWidth ?? 1.25);

  const polygonHash = hashVertices(deviceVertices);
  const seed = (randomSeed ?? polygonHash) >>> 0;
  const random = createPrng(seed || 1);

  const center = pickInteriorSeedPoint(deviceVertices, bounds, random);
  const margin = Math.max(spacing * 2, 24);
  const resolution = Math.max(1, Math.round(Math.max(spacing / 2.5, 2)));
  const grid = buildDistanceGrid(deviceVertices, bounds, resolution, margin, seed);

  if (grid.maxDistance < spacing * 0.75) {
    console.warn('Shape too small for contour spacing', {
      maxDistance: grid.maxDistance,
      spacing,
    });
    return;
  }

  let effectiveSpacing = spacing;
  let baseLevels = effectiveSpacing > 0 ? Math.floor(grid.maxDistance / effectiveSpacing) : 0;
  if (baseLevels < 1) {
    effectiveSpacing = Math.max(MIN_CONTOUR_SPACING, grid.maxDistance / 4);
    baseLevels = effectiveSpacing > 0 ? Math.floor(grid.maxDistance / effectiveSpacing) : 0;
  }

  if (baseLevels < 1) {
    console.warn('Insufficient contour levels for spacing', {
      spacing,
      adjustedSpacing: effectiveSpacing,
      maxDistance: grid.maxDistance,
    });
    return;
  }

  const desiredLevels = isPreview && previewDetail === 'minimal'
    ? Math.max(1, Math.ceil(baseLevels * 0.6))
    : baseLevels;
  const levelLimit = Math.min(64, desiredLevels);

  const tolerance = Math.max(resolution * 1.5, effectiveSpacing * 0.4);
  const loops: Point[][] = [];

  for (let levelIndex = 1; levelIndex <= levelLimit; levelIndex += 1) {
    let radius = effectiveSpacing * levelIndex;
    if (variance > 0) {
      const jitter = random() * 2 - 1;
      radius *= 1 + jitter * variance;
    }
    if (radius <= 0 || radius >= grid.maxDistance) {
      continue;
    }

    const segments = marchIsoSegments(grid, radius);
    if (!segments.length) {
      continue;
    }

    const rawLoops = connectSegmentsToLoops(segments, tolerance);
    if (!rawLoops.length) {
      continue;
    }

    const smoothingIterations = smoothness > 0.75 ? 2 : smoothness > 0.35 ? 1 : 0;
    rawLoops.forEach(loop => {
      if (loop.length < 4) {
        return;
      }
      const smoothed = smoothingIterations > 0
        ? smoothClosedLoop(loop, smoothingIterations, smoothness)
        : loop;
      loops.push(smoothed);
    });
  }

  if (!loops.length) {
    console.warn('No contour loops generated', {
      spacing,
      maxDistance: grid.maxDistance,
      center,
      previewDetail,
    });
    return;
  }

  const strokeColor = strokeColorOverride ?? brushSettings.color ?? '#1a1a1a';
  const opacity = clamp(brushSettings.opacity ?? 1, 0, 1);
  const compositeOperation = brushSettings.blendMode || 'source-over';

  runInDeviceSpace(ctx, () => {
    ctx.save();
    ctx.globalAlpha = opacity;
    ctx.globalCompositeOperation = compositeOperation;
    ctx.imageSmoothingEnabled = !pixelMode;
    ctx.lineJoin = smoothness > 0.6 ? 'round' : 'miter';
    ctx.lineCap = 'round';
    ctx.lineWidth = lineWidth;
    ctx.strokeStyle = strokeColor;

    clipToPolygon(ctx, deviceVertices);

    loops.forEach(loop => {
      ctx.beginPath();
      ctx.moveTo(loop[0].x, loop[0].y);
      for (let i = 1; i < loop.length; i += 1) {
        ctx.lineTo(loop[i].x, loop[i].y);
      }
      ctx.stroke();
    });

    ctx.restore();
  });

  console.log('Rendered contour loops with custom distance field', {
    loopCount: loops.length,
    spacing: effectiveSpacing,
    variance,
    smoothness,
    resolution,
    center,
    maxDistance: grid.maxDistance,
    seed,
  });
};

export const computeNewShapeFillCenter = (
  vertices: readonly Point[],
  randomSeed?: number,
): Point => {
  if (vertices.length < 3) {
    return centroidOf(vertices);
  }

  const bounds = computeBounds(vertices);
  const hash = hashVertices(vertices);
  const seed = (randomSeed ?? hash) >>> 0;
  const random = createPrng(seed || 1);
  return pickInteriorSeedPoint(vertices, bounds, random);
};
