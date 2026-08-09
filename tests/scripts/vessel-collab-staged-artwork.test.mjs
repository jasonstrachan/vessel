import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { preflightArtworkJob } from '../../scripts/vessel-collab-artwork-job.mjs';
import { createStagedArtworkExpander } from '../../scripts/vessel-collab-staged-artwork.mjs';

const createCache = () => ({
  schemaVersion: 1,
  workflowId: 'reference-study-v1',
  sourceFingerprint: 'sha256:reference-1',
  project: { id: 'project-1', width: 100, height: 120 },
  stages: [
    {
      id: 'broad-structure',
      capture: 'final-thumbnail',
      thumbnailMaxSize: 512,
      gestureBudget: 2,
      setupOperations: [{ action: 'set-tool', tool: 'brush' }],
      candidates: [
        {
          id: 'dominant-mass',
          operations: [{
            action: 'shape',
            phase: 'primary',
            points: [
              { x: 10, y: 10 },
              { x: 50, y: 10 },
              { x: 50, y: 70 },
              { x: 10, y: 70 },
            ],
          }],
        },
      ],
    },
    {
      id: 'close-review',
      capture: 'full',
      thumbnailMaxSize: 512,
      gestureBudget: 0,
      candidates: [],
    },
  ],
});

test('staged artwork reuses cached candidates and emits one configured checkpoint', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'vessel-staged-artwork-'));
  const cachePath = path.join(directory, 'cache.json');
  await fs.writeFile(cachePath, JSON.stringify(createCache()));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const expander = createStagedArtworkExpander();
  const baseCommand = {
    action: 'artwork-stage',
    requestId: 'broad-structure-1',
    cacheFile: cachePath,
    workflowId: 'reference-study-v1',
    sourceFingerprint: 'sha256:reference-1',
    stageId: 'broad-structure',
    candidateIds: ['dominant-mass'],
    adjustments: {
      'dominant-mass': { translateX: 5, translateY: 3 },
    },
    runtimeFence: {
      expectedProjectId: 'project-1',
      expectedProjectRevision: 4,
    },
  };

  const first = await expander.expand(baseCommand, {
    project: { id: 'project-1', width: 100, height: 120 },
  });
  const validated = preflightArtworkJob(first.command);
  assert.equal(first.stageEvidence.cacheHit, false);
  assert.equal(first.stageEvidence.gestureCount, 1);
  assert.deepEqual(validated.operations[1].points[0], { x: 15, y: 13 });
  assert.deepEqual(validated.operations.at(-1), {
    action: 'checkpoint',
    name: 'broad-structure',
    capture: 'final-thumbnail',
    thumbnailMaxSize: 512,
  });

  const second = await expander.expand({
    ...baseCommand,
    requestId: 'broad-structure-2',
  });
  assert.equal(second.stageEvidence.cacheHit, true);
  assert.equal(second.stageEvidence.cacheId, first.stageEvidence.cacheId);
});

test('staged artwork supports a zero-gesture full-resolution review gate', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'vessel-staged-review-'));
  const cachePath = path.join(directory, 'cache.json');
  await fs.writeFile(cachePath, JSON.stringify(createCache()));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const expander = createStagedArtworkExpander();

  const expanded = await expander.expand({
    action: 'artwork-stage',
    cacheFile: cachePath,
    stageId: 'close-review',
    runtimeFence: {
      expectedProjectId: 'project-1',
      expectedProjectRevision: 5,
    },
  });

  assert.deepEqual(expanded.command.operations, [{
    action: 'checkpoint',
    name: 'close-review',
    capture: 'full',
    thumbnailMaxSize: 512,
  }]);
  assert.equal(expanded.stageEvidence.gestureCount, 0);
  assert.doesNotThrow(() => preflightArtworkJob(expanded.command));
});

test('staged artwork rejects budget overflow and stale project caches', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'vessel-staged-reject-'));
  const cachePath = path.join(directory, 'cache.json');
  await fs.writeFile(cachePath, JSON.stringify(createCache()));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const expander = createStagedArtworkExpander();
  const command = {
    action: 'artwork-stage',
    cacheFile: cachePath,
    stageId: 'broad-structure',
    candidateIds: ['dominant-mass'],
    residualOperations: [
      { action: 'stroke', phase: 'primary', points: [{ x: 1, y: 1 }] },
      { action: 'stroke', phase: 'primary', points: [{ x: 2, y: 2 }] },
    ],
    runtimeFence: {
      expectedProjectId: 'project-1',
      expectedProjectRevision: 5,
    },
  };

  await assert.rejects(
    expander.expand(command),
    /contains 3 gestures, exceeding its budget of 2/,
  );
  await assert.rejects(
    expander.expand({ ...command, residualOperations: [] }, {
      project: { id: 'project-2', width: 100, height: 120 },
    }),
    /cache does not match the current Vessel project/,
  );
});

test('local artwork preflight rejects stale dimensions and malformed pressure before dispatch', () => {
  const command = {
    action: 'artwork-job',
    runtimeFence: {
      expectedProjectId: 'project-1',
      expectedProjectRevision: 2,
    },
    canvas: { width: 100, height: 120 },
    operations: [
      {
        action: 'stroke',
        phase: 'primary',
        points: [{ x: 10, y: 10, pressure: 2 }],
      },
      { action: 'checkpoint', name: 'structure' },
    ],
  };

  assert.throws(
    () => preflightArtworkJob(command, {
      project: { id: 'project-1', width: 101, height: 120 },
    }),
    /canvas does not match the current Vessel project/,
  );
  assert.throws(
    () => preflightArtworkJob(command),
    /pressure must be between 0 and 1/,
  );
});
