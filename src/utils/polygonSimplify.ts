/**
 * Polygon simplification utilities
 * - Ramer–Douglas–Peucker (RDP) simplification in pixel space
 * - Helper to iteratively increase tolerance until a vertex limit is met
 */

export type Point = { x: number; y: number };

function sqr(x: number) { return x * x; }
function dist2(a: Point, b: Point) { return sqr(a.x - b.x) + sqr(a.y - b.y); }

// Squared distance from point p to segment ab
function distToSegmentSquared(p: Point, a: Point, b: Point) {
  const l2 = dist2(a, b);
  if (l2 === 0) return dist2(p, a);
  let t = ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / l2;
  t = Math.max(0, Math.min(1, t));
  const proj = { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) };
  return dist2(p, proj);
}

/**
 * Ramer–Douglas–Peucker simplification.
 * @param points Polygon vertices (not auto-closed). Must have length >= 2.
 * @param tolerance Simplification tolerance in pixels.
 */
export function simplifyRDP(points: Point[], tolerance: number): Point[] {
  if (!points || points.length <= 2) return points.slice();
  const tol2 = tolerance * tolerance;

  const keep = new Uint8Array(points.length);
  keep[0] = 1; keep[points.length - 1] = 1;

  const stack: Array<{ start: number; end: number }> = [{ start: 0, end: points.length - 1 }];
  while (stack.length) {
    const { start, end } = stack.pop()!;
    let maxDist = -1;
    let index = -1;
    for (let i = start + 1; i < end; i++) {
      const d = distToSegmentSquared(points[i], points[start], points[end]);
      if (d > maxDist) { maxDist = d; index = i; }
    }
    if (maxDist > tol2 && index > start && index < end) {
      keep[index] = 1;
      stack.push({ start, end: index }, { start: index, end });
    }
  }

  const out: Point[] = [];
  for (let i = 0; i < points.length; i++) if (keep[i]) out.push(points[i]);
  return out;
}

/**
 * Simplify polygon until its vertex count is <= limit, increasing tolerance each round.
 * Ensures at least 3 vertices remain.
 */
export function simplifyToVertexLimit(points: Point[], limit: number, opts?: {
  initialTolerance?: number;
  maxTolerance?: number;
  stepFactor?: number;
}): Point[] {
  if (points.length <= limit) return points.slice();
  const initial = Math.max(0.1, opts?.initialTolerance ?? 0.5);
  const maxTol = Math.max(initial, opts?.maxTolerance ?? 8);
  const factor = Math.max(1.05, opts?.stepFactor ?? 1.6);

  let tol = initial;
  let best = points.slice();
  while (tol <= maxTol) {
    const simplified = simplifyRDP(points, tol);
    if (simplified.length <= limit && simplified.length >= 3) return simplified;
    if (simplified.length < best.length && simplified.length >= 3) best = simplified;
    tol *= factor;
  }
  // Fallback: if still over limit, decimate uniformly to meet limit
  if (best.length > limit) {
    const step = Math.ceil(best.length / limit);
    const out: Point[] = [];
    for (let i = 0; i < best.length; i += step) out.push(best[i]);
    // Ensure closure coverage by adding last point if needed
    if (out.length < 3) return best.slice(0, Math.max(3, Math.min(limit, best.length)));
    return out;
  }
  return best;
}

