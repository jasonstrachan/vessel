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

const distanceToSegmentSquared = (point: Vec2, a: Vec2, b: Vec2): number => {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;

  if (lenSq === 0) {
    const diffX = point.x - a.x;
    const diffY = point.y - a.y;
    return diffX * diffX + diffY * diffY;
  }

  const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lenSq));
  const projX = a.x + t * dx;
  const projY = a.y + t * dy;
  const diffX = point.x - projX;
  const diffY = point.y - projY;
  return diffX * diffX + diffY * diffY;
};

const distanceToPolygon = (point: Vec2, vertices: Vec2[]): number => {
  let minDistSq = Infinity;
  for (let index = 0; index < vertices.length; index += 1) {
    const next = (index + 1) % vertices.length;
    const segmentDistSq = distanceToSegmentSquared(point, vertices[index], vertices[next]);
    if (segmentDistSq < minDistSq) {
      minDistSq = segmentDistSq;
    }
  }
  return Math.sqrt(minDistSq);
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

const createDeterministicRng = (seed: number): (() => number) => {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const computePolygonCentroid = (vertices: Vec2[]): Vec2 => {
  let areaAcc = 0;
  let cxAcc = 0;
  let cyAcc = 0;

  for (let index = 0; index < vertices.length; index += 1) {
    const current = vertices[index];
    const next = vertices[(index + 1) % vertices.length];
    const cross = current.x * next.y - next.x * current.y;
    areaAcc += cross;
    cxAcc += (current.x + next.x) * cross;
    cyAcc += (current.y + next.y) * cross;
  }

  const area = areaAcc * 0.5;
  if (Math.abs(area) < 1e-9) {
    return vertices[0];
  }

  const factor = 1 / (6 * area);
  return {
    x: cxAcc * factor,
    y: cyAcc * factor,
  };
};

const sampleInteriorPoint = (
  vertices: Vec2[],
  bounds: BoundingBox,
  rng: () => number,
): Vec2 => {
  const spanX = Math.max(1e-6, bounds.maxX - bounds.minX);
  const spanY = Math.max(1e-6, bounds.maxY - bounds.minY);
  const attemptCount = Math.max(36, vertices.length * 8);
  const centroid = computePolygonCentroid(vertices);
  const preferEdgeRoll = rng();
  const preferEdge = preferEdgeRoll < 0.35;
  const centerPower = 0.9 + rng() * 1.1;
  const edgePower = 0.6 + rng() * 1.3;
  const extent = Math.max(spanX, spanY) * 0.5;
  const distanceNormalizer = Math.max(1e-6, extent);

  let bestCandidate: Vec2 | null = null;
  let bestScore = -Infinity;

  for (let attempt = 0; attempt < attemptCount; attempt += 1) {
    const candidate = {
      x: bounds.minX + rng() * spanX,
      y: bounds.minY + rng() * spanY,
    };
    if (!isPointInsidePolygon(candidate, vertices)) {
      continue;
    }

    const distance = distanceToPolygon(candidate, vertices);
    const normalized = Math.max(0, Math.min(1, distance / distanceNormalizer));
    const preference = preferEdge
      ? Math.pow(1 - normalized, edgePower)
      : Math.pow(normalized, centerPower);
    const jitter = preferEdge
      ? 0.75 + rng() * 0.9
      : 0.95 + rng() * 0.5;
    const score = preference * jitter;
    if (score > bestScore) {
      bestScore = score;
      bestCandidate = candidate;
    }
  }

  if (bestCandidate) {
    if (preferEdge) {
      const direction = {
        x: bestCandidate.x - centroid.x,
        y: bestCandidate.y - centroid.y,
      };
      const length = Math.hypot(direction.x, direction.y);
      if (length > 1e-5) {
        const pushFactor = 1 + Math.min(0.4, rng() * 0.5);
        const pushed = {
          x: centroid.x + (direction.x / length) * length * pushFactor,
          y: centroid.y + (direction.y / length) * length * pushFactor,
        };
        if (isPointInsidePolygon(pushed, vertices)) {
          bestCandidate = pushed;
        }
      }
    }
    return bestCandidate;
  }

  if (preferEdge) {
    for (let attempt = 0; attempt < vertices.length; attempt += 1) {
      const index = Math.floor(rng() * vertices.length);
      const a = vertices[index];
      const b = vertices[(index + 1) % vertices.length];
      const edgeT = 0.05 + rng() * 0.9;
      const edgePoint = {
        x: a.x + (b.x - a.x) * edgeT,
        y: a.y + (b.y - a.y) * edgeT,
      };
      const mix = 0.75 + rng() * 0.2;
      const candidate = {
        x: centroid.x + (edgePoint.x - centroid.x) * mix,
        y: centroid.y + (edgePoint.y - centroid.y) * mix,
      };
      if (isPointInsidePolygon(candidate, vertices)) {
        return candidate;
      }
    }
  }

  if (isPointInsidePolygon(centroid, vertices)) {
    return centroid;
  }

  return vertices[0];
};

const applyContourCenterBias = (
  fieldData: ReturnType<typeof buildSignedDistanceField>,
  bounds: BoundingBox,
  center: Vec2,
  spacing: number,
  rng: () => number,
  vertices: Vec2[],
) => {
  const boundaryDistance = distanceToPolygon(center, vertices);
  const maxReach = Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY);
  const maxRadius = Math.max(spacing, maxReach * 0.5);
  const edgeFactor = Math.max(0, 1 - boundaryDistance / Math.max(spacing * 2, maxRadius));
  const amplitudeBase = spacing * (0.45 + rng() * 1.05);
  const amplitude = Math.max(spacing * 0.25, amplitudeBase + edgeFactor * spacing * (0.5 + rng() * 0.6));
  const falloffBase = 1.1 + rng() * 1.1;
  const falloffPower = falloffBase + edgeFactor * (0.8 + rng() * 0.6);

  for (let row = 0; row < fieldData.rows; row += 1) {
    const y = bounds.minY - fieldData.extension + row * fieldData.resolution;
    for (let col = 0; col < fieldData.cols; col += 1) {
      const value = fieldData.field[row][col];
      if (value <= 0) {
        continue;
      }

      const x = bounds.minX - fieldData.extension + col * fieldData.resolution;
      const dx = x - center.x;
      const dy = y - center.y;
      const distance = Math.hypot(dx, dy);
      const normalised = Math.max(0, 1 - distance / (maxRadius + 1e-6));
      if (normalised <= 0) {
        continue;
      }

      const bias = amplitude * normalised ** falloffPower;
      fieldData.field[row][col] = value + bias;
    }
  }
};

const buildSignedDistanceField = (
  vertices: Vec2[],
  bounds: BoundingBox,
  fieldResolution: number,
  extension: number,
) => {
  const width = Math.max(1, Math.ceil((bounds.maxX - bounds.minX) + extension * 2));
  const height = Math.max(1, Math.ceil((bounds.maxY - bounds.minY) + extension * 2));
  const cols = Math.ceil(width / fieldResolution);
  const rows = Math.ceil(height / fieldResolution);
  const field: number[][] = new Array(rows);

  for (let row = 0; row < rows; row += 1) {
    const y = bounds.minY - extension + row * fieldResolution;
    const rowData: number[] = new Array(cols);
    for (let col = 0; col < cols; col += 1) {
      const x = bounds.minX - extension + col * fieldResolution;
      const point = { x, y };
      const inside = isPointInsidePolygon(point, vertices);
      if (inside) {
        rowData[col] = distanceToPolygon(point, vertices);
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

const resolveFieldExtension = (
  bounds: BoundingBox,
  spacing: number,
  maxDistance?: number,
  override?: number,
): number => {
  if (override != null) {
    return Math.max(0, override);
  }

  const spanX = bounds.maxX - bounds.minX;
  const spanY = bounds.maxY - bounds.minY;
  const maxSpan = Math.max(spanX, spanY);
  const effectiveMaxDistance = typeof maxDistance === 'number' && Number.isFinite(maxDistance) && maxDistance > 0
    ? maxDistance
    : Math.max(maxSpan * 0.5, spacing);
  const padding = Math.max(spacing * 4, effectiveMaxDistance + spacing * 2);
  return Math.min(DEFAULT_EXTENSION, Math.max(16, padding));
};

const smoothField = (field: number[][], rows: number, cols: number, passes: number) => {
  for (let pass = 0; pass < passes; pass += 1) {
    const next = field.map(row => row.slice());
    for (let y = 0; y < rows; y += 1) {
      for (let x = 0; x < cols; x += 1) {
        const value = field[y][x];
        const sign = value >= 0;
        let sum = 0;
        let count = 0;
        for (let dy = -1; dy <= 1; dy += 1) {
          const ny = y + dy;
          if (ny < 0 || ny >= rows) continue;
          for (let dx = -1; dx <= 1; dx += 1) {
            const nx = x + dx;
            if (nx < 0 || nx >= cols) continue;
            const neighbor = field[ny][nx];
            if ((neighbor >= 0) === sign) {
              sum += neighbor;
              count += 1;
            }
          }
        }
        if (count > 0) {
          next[y][x] = sum / count;
        }
      }
    }
    for (let y = 0; y < rows; y += 1) {
      for (let x = 0; x < cols; x += 1) {
        field[y][x] = next[y][x];
      }
    }
  }
};

const marchingSquares = (
  field: number[][],
  cols: number,
  rows: number,
  resolution: number,
  extension: number,
  boundsMin: Vec2,
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
      const baseX = boundsMin.x - extension + x * resolution;
      const baseY = boundsMin.y - extension + y * resolution;

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

const removeDuplicatePoints = (loop: Vec2[], epsilon = 0.1): Vec2[] => {
  if (loop.length <= 2) {
    return loop;
  }

  const filtered: Vec2[] = [];
  for (let index = 0; index < loop.length; index += 1) {
    const point = loop[index];
    const prev = filtered[filtered.length - 1] ?? loop[(index + loop.length - 1) % loop.length];
    if (Math.hypot(point.x - prev.x, point.y - prev.y) > epsilon) {
      filtered.push(point);
    }
  }

  if (filtered.length > 1) {
    const first = filtered[0];
    const last = filtered[filtered.length - 1];
    if (Math.hypot(first.x - last.x, first.y - last.y) <= epsilon) {
      filtered.pop();
    }
  }

  return filtered;
};

const smoothLoop = (loop: Vec2[], iterations = 2, alpha = 0.25): Vec2[] => {
  let current = loop.slice();
  for (let pass = 0; pass < iterations; pass += 1) {
    const next: Vec2[] = new Array(current.length);
    for (let index = 0; index < current.length; index += 1) {
      const prev = current[(index + current.length - 1) % current.length];
      const point = current[index];
      const nextPoint = current[(index + 1) % current.length];
      const weight = 1 - alpha * 2;
      next[index] = {
        x: point.x * weight + alpha * (prev.x + nextPoint.x),
        y: point.y * weight + alpha * (prev.y + nextPoint.y),
      };
    }
    current = next;
  }
  return current;
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

  const spacing = Math.max(0.5, params.spacing);
  const extension = resolveFieldExtension(bounds, spacing, params.maxDistance, params.extension);
  const field = buildSignedDistanceField(
    vertices,
    bounds,
    Math.max(0.5, params.fieldResolution || 2),
    extension,
  );

  smoothField(field.field, field.rows, field.cols, 2);
  const seed = (params.randomSeed ?? Math.floor(Math.random() * 0xffffffff)) >>> 0;
  const rng = createDeterministicRng(seed || 1);
  const biasCenter = sampleInteriorPoint(vertices, bounds, rng);
  applyContourCenterBias(field, bounds, biasCenter, spacing, rng, vertices);
  const smoothingAlpha = 0.1 + (1 - Math.min(1, Math.max(0, params.variance))) * 0.25;
  const smoothingIterations = params.variance > 0.6 ? 2 : 3;

  let maxDistance = 0;
  for (let row = 0; row < field.rows; row += 1) {
    for (let col = 0; col < field.cols; col += 1) {
      const value = field.field[row][col];
      if (value > maxDistance) {
        maxDistance = value;
      }
    }
  }
  const maxDistanceLimit = Number.isFinite(params.maxDistance) ? params.maxDistance : maxDistance;
  const clampedMaxDistance = Math.max(spacing, Math.min(maxDistanceLimit, maxDistance));

  const loops: ContourGeometryLoop[] = [];
  let geomMinX = Infinity;
  let geomMinY = Infinity;
  let geomMaxX = -Infinity;
  let geomMaxY = -Infinity;
  let currentDistance = spacing;
  let levelIndex = 0;

  while (currentDistance <= clampedMaxDistance + 1e-3) {
      const segments = marchingSquares(
        field.field,
        field.cols,
        field.rows,
        field.resolution,
        field.extension,
        { x: bounds.minX, y: bounds.minY },
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

      const cleaned = removeDuplicatePoints(loop);
      if (cleaned.length < 3) {
        continue;
      }

      const smoothed = smoothLoop(cleaned, smoothingIterations, smoothingAlpha);
      const centroidAccumulator = smoothed.reduce<Vec2>(
        (acc, point) => ({ x: acc.x + point.x, y: acc.y + point.y }),
        { x: 0, y: 0 },
      );
      const centroid = {
        x: centroidAccumulator.x / smoothed.length,
        y: centroidAccumulator.y / smoothed.length,
      };

      if (!isPointInsidePolygon(centroid, vertices)) {
        continue;
      }

      const buffer = new Float32Array(smoothed.length * 2);
      for (let index = 0; index < smoothed.length; index += 1) {
        const point = smoothed[index];
        buffer[index * 2] = point.x;
        buffer[index * 2 + 1] = point.y;
        if (point.x < geomMinX) geomMinX = point.x;
        if (point.y < geomMinY) geomMinY = point.y;
        if (point.x > geomMaxX) geomMaxX = point.x;
        if (point.y > geomMaxY) geomMaxY = point.y;
      }

      loops.push({
        levelIndex,
        points: buffer,
      });
    }

    currentDistance += spacing;
    levelIndex += 1;
  }

  if (loops.length === 0) {
    const buffer = new Float32Array(vertices.length * 2);
    geomMinX = Infinity;
    geomMinY = Infinity;
    geomMaxX = -Infinity;
    geomMaxY = -Infinity;
    for (let index = 0; index < vertices.length; index += 1) {
      const point = vertices[index];
      buffer[index * 2] = point.x;
      buffer[index * 2 + 1] = point.y;
      if (point.x < geomMinX) geomMinX = point.x;
      if (point.y < geomMinY) geomMinY = point.y;
      if (point.x > geomMaxX) geomMaxX = point.x;
      if (point.y > geomMaxY) geomMaxY = point.y;
    }
    loops.push({
      levelIndex: 0,
      points: buffer,
    });
  }

  const resolvedBounds = geomMinX === Infinity
    ? bounds
    : {
        minX: geomMinX,
        minY: geomMinY,
        maxX: geomMaxX,
        maxY: geomMaxY,
      };

  return {
    loops,
    bounds: resolvedBounds,
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
