export const VESSEL_COLLABORATION_PROTOCOL_VERSION = 3;

export interface VesselCollaborationRuntimeIdentity {
  protocolVersion: number;
  runtimeBuildId: string;
  runtimeInstanceId: string;
  leaseEpoch: number;
}

export interface VesselCollaborationRuntimeFence extends VesselCollaborationRuntimeIdentity {
  expectedProjectId?: string | null;
  expectedProjectRevision?: number;
  expectedCheckpointId?: string | null;
}

const runtimeInstanceId = typeof crypto !== 'undefined' && 'randomUUID' in crypto
  ? crypto.randomUUID()
  : `runtime-${Math.random().toString(36).slice(2)}`;

export const createVesselCollaborationRuntimeIdentity = (
  leaseEpoch = 0,
): VesselCollaborationRuntimeIdentity => ({
  protocolVersion: VESSEL_COLLABORATION_PROTOCOL_VERSION,
  runtimeBuildId: process.env.BUILD_TIMESTAMP ?? 'development',
  runtimeInstanceId,
  leaseEpoch,
});

export const assertVesselCollaborationRuntimeFence = ({
  fence,
  identity,
  projectId,
  projectRevision,
  checkpointId,
}: {
  fence: VesselCollaborationRuntimeFence | undefined;
  identity: VesselCollaborationRuntimeIdentity;
  projectId: string | null;
  projectRevision: number;
  checkpointId?: string | null;
}) => {
  if (!fence) {
    throw new Error('Collaboration command is missing its runtime fence');
  }
  if (
    fence.protocolVersion !== identity.protocolVersion ||
    fence.runtimeBuildId !== identity.runtimeBuildId ||
    fence.runtimeInstanceId !== identity.runtimeInstanceId ||
    fence.leaseEpoch !== identity.leaseEpoch
  ) {
    throw new Error('Collaboration command targets a stale or incompatible Vessel runtime');
  }
  if (
    fence.expectedProjectId !== undefined &&
    fence.expectedProjectId !== projectId
  ) {
    throw new Error('Collaboration command targets a different Vessel project');
  }
  if (
    fence.expectedProjectRevision !== undefined &&
    fence.expectedProjectRevision !== projectRevision
  ) {
    throw new Error('Collaboration command targets a stale Vessel project revision');
  }
  if (
    fence.expectedCheckpointId !== undefined &&
    fence.expectedCheckpointId !== (checkpointId ?? null)
  ) {
    throw new Error('Collaboration command targets a stale Vessel checkpoint');
  }
};
