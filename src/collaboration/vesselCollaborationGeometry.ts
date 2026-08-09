import type {
  VesselCollaborationBatchOperation,
  VesselCollaborationPoint,
} from './vesselCollaborationProtocol';
import geometryCore from './vesselCollaborationGeometryCore.cjs';

export const resolveVesselCollaborationPolygonArea = (
  points: VesselCollaborationPoint[],
) => geometryCore.resolvePolygonArea(points);

export const vesselCollaborationPolygonSelfIntersects = (
  points: VesselCollaborationPoint[],
) => geometryCore.polygonSelfIntersects(points);

export const vesselCollaborationPointInPolygon = (
  point: VesselCollaborationPoint,
  polygon: VesselCollaborationPoint[],
) => geometryCore.pointInPolygon(point, polygon);

export const assertVesselCollaborationGestureGeometry = ({
  operation,
  canvasWidth,
  canvasHeight,
  label,
}: {
  operation: Extract<VesselCollaborationBatchOperation, { action: 'shape' | 'stroke' }>;
  canvasWidth: number;
  canvasHeight: number;
  label: string;
}) => {
  const error = geometryCore.resolveGestureGeometryError({
    operation,
    canvasWidth,
    canvasHeight,
    label,
  });
  if (error) throw new Error(error);
};

/** Overlapping independent polygons remain valid; malformed individual paths do not. */
export const resolveVesselCollaborationCandidateGeometryRejection = (
  operation: Extract<VesselCollaborationBatchOperation, { action: 'shape' | 'stroke' }>,
  canvasWidth: number,
  canvasHeight: number,
): 'invalid-geometry' | null => geometryCore.resolveGestureGeometryError({
  operation,
  canvasWidth,
  canvasHeight,
  label: operation.action,
}) ? 'invalid-geometry' : null;
