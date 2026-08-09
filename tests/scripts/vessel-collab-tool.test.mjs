import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createVesselCollaborationToolSession } from '../../scripts/vessel-collab-tool.mjs';

test('tool adapter emits the committed checkpoint image and compact evidence together', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'vessel-tool-stage-'));
  const cachePath = path.join(directory, 'cache.json');
  await fs.writeFile(cachePath, JSON.stringify({
    schemaVersion: 1,
    workflowId: 'general-artwork-v1',
    project: { id: 'project-1', width: 64, height: 80 },
    stages: [{
      id: 'close-review',
      capture: 'full',
      gestureBudget: 0,
      candidates: [],
    }],
  }));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const emittedImages = [];
  const deliveredCommands = [];
  const deliveredOptions = [];
  const client = {
    send: async (command, options) => {
      deliveredCommands.push(command);
      deliveredOptions.push(options);
      if (command.action === 'observe') {
        return {
          result: {
            ok: true,
            commandId: '00000000-0000-4000-8000-000000000001',
            action: 'observe',
            revision: 2,
            state: { project: { id: 'project-1', width: 64, height: 80 } },
          },
        };
      }
      await options.onEvent({
        type: 'checkpoint',
        commandId: '00000000-0000-4000-8000-000000000002',
        eventId: 'checkpoint-1',
        operationIndex: 0,
        checkpointName: 'close-review',
        completedOperations: 1,
        totalOperations: 1,
        revision: 2,
        frame: {
          kind: 'full',
          width: 64,
          height: 80,
          sourceWidth: 64,
          sourceHeight: 80,
          dataUrl: 'data:image/png;base64,aW1hZ2U=',
        },
      });
      return {
        result: {
          ok: true,
          commandId: '00000000-0000-4000-8000-000000000002',
          action: 'artwork-job',
          revision: 2,
          completedOperations: 1,
          state: { project: { id: 'project-1', width: 64, height: 80 } },
        },
      };
    },
  };
  const toolSession = await createVesselCollaborationToolSession({
    session: 'test',
    state: { url: 'http://127.0.0.1:4317', token: 'test' },
    client,
    emitImage: async (dataUrl) => emittedImages.push(dataUrl),
  });

  await toolSession.observe();
  const response = await toolSession.send({
    action: 'artwork-stage',
    requestId: 'review-1',
    cacheFile: cachePath,
    stageId: 'close-review',
  });

  assert.deepEqual(emittedImages, ['data:image/png;base64,aW1hZ2U=']);
  assert.equal(deliveredCommands[1].action, 'artwork-job');
  assert.deepEqual(deliveredCommands[1].runtimeFence, {
    expectedProjectId: 'project-1',
    expectedProjectRevision: 2,
  });
  assert.equal(deliveredCommands[1].operations[0].capture, 'full');
  assert.equal(deliveredOptions[0].timeoutMs, 120000);
  assert.match(
    deliveredOptions[0].requestId,
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  );
  assert.equal(deliveredOptions[1].timeoutMs, null);
  assert.equal(response.stage.stageId, 'close-review');
  assert.equal(response.checkpoints[0].frame.kind, 'full');
  assert.equal(response.completed.revision, 2);
  assert.equal(response.completed.frame, undefined);
});
