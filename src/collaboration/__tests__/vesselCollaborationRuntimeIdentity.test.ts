import { assertVesselCollaborationRuntimeFence } from '../vesselCollaborationRuntimeIdentity';

describe('assertVesselCollaborationRuntimeFence', () => {
  const identity = {
    protocolVersion: 2,
    runtimeBuildId: 'build-current',
    runtimeInstanceId: 'runtime-current',
    leaseEpoch: 7,
  };
  const fence = {
    ...identity,
    expectedProjectId: 'project-current',
    expectedProjectRevision: 14,
  };

  it('accepts only the claimed runtime and exact project revision', () => {
    expect(() => assertVesselCollaborationRuntimeFence({
      fence,
      identity,
      projectId: 'project-current',
      projectRevision: 14,
    })).not.toThrow();
    expect(() => assertVesselCollaborationRuntimeFence({
      fence: { ...fence, leaseEpoch: 6 },
      identity,
      projectId: 'project-current',
      projectRevision: 14,
    })).toThrow('stale or incompatible Vessel runtime');
    expect(() => assertVesselCollaborationRuntimeFence({
      fence,
      identity,
      projectId: 'project-current',
      projectRevision: 15,
    })).toThrow('stale Vessel project revision');
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
