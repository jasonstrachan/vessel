import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { compactVesselCollaborationResult } from './vessel-collab-artifacts.mjs';
import { preflightArtworkJob } from './vessel-collab-artwork-job.mjs';
import { createVesselCollaborationBridgeClient } from './vessel-collab-client.mjs';
import { createStagedArtworkExpander } from './vessel-collab-staged-artwork.mjs';

const requireSafeSession = (value) => {
  const session = value || 'default';
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/i.test(session)) {
    throw new Error('Session must use 1-64 letters, numbers, dashes, or underscores');
  }
  return session;
};

const readSessionState = async (session) => {
  const statePath = path.join(os.tmpdir(), `vessel-collab-${session}.json`);
  const state = JSON.parse(await fs.readFile(statePath, 'utf8'));
  const url = new URL(String(state?.url));
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(url.hostname)) {
    throw new Error('Vessel collaboration state is missing a valid localhost bridge URL');
  }
  if (typeof state?.token !== 'string' || state.token.length === 0) {
    throw new Error('Vessel collaboration state is missing its bridge credential');
  }
  return { ...state, url: url.origin };
};

const compactCheckpointEvent = (event) => ({
  type: event.type,
  commandId: event.commandId,
  eventId: event.eventId,
  operationIndex: event.operationIndex,
  checkpointName: event.checkpointName,
  checkpointId: event.checkpointId,
  completedOperations: event.completedOperations,
  totalOperations: event.totalOperations,
  revision: event.revision,
  priorityCoverage: event.priorityCoverage,
  frame: event.frame ? {
    kind: event.frame.kind,
    width: event.frame.width,
    height: event.frame.height,
    sourceWidth: event.frame.sourceWidth,
    sourceHeight: event.frame.sourceHeight,
  } : undefined,
});

const emitFrame = async (frame, emitImage) => {
  if (!frame?.dataUrl) return;
  await emitImage(frame.dataUrl);
};

export const createVesselCollaborationToolSession = async ({
  session: sessionValue,
  emitImage,
  client: injectedClient,
  state: injectedState,
} = {}) => {
  if (typeof emitImage !== 'function') {
    throw new Error('createVesselCollaborationToolSession requires an emitImage callback');
  }
  const session = requireSafeSession(sessionValue);
  const state = injectedState ?? await readSessionState(session);
  const client = injectedClient ?? createVesselCollaborationBridgeClient(state);
  const stagedArtworkExpander = createStagedArtworkExpander();
  let lastProject = null;
  let lastRevision = 0;
  let lastCheckpointId = null;

  const send = async (input, { requestId, timeoutMs } = {}) => {
    let command = structuredClone(input);
    if (!command || typeof command !== 'object' || Array.isArray(command)) {
      throw new Error('Vessel tool input must be one command object');
    }
    const resolvedRequestId = requestId ?? command.requestId ?? crypto.randomUUID();
    command.requestId = resolvedRequestId;
    if ((command.action === 'artwork-job' || command.action === 'artwork-stage') &&
        lastProject && command.runtimeFence === undefined) {
      command.runtimeFence = {
        expectedProjectId: lastProject.id,
        expectedProjectRevision: lastRevision,
        expectedCheckpointId: lastCheckpointId,
      };
    }
    const staged = await stagedArtworkExpander.expand(command, {
      project: lastProject ?? undefined,
    });
    command = preflightArtworkJob(staged.command, {
      project: lastProject ?? undefined,
    });
    const checkpointEvents = [];
    const resolvedTimeoutMs = timeoutMs === undefined
      ? (command.action === 'artwork-job' ? null : 120000)
      : timeoutMs;
    const { result } = await client.send(command, {
      timeoutMs: resolvedTimeoutMs,
      requestId: resolvedRequestId,
      onEvent: async (event) => {
        if (event.type !== 'checkpoint') return;
        await emitFrame(event.frame, emitImage);
        checkpointEvents.push(compactCheckpointEvent(event));
      },
    });
    await emitFrame(result.frame, emitImage);
    if (Array.isArray(result.frames)) {
      for (const captured of result.frames) await emitFrame(captured.frame, emitImage);
    }
    if (typeof result.revision === 'number') lastRevision = result.revision;
    if (Object.hasOwn(result, 'checkpointId')) lastCheckpointId = result.checkpointId;
    lastProject = result.state?.project ?? lastProject;
    const committedStage = result.ok && checkpointEvents.length > 0
      ? stagedArtworkExpander.commit(staged.stageEvidence)
      : staged.stageEvidence;
    return {
      type: 'vessel-tool-result',
      session,
      stage: committedStage,
      checkpoints: checkpointEvents,
      completed: compactVesselCollaborationResult(result),
    };
  };

  return {
    send,
    observe: (options) => send({ action: 'observe', capture: 'none' }, options),
  };
};
