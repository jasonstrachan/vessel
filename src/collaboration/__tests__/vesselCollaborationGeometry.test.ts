import {
  assertVesselCollaborationGestureGeometry,
  resolveVesselCollaborationCandidateGeometryRejection,
  resolveVesselCollaborationPolygonArea,
  vesselCollaborationPointInPolygon,
  vesselCollaborationPolygonSelfIntersects,
} from '../vesselCollaborationGeometry';

describe('Vessel collaboration geometry preflight', () => {
  it('measures meaningful mass area and rejects self-intersections', () => {
    const rectangle = [
      { x: 20, y: 20 },
      { x: 220, y: 20 },
      { x: 220, y: 180 },
      { x: 20, y: 180 },
    ];
    expect(resolveVesselCollaborationPolygonArea(rectangle)).toBe(32000);
    expect(vesselCollaborationPolygonSelfIntersects(rectangle)).toBe(false);
    expect(vesselCollaborationPolygonSelfIntersects([
      { x: 20, y: 20 },
      { x: 220, y: 180 },
      { x: 20, y: 180 },
      { x: 220, y: 20 },
    ])).toBe(true);
  });

  it('measures polygon membership without rejecting an artistic direction choice', () => {
    const polygon = [
      { x: 20, y: 20 },
      { x: 220, y: 20 },
      { x: 220, y: 180 },
      { x: 20, y: 180 },
    ];
    expect(vesselCollaborationPointInPolygon({ x: 120, y: 90 }, polygon)).toBe(true);
    expect(vesselCollaborationPointInPolygon({ x: 260, y: 90 }, polygon)).toBe(false);
    expect(() => assertVesselCollaborationGestureGeometry({
      operation: {
        action: 'shape',
        phase: 'establish',
        points: polygon,
        direction: [{ x: 30, y: 30 }, { x: 260, y: 90 }],
      },
      canvasWidth: 512,
      canvasHeight: 640,
      label: 'operations[4]',
    })).not.toThrow();
  });

  it('does not turn predicted size or span into a hard geometry failure', () => {
    expect(() => assertVesselCollaborationGestureGeometry({
      operation: {
        action: 'shape',
        phase: 'establish',
        points: [{ x: 10, y: 10 }, { x: 20, y: 10 }, { x: 15, y: 15 }],
      },
      canvasWidth: 512,
      canvasHeight: 640,
      label: 'shape',
    })).not.toThrow();
    expect(() => assertVesselCollaborationGestureGeometry({
      operation: {
        action: 'stroke',
        phase: 'deepen',
        points: [{ x: 10, y: 10 }, { x: 20, y: 10 }],
      },
      canvasWidth: 512,
      canvasHeight: 640,
      label: 'stroke',
    })).not.toThrow();
  });

  it('reports a self-intersecting candidate without rejecting overlapping masses', () => {
    expect(resolveVesselCollaborationCandidateGeometryRejection({
      action: 'shape',
      phase: 'develop',
      points: [
        { x: 20, y: 20 },
        { x: 220, y: 180 },
        { x: 20, y: 180 },
        { x: 220, y: 20 },
      ],
    }, 512, 640)).toBe('invalid-geometry');
    expect(resolveVesselCollaborationCandidateGeometryRejection({
      action: 'shape',
      phase: 'develop',
      points: [
        { x: 20, y: 20 },
        { x: 220, y: 20 },
        { x: 220, y: 180 },
        { x: 20, y: 180 },
      ],
    }, 512, 640)).toBeNull();
  });

  it('rejects degenerate and out-of-canvas geometry', () => {
    expect(() => assertVesselCollaborationGestureGeometry({
      operation: {
        action: 'shape',
        phase: 'establish',
        points: [{ x: 1, y: 1 }, { x: 2, y: 2 }, { x: 3, y: 3 }],
      },
      canvasWidth: 10,
      canvasHeight: 10,
      label: 'shape',
    })).toThrow('shape.points must enclose a non-degenerate area');
    expect(() => assertVesselCollaborationGestureGeometry({
      operation: {
        action: 'stroke',
        phase: 'establish',
        points: [{ x: 1, y: 1 }, { x: 10, y: 2 }],
      },
      canvasWidth: 10,
      canvasHeight: 10,
      label: 'stroke',
    })).toThrow('stroke.points[1] must be inside the project canvas');
  });

  it('measures stroke span across the whole path instead of only from its start', () => {
    expect(() => assertVesselCollaborationGestureGeometry({
      operation: {
        action: 'stroke',
        phase: 'deepen',
        points: [
          { x: 500, y: 500 },
          { x: 450, y: 500 },
          { x: 550, y: 500 },
        ],
      },
      canvasWidth: 1000,
      canvasHeight: 1000,
      label: 'stroke',
    })).not.toThrow();
  });
});
