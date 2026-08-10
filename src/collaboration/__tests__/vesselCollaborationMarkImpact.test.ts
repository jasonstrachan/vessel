import { evaluateVesselCollaborationMarkImpact } from '../vesselCollaborationMarkImpact';

describe('evaluateVesselCollaborationMarkImpact', () => {
  const base = {
    layerId: 'layer-1',
    documentVersion: 2,
    documentVersionDelta: 1,
    dirtyRevisionDelta: 1,
    canvasWidth: 512,
    canvasHeight: 640,
  };

  it('reports coverage without making phase a uniform size gate', () => {
    const primary = evaluateVesselCollaborationMarkImpact({
      ...base,
      markType: 'shape',
      phase: 'establish',
      changedPixels: 1000,
      points: [{ x: 10, y: 10 }, { x: 80, y: 10 }, { x: 40, y: 50 }],
    });
    const focal = evaluateVesselCollaborationMarkImpact({
      ...base,
      markType: 'shape',
      phase: 'deepen',
      changedPixels: 1000,
      points: [{ x: 10, y: 10 }, { x: 80, y: 10 }, { x: 40, y: 50 }],
    });

    expect(primary).toMatchObject({
      status: 'committed',
      normalizedCoverage: 1000 / (512 * 640),
    });
    expect(focal).toMatchObject({
      status: 'committed',
      normalizedCoverage: 1000 / (512 * 640),
    });
  });

  it('reports canvas-relative stroke span without making it a rejection gate', () => {
    const shortStroke = evaluateVesselCollaborationMarkImpact({
      ...base,
      markType: 'stroke',
      phase: 'develop',
      changedPixels: 1000,
      points: [{ x: 10, y: 10 }, { x: 20, y: 10 }],
    });
    const meaningfulStroke = evaluateVesselCollaborationMarkImpact({
      ...base,
      markType: 'stroke',
      phase: 'develop',
      changedPixels: 1000,
      points: [{ x: 10, y: 10 }, { x: 80, y: 10 }],
    });

    expect(shortStroke).toMatchObject({
      status: 'committed',
    });
    expect(shortStroke.strokeSpan).toBeCloseTo(10 / Math.hypot(512, 640));
    expect(meaningfulStroke).toMatchObject({ status: 'committed' });
    expect(meaningfulStroke.strokeSpan).toBeCloseTo(70 / Math.hypot(512, 640));
  });

  it('measures the furthest path points instead of endpoint displacement', () => {
    const evidence = evaluateVesselCollaborationMarkImpact({
      ...base,
      markType: 'stroke',
      phase: 'deepen',
      changedPixels: 1000,
      points: [
        { x: 10, y: 10 },
        { x: 110, y: 10 },
        { x: 10, y: 10 },
      ],
    });

    expect(evidence).toMatchObject({ status: 'committed' });
    expect(evidence.strokeSpan).toBeCloseTo(100 / Math.hypot(512, 640));
  });

  it('measures the exact diameter of a non-linear path hull', () => {
    const evidence = evaluateVesselCollaborationMarkImpact({
      ...base,
      markType: 'stroke',
      phase: 'deepen',
      changedPixels: 1000,
      points: [
        { x: 10, y: 10 },
        { x: 110, y: 10 },
        { x: 110, y: 110 },
        { x: 10, y: 110 },
        { x: 10, y: 10 },
      ],
    });

    expect(evidence.strokeSpan).toBeCloseTo(Math.hypot(100, 100) / Math.hypot(512, 640));
  });

  it('reports silent no-ops before any other rejection reason', () => {
    expect(evaluateVesselCollaborationMarkImpact({
      ...base,
      markType: 'stroke',
      phase: 'deepen',
      changedPixels: 0,
      points: [{ x: 10, y: 10 }, { x: 11, y: 10 }],
    })).toMatchObject({
      status: 'rejected',
      rejectionReason: 'no-authored-delta',
    });
  });

  it('rejects changed buffers that were not published through document and history revisions', () => {
    expect(evaluateVesselCollaborationMarkImpact({
      ...base,
      documentVersionDelta: 0,
      markType: 'shape',
      phase: 'deepen',
      changedPixels: 1000,
      points: [{ x: 10, y: 10 }, { x: 80, y: 10 }, { x: 40, y: 50 }],
    })).toMatchObject({
      status: 'rejected',
      rejectionReason: 'unpublished-canonical-delta',
    });
    expect(evaluateVesselCollaborationMarkImpact({
      ...base,
      dirtyRevisionDelta: 0,
      markType: 'shape',
      phase: 'deepen',
      changedPixels: 1000,
      points: [{ x: 10, y: 10 }, { x: 80, y: 10 }, { x: 40, y: 50 }],
    })).toMatchObject({
      status: 'rejected',
      rejectionReason: 'unpublished-canonical-delta',
    });
  });
});
