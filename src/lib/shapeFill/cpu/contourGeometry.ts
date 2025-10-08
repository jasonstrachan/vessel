import type { BoundingBox } from '../types';

export interface ContourPoint {
  x: number;
  y: number;
}

export interface SignedDistanceFieldResult {
  field: number[][];
  cols: number;
  rows: number;
  resolution: number;
  extension: number;
  bounds: BoundingBox;
  peak: { x: number; y: number };
  peakX: number;
  peakY: number;
}

export interface ContourFieldOptions {
  canvasWidth: number;
  canvasHeight: number;
  resolution?: number;
  extension?: number;
  seed?: number;
}

const FRACT = (value: number): number => value - Math.floor(value);

const seededRandom = (seed: number, index: number): number => {
  const n = seed * 0.3183099 + index * 0.3678794;
  return FRACT(Math.sin(n) * 43758.5453);
};

const distanceToSegment = (point: ContourPoint, a: ContourPoint, b: ContourPoint): number => {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  let t = 0;
  if (lenSq > 0) {
    t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lenSq));
  }
  const projX = a.x + t * dx;
  const projY = a.y + t * dy;
  const distX = point.x - projX;
  const distY = point.y - projY;
  return Math.hypot(distX, distY);
};

const isPointInPolygon = (point: ContourPoint, vertices: readonly ContourPoint[]): boolean => {
  let inside = false;
  for (let i = 0, j = vertices.length - 1; i < vertices.length; j = i++) {
    const xi = vertices[i].x;
    const yi = vertices[i].y;
    const xj = vertices[j].x;
    const yj = vertices[j].y;
    const intersects = yi > point.y !== yj > point.y
      && point.x < ((xj - xi) * (point.y - yi)) / (yj - yi) + xi;
    if (intersects) {
      inside = !inside;
    }
  }
  return inside;
};

export const createSignedDistanceField = (
  vertices: readonly ContourPoint[],
  {
    canvasWidth,
    canvasHeight,
    resolution = 2,
    extension = 300,
    seed = 0,
  }: ContourFieldOptions,
): SignedDistanceFieldResult => {
  const cols = Math.ceil((canvasWidth + extension * 2) / resolution);
  const rows = Math.ceil((canvasHeight + extension * 2) / resolution);
  const field: number[][] = new Array(rows);

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let sumX = 0;
  let sumY = 0;

  vertices.forEach(vertex => {
    minX = Math.min(minX, vertex.x);
    minY = Math.min(minY, vertex.y);
    maxX = Math.max(maxX, vertex.x);
    maxY = Math.max(maxY, vertex.y);
    sumX += vertex.x;
    sumY += vertex.y;
  });

  const centerX = sumX / vertices.length;
  const centerY = sumY / vertices.length;
  const spanX = Math.max(1e-6, maxX - minX);
  const spanY = Math.max(1e-6, maxY - minY);

  const offset = (index: number) => seededRandom(seed, index) - 0.5;
  const peakX = centerX + offset(0) * spanX * 1.2;
  const peakY = centerY + offset(1) * spanY * 1.2;
  const maxSpan = Math.max(spanX, spanY);

  for (let row = 0; row < rows; row += 1) {
    field[row] = new Array(cols);
    for (let col = 0; col < cols; col += 1) {
      const px = col * resolution - extension;
      const py = row * resolution - extension;
      const point = { x: px, y: py };
      if (isPointInPolygon(point, vertices)) {
        const edgeDist = vertices.length > 1
          ? vertices.reduce((acc, vertex, index) => (
              Math.min(acc, distanceToSegment(point, vertex, vertices[(index + 1) % vertices.length]))
            ), Infinity)
          : 0;
        const peakDist = Math.hypot(px - peakX, py - peakY);
        const normalized = peakDist / maxSpan;
        const peakInfluence = Math.exp(-normalized * normalized * 8);
        field[row][col] = edgeDist + edgeDist * peakInfluence * 0.8;
      } else {
        const outsideDist = vertices.length > 1
          ? vertices.reduce((acc, vertex, index) => (
              Math.min(acc, distanceToSegment(point, vertex, vertices[(index + 1) % vertices.length]))
            ), Infinity)
          : 0;
        field[row][col] = -outsideDist;
      }
    }
  }

  const bounds: BoundingBox = {
    minX: minX - extension,
    minY: minY - extension,
    maxX: maxX + extension,
    maxY: maxY + extension,
  };

  return {
    field,
    cols,
    rows,
    resolution,
    extension,
    bounds,
    peak: { x: peakX, y: peakY },
    peakX,
    peakY,
  };
};

const smoothMix = (t: number, smoothness: number): number => {
  const s = Math.min(Math.max(smoothness, 0), 1);
  const cubic = t * t * (3 - 2 * t);
  return t * (1 - s) + cubic * s;
};

const interpolate = (
  a: ContourPoint,
  b: ContourPoint,
  va: number,
  vb: number,
  target: number,
  smoothness: number,
): ContourPoint => {
  const denom = Math.max(Math.abs(vb - va), 1e-6);
  let t = (target - va) / denom;
  t = smoothMix(Math.min(Math.max(t, 0), 1), smoothness);
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
  };
};

export const extractContourSegments = (
  sdf: SignedDistanceFieldResult,
  targetDistance: number,
  smoothness = 0,
): Array<[ContourPoint, ContourPoint]> => {
  const segments: Array<[ContourPoint, ContourPoint]> = [];
  const { field, rows, cols, resolution, extension } = sdf;

  for (let row = 0; row < rows - 1; row += 1) {
    for (let col = 0; col < cols - 1; col += 1) {
      const tl = field[row][col];
      const tr = field[row][col + 1];
      const br = field[row + 1][col + 1];
      const bl = field[row + 1][col];
      if (Math.max(tl, tr, br, bl) < 0) {
        continue;
      }
      const min = Math.min(tl, tr, br, bl);
      const max = Math.max(tl, tr, br, bl);
      if (min > targetDistance || max < targetDistance) {
        continue;
      }

      const cellOriginX = col * resolution - extension;
      const cellOriginY = row * resolution - extension;
      const points: ContourPoint[] = [];

      const topA = { x: cellOriginX, y: cellOriginY };
      const topB = { x: cellOriginX + resolution, y: cellOriginY };
      const rightA = topB;
      const rightB = { x: topB.x, y: topB.y + resolution };
      const bottomA = { x: cellOriginX + resolution, y: cellOriginY + resolution };
      const bottomB = { x: cellOriginX, y: cellOriginY + resolution };
      const leftA = bottomB;
      const leftB = topA;

      if ((tl - targetDistance) * (tr - targetDistance) < 0) {
        points.push(interpolate(topA, topB, tl, tr, targetDistance, smoothness));
      }
      if ((tr - targetDistance) * (br - targetDistance) < 0) {
        points.push(interpolate(rightA, rightB, tr, br, targetDistance, smoothness));
      }
      if ((br - targetDistance) * (bl - targetDistance) < 0) {
        points.push(interpolate(bottomA, bottomB, br, bl, targetDistance, smoothness));
      }
      if ((bl - targetDistance) * (tl - targetDistance) < 0) {
        points.push(interpolate(leftA, leftB, bl, tl, targetDistance, smoothness));
      }

      if (points.length === 2) {
        segments.push([points[0], points[1]]);
      } else if (points.length === 4) {
        const config = [
          tl > targetDistance ? 1 : 0,
          tr > targetDistance ? 1 : 0,
          br > targetDistance ? 1 : 0,
          bl > targetDistance ? 1 : 0,
        ].join('');
        if (config === '0110' || config === '1001') {
          segments.push([points[0], points[3]]);
          segments.push([points[1], points[2]]);
        } else {
          segments.push([points[0], points[1]]);
          segments.push([points[2], points[3]]);
        }
      }
    }
  }

  return segments;
};

export const connectContourSegments = (
  segments: Array<[ContourPoint, ContourPoint]>,
  tolerance = 3,
): ContourPoint[][] => {
  if (segments.length === 0) {
    return [];
  }

  const loops: ContourPoint[][] = [];
  const used = new Array(segments.length).fill(false);

  for (let i = 0; i < segments.length; i += 1) {
    if (used[i]) {
      continue;
    }
    const loop: ContourPoint[] = [segments[i][0], segments[i][1]];
    used[i] = true;

    let searching = true;
    while (searching) {
      searching = false;
      const tail = loop[loop.length - 1];
      let best = -1;
      let bestDistance = Infinity;
      let appendStart = false;

      for (let j = 0; j < segments.length; j += 1) {
        if (used[j]) {
          continue;
        }
        const [a, b] = segments[j];
        const distA = Math.hypot(a.x - tail.x, a.y - tail.y);
        if (distA < tolerance && distA < bestDistance) {
          bestDistance = distA;
          best = j;
          appendStart = false;
        }
        const distB = Math.hypot(b.x - tail.x, b.y - tail.y);
        if (distB < tolerance && distB < bestDistance) {
          bestDistance = distB;
          best = j;
          appendStart = true;
        }
      }

      if (best !== -1) {
        const [a, b] = segments[best];
        loop.push(appendStart ? a : b);
        used[best] = true;
        searching = true;
      }
    }

    if (loop.length > 3) {
      const first = loop[0];
      const last = loop[loop.length - 1];
      const closingDistance = Math.hypot(first.x - last.x, first.y - last.y);
      if (closingDistance < tolerance * 2) {
        if (closingDistance < tolerance / 2) {
          loop.pop();
        }
      }
      if (loop.length > 3) {
        loops.push(loop);
      }
    }
  }

  return loops;
};

export interface ContourLevelConfig {
  spacing: number;
  variance: number;
  smoothness: number;
  maxLevels: number;
  maxDistance: number;
  seed: number;
}

export interface ContourLoopResult {
  level: number;
  distance: number;
  loop: ContourPoint[];
}

export const generateContourLoops = (
  sdf: SignedDistanceFieldResult,
  config: ContourLevelConfig,
): ContourLoopResult[] => {
  const loops: ContourLoopResult[] = [];
  const { spacing, variance, smoothness, maxLevels, maxDistance, seed } = config;
  for (let index = 0; index < maxLevels; index += 1) {
    const base = spacing * (index + 1);
    if (base > maxDistance) {
      break;
    }
    let distance = base;
    if (variance > 1e-4) {
      const jitter = seededRandom(seed, index + 2) * 2 - 1;
      distance = Math.max(0, base * (1 + jitter * variance));
    }
    const segments = extractContourSegments(sdf, distance, smoothness);
    const connected = connectContourSegments(segments);
    connected.forEach(loop => {
      loops.push({ level: index, distance, loop });
    });
  }
  return loops;
};
