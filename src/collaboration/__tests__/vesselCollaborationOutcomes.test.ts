import { summarizeVesselCollaborationOutcome } from '../vesselCollaborationOutcomes';
import type { VesselCollaborationProfile } from '../vesselCollaborationProtocol';

const mark = (
  index: number,
  action: 'shape' | 'stroke',
  status: 'committed' | 'rejected',
  changedPixels: number,
): NonNullable<VesselCollaborationProfile['operations']>[number] => ({
  index,
  action,
  mutationMs: 1,
  revision: index + 1,
  markEvidence: {
    layerId: 'paint-layer',
    documentVersion: index + 1,
    documentVersionDelta: status === 'committed' ? 1 : 0,
    markType: action,
    phase: 'establish',
    status,
    changedPixels,
    normalizedCoverage: changedPixels / (512 * 640),
    dirtyRevisionDelta: status === 'committed' ? 1 : 0,
    changedChannels: changedPixels > 0 ? ['paint'] : [],
  },
});

describe('summarizeVesselCollaborationOutcome', () => {
  it('does not disguise rejected marks as a successful artwork stage', () => {
    const profiles = [
      ...Array.from({ length: 2 }, (_, index) => mark(index, 'shape', 'committed', 3000)),
      ...Array.from({ length: 98 }, (_, index) => mark(index + 2, 'shape', 'rejected', 0)),
    ];
    expect(summarizeVesselCollaborationOutcome({
      profiles,
      cancelled: false,
      hasCheckpoint: true,
    })).toEqual({
      transport: 'accepted',
      execution: 'completed',
      evidence: 'deficient',
      checkpoint: 'valid',
      attemptedShapes: 100,
      committedShapes: 2,
      rejectedShapes: 98,
      attemptedStrokes: 0,
      committedStrokes: 0,
      rejectedStrokes: 0,
      changedPixels: 6000,
    });
  });

  it('reports absent evidence independently from cancellation and checkpoints', () => {
    const profiles: NonNullable<VesselCollaborationProfile['operations']> = [{
      index: 0,
      action: 'stroke',
      mutationMs: 1,
      revision: 0,
    }];
    expect(summarizeVesselCollaborationOutcome({
      profiles,
      cancelled: true,
      hasCheckpoint: false,
    })).toMatchObject({
      execution: 'cancelled',
      evidence: 'unverifiable',
      checkpoint: 'missing',
      attemptedStrokes: 1,
      committedStrokes: 0,
      rejectedStrokes: 0,
    });
  });

  it('allows replacement marks up to the group rejection threshold', () => {
    const profiles = [
      ...Array.from({ length: 9 }, (_, index) => mark(index, 'shape', 'committed', 3000)),
      mark(9, 'shape', 'rejected', 0),
    ];
    expect(summarizeVesselCollaborationOutcome({
      profiles,
      cancelled: false,
      hasCheckpoint: true,
    })).toMatchObject({
      evidence: 'valid',
      attemptedShapes: 10,
      committedShapes: 9,
      rejectedShapes: 1,
    });
  });
});
