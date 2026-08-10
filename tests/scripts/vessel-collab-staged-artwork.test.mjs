import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { preflightArtworkJob } from '../../scripts/vessel-collab-artwork-job.mjs';
import {
  createStagedArtworkExpander,
  summarizeShapeFootprints,
} from '../../scripts/vessel-collab-staged-artwork.mjs';

const createCache = () => ({
  schemaVersion: 4,
  workflowId: 'reference-study-v1',
  cacheIdentity: {
    referenceContentFingerprint: 'sha256:reference-1',
    referenceTransformFingerprint: 'sha256:contain-transform-1',
    plannerSchemaVersion: 'mass-planner-v3',
    coordinateConvention: 'vessel-canvas-pixels-v1',
  },
  massObservationPlan: {
    schemaVersion: 3,
    checkpointId: 'reference-observation-1',
    fingerprint: 'mass-plan-sha256-1',
    observedMassCount: 3,
  },
  project: { id: 'project-1', width: 100, height: 120 },
  stages: [
    {
      id: 'broad-structure',
      capture: 'final-thumbnail',
      thumbnailMaxSize: 512,
      gestureBudget: 2,
      pointBudget: 100,
      payloadByteBudget: 500000,
      setupOperations: [{ action: 'set-tool', tool: 'brush' }],
      candidates: [
        {
          id: 'dominant-mass',
          parentMassId: 'whole-canvas',
          sourceRegionId: 'reference-region-1',
          operations: [{
            action: 'shape',
            phase: 'establish',
            boundaryAnchorCount: 20,
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
      pointBudget: 0,
      payloadByteBudget: 500000,
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
    stageId: 'broad-structure',
    candidateIds: ['dominant-mass'],
    adjustments: {
      'dominant-mass': { translateX: 5, translateY: 3 },
    },
    runtimeFence: {
      expectedProjectId: 'project-1',
      expectedProjectRevision: 4,
      expectedCheckpointId: null,
    },
    decision: {
      status: 'advance',
      basedOnRevision: 4,
      basedOnCheckpointId: null,
    },
  };

  const first = await expander.expand(baseCommand, {
    project: { id: 'project-1', width: 100, height: 120 },
  });
  const validated = preflightArtworkJob(first.command);
  assert.equal(first.stageEvidence.cacheHit, false);
  assert.equal(first.stageEvidence.gestureCount, 1);
  assert.deepEqual(validated.operations[1].points[0], { x: 15, y: 13 });
  assert.equal(validated.operations[1].id, 'dominant-mass:1');
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
      expectedCheckpointId: null,
    },
    decision: {
      status: 'advance',
      basedOnRevision: 5,
      basedOnCheckpointId: null,
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
      {
        id: 'repair-1',
        action: 'stroke',
        phase: 'establish',
        basedOnRevision: 5,
        parentMassId: 'dominant-mass',
        sourceRegionId: 'reference-region-2',
        points: [{ x: 1, y: 1 }],
      },
      {
        id: 'repair-2',
        action: 'stroke',
        phase: 'establish',
        basedOnRevision: 5,
        parentMassId: 'dominant-mass',
        sourceRegionId: 'reference-region-3',
        points: [{ x: 2, y: 2 }],
      },
    ],
    runtimeFence: {
      expectedProjectId: 'project-1',
      expectedProjectRevision: 5,
      expectedCheckpointId: null,
    },
    decision: {
      status: 'continue-current',
      basedOnRevision: 5,
      basedOnCheckpointId: null,
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
      expectedCheckpointId: null,
    },
    canvas: { width: 100, height: 120 },
    operations: [
      {
        action: 'stroke',
        id: 'invalid-pressure',
        phase: 'establish',
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

test('local artwork preflight binds planned shapes to observed mass evidence', () => {
  const points = Array.from({ length: 20 }, (_, index) => {
    const angle = index / 20 * Math.PI * 2;
    return { x: 50 + Math.cos(angle) * 20, y: 60 + Math.sin(angle) * 25 };
  });
  const command = {
    action: 'artwork-job',
    runtimeFence: {
      expectedProjectId: 'project-1',
      expectedProjectRevision: 2,
      expectedCheckpointId: 'visible-checkpoint-1',
    },
    canvas: { width: 100, height: 120 },
    massObservationPlan: {
      schemaVersion: 3,
      checkpointId: 'visible-checkpoint-1',
      fingerprint: 'mass-plan-sha256-1',
      observedMassCount: 1,
      basedOnRevision: 2,
      basedOnCheckpointId: 'visible-checkpoint-1',
    },
    operations: [
      {
        action: 'shape',
        id: 'cheek-light-plane',
        phase: 'deepen',
        parentMassId: 'head-mid-plane',
        sourceRegionId: 'reference-cheek-light-1',
        boundaryAnchorCount: 20,
        points,
      },
      { action: 'checkpoint', name: 'deepen-review' },
    ],
  };

  assert.doesNotThrow(() => preflightArtworkJob(command));
  const genericBlob = structuredClone(command);
  delete genericBlob.operations[0].sourceRegionId;
  assert.throws(
    () => preflightArtworkJob(genericBlob),
    /sourceRegionId/,
  );
});

test('staged artwork invalidates changed cache files and rejects stale residual provenance', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'vessel-staged-cache-refresh-'));
  const cachePath = path.join(directory, 'cache.json');
  const cache = createCache();
  await fs.writeFile(cachePath, JSON.stringify(cache));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const expander = createStagedArtworkExpander();
  const command = {
    action: 'artwork-stage',
    cacheFile: cachePath,
    stageId: 'broad-structure',
    candidateIds: ['dominant-mass'],
    runtimeFence: {
      expectedProjectId: 'project-1',
      expectedProjectRevision: 7,
      expectedCheckpointId: 'checkpoint-6',
    },
    decision: {
      status: 'continue-current',
      basedOnRevision: 7,
      basedOnCheckpointId: 'checkpoint-6',
    },
  };
  const first = await expander.expand(command);
  assert.equal(first.stageEvidence.cacheHit, false);
  const second = await expander.expand(command);
  assert.equal(second.stageEvidence.cacheHit, true);

  cache.massObservationPlan.fingerprint = 'mass-plan-sha256-2';
  await fs.writeFile(cachePath, JSON.stringify(cache));
  const refreshed = await expander.expand(command);
  assert.equal(refreshed.stageEvidence.cacheHit, false);
  assert.notEqual(refreshed.stageEvidence.cacheId, first.stageEvidence.cacheId);

  await assert.rejects(expander.expand({
    ...command,
    candidateIds: [],
    residualOperations: [{
      id: 'jaw-shadow-repair-1',
      action: 'shape',
      phase: 'deepen',
      basedOnRevision: 6,
      parentMassId: 'head-shadow',
      sourceRegionId: 'reference-region-17',
      points: [{ x: 10, y: 10 }, { x: 30, y: 10 }, { x: 20, y: 30 }],
    }],
  }), /was not derived from the fenced revision/);
});

test('staged artwork enforces point and payload limits after expansion', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'vessel-staged-complexity-'));
  const cachePath = path.join(directory, 'cache.json');
  const cache = createCache();
  cache.stages[0].pointBudget = 3;
  await fs.writeFile(cachePath, JSON.stringify(cache));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const command = {
    action: 'artwork-stage',
    cacheFile: cachePath,
    stageId: 'broad-structure',
    candidateIds: ['dominant-mass'],
    runtimeFence: {
      expectedProjectId: 'project-1',
      expectedProjectRevision: 1,
      expectedCheckpointId: null,
    },
    decision: { status: 'advance', basedOnRevision: 1, basedOnCheckpointId: null },
  };
  await assert.rejects(createStagedArtworkExpander().expand(command), /contains 4 points/);

  cache.stages[0].pointBudget = 100;
  cache.stages[0].payloadByteBudget = 100;
  await fs.writeFile(cachePath, JSON.stringify(cache));
  await assert.rejects(createStagedArtworkExpander().expand(command), /payload is .* bytes/);
});

test('footprint evidence uses robust percentiles and accumulates only committed checkpoints', async (t) => {
  assert.deepEqual(summarizeShapeFootprints(
    [1, 2, 4, 8, 16, 32, 64, 2000, 20000, 100000],
    1000000,
  ), {
    shapeCount: 10,
    p10: 1,
    p50: 16,
    p90: 20000,
    max: 100000,
    p90P10Ratio: 20000,
    scaleBands: ['micro', 'small', 'medium', 'large'],
  });

  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'vessel-staged-footprints-'));
  const cachePath = path.join(directory, 'cache.json');
  await fs.writeFile(cachePath, JSON.stringify(createCache()));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const expander = createStagedArtworkExpander();
  const expanded = await expander.expand({
    action: 'artwork-stage',
    requestId: 'footprint-primary-1',
    cacheFile: cachePath,
    stageId: 'broad-structure',
    candidateIds: ['dominant-mass'],
    runtimeFence: {
      expectedProjectId: 'project-1',
      expectedProjectRevision: 1,
      expectedCheckpointId: null,
    },
    decision: { status: 'advance', basedOnRevision: 1, basedOnCheckpointId: null },
  });
  assert.equal(expanded.stageEvidence.footprintStatistics.shapeCount, 1);
  expander.commit(expanded.stageEvidence);
  expander.commit(expanded.stageEvidence);
  const repair = await expander.expand({
    action: 'artwork-stage',
    cacheFile: cachePath,
    stageId: 'broad-structure',
    candidateIds: [],
    residualOperations: [{
      id: 'small-repair',
      action: 'shape',
      phase: 'establish',
      basedOnRevision: 2,
      parentMassId: 'dominant-mass',
      sourceRegionId: 'reference-region-2',
      points: [{ x: 1, y: 1 }, { x: 3, y: 1 }, { x: 2, y: 3 }],
    }],
    runtimeFence: {
      expectedProjectId: 'project-1',
      expectedProjectRevision: 2,
      expectedCheckpointId: 'checkpoint-1',
    },
    decision: {
      status: 'continue-current',
      basedOnRevision: 2,
      basedOnCheckpointId: 'checkpoint-1',
    },
  });
  assert.equal(repair.stageEvidence.footprintStatistics.shapeCount, 2);
});
