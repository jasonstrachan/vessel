import type { ShapePoint } from '../types';

/**
 * Append a point to a shape path if it is far enough from the last point,
 * using a zoom- and brush-aware spacing threshold.
 * Returns true if the point was appended.
 */
export function appendPointWithDynamicSpacing(
  points: ShapePoint[],
  newPoint: ShapePoint,
  zoom: number,
  brushSize: number,
  minWorldFloor: number = 0.5
): boolean {
  if (points.length === 0) {
    points.push(newPoint);
    return true;
  }

  const last = points[points.length - 1];
  const distance = Math.hypot(newPoint.x - last.x, newPoint.y - last.y);

  // ~1 screen pixel in world units, clamped by brush size and floor
  const base = 1 / Math.max(zoom, 0.0001);
  const maxForSize = Math.max(minWorldFloor, brushSize * 0.08);
  const minSpacing = Math.max(minWorldFloor, Math.min(base, maxForSize));

  if (distance >= minSpacing) {
    points.push(newPoint);
    return true;
  }
  return false;
}

/**
 * Compute a zoom/brush-size aware minimum spacing in world units.
 */
export function computeMinSpacing(
  zoom: number,
  brushSize: number,
  minWorldFloor: number = 0.5
): number {
  const base = 1 / Math.max(zoom, 0.0001); // ~1 screen px in world units
  const maxForSize = Math.max(minWorldFloor, brushSize * 0.08);
  return Math.max(minWorldFloor, Math.min(base, maxForSize));
}

/**
 * Append a segment using dynamic resampling so fast pointer movement still
 * yields detailed point sequences. Returns number of points appended.
 *
 * densityFactor < 1.0 increases detail (smaller step); > 1.0 reduces detail.
 */
export function appendSegmentWithDynamicResampling(
  points: ShapePoint[],
  newPoint: ShapePoint,
  zoom: number,
  brushSize: number,
  minWorldFloor: number = 0.25,
  densityFactor: number = 0.6
): number {
  if (points.length === 0) {
    points.push(newPoint);
    return 1;
  }

  const last = points[points.length - 1];
  const dx = newPoint.x - last.x;
  const dy = newPoint.y - last.y;
  const dist = Math.hypot(dx, dy);
  if (dist === 0) return 0;

  const spacing = computeMinSpacing(zoom, brushSize, minWorldFloor) * Math.max(0.05, densityFactor);
  if (dist < spacing) {
    // Too close; do not append intermediate points
    return 0;
  }

  const steps = Math.min(2048, Math.floor(dist / spacing));
  const sx = dx / (steps + 1);
  const sy = dy / (steps + 1);

  for (let i = 1; i <= steps; i++) {
    points.push({ x: last.x + sx * i, y: last.y + sy * i });
  }
  // Always add the end point unless it's identical to the last appended
  const tail = points[points.length - 1];
  const tailDist = Math.hypot(newPoint.x - tail.x, newPoint.y - tail.y);
  if (tailDist > 0) {
    points.push(newPoint);
    return steps + 1;
  }
  return steps;
}

/**
 * Build preview vertices by normalizing stored points and appending current pointer.
 * Uses nullish coalescing so 0 coords are preserved (not treated as falsy).
 */
export function buildPreviewVertices(
  points: Array<ShapePoint | { x?: number; y?: number } | number>,
  current: ShapePoint
): ShapePoint[] {
  const normalized = points.map(normalizePoint);
  return [...normalized, current];
}

function normalizePoint(point: ShapePoint | { x?: number; y?: number } | number): ShapePoint {
  if (typeof point === 'number') {
    return { x: point, y: point };
  }

  if (typeof point === 'object' && point !== null) {
    const xValue = typeof point.x === 'number' ? point.x : 0;
    const yValue = typeof point.y === 'number' ? point.y : 0;
    return { x: xValue, y: yValue };
  }

  return { x: 0, y: 0 };
}

/**
 * Clear shape points and reset active flag.
 */
export function resetShape(points: ShapePoint[], setActive?: (active: boolean) => void) {
  points.length = 0;
  if (setActive) setActive(false);
}
