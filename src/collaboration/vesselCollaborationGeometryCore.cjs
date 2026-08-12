const GEOMETRY_EPSILON = 1e-6;

const cross = (a, b, c) =>
  (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);

const pointOnSegment = (point, start, end) =>
  Math.abs(cross(start, end, point)) < GEOMETRY_EPSILON &&
  point.x >= Math.min(start.x, end.x) &&
  point.x <= Math.max(start.x, end.x) &&
  point.y >= Math.min(start.y, end.y) &&
  point.y <= Math.max(start.y, end.y);

const segmentsIntersect = (
  firstStart,
  firstEnd,
  secondStart,
  secondEnd,
) => {
  const firstA = cross(firstStart, firstEnd, secondStart);
  const firstB = cross(firstStart, firstEnd, secondEnd);
  const secondA = cross(secondStart, secondEnd, firstStart);
  const secondB = cross(secondStart, secondEnd, firstEnd);
  if (((firstA > 0 && firstB < 0) || (firstA < 0 && firstB > 0)) &&
      ((secondA > 0 && secondB < 0) || (secondA < 0 && secondB > 0))) {
    return true;
  }
  return pointOnSegment(secondStart, firstStart, firstEnd) ||
    pointOnSegment(secondEnd, firstStart, firstEnd) ||
    pointOnSegment(firstStart, secondStart, secondEnd) ||
    pointOnSegment(firstEnd, secondStart, secondEnd);
};

const resolvePolygonArea = (points) => {
  let signedDoubleArea = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    signedDoubleArea += current.x * next.y - next.x * current.y;
  }
  return Math.abs(signedDoubleArea) / 2;
};

const polygonSelfIntersects = (points) => {
  for (let first = 0; first < points.length; first += 1) {
    const firstNext = (first + 1) % points.length;
    for (let second = first + 1; second < points.length; second += 1) {
      const secondNext = (second + 1) % points.length;
      if (first === second || firstNext === second || secondNext === first) continue;
      if (first === 0 && secondNext === 0) continue;
      if (segmentsIntersect(
        points[first],
        points[firstNext],
        points[second],
        points[secondNext],
      )) return true;
    }
  }
  return false;
};

const pointInPolygon = (point, polygon) => {
  let inside = false;
  for (
    let current = 0, previous = polygon.length - 1;
    current < polygon.length;
    previous = current, current += 1
  ) {
    const a = polygon[current];
    const b = polygon[previous];
    if (pointOnSegment(point, a, b)) return true;
    if (
      (a.y > point.y) !== (b.y > point.y) &&
      point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x
    ) inside = !inside;
  }
  return inside;
};

const resolvePointGroupError = ({
  points,
  canvasWidth,
  canvasHeight,
  label,
  allowOutsideAfterFirst = false,
}) => {
  if (!Array.isArray(points) || points.length === 0) {
    return `${label} must contain at least one point`;
  }
  for (let index = 0; index < points.length; index += 1) {
    const point = points[index];
    if (!Number.isFinite(point?.x) || !Number.isFinite(point?.y)) {
      return `${label}[${index}] must contain finite coordinates`;
    }
    if (point.pressure !== undefined &&
        (!Number.isFinite(point.pressure) || point.pressure < 0 || point.pressure > 1)) {
      return `${label}[${index}].pressure must be between 0 and 1`;
    }
    if (
      !(allowOutsideAfterFirst && index > 0) &&
      (
        point.x < 0 || point.x >= canvasWidth ||
        point.y < 0 || point.y >= canvasHeight
      )
    ) {
      return `${label}[${index}] must be inside the project canvas`;
    }
  }
  return null;
};

const resolveGestureGeometryError = ({
  operation,
  canvasWidth,
  canvasHeight,
  label,
}) => {
  if (!Number.isInteger(canvasWidth) || canvasWidth < 1 ||
      !Number.isInteger(canvasHeight) || canvasHeight < 1) {
    return `${label} requires positive integer canvas dimensions`;
  }
  const pointsError = resolvePointGroupError({
    points: operation?.points,
    canvasWidth,
    canvasHeight,
    label: `${label}.points`,
  });
  if (pointsError) return pointsError;
  if (operation.action !== 'shape') return null;
  if (operation.points.length < 3) {
    return `${label}.points must contain at least three boundary points`;
  }
  if (operation.direction !== undefined) {
    if (!Array.isArray(operation.direction) || operation.direction.length < 2) {
      return `${label}.direction must contain at least two points`;
    }
    const directionError = resolvePointGroupError({
      points: operation.direction,
      canvasWidth,
      canvasHeight,
      label: `${label}.direction`,
      allowOutsideAfterFirst: true,
    });
    if (directionError) return directionError;
  }
  if (polygonSelfIntersects(operation.points)) {
    return `${label}.points must not self-intersect`;
  }
  if (resolvePolygonArea(operation.points) <= GEOMETRY_EPSILON) {
    return `${label}.points must enclose a non-degenerate area`;
  }
  return null;
};

const geometryCore = Object.freeze({
  pointInPolygon,
  polygonSelfIntersects,
  resolveGestureGeometryError,
  resolvePolygonArea,
});

module.exports = geometryCore;
