import type { ContourLinesBasis, ContourLinesStage } from '@/types';

export interface ContourLinePath {
  points: Array<{ x: number; y: number }>;
}

export const MIN_LINE_SPACING = 4;
export const MAX_LINE_SPACING = 160;

export interface Lines2GenerationOptions {
  angle: number;
  convergenceA: Point;
  convergenceB: Point;
  spacing: number;
  density: number;
  alternate: boolean;
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const EPSILON = 1e-5;
const EDGE_TOLERANCE = EPSILON * 100; // More generous tolerance for edge detection
const PARALLEL_TOLERANCE = Math.PI / 12; // 15 degrees

interface Point { x: number; y: number }

const dot = (a: Point, b: Point) => a.x * b.x + a.y * b.y;
const subtract = (a: Point, b: Point): Point => ({ x: a.x - b.x, y: a.y - b.y });

const normalise = (vec: Point): Point => {
  const len = Math.hypot(vec.x, vec.y) || 1;
  return { x: vec.x / len, y: vec.y / len };
};

const angleDiff = (a: number, b: number) => {
  let diff = a - b;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  return Math.abs(diff);
};

const pointOnSegment = (p: Point, a: Point, b: Point, tolerance: number = EDGE_TOLERANCE): boolean => {
  // Improved precision: normalize distances for consistent tolerance checking
  const segLen = Math.hypot(b.x - a.x, b.y - a.y);
  if (segLen < EPSILON) {
    // Degenerate segment - check distance to point a
    return Math.hypot(p.x - a.x, p.y - a.y) < tolerance;
  }
  
  // Check perpendicular distance from point to line
  const cross = (p.y - a.y) * (b.x - a.x) - (p.x - a.x) * (b.y - a.y);
  const perpDist = Math.abs(cross) / segLen;
  if (perpDist > tolerance) return false;
  
  // Check if point is within segment bounds
  const dotProd = (p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y);
  const t = dotProd / (segLen * segLen);
  return t >= -EPSILON && t <= 1 + EPSILON;
};

const pointInPolygon = (point: Point, vertices: Point[]): boolean => {
  // First check if point is on any edge with consistent tolerance
  for (let i = 0; i < vertices.length; i++) {
    const a = vertices[i];
    const b = vertices[(i + 1) % vertices.length];
    if (pointOnSegment(point, a, b)) {
      return true; // Point on boundary is considered inside
    }
  }

  // Ray casting algorithm for interior points
  let inside = false;
  for (let i = 0, j = vertices.length - 1; i < vertices.length; j = i++) {
    const xi = vertices[i].x;
    const yi = vertices[i].y;
    const xj = vertices[j].x;
    const yj = vertices[j].y;

    // Improved: avoid division by near-zero values
    if (Math.abs(yj - yi) < EPSILON) continue;
    
    const intersect = ((yi > point.y) !== (yj > point.y)) &&
      (point.x < ((xj - xi) * (point.y - yi)) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
};

const computeCentroid = (vertices: Point[]): Point => {
  if (!vertices.length) return { x: 0, y: 0 };
  let x = 0;
  let y = 0;
  for (const v of vertices) {
    x += v.x;
    y += v.y;
  }
  return { x: x / vertices.length, y: y / vertices.length };
};


export type Lines2Side = 'min' | 'max';

export interface Lines2ProjectionStats {
  centroid: Point;
  dir: Point;
  normal: Point;
  dirMin: number;
  dirMax: number;
  dirRange: number;
  normalMin: number;
  normalMax: number;
  normalRange: number;
  minBand: { min: number; max: number; mid: number };
  maxBand: { min: number; max: number; mid: number };
}

const reconstructFromProjections = (
  centroid: Point,
  dir: Point,
  normal: Point,
  dirProj: number,
  normalProj: number
): Point => ({
  x: centroid.x + dir.x * dirProj + normal.x * normalProj,
  y: centroid.y + dir.y * dirProj + normal.y * normalProj
});

export const computeLines2ProjectionStats = (
  vertices: Array<{ x: number; y: number }>,
  angle: number,
  centroidOverride?: Point | null
): Lines2ProjectionStats => {
  const valid = vertices.filter((v) => Number.isFinite(v.x) && Number.isFinite(v.y));
  const centroid = centroidOverride ?? computeCentroid(valid as Point[]);

  const dir = normalise({ x: Math.cos(angle), y: Math.sin(angle) });
  const normal = { x: -dir.y, y: dir.x };

  const projections = valid.map((v) => {
    const rel = subtract(v, centroid);
    return {
      vertex: v,
      dirProj: dot(rel, dir),
      normalProj: dot(rel, normal)
    };
  });

  if (!projections.length) {
    return {
      centroid,
      dir,
      normal,
      dirMin: 0,
      dirMax: 0,
      dirRange: 0,
      normalMin: 0,
      normalMax: 0,
      normalRange: 0,
      minBand: { min: 0, max: 0, mid: 0 },
      maxBand: { min: 0, max: 0, mid: 0 }
    };
  }

  const dirValues = projections.map((p) => p.dirProj);
  const normalValues = projections.map((p) => p.normalProj);

  const dirMin = Math.min(...dirValues);
  const dirMax = Math.max(...dirValues);
  const normalMin = Math.min(...normalValues);
  const normalMax = Math.max(...normalValues);
  const dirRange = dirMax - dirMin;
  const normalRange = normalMax - normalMin;

  const tolerance = Math.max(dirRange * 0.05, 4);
  const minBandPoints = dirRange < EPSILON
    ? projections
    : projections.filter((p) => Math.abs(p.dirProj - dirMin) <= tolerance);
  const maxBandPoints = dirRange < EPSILON
    ? projections
    : projections.filter((p) => Math.abs(p.dirProj - dirMax) <= tolerance);

  const bandStats = (band: typeof projections) => {
    if (!band.length) {
      return {
        min: normalMin,
        max: normalMax,
        mid: (normalMin + normalMax) * 0.5
      };
    }
    const vals = band.map((p) => p.normalProj);
    const minVal = Math.min(...vals);
    const maxVal = Math.max(...vals);
    return {
      min: minVal,
      max: maxVal,
      mid: (minVal + maxVal) * 0.5
    };
  };

  return {
    centroid,
    dir,
    normal,
    dirMin,
    dirMax,
    dirRange,
    normalMin,
    normalMax,
    normalRange,
    minBand: bandStats(minBandPoints),
    maxBand: bandStats(maxBandPoints)
  };
};

export const getLines2SideMidpoint = (
  stats: Lines2ProjectionStats,
  side: Lines2Side
): Point => {
  const band = side === 'min' ? stats.minBand : stats.maxBand;
  const dirProj = side === 'min' ? stats.dirMin : stats.dirMax;
  const normalProj = band.mid;
  return reconstructFromProjections(stats.centroid, stats.dir, stats.normal, dirProj, normalProj);
};

export const projectPointOntoLines2Side = (
  stats: Lines2ProjectionStats,
  point: Point,
  side: Lines2Side
): Point => {
  const rel = subtract(point, stats.centroid);
  const pointerNormal = dot(rel, stats.normal);
  const pointerDir = dot(rel, stats.dir);

  // Allow generous movement beyond the detected face while keeping a minimal guard
  const band = side === 'min' ? stats.minBand : stats.maxBand;
  const normalSlack = Math.max((band.max - band.min) * 2, 32);
  const dirSlack = Math.max(stats.dirRange * 2, 48);

  const clampedNormal = clamp(pointerNormal, band.min - normalSlack, band.max + normalSlack);
  const baseDir = side === 'min' ? stats.dirMin : stats.dirMax;
  const clampedDir = clamp(pointerDir, baseDir - dirSlack, baseDir + dirSlack);

  return reconstructFromProjections(stats.centroid, stats.dir, stats.normal, clampedDir, clampedNormal);
};

export function prepareContourLinesBasis(vertices: Array<{ x: number; y: number }>): ContourLinesBasis | null {
  if (!vertices || vertices.length < 3) return null;

  let longestEdgeIndex = 0;
  let longestLength = 0;

  for (let i = 0; i < vertices.length; i++) {
    const a = vertices[i];
    const b = vertices[(i + 1) % vertices.length];
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    if (length > longestLength) {
      longestLength = length;
      longestEdgeIndex = i;
    }
  }

  if (longestLength < EPSILON) return null;

  const baseA = vertices[longestEdgeIndex];
  const baseB = vertices[(longestEdgeIndex + 1) % vertices.length];
  const direction = normalise(subtract(baseB, baseA));
  let normal = normalise({ x: -direction.y, y: direction.x });
  const baseMidpoint = { x: (baseA.x + baseB.x) * 0.5, y: (baseA.y + baseB.y) * 0.5 };
  const centroid = vertices.reduce((acc, v) => ({ x: acc.x + v.x, y: acc.y + v.y }), { x: 0, y: 0 });
  centroid.x /= vertices.length;
  centroid.y /= vertices.length;

  if (dot(normal, subtract(centroid, baseMidpoint)) < 0) {
    normal = { x: -normal.x, y: -normal.y };
  }

  const projections = vertices.map(v => dot(v, normal));
  const baseProjection = dot(baseMidpoint, normal);
  const maxProjection = Math.max(...projections);
  const minProjection = Math.min(...projections);

  return {
    baseEdge: { a: baseA, b: baseB },
    direction,
    normal,
    baseProjection,
    maxDistance: Math.max(0, maxProjection - baseProjection),
    backDistance: Math.max(0, baseProjection - minProjection)
  };
}

export interface Lines2Defaults {
  centroid: Point;
  defaultAngle: number;
  convergenceA: Point;
  convergenceB: Point;
  basis: ContourLinesBasis | null;
}

export const computeLines2Defaults = (
  vertices: Array<{ x: number; y: number }>,
  existingBasis?: ContourLinesBasis | null
): Lines2Defaults => {
  const valid = vertices.filter((v) => Number.isFinite(v.x) && Number.isFinite(v.y));
  const centroid = computeCentroid(valid as Point[]);

  const basis = existingBasis ?? prepareContourLinesBasis(valid);
  const defaultAngle = basis
    ? Math.atan2(basis.direction.y, basis.direction.x)
    : (() => {
        if (valid.length >= 2) {
          const dx = valid[1].x - valid[0].x;
          const dy = valid[1].y - valid[0].y;
          return Math.atan2(dy, Math.abs(dx) < EPSILON ? (dy >= 0 ? EPSILON : -EPSILON) : dx);
        }
        return 0;
      })();

  const stats = computeLines2ProjectionStats(valid, defaultAngle, centroid);

  const convergenceA = getLines2SideMidpoint(stats, 'min');
  const convergenceB = getLines2SideMidpoint(stats, 'max');

  return {
    centroid: stats.centroid,
    defaultAngle,
    convergenceA,
    convergenceB,
    basis: basis ?? null
  };
};

const getPolygonEdges = (vertices: Point[]) => {
  const edges: Array<{ a: Point; b: Point; angle: number; index: number }> = [];
  for (let i = 0; i < vertices.length; i++) {
    const a = vertices[i];
    const b = vertices[(i + 1) % vertices.length];
    edges.push({
      a,
      b,
      angle: Math.atan2(b.y - a.y, b.x - a.x),
      index: i
    });
  }
  return edges;
};

const collectSidePolyline = (
  vertices: Point[],
  startIndex: number,
  tolerance: number
): Point[] => {
  const edges = getPolygonEdges(vertices);
  const baseEdge = edges[startIndex];
  const baseAngle = baseEdge.angle;

  const points: Point[] = [baseEdge.a, baseEdge.b];

  // Forward (following polygon order)
  let idx = (startIndex + 1) % edges.length;
  while (idx !== startIndex) {
    const edge = edges[idx];
    if (angleDiff(edge.angle, baseAngle) > tolerance) break;
    points.push(edge.b);
    idx = (idx + 1) % edges.length;
  }

  // Backward (previous edges)
  idx = (startIndex - 1 + edges.length) % edges.length;
  while (idx !== startIndex) {
    const edge = edges[idx];
    if (angleDiff(edge.angle, baseAngle) > tolerance) break;
    points.unshift(edge.a);
    idx = (idx - 1 + edges.length) % edges.length;
  }

  // Remove duplicate consecutive points
  const deduped: Point[] = [];
  for (const p of points) {
    if (deduped.length === 0) {
      deduped.push(p);
    } else {
      const prev = deduped[deduped.length - 1];
      if (Math.hypot(prev.x - p.x, prev.y - p.y) > EPSILON) {
        deduped.push(p);
      }
    }
  }

  return deduped;
};

const findEdgeIndexForSegment = (vertices: Point[], segment: { a: Point; b: Point }): number => {
  const edges = getPolygonEdges(vertices);
  for (const edge of edges) {
    if (
      Math.hypot(edge.a.x - segment.a.x, edge.a.y - segment.a.y) < EPSILON &&
      Math.hypot(edge.b.x - segment.b.x, edge.b.y - segment.b.y) < EPSILON
    ) {
      return edge.index;
    }
  }
  return 0;
};

export function calculateLineSpacingFromPointer(
  basis: ContourLinesBasis,
  pointer: Point,
  stage: ContourLinesStage,
  minSpacing: number = MIN_LINE_SPACING,
  maxSpacing: number = MAX_LINE_SPACING
): number {
  // Project the pointer onto the normal direction from the base edge
  // to determine how far the pointer is from the base
  const basePoint = basis.baseEdge.a;
  const pointerVector = subtract(pointer, basePoint);
  const projection = dot(pointerVector, basis.normal);
  
  // Calculate spacing based on the projection distance
  // Closer to base = smaller spacing (denser lines)
  // Further from base = larger spacing (sparser lines)
  const normalizedDistance = Math.abs(projection) / (basis.maxDistance || 100);
  const spacingRange = maxSpacing - minSpacing;
  const spacing = minSpacing + normalizedDistance * spacingRange * 0.5;
  
  return Math.min(maxSpacing, Math.max(minSpacing, spacing));
}

export function generateContourLines(
  vertices: Array<{ x: number; y: number }>,
  basis: ContourLinesBasis,
  spacingStart: number,
  spacingEnd?: number
): ContourLinePath[] {
  if (!vertices || vertices.length < 3) return [];

  // Use spacing values to create variable density lines
  const startSpacing = Math.max(MIN_LINE_SPACING, Math.min(MAX_LINE_SPACING, spacingStart));
  const endSpacing = Math.max(MIN_LINE_SPACING, Math.min(MAX_LINE_SPACING, spacingEnd ?? spacingStart));
  
  // Calculate number of lines based on average spacing
  const avgSpacing = (startSpacing + endSpacing) / 2;
  const NUM_LINES = Math.max(3, Math.min(30, Math.floor(basis.maxDistance / avgSpacing)));
  const SAMPLE_POINTS = 100;

  const baseEdgeIndex = findEdgeIndexForSegment(vertices, basis.baseEdge);
  const basePolylineRaw = collectSidePolyline(vertices, baseEdgeIndex, PARALLEL_TOLERANCE);

  const baseEdgePoints = [basis.baseEdge.a, basis.baseEdge.b];
  const basePolyline = ensureMinimumPolyline(basePolylineRaw, baseEdgePoints);

  const baseSampled = resamplePolyline(basePolyline, SAMPLE_POINTS);

  const paths: ContourLinePath[] = [];

  // Generate uniform base distances, but vary the actual line shape based on spacing
  for (let lineIndex = 0; lineIndex < NUM_LINES; lineIndex++) {
    const t = (lineIndex + 1) / (NUM_LINES + 1);
    const baseDistance = t * basis.maxDistance;
    
    // Create a contour line by finding intersection points along the polygon
    const contourLine: Point[] = [];
    
    // Extend the sampling range to catch all intersections
    // Sample beyond the base edge to ensure we catch the full polygon width
    const extendFactor = 2.0; // Extend sampling range
    const extendedSampleCount = Math.floor(SAMPLE_POINTS * extendFactor);
    
    for (let i = -Math.floor(extendedSampleCount * 0.2); i < extendedSampleCount + Math.floor(extendedSampleCount * 0.2); i++) {
      // Interpolate along the base edge direction, extending beyond edges
      const tSample = i / (SAMPLE_POINTS - 1);
      
      // Calculate variable distance based on position along the line
      // This creates the spacing gradient from start to end
      const positionAlongLine = (tSample + 0.2) / 1.4; // Normalize to [0,1] range
      const clampedPosition = Math.max(0, Math.min(1, positionAlongLine));
      
      // Interpolate between start and end spacing based on position
      const localSpacingRatio = startSpacing + clampedPosition * (endSpacing - startSpacing);
      const spacingModulation = localSpacingRatio / avgSpacing;
      
      // Modulate the distance from base - this creates the variable density
      // Lines bend toward areas of tighter spacing
      const modulatedDistance = baseDistance * (0.5 + 0.5 * spacingModulation);
      
      // Get base point along the extended line
      let basePoint: Point;
      if (tSample >= 0 && tSample <= 1) {
        // Within the base edge range
        const idx = Math.min(Math.floor(tSample * (baseSampled.length - 1)), baseSampled.length - 1);
        basePoint = baseSampled[idx];
      } else if (tSample < 0) {
        // Extend before the start
        const dir = normalise(subtract(baseSampled[1], baseSampled[0]));
        const extendDist = -tSample * basis.maxDistance;
        basePoint = {
          x: baseSampled[0].x - dir.x * extendDist,
          y: baseSampled[0].y - dir.y * extendDist
        };
      } else {
        // Extend after the end  
        const lastIdx = baseSampled.length - 1;
        const dir = normalise(subtract(baseSampled[lastIdx], baseSampled[lastIdx - 1]));
        const extendDist = (tSample - 1) * basis.maxDistance;
        basePoint = {
          x: baseSampled[lastIdx].x + dir.x * extendDist,
          y: baseSampled[lastIdx].y + dir.y * extendDist
        };
      }
      
      // Move perpendicular from base edge by the modulated distance
      const contourPoint = {
        x: basePoint.x + basis.normal.x * modulatedDistance,
        y: basePoint.y + basis.normal.y * modulatedDistance
      };
      
      // Add slight wave variation along the contour
      if (i > 0 && i < extendedSampleCount - 1) {
        const phase = (i / SAMPLE_POINTS) * Math.PI * 4;
        const variation = Math.sin(phase + lineIndex * 0.5) * 0.3;
        const tangent = basis.direction;
        
        contourPoint.x += tangent.x * variation;
        contourPoint.y += tangent.y * variation;
      }
      
      contourLine.push(contourPoint);
    }
    
    // Now clip the entire line to the polygon
    const clippedSegments = clipLineToPolygon(contourLine, vertices);
    for (const segment of clippedSegments) {
      if (segment.length >= 2) {
        const smoothed = segment.length > 2 ? smoothPolyline(segment, 0.3) : segment;
        paths.push({ points: smoothed });
      }
    }
  }
  
  return paths;
}

export function generateLines2Paths(
  vertices: Array<{ x: number; y: number }>,
  options: Lines2GenerationOptions,
  centroidOverride?: Point
): ContourLinePath[] {
  if (!vertices || vertices.length < 3) return [];

  const valid: Point[] = vertices.filter((v) => Number.isFinite(v.x) && Number.isFinite(v.y));
  if (valid.length < 3) return [];

  const stats = computeLines2ProjectionStats(valid, options.angle, centroidOverride ?? null);
  const centroid = stats.centroid;
  const dir = stats.dir;
  const normal = stats.normal;
  const range = Math.max(EPSILON, stats.normalRange);
  const dirRange = stats.dirRange;

  const spacingValue = clamp(options.spacing, 1, 40) * 3.5;
  const densityScale = clamp(options.density, 1, 10) / 5; // 0.2 - 2 scale factor

  const baseCount = Math.max(0, Math.floor(range / spacingValue));
  let numLines = baseCount > 0 ? baseCount : Math.round(6 * densityScale);
  numLines = Math.max(3, Math.min(200, Math.round(numLines * (0.75 + densityScale * 0.5))));

  const normalPadding = Math.max(spacingValue * 0.1, 1);
  const paddedMin = stats.normalMin - normalPadding;
  const paddedMax = stats.normalMax + normalPadding;
  const paddedRange = Math.max(EPSILON, paddedMax - paddedMin);

  const actualSpacing = paddedRange / Math.max(1, numLines - 1);

  const span = Math.max(paddedRange, dirRange) + Math.max(120, spacingValue * 6);

  const results: ContourLinePath[] = [];

  for (let lineIndex = 0; lineIndex < numLines; lineIndex++) {
    const t = numLines === 1 ? 0.5 : lineIndex / (numLines - 1);
    const offset = paddedMin + t * paddedRange;

    const pullStrength = Math.max(0.15, Math.min(0.4, (1 - Math.abs(0.5 - t) * 1.8)));

    const lineOrigin = {
      x: centroid.x + normal.x * offset,
      y: centroid.y + normal.y * offset
    };

    const halfSpan = span * 0.5;
    const sampleCount = Math.max(32, Math.min(240, Math.round(span / (actualSpacing * 0.35))));
    let startPoint: Point | null = null;
    let endPoint: Point | null = null;

    let minAlong = Infinity;
    let maxAlong = -Infinity;
    let minPoint: Point | null = null;
    let maxPoint: Point | null = null;

    const linePoint = lineOrigin;
    const lineDir = dir;

    for (let i = 0; i < valid.length; i++) {
      const a = valid[i];
      const b = valid[(i + 1) % valid.length];
      const intersection = lineSegmentIntersectionWithParams(linePoint, {
        x: linePoint.x + lineDir.x,
        y: linePoint.y + lineDir.y,
      }, a, b);
      if (intersection) {
        const along = dot(subtract(intersection.point, linePoint), lineDir);
        if (along < minAlong) {
          minAlong = along;
          minPoint = intersection.point;
        }
        if (along > maxAlong) {
          maxAlong = along;
          maxPoint = intersection.point;
        }
      }
    }

    if (minPoint && maxPoint && Math.hypot(maxPoint.x - minPoint.x, maxPoint.y - minPoint.y) > EPSILON) {
      startPoint = minPoint;
      endPoint = maxPoint;
    }

    if (!startPoint || !endPoint) {
      const segmentSeed: Point[] = [];
      for (let i = 0; i <= sampleCount; i++) {
        const lerp = (i / sampleCount) * 2 - 1;
        const dist = lerp * halfSpan;
        segmentSeed.push({
          x: lineOrigin.x + dir.x * dist,
          y: lineOrigin.y + dir.y * dist
        });
      }

      const clippedSegments = clipLineToPolygon(segmentSeed, valid);
      if (clippedSegments.length === 0) continue;

      let longestSegment = clippedSegments[0];
      let longestLen = Math.hypot(
        longestSegment[longestSegment.length - 1].x - longestSegment[0].x,
        longestSegment[longestSegment.length - 1].y - longestSegment[0].y
      );
      for (let i = 1; i < clippedSegments.length; i++) {
        const seg = clippedSegments[i];
        const segLen = Math.hypot(
          seg[seg.length - 1].x - seg[0].x,
          seg[seg.length - 1].y - seg[0].y
        );
        if (segLen > longestLen) {
          longestSegment = seg;
          longestLen = segLen;
        }
      }

      if (!longestSegment || longestSegment.length < 2) continue;
      startPoint = longestSegment[0];
      endPoint = longestSegment[longestSegment.length - 1];
    }

    if (!startPoint || !endPoint) continue;

    const offsetNormRaw = range > EPSILON ? (offset - stats.normalMin) / range : 0.5;
    const offsetNorm = clamp(offsetNormRaw, -0.25, 1.25);
    const baseWeightA = clamp(0.3 + offsetNorm * 0.3, 0.2, 0.8);
    const baseWeightB = clamp(0.7 - offsetNorm * 0.3, 0.2, 0.8);
    const groupSize = Math.max(1, Math.round(options.density));
    const groupIndex = Math.floor(lineIndex / groupSize);
    const altDelta = options.alternate ? ((groupIndex % 2 === 0 ? -1 : 1) * 0.05) : 0;
    const weightA = clamp((baseWeightA + altDelta) * pullStrength, 0.1, 0.6);
    const weightB = clamp((baseWeightB - altDelta) * pullStrength, 0.1, 0.6);

    const offsetA = subtract(options.convergenceA, startPoint);
    const offsetB = subtract(options.convergenceB, endPoint);
    const projectedA = subtract(options.convergenceA, stats.centroid);
    const projectedB = subtract(options.convergenceB, stats.centroid);
    const screwOffsetA = dot(projectedA, dir) - dot(subtract(startPoint, stats.centroid), dir);
    const screwOffsetB = dot(projectedB, dir) - dot(subtract(endPoint, stats.centroid), dir);
    const directedA = {
      x: dir.x * screwOffsetA + normal.x * dot(offsetA, normal),
      y: dir.y * screwOffsetA + normal.y * dot(offsetA, normal),
    };
    const directedB = {
      x: dir.x * screwOffsetB + normal.x * dot(offsetB, normal),
      y: dir.y * screwOffsetB + normal.y * dot(offsetB, normal),
    };

    const curveSamples = Math.max(24, Math.min(96, Math.round(dirRange / 6)));
    const curve: Point[] = [];
    const lineVector = subtract(endPoint, startPoint);
    const lineVecLength = Math.hypot(lineVector.x, lineVector.y) || 1;
    const lineDirNorm = { x: lineVector.x / lineVecLength, y: lineVector.y / lineVecLength };
    const extension = Math.max(spacingValue * 1.5, 12);

    for (let i = 0; i <= curveSamples; i++) {
      const tt = i / curveSamples;
      const edgeFalloffA = Math.pow(1 - tt, 3);
      const edgeFalloffB = Math.pow(tt, 3);
      const influenceA = (1 - tt) * (1 - tt) * weightA * edgeFalloffA;
      const influenceB = tt * tt * weightB * edgeFalloffB;
      const altInfluence = options.alternate ? Math.sin(tt * Math.PI) * altDelta * 0.5 : 0;
      curve.push({
        x:
          startPoint.x +
          lineVector.x * tt +
          directedA.x * influenceA +
          directedB.x * influenceB +
          normal.x * altInfluence,
        y:
          startPoint.y +
          lineVector.y * tt +
          directedA.y * influenceA +
          directedB.y * influenceB +
          normal.y * altInfluence,
      });
    }

    const extendedCurve: Point[] = [];
    extendedCurve.push({
      x: curve[0].x - lineDirNorm.x * extension,
      y: curve[0].y - lineDirNorm.y * extension,
    });
    extendedCurve.push(...curve);
    extendedCurve.push({
      x: curve[curve.length - 1].x + lineDirNorm.x * extension,
      y: curve[curve.length - 1].y + lineDirNorm.y * extension,
    });

    const clippedCurveSegments = clipLineToPolygon(extendedCurve, valid);
    for (const seg of clippedCurveSegments) {
      if (seg.length < 2) continue;
      const smoothed = seg.length > 2 ? smoothPolyline(seg, 0.25) : seg;
      results.push({ points: smoothed });
    }
  }

  return results;
}

// Helper function to resample a polyline with uniform spacing
const resamplePolyline = (polyline: Point[], targetCount: number): Point[] => {
  if (polyline.length === 0) return [];
  if (polyline.length === 1) return Array(targetCount).fill(polyline[0]);

  const result: Point[] = [];

  // Calculate total length
  let totalLength = 0;
  for (let i = 0; i < polyline.length - 1; i++) {
    totalLength += Math.hypot(
      polyline[i + 1].x - polyline[i].x,
      polyline[i + 1].y - polyline[i].y
    );
  }

  if (totalLength < EPSILON) {
    return Array(targetCount).fill(polyline[0]);
  }

  // Sample points along the polyline
  for (let i = 0; i < targetCount; i++) {
    const targetDist = (i / (targetCount - 1)) * totalLength;
    let accumulated = 0;

    for (let j = 0; j < polyline.length - 1; j++) {
      const segStart = polyline[j];
      const segEnd = polyline[j + 1];
      const segLength = Math.hypot(segEnd.x - segStart.x, segEnd.y - segStart.y);

      if (accumulated + segLength >= targetDist) {
        const t = segLength > EPSILON ? (targetDist - accumulated) / segLength : 0;
        result.push({
          x: segStart.x + t * (segEnd.x - segStart.x),
          y: segStart.y + t * (segEnd.y - segStart.y)
        });
        break;
      }
      accumulated += segLength;
    }
  }

  // Ensure we have the right number of points
  while (result.length < targetCount) {
    result.push(polyline[polyline.length - 1]);
  }

  return result;
};

const ensureMinimumPolyline = (polyline: Point[], fallback: Point[]): Point[] => {
  if (polyline.length >= 2) return polyline;
  if (polyline.length === 1) {
    const single = polyline[0];
    return [single, single];
  }
  return fallback.length >= 2 ? fallback : fallback.slice(0, 2);
};

// Clip a polyline to polygon boundaries, including points on edges
const clipLineToPolygon = (line: Point[], polygon: Point[]): Point[][] => {
  if (line.length < 2) return [];
  
  const segments: Point[][] = [];
  let currentSegment: Point[] = [];
  
  for (let i = 0; i < line.length; i++) {
    const point = line[i];
    const isInside = pointInPolygon(point, polygon);
    
    if (i > 0) {
      const prevPoint = line[i - 1];
      const prevInside = pointInPolygon(prevPoint, polygon);
      
      // Check for edge crossings
      if (prevInside !== isInside) {
        // Find intersection with polygon edge
        const intersections = getSegmentPolygonIntersections(prevPoint, point, polygon);
        if (intersections.length > 0) {
          const intersection = intersections[0].point;
          if (prevInside) {
            // Exiting polygon
            currentSegment.push(intersection);
            if (currentSegment.length >= 2) {
              segments.push([...currentSegment]);
            }
            currentSegment = [];
          } else {
            // Entering polygon
            currentSegment = [intersection];
          }
        }
      }
    }
    
    if (isInside) {
      currentSegment.push(point);
    }
  }
  
  // Add any remaining segment
  if (currentSegment.length >= 2) {
    segments.push(currentSegment);
  }
  
  return segments;
};

// Clamp points and clip polylines to the polygon by splitting where edges intersect
// Currently unused but kept for potential future use
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const clipLineToPolygonProper = (line: Point[], polygon: Point[]): Point[][] => {
  if (line.length === 0) return [];

  const segments: Point[][] = [];
  let currentSegment: Point[] = [];

  const addPoint = (segment: Point[], point: Point) => {
    if (segment.length === 0) {
      segment.push(point);
      return;
    }
    const last = segment[segment.length - 1];
    // Use consistent edge tolerance for deduplication
    if (Math.hypot(last.x - point.x, last.y - point.y) > EDGE_TOLERANCE) {
      segment.push(point);
    }
  };

  const commitSegment = () => {
    if (currentSegment.length >= 2) {
      segments.push([...currentSegment]);
    }
    currentSegment = [];
  };

  let prevPoint = line[0];
  let prevInside = pointInPolygon(prevPoint, polygon);
  if (prevInside) {
    currentSegment.push(prevPoint);
  }

  for (let i = 1; i < line.length; i++) {
    const currPoint = line[i];
    const currInside = pointInPolygon(currPoint, polygon);
    const intersections = getSegmentPolygonIntersections(prevPoint, currPoint, polygon);

    let stateInside = prevInside;

    for (const intersection of intersections) {
      if (stateInside) {
        addPoint(currentSegment, intersection.point);
        commitSegment();
      } else {
        currentSegment = [intersection.point];
      }
      stateInside = !stateInside;
    }

    if (stateInside && currInside) {
      addPoint(currentSegment, currPoint);
    } else if (stateInside && !currInside) {
      commitSegment();
    } else if (!stateInside && currInside) {
      currentSegment = [currPoint];
      stateInside = true;
    }

    prevPoint = currPoint;
    prevInside = currInside;
  }

  commitSegment();
  return segments;
};


const lineSegmentIntersectionWithParams = (
  p1: Point,
  p2: Point,
  p3: Point,
  p4: Point
): { point: Point; t: number } | null => {
  const x1 = p1.x;
  const y1 = p1.y;
  const x2 = p2.x;
  const y2 = p2.y;
  const x3 = p3.x;
  const y3 = p3.y;
  const x4 = p4.x;
  const y4 = p4.y;

  const denom = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
  if (Math.abs(denom) < EPSILON) return null;

  const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / denom;
  const u = -((x1 - x2) * (y1 - y3) - (y1 - y2) * (x1 - x3)) / denom;

  // Use tighter tolerance for intersection detection to ensure edge points are included
  const tolerance = EPSILON * 2;
  if (t >= -tolerance && t <= 1 + tolerance && u >= -tolerance && u <= 1 + tolerance) {
    // Clamp t to [0,1] to ensure intersection point is exactly on segment
    const clampedT = Math.max(0, Math.min(1, t));
    return {
      point: {
        x: x1 + clampedT * (x2 - x1),
        y: y1 + clampedT * (y2 - y1)
      },
      t: clampedT
    };
  }

  return null;
};

const getSegmentPolygonIntersections = (p1: Point, p2: Point, polygon: Point[]) => {
  const intersections: Array<{ point: Point; t: number }> = [];
  for (let i = 0; i < polygon.length; i++) {
    const v1 = polygon[i];
    const v2 = polygon[(i + 1) % polygon.length];
    const result = lineSegmentIntersectionWithParams(p1, p2, v1, v2);
    if (result) {
      // Use edge tolerance for duplicate detection
      const duplicate = intersections.find(entry => 
        Math.abs(entry.t - result.t) < EDGE_TOLERANCE ||
        Math.hypot(entry.point.x - result.point.x, entry.point.y - result.point.y) < EDGE_TOLERANCE
      );
      if (!duplicate) {
        intersections.push(result);
      }
    }
  }
  intersections.sort((a, b) => a.t - b.t);
  return intersections;
};

// Cast ray to find intersection with polygon
// Currently unused but kept for potential future use
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const castRayToPolygon = (origin: Point, direction: Point, polygon: Point[], maxDistance: number): Point | null => {
  // Use minimal offset to avoid numerical issues without displacing rays from edges
  const offset = EPSILON * 2;
  const rayOrigin = {
    x: origin.x + direction.x * offset,
    y: origin.y + direction.y * offset
  };

  const maxTAllowed = maxDistance > 0 ? maxDistance : Infinity;
  let bestPoint: Point | null = null;
  let bestT = Infinity; // Changed: Look for CLOSEST intersection, not farthest

  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i];
    const b = polygon[(i + 1) % polygon.length];
    const result = raySegmentIntersection(rayOrigin, direction, a, b);
    if (!result) continue;
    if (result.t < -EPSILON) continue;
    if (result.t > maxTAllowed + EPSILON) continue;
    
    // FIXED: Find closest intersection (smallest t), not farthest
    if (result.t < bestT) {
      bestT = result.t;
      bestPoint = result.point;
    }
  }

  // If no intersection found but we have a maxDistance, don't create a fallback point
  // This prevents lines from extending beyond the polygon when no intersection exists
  if (!bestPoint && maxDistance > 0 && bestT === Infinity) {
    // Only use fallback if we're within the polygon and should extend to max distance
    const fallbackPoint = {
      x: origin.x + direction.x * maxDistance,
      y: origin.y + direction.y * maxDistance
    };
    // Check if fallback point would be inside polygon
    if (pointInPolygon(fallbackPoint, polygon)) {
      bestPoint = fallbackPoint;
    }
  }

  return bestPoint;
};

const raySegmentIntersection = (origin: Point, direction: Point, a: Point, b: Point): { point: Point; t: number } | null => {
  const edge = subtract(b, a);
  const rhs = { x: a.x - origin.x, y: a.y - origin.y };
  const det = direction.x * (-edge.y) - direction.y * (-edge.x);

  if (Math.abs(det) < EPSILON) return null;

  const t = (rhs.x * (-edge.y) - rhs.y * (-edge.x)) / det;
  const u = (direction.x * rhs.y - direction.y * rhs.x) / det;

  // Use tighter tolerance and clamp u to ensure edge points are included
  const tolerance = EPSILON * 2;
  if (t < -tolerance || u < -tolerance || u > 1 + tolerance) return null;

  // Clamp u to [0,1] to ensure intersection is exactly on segment
  const clampedU = Math.max(0, Math.min(1, u));
  const intersectionPoint = {
    x: a.x + clampedU * edge.x,
    y: a.y + clampedU * edge.y
  };
  
  return {
    point: intersectionPoint,
    t: Math.hypot(intersectionPoint.x - origin.x, intersectionPoint.y - origin.y)
  };
};

const smoothPolyline = (points: Point[], factor: number = 0.5): Point[] => {
  if (points.length < 3) return points;

  const smoothed: Point[] = [points[0]];
  for (let i = 1; i < points.length - 1; i++) {
    const prev = points[i - 1];
    const curr = points[i];
    const next = points[i + 1];
    smoothed.push({
      x: curr.x * (1 - factor) + (prev.x + next.x) * factor * 0.5,
      y: curr.y * (1 - factor) + (prev.y + next.y) * factor * 0.5
    });
  }
  smoothed.push(points[points.length - 1]);
  return smoothed;
};
