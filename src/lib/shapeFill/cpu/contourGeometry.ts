import type { BoundingBox, StrokeJob } from '@/lib/shapeFill/types';

export type ContourGeometryLoop = {
  levelIndex: number;
  points: Float32Array;
};

export type ContourGeometry = {
  loops: ContourGeometryLoop[];
  bounds: BoundingBox;
};

export interface ContourGeometryParams {
  spacing: number;
  maxDistance: number;
  variance: number;
  fieldResolution: number;
  randomSeed?: number;
  extension?: number;
}

type Vec2 = { x: number; y: number };

const DEFAULT_EXTENSION = 256;

const toPoints = (vertices: readonly Vec2[] | Float32Array): Vec2[] => {
  if (vertices instanceof Float32Array) {
    const out: Vec2[] = [];
    for (let index = 0; index < vertices.length; index += 2) {
      out.push({ x: vertices[index], y: vertices[index + 1] });
    }
    return out;
  }
  return vertices.map(vertex => ({ x: vertex.x, y: vertex.y }));
};

const computeBounds = (points: Vec2[]): BoundingBox => {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const point of points) {
    if (point.x < minX) minX = point.x;
    if (point.y < minY) minY = point.y;
    if (point.x > maxX) maxX = point.x;
    if (point.y > maxY) maxY = point.y;
  }

  return {
    minX,
    minY,
    maxX,
    maxY,
  };
};

const distanceToSegment = (point: Vec2, a: Vec2, b: Vec2): number => {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;

  if (lenSq === 0) {
    return Math.hypot(point.x - a.x, point.y - a.y);
  }

  const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lenSq));
  const projX = a.x + t * dx;
  const projY = a.y + t * dy;
  return Math.hypot(point.x - projX, point.y - projY);
};

const distanceToPolygon = (point: Vec2, vertices: Vec2[]): number => {
  let minDist = Infinity;
  for (let index = 0; index < vertices.length; index += 1) {
    const next = (index + 1) % vertices.length;
    const segmentDist = distanceToSegment(point, vertices[index], vertices[next]);
    if (segmentDist < minDist) {
      minDist = segmentDist;
    }
  }
  return minDist;
};

const isPointInsidePolygon = (point: Vec2, vertices: Vec2[]): boolean => {
  let inside = false;
  const count = vertices.length;
  for (let i = 0, j = count - 1; i < count; j = i++) {
    const xi = vertices[i].x;
    const yi = vertices[i].y;
    const xj = vertices[j].x;
    const yj = vertices[j].y;

    const intersects = yi > point.y !== yj > point.y
      && point.x < ((xj - xi) * (point.y - yi)) / (yj - yi + 1e-9) + xi;
    if (intersects) {
      inside = !inside;
    }
  }
  return inside;
};

const seededRandom = (seed: number | undefined) => {
  if (typeof seed !== 'number') {
    return Math.random;
  }
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
};

const buildSignedDistanceField = (
  vertices: Vec2[],
  bounds: BoundingBox,
  fieldResolution: number,
  extension: number,
  random: () => number,
) => {
  const width = Math.max(1, Math.ceil((bounds.maxX - bounds.minX) + extension * 2));
  const height = Math.max(1, Math.ceil((bounds.maxY - bounds.minY) + extension * 2));
  const cols = Math.ceil(width / fieldResolution);
  const rows = Math.ceil(height / fieldResolution);
  const field: number[][] = new Array(rows);

  let sumX = 0;
  let sumY = 0;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const vertex of vertices) {
    sumX += vertex.x;
    sumY += vertex.y;
    if (vertex.x < minX) minX = vertex.x;
    if (vertex.y < minY) minY = vertex.y;
    if (vertex.x > maxX) maxX = vertex.x;
    if (vertex.y > maxY) maxY = vertex.y;
  }

  const centerX = sumX / vertices.length;
  const centerY = sumY / vertices.length;
  const polyWidth = Math.max(1, maxX - minX);
  const polyHeight = Math.max(1, maxY - minY);

  const offsetX = (random() - 0.5) * polyWidth * 1.2;
  const offsetY = (random() - 0.5) * polyHeight * 1.2;
  const peakX = centerX + offsetX;
  const peakY = centerY + offsetY;
  const maxPossible = Math.max(polyWidth, polyHeight);

  for (let row = 0; row < rows; row += 1) {
    const y = bounds.minY - extension + row * fieldResolution;
    const rowData: number[] = new Array(cols);
    for (let col = 0; col < cols; col += 1) {
      const x = bounds.minX - extension + col * fieldResolution;
      const point = { x, y };
      const inside = isPointInsidePolygon(point, vertices);
      if (inside) {
        const edgeDist = distanceToPolygon(point, vertices);
        const peakDist = Math.hypot(x - peakX, y - peakY);
        const normalizedPeak = peakDist / maxPossible;
        const peakInfluence = Math.exp(-normalizedPeak * normalizedPeak * 8);
        const elevation = edgeDist + edgeDist * peakInfluence * 0.8;
        rowData[col] = elevation;
      } else {
        rowData[col] = -distanceToPolygon(point, vertices);
      }
    }
    field[row] = rowData;
  }

  return {
    field,
    rows,
    cols,
    resolution: fieldResolution,
    extension,
  };
};

const marchingSquares = (
  field: number[][],
  cols: number,
  rows: number,
  resolution: number,
  extension: number,
  targetDistance: number,
) => {
  const segments: Array<[Vec2, Vec2]> = [];

  for (let y = 0; y < rows - 1; y += 1) {
    for (let x = 0; x < cols - 1; x += 1) {
      const tl = field[y][x];
      const tr = field[y][x + 1];
      const br = field[y + 1][x + 1];
      const bl = field[y + 1][x];

      const above = tl >= targetDistance;
      const right = tr >= targetDistance;
      const below = br >= targetDistance;
      const left = bl >= targetDistance;

      const mask = (above ? 8 : 0) | (right ? 4 : 0) | (below ? 2 : 0) | (left ? 1 : 0);
      if (mask === 0 || mask === 15) {
        continue;
      }

      const points: Vec2[] = [];
      const baseX = x * resolution - extension;
      const baseY = y * resolution - extension;

      const interpolate = (a: number, b: number, axis: 'x' | 'y', offset: number) => {
        if (Math.abs(a - b) < 1e-6) {
          return offset + resolution * 0.5;
        }
        const t = Math.max(0, Math.min(1, (targetDistance - a) / (b - a)));
        return axis === 'x'
          ? offset + t * resolution
          : offset + (1 - t) * resolution;
      };

      if (above !== right) {
        const px = interpolate(tl, tr, 'x', baseX);
        points.push({ x: px, y: baseY });
      }
      if (right !== below) {
        const py = interpolate(tr, br, 'y', baseY);
        points.push({ x: baseX + resolution, y: py });
      }
      if (below !== left) {
        const px = interpolate(bl, br, 'x', baseX);
        points.push({ x: px, y: baseY + resolution });
      }
      if (left !== above) {
        const py = interpolate(tl, bl, 'y', baseY);
        points.push({ x: baseX, y: py });
      }

      if (points.length === 2) {
        segments.push([points[0], points[1]]);
      } else if (points.length === 4) {
        segments.push([points[0], points[3]]);
        segments.push([points[1], points[2]]);
      }
    }
  }

  return segments;
};

const connectSegments = (segments: Array<[Vec2, Vec2]>) => {
  if (!segments.length) {
    return [] as Vec2[][];
  }

  const tolerance = 2.5;
  const loops: Vec2[][] = [];
  const used = new Array(segments.length).fill(false);

  for (let startIndex = 0; startIndex < segments.length; startIndex += 1) {
    if (used[startIndex]) {
      continue;
    }

    const loop: Vec2[] = [segments[startIndex][0], segments[startIndex][1]];
    used[startIndex] = true;

    let extended = true;
    while (extended) {
      extended = false;
      const tail = loop[loop.length - 1];

      let bestMatch = -1;
      let bestUseFirst = true;
      let bestDistance = Infinity;

      for (let segIndex = 0; segIndex < segments.length; segIndex += 1) {
        if (used[segIndex]) {
          continue;
        }

        const [a, b] = segments[segIndex];
        const distanceA = Math.hypot(tail.x - a.x, tail.y - a.y);
        const distanceB = Math.hypot(tail.x - b.x, tail.y - b.y);

        if (distanceA < bestDistance && distanceA <= tolerance) {
          bestMatch = segIndex;
          bestUseFirst = false;
          bestDistance = distanceA;
        }
        if (distanceB < bestDistance && distanceB <= tolerance) {
          bestMatch = segIndex;
          bestUseFirst = true;
          bestDistance = distanceB;
        }
      }

      if (bestMatch !== -1) {
        const [a, b] = segments[bestMatch];
        loop.push(bestUseFirst ? a : b);
        used[bestMatch] = true;
        extended = true;
      }
    }

    if (loop.length > 2) {
      const first = loop[0];
      const last = loop[loop.length - 1];
      const dist = Math.hypot(first.x - last.x, first.y - last.y);
      if (dist <= tolerance * 2) {
        if (dist <= tolerance * 0.5) {
          loop.pop();
        }
        loops.push(loop);
      }
    }
  }

  return loops;
};

export const computeContoursCPU = (
  job: StrokeJob,
  bounds: BoundingBox,
  params: ContourGeometryParams,
): ContourGeometry => {
  const vertices = toPoints(job.vertices);
  if (vertices.length < 3) {
    return { loops: [], bounds };
  }

  const random = seededRandom(params.randomSeed);
  const extension = Math.max(0, params.extension ?? DEFAULT_EXTENSION);
  const field = buildSignedDistanceField(
    vertices,
    bounds,
    Math.max(0.5, params.fieldResolution || 2),
    extension,
    random,
  );

  let maxDistance = 0;
  for (let row = 0; row < field.rows; row += 1) {
    for (let col = 0; col < field.cols; col += 1) {
      const value = field.field[row][col];
      if (value > maxDistance) {
        maxDistance = value;
      }
    }
  }
  const clampedMaxDistance = Math.min(Math.max(params.maxDistance, params.spacing), maxDistance);
  const spacing = Math.max(0.5, params.spacing);

  const loops: ContourGeometryLoop[] = [];
  let currentDistance = spacing;
  let levelIndex = 0;

  while (currentDistance <= clampedMaxDistance + 1e-3) {
    const segments = marchingSquares(
      field.field,
      field.cols,
      field.rows,
      field.resolution,
      field.extension,
      currentDistance,
    );

    if (segments.length === 0) {
      currentDistance += spacing;
      levelIndex += 1;
      continue;
    }

    const connected = connectSegments(segments);
    for (const loop of connected) {
      if (loop.length < 3) {
        continue;
      }

      const buffer = new Float32Array(loop.length * 2);
      for (let index = 0; index < loop.length; index += 1) {
        buffer[index * 2] = loop[index].x;
        buffer[index * 2 + 1] = loop[index].y;
      }

      loops.push({
        levelIndex,
        points: buffer,
      });
    }

    currentDistance += spacing;
    levelIndex += 1;
  }

  return {
    loops,
    bounds,
  };
};

export const rasterizeContoursCPU = (
  ctx: CanvasRenderingContext2D,
  geometry: ContourGeometry,
  strokeColor: string,
  lineWidth: number,
  pixelMode: boolean,
) => {
  if (!geometry.loops.length) {
    return;
  }

  const snap = pixelMode
    ? (value: number) => Math.round(value)
    : (value: number) => value;

  ctx.save();
  ctx.strokeStyle = strokeColor;
  ctx.lineWidth = lineWidth;
  ctx.imageSmoothingEnabled = !pixelMode;

  for (const loop of geometry.loops) {
    const { points } = loop;
    if (points.length < 6) {
      continue;
    }
    ctx.beginPath();
    ctx.moveTo(snap(points[0]), snap(points[1]));
    for (let index = 2; index < points.length; index += 2) {
      ctx.lineTo(snap(points[index]), snap(points[index + 1]));
    }
    ctx.closePath();
    ctx.stroke();
  }

  ctx.restore();
};

