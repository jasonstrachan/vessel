export interface VesselCollaborationGeometryPoint {
  x: number;
  y: number;
  pressure?: number;
}

export interface VesselCollaborationGeometryOperation {
  action: 'shape' | 'stroke';
  points: VesselCollaborationGeometryPoint[];
  direction?: VesselCollaborationGeometryPoint[];
}

export interface VesselCollaborationGeometryInput {
  operation: VesselCollaborationGeometryOperation;
  canvasWidth: number;
  canvasHeight: number;
  label: string;
}

declare const geometryCore: Readonly<{
  pointInPolygon: (
    point: VesselCollaborationGeometryPoint,
    polygon: VesselCollaborationGeometryPoint[],
  ) => boolean;
  polygonSelfIntersects: (points: VesselCollaborationGeometryPoint[]) => boolean;
  resolveGestureGeometryError: (input: VesselCollaborationGeometryInput) => string | null;
  resolvePolygonArea: (points: VesselCollaborationGeometryPoint[]) => number;
}>;

export default geometryCore;
