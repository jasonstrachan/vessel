import type {
  VesselCollaborationOutcomeSummary,
  VesselCollaborationProfile,
} from './vesselCollaborationProtocol';

const MAX_REJECTED_MARK_RATIO = 0.1;

export const summarizeVesselCollaborationOutcome = ({
  profiles,
  cancelled,
  failed = false,
  hasCheckpoint,
}: {
  profiles: NonNullable<VesselCollaborationProfile['operations']>;
  cancelled: boolean;
  failed?: boolean;
  hasCheckpoint: boolean;
}): VesselCollaborationOutcomeSummary => {
  let attemptedShapes = 0;
  let committedShapes = 0;
  let rejectedShapes = 0;
  let attemptedStrokes = 0;
  let committedStrokes = 0;
  let rejectedStrokes = 0;
  let changedPixels = 0;
  let missingEvidence = 0;

  for (const profile of profiles) {
    if (profile.action !== 'shape' && profile.action !== 'stroke') continue;
    if (profile.action === 'shape') attemptedShapes += 1;
    else attemptedStrokes += 1;
    if (!profile.markEvidence) {
      missingEvidence += 1;
      continue;
    }
    changedPixels += profile.markEvidence.changedPixels;
    if (profile.action === 'shape') {
      if (profile.markEvidence.status === 'committed') committedShapes += 1;
      else rejectedShapes += 1;
    } else if (profile.markEvidence.status === 'committed') {
      committedStrokes += 1;
    } else {
      rejectedStrokes += 1;
    }
  }

  return {
    transport: 'accepted',
    execution: failed ? 'failed' : cancelled ? 'cancelled' : 'completed',
    evidence: missingEvidence > 0
      ? 'unverifiable'
      : (rejectedShapes + rejectedStrokes) /
          Math.max(1, attemptedShapes + attemptedStrokes) > MAX_REJECTED_MARK_RATIO
        ? 'deficient'
        : 'valid',
    checkpoint: hasCheckpoint ? 'valid' : 'missing',
    attemptedShapes,
    committedShapes,
    rejectedShapes,
    attemptedStrokes,
    committedStrokes,
    rejectedStrokes,
    changedPixels,
  };
};
