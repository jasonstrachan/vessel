import type {
  VesselCollaborationBatchOperation,
  VesselCollaborationPoint,
} from './vesselCollaborationProtocol';

const cross = (
  a: VesselCollaborationPoint,
  b: VesselCollaborationPoint,
  c: VesselCollaborationPoint,
) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);

const pointOnSegment = (
  point: VesselCollaborationPoint,
  start: VesselCollaborationPoint,
  end: VesselCollaborationPoint,
) => Math.abs(cross(start, end, point)) < 1e-6 &&
  point.x >= Math.min(start.x, end.x) && point.x <= Math.max(start.x, end.x) &&
  point.y >= Math.min(start.y, end.y) && point.y <= Math.max(start.y, end.y);

const segmentsIntersect = (
  firstStart: VesselCollaborationPoint,
  firstEnd: VesselCollaborationPoint,
  secondStart: VesselCollaborationPoint,
  secondEnd: VesselCollaborationPoint,
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

export const resolveVesselCollaborationPolygonArea = (
  points: VesselCollaborationPoint[],
) => {
  let signedDoubleArea = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    signedDoubleArea += current.x * next.y - next.x * current.y;
  }
  return Math.abs(signedDoubleArea) / 2;
};

export const vesselCollaborationPolygonSelfIntersects = (
  points: VesselCollaborationPoint[],
) => {
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

export const vesselCollaborationPointInPolygon = (
  point: VesselCollaborationPoint,
  polygon: VesselCollaborationPoint[],
) => {
  let inside = false;
  for (let current = 0, previous = polygon.length - 1; current < polygon.length; previous = current++) {
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

export const assertVesselCollaborationGestureGeometry = ({
  operation,
  label,
}: {
  operation: Extract<VesselCollaborationBatchOperation, { action: 'shape' | 'stroke' }>;
  canvasWidth: number;
  canvasHeight: number;
  label: string;
}) => {
  if (operation.action === 'stroke') return;

  if (operation.points.length < 3) {
    throw new Error(`${label} must contain at least three boundary points`);
  }
};

/**
 * Candidate geometry is an authoring-quality concern, not a transport failure.
 * Artwork jobs use this result to skip one malformed candidate and continue to
 * the next checkpoint. Overlapping independent polygons are intentionally valid.
 */
export const resolveVesselCollaborationCandidateGeometryRejection = (
  operation: Extract<VesselCollaborationBatchOperation, { action: 'shape' | 'stroke' }>,
): 'invalid-geometry' | null => (
  operation.action === 'shape' && vesselCollaborationPolygonSelfIntersects(operation.points)
    ? 'invalid-geometry'
    : null
);
