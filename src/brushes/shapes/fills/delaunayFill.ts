import type { ShapeFillParams, Point } from './types';

type Bounds = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
};

type Triangle = [number, number, number];
type Edge = [number, number];

const EPSILON = 1e-6;

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

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
  return { minX, minY, maxX, maxY };
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

const runInDeviceSpace = (ctx: CanvasRenderingContext2D, fn: () => void): void => {
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  try {
    fn();
  } finally {
    ctx.restore();
  }
};

// Bowyer-Watson Delaunay triangulation
const circumcircleContains = (
  a: Point,
  b: Point,
  c: Point,
  p: Point,
): boolean => {
  const ax = a.x - p.x;
  const ay = a.y - p.y;
  const bx = b.x - p.x;
  const by = b.y - p.y;
  const cx = c.x - p.x;
  const cy = c.y - p.y;

  const det = (ax * ax + ay * ay) * (bx * cy - cx * by)
    - (bx * bx + by * by) * (ax * cy - cx * ay)
    + (cx * cx + cy * cy) * (ax * by - bx * ay);

  return det > 0.0001;
};

const delaunayTriangulate = (points: Point[]): Triangle[] => {
  if (points.length < 3) {
    return [];
  }

  // Create super-triangle encompassing all points
  const bounds = computeBounds(points);
  const delta = Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY) * 4;
  const superTriangle: Point[] = [
    { x: bounds.minX - delta, y: bounds.minY - delta },
    { x: (bounds.minX + bounds.maxX) * 0.5, y: bounds.maxY + delta },
    { x: bounds.maxX + delta, y: bounds.minY - delta },
  ];

  const allPoints = [...superTriangle, ...points];
  const triangles: Triangle[] = [[0, 1, 2]];

  // Add each point and retriangulate
  for (let pIndex = 3; pIndex < allPoints.length; pIndex += 1) {
    const point = allPoints[pIndex];
    const badTriangles: Set<number> = new Set();
    const edges: Edge[] = [];

    // Find triangles whose circumcircle contains the point
    triangles.forEach((tri, idx) => {
      const a = allPoints[tri[0]];
      const b = allPoints[tri[1]];
      const c = allPoints[tri[2]];
      if (circumcircleContains(a, b, c, point)) {
        badTriangles.add(idx);
        edges.push([tri[0], tri[1]]);
        edges.push([tri[1], tri[2]]);
        edges.push([tri[2], tri[0]]);
      }
    });

    // Find unique edges (edges that appear only once)
    const edgeCounts = new Map<string, number>();
    edges.forEach(edge => {
      const [a, b] = edge;
      const key = a < b ? `${a}-${b}` : `${b}-${a}`;
      edgeCounts.set(key, (edgeCounts.get(key) || 0) + 1);
    });

    const uniqueEdges: Edge[] = [];
    edges.forEach(edge => {
      const [a, b] = edge;
      const key = a < b ? `${a}-${b}` : `${b}-${a}`;
      if (edgeCounts.get(key) === 1) {
        uniqueEdges.push(edge);
      }
    });

    // Remove bad triangles and add new ones
    const newTriangles = triangles.filter((_, idx) => !badTriangles.has(idx));
    uniqueEdges.forEach(edge => {
      newTriangles.push([edge[0], edge[1], pIndex]);
    });

    triangles.length = 0;
    triangles.push(...newTriangles);
  }

  // Filter out triangles that use super-triangle vertices
  return triangles.filter(tri => tri[0] >= 3 && tri[1] >= 3 && tri[2] >= 3);
};

const generateDelaunaySeeds = (
  vertices: readonly Point[],
  bounds: Bounds,
  options: {
    cellSize: number;
    minSpacing: number;
    jitter: number;
    maxSeeds: number;
    seed: number;
  },
): Point[] => {
  const random = createPrng(options.seed);
  const seeds: Point[] = [];
  const minSpacingSq = options.minSpacing * options.minSpacing;

  const maxIterations = options.maxSeeds * 40;
  let iterations = 0;

  while (seeds.length < options.maxSeeds && iterations < maxIterations) {
    iterations += 1;

    // Generate random candidate point
    const r1 = random();
    const r2 = random();
    let candidate = {
      x: bounds.minX + r1 * (bounds.maxX - bounds.minX),
      y: bounds.minY + r2 * (bounds.maxY - bounds.minY),
    };

    // Apply jitter
    if (options.jitter > 0) {
      const jitter = (random() - 0.5) * options.cellSize * options.jitter;
      candidate = {
        x: candidate.x + jitter,
        y: candidate.y + jitter * 0.3,
      };
    }

    // Check if point is inside polygon
    if (!isPointInsidePolygon(candidate, vertices)) {
      continue;
    }

    // Check minimum spacing from existing seeds
    let farEnough = true;
    for (const seed of seeds) {
      const dx = seed.x - candidate.x;
      const dy = seed.y - candidate.y;
      if (dx * dx + dy * dy < minSpacingSq) {
        farEnough = false;
        break;
      }
    }

    if (!farEnough) {
      continue;
    }

    seeds.push(candidate);
  }

  return seeds;
};

export const drawDelaunayFill = ({
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

  // Parameters
  const cellSizeSetting = spacingOverride ?? brushSettings.contourSpacing ?? 20;
  const cellSize = clamp(cellSizeSetting, 5, 200);
  const previewMultiplier = isPreview ? (previewDetail === 'minimal' ? 2 : 1.5) : 1;
  const effectiveCellSize = cellSize * previewMultiplier;

  const minSpacing = effectiveCellSize * 0.5;
  const jitter = brushSettings.contourVariance ?? 0.3;
  const maxSeeds = isPreview && previewDetail === 'minimal' ? 100 : 300;
  const seed = randomSeed ?? Date.now();

  // Generate seeds and triangulate
  const seeds = generateDelaunaySeeds(deviceVertices, bounds, {
    cellSize: effectiveCellSize,
    minSpacing,
    jitter: clamp(jitter, 0, 1),
    maxSeeds,
    seed,
  });

  if (seeds.length < 3) {
    return;
  }

  const triangles = delaunayTriangulate(seeds);

  if (triangles.length === 0) {
    return;
  }

  // Render settings
  const strokeColor = strokeColorOverride ?? brushSettings.color ?? '#1a1a1a';
  const opacity = clamp(brushSettings.opacity ?? 1, 0, 1);
  const compositeOperation = brushSettings.blendMode || 'source-over';
  const pixelMode = brushSettings.shapeFillPixelMode ?? true;
  const lineWidth = Math.max(0.3, brushSettings.shapeFillLineWidth ?? 1.25);

  runInDeviceSpace(ctx, () => {
    ctx.save();
    ctx.globalAlpha = opacity;
    ctx.globalCompositeOperation = compositeOperation;
    ctx.imageSmoothingEnabled = !pixelMode;
    ctx.lineJoin = 'miter';
    ctx.lineCap = 'round';
    ctx.lineWidth = lineWidth;
    ctx.strokeStyle = strokeColor;

    clipToPolygon(ctx, deviceVertices);

    // Draw triangle edges (offset by 3 for super-triangle)
    const allPoints = [...seeds];
    ctx.beginPath();
    triangles.forEach(tri => {
      const a = allPoints[tri[0] - 3];
      const b = allPoints[tri[1] - 3];
      const c = allPoints[tri[2] - 3];

      if (!a || !b || !c) return;

      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.lineTo(c.x, c.y);
      ctx.closePath();
    });
    ctx.stroke();

    ctx.restore();
  });
};
