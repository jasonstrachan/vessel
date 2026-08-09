import { assertVesselCollaborationRuntimeFence } from '../vesselCollaborationRuntimeIdentity';

describe('assertVesselCollaborationRuntimeFence', () => {
  const identity = {
    protocolVersion: 3,
    runtimeBuildId: 'build-current',
    runtimeInstanceId: 'runtime-current',
    leaseEpoch: 7,
  };
  const fence = {
    ...identity,
    expectedProjectId: 'project-current',
    expectedProjectRevision: 14,
    expectedCheckpointId: 'checkpoint-current',
  };

  it('accepts only the claimed runtime and exact project revision', () => {
    expect(() => assertVesselCollaborationRuntimeFence({
      fence,
      identity,
      projectId: 'project-current',
      projectRevision: 14,
      checkpointId: 'checkpoint-current',
    })).not.toThrow();
    expect(() => assertVesselCollaborationRuntimeFence({
      fence: { ...fence, leaseEpoch: 6 },
      identity,
      projectId: 'project-current',
      projectRevision: 14,
      checkpointId: 'checkpoint-current',
    })).toThrow('stale or incompatible Vessel runtime');
    expect(() => assertVesselCollaborationRuntimeFence({
      fence,
      identity,
      projectId: 'project-current',
      projectRevision: 15,
      checkpointId: 'checkpoint-current',
    })).toThrow('stale Vessel project revision');
    expect(() => assertVesselCollaborationRuntimeFence({
      fence,
      identity,
      projectId: 'project-current',
      projectRevision: 14,
      checkpointId: 'checkpoint-stale',
    })).toThrow('stale Vessel checkpoint');
  });

  it('fails closed when the fence is absent', () => {
    expect(() => assertVesselCollaborationRuntimeFence({
      fence: undefined,
      identity,
      projectId: 'project-current',
      projectRevision: 14,
    })).toThrow('missing its runtime fence');
  });
});
