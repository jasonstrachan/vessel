/**
 * Pure stroke interpolation algorithms
 * Extracted from useBrushEngine for better maintainability
 */

export interface Point {
  x: number;
  y: number;
}

export interface StrokePoint extends Point {
  pressure?: number;
  timestamp?: number;
}

/**
 * Bresenham's line algorithm for pixel-perfect lines
 * Returns all integer points between start and end
 */
export function bresenhamLine(x0: number, y0: number, x1: number, y1: number): Point[] {
  const points: Point[] = [];
  
  x0 = Math.floor(x0);
  y0 = Math.floor(y0);
  x1 = Math.floor(x1);
  y1 = Math.floor(y1);
  
  const dx = Math.abs(x1 - x0);
  const dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx - dy;
  
  while (true) {
    points.push({ x: x0, y: y0 });
    
    if (x0 === x1 && y0 === y1) break;
    
    const e2 = 2 * err;
    if (e2 > -dy) {
      err -= dy;
      x0 += sx;
    }
    if (e2 < dx) {
      err += dx;
      y0 += sy;
    }
  }
  
  return points;
}

/**
 * Calculate Euclidean distance between two points
 */
export function distance(p1: Point, p2: Point): number {
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Linear interpolation between two values
 */
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * Smooth step interpolation (cubic)
 */
export function smoothStep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/**
 * Interpolate points along a stroke with spacing
 */
export function interpolateStroke(
  start: StrokePoint,
  end: StrokePoint,
  spacing: number
): StrokePoint[] {
  const dist = distance(start, end);
  const numPoints = Math.max(1, Math.floor(dist / spacing));
  const points: StrokePoint[] = [];
  
  for (let i = 0; i <= numPoints; i++) {
    const t = i / numPoints;
    points.push({
      x: lerp(start.x, end.x, t),
      y: lerp(start.y, end.y, t),
      pressure: start.pressure !== undefined && end.pressure !== undefined
        ? lerp(start.pressure, end.pressure, t)
        : 1.0
    });
  }
  
  return points;
}

/**
 * Calculate direction angle from one point to another
 */
export function calculateDirection(from: Point, to: Point): number {
  return Math.atan2(to.y - from.y, to.x - from.x);
}

/**
 * Smooth an array of values using weighted average
 */
export function smoothValues(values: number[], weights?: number[]): number {
  if (values.length === 0) return 0;
  
  const defaultWeights = weights || values.map((_, i) => (i + 1) / values.length);
  let weightedSum = 0;
  let weightSum = 0;
  
  for (let i = 0; i < values.length; i++) {
    const weight = defaultWeights[i] || 1;
    weightedSum += values[i] * weight;
    weightSum += weight;
  }
  
  return weightSum > 0 ? weightedSum / weightSum : values[values.length - 1];
}

/**
 * Circular average for angles (handles wraparound)
 */
export function averageAngles(angles: number[], weights?: number[]): number {
  const defaultWeights = weights || angles.map(() => 1 / angles.length);
  let sinSum = 0;
  let cosSum = 0;
  
  for (let i = 0; i < angles.length; i++) {
    const weight = defaultWeights[i] || 1;
    sinSum += Math.sin(angles[i]) * weight;
    cosSum += Math.cos(angles[i]) * weight;
  }
  
  return Math.atan2(sinSum, cosSum);
}

/**
 * Quantize value to nearest step
 */
export function quantize(value: number, stepSize: number = 1): number {
  return Math.round(value / stepSize) * stepSize;
}