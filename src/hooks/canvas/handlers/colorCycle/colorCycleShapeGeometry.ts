type IndexedPoint = { x: number; y: number; index: number };

const pointKey = (point: { x: number; y: number }): string => `${point.x}:${point.y}`;

const cross = (
  origin: { x: number; y: number },
  a: { x: number; y: number },
  b: { x: number; y: number }
): number =>
  (a.x - origin.x) * (b.y - origin.y) -
  (a.y - origin.y) * (b.x - origin.x);

const buildConvexHull = (
  points: IndexedPoint[]
): IndexedPoint[] => {
  const sorted = [...points].sort((a, b) => {
    if (a.x !== b.x) {
      return a.x - b.x;
    }
    if (a.y !== b.y) {
      return a.y - b.y;
    }
    return a.index - b.index;
  });
  const unique: IndexedPoint[] = [];
  let previousKey: string | null = null;
  for (const point of sorted) {
    const key = pointKey(point);
    if (key === previousKey) {
      continue;
    }
    unique.push(point);
    previousKey = key;
  }

  if (unique.length <= 2) {
    return unique;
  }

  const lower: IndexedPoint[] = [];
  for (const point of unique) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], point) <= 0) {
      lower.pop();
    }
    lower.push(point);
  }

  const upper: IndexedPoint[] = [];
  for (let i = unique.length - 1; i >= 0; i -= 1) {
    const point = unique[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], point) <= 0) {
      upper.pop();
    }
    upper.push(point);
  }

  lower.pop();
  upper.pop();
  return [...lower, ...upper];
};

const distanceSquared = (
  a: { x: number; y: number },
  b: { x: number; y: number }
): number => {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return dx * dx + dy * dy;
};

const triangleArea2 = (
  a: { x: number; y: number },
  b: { x: number; y: number },
  c: { x: number; y: number }
): number => Math.abs(cross(a, b, c));

const findFarthestPair = (
  points: IndexedPoint[]
): { a: IndexedPoint; b: IndexedPoint } => {
  const n = points.length;
  if (n <= 1) {
    const fallback = points[0] ?? { x: 0, y: 0, index: 0 };
    return { a: fallback, b: fallback };
  }
  if (n <= 3) {
    return findFarthestPairBruteForce(points);
  }

  let bestD2 = -1;
  let ax = points[0];
  let bx = points[1];

  const updateBest = (a: IndexedPoint, b: IndexedPoint) => {
    const d2 = distanceSquared(a, b);
    if (d2 > bestD2) {
      bestD2 = d2;
      ax = a;
      bx = b;
    }
  };

  let j = 1;
  for (let i = 0; i < n; i += 1) {
    const nextI = (i + 1) % n;
    while (
      triangleArea2(points[i], points[nextI], points[(j + 1) % n]) >
      triangleArea2(points[i], points[nextI], points[j])
    ) {
      j = (j + 1) % n;
    }
    updateBest(points[i], points[j]);
    updateBest(points[nextI], points[j]);
  }

  return { a: ax, b: bx };
};

const findFarthestPairBruteForce = (
  points: IndexedPoint[]
): { a: IndexedPoint; b: IndexedPoint } => {
  let bestD2 = -1;
  let ax = points[0];
  let bx = points[1] ?? points[0];
  for (let i = 0; i < points.length; i += 1) {
    for (let j = i + 1; j < points.length; j += 1) {
      const d2 = distanceSquared(points[i], points[j]);
      if (d2 > bestD2) {
        bestD2 = d2;
        ax = points[i];
        bx = points[j];
      }
    }
  }
  return { a: ax, b: bx };
};

export const computeFallbackLinearDirection = (
  points: Array<{ x: number; y: number }>
): { x: number; y: number } => {
  const finitePoints = points
    .map((point, index) => ({ ...point, index }))
    .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
  const n = finitePoints.length;
  if (n === 0) {
    return { x: 1, y: 0 };
  }
  if (n === 1) {
    return { x: 1, y: 0 };
  }

  const hull = buildConvexHull(finitePoints);
  const candidates = hull.length >= 2 ? hull : finitePoints;
  const pair = findFarthestPair(candidates);
  const ax = pair.a.index <= pair.b.index ? pair.a : pair.b;
  const bx = pair.a.index <= pair.b.index ? pair.b : pair.a;

  let dx = bx.x - ax.x;
  let dy = bx.y - ax.y;
  const len = Math.hypot(dx, dy);
  if (!Number.isFinite(len) || len < 1e-6) {
    return { x: 1, y: 0 };
  }
  dx /= len;
  dy /= len;

  return { x: dx, y: dy };
};
