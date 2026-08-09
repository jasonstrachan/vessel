import type { VesselCollaborationPoint } from './vesselCollaborationProtocol';

const cross = (
  origin: VesselCollaborationPoint,
  first: VesselCollaborationPoint,
  second: VesselCollaborationPoint,
) => (
  (first.x - origin.x) * (second.y - origin.y) -
  (first.y - origin.y) * (second.x - origin.x)
);

const squaredDistance = (
  first: VesselCollaborationPoint,
  second: VesselCollaborationPoint,
) => {
  const deltaX = first.x - second.x;
  const deltaY = first.y - second.y;
  return deltaX * deltaX + deltaY * deltaY;
};

const resolveConvexHull = (points: VesselCollaborationPoint[]) => {
  const sorted = [...points]
    .sort((first, second) => first.x - second.x || first.y - second.y)
    .filter((point, index, values) => (
      index === 0 || point.x !== values[index - 1].x || point.y !== values[index - 1].y
    ));
  if (sorted.length <= 2) return sorted;

  const lower: VesselCollaborationPoint[] = [];
  for (const point of sorted) {
    while (
      lower.length >= 2 &&
      cross(lower[lower.length - 2], lower[lower.length - 1], point) <= 0
    ) {
      lower.pop();
    }
    lower.push(point);
  }

  const upper: VesselCollaborationPoint[] = [];
  for (let index = sorted.length - 1; index >= 0; index -= 1) {
    const point = sorted[index];
    while (
      upper.length >= 2 &&
      cross(upper[upper.length - 2], upper[upper.length - 1], point) <= 0
    ) {
      upper.pop();
    }
    upper.push(point);
  }

  lower.pop();
  upper.pop();
  return lower.concat(upper);
};

export const resolveVesselCollaborationPointSpan = (
  points: VesselCollaborationPoint[],
) => {
  const hull = resolveConvexHull(points);
  if (hull.length < 2) return 0;
  if (hull.length === 2) return Math.sqrt(squaredDistance(hull[0], hull[1]));

  let opposite = 1;
  let maximumDistanceSquared = 0;
  for (let index = 0; index < hull.length; index += 1) {
    const nextIndex = (index + 1) % hull.length;
    while (
      Math.abs(cross(hull[index], hull[nextIndex], hull[(opposite + 1) % hull.length])) >
      Math.abs(cross(hull[index], hull[nextIndex], hull[opposite]))
    ) {
      opposite = (opposite + 1) % hull.length;
    }
    maximumDistanceSquared = Math.max(
      maximumDistanceSquared,
      squaredDistance(hull[index], hull[opposite]),
      squaredDistance(hull[nextIndex], hull[opposite]),
    );
  }

  return Math.sqrt(maximumDistanceSquared);
};
