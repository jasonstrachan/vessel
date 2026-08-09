import type {
  VesselCollaborationConstructionPhase,
  VesselCollaborationMarkEvidence,
  VesselCollaborationPoint,
} from './vesselCollaborationProtocol';
import { resolveVesselCollaborationPointSpan } from './vesselCollaborationPointGeometry';

const resolveStrokeSpan = (
  points: VesselCollaborationPoint[],
  canvasWidth: number,
  canvasHeight: number,
) => {
  const canvasDiagonal = Math.hypot(canvasWidth, canvasHeight);
  if (canvasDiagonal === 0 || points.length < 2) return 0;
  return resolveVesselCollaborationPointSpan(points) / canvasDiagonal;
};

export const evaluateVesselCollaborationMarkImpact = ({
  layerId,
  markType,
  phase,
  changedPixels,
  dirtyRevisionDelta,
  documentVersion,
  documentVersionDelta,
  affectedBounds,
  changedChannels,
  points,
  canvasWidth,
  canvasHeight,
}: {
  layerId: string;
  markType: 'stroke' | 'shape';
  phase?: VesselCollaborationConstructionPhase;
  changedPixels: number;
  dirtyRevisionDelta: number;
  documentVersion?: number;
  documentVersionDelta?: number;
  affectedBounds?: { x: number; y: number; width: number; height: number };
  changedChannels?: VesselCollaborationMarkEvidence['changedChannels'];
  points: VesselCollaborationPoint[];
  canvasWidth: number;
  canvasHeight: number;
}): VesselCollaborationMarkEvidence => {
  const canvasArea = canvasWidth * canvasHeight;
  const normalizedCoverage = canvasArea > 0 ? changedPixels / canvasArea : 0;
  const strokeSpan = markType === 'stroke'
    ? resolveStrokeSpan(points, canvasWidth, canvasHeight)
    : undefined;
  let rejectionReason: VesselCollaborationMarkEvidence['rejectionReason'];

  if (changedPixels === 0) {
    rejectionReason = 'no-authored-delta';
  } else if ((documentVersionDelta ?? 0) <= 0 || dirtyRevisionDelta <= 0) {
    rejectionReason = 'unpublished-canonical-delta';
  }

  return {
    layerId,
    documentVersion: documentVersion ?? 0,
    documentVersionDelta: documentVersionDelta ?? 0,
    markType,
    phase: phase ?? null,
    status: rejectionReason ? 'rejected' : 'committed',
    changedPixels,
    normalizedCoverage,
    dirtyRevisionDelta,
    ...(affectedBounds ? { affectedBounds } : {}),
    changedChannels: changedChannels ?? [],
    ...(strokeSpan === undefined ? {} : { strokeSpan }),
    ...(rejectionReason === undefined ? {} : { rejectionReason }),
  };
};
