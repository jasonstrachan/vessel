import fs from 'node:fs/promises';
import path from 'node:path';

import geometryCore from '../src/collaboration/vesselCollaborationGeometryCore.cjs';

const MAX_ARTWORK_JOB_OPERATIONS = 2000;
const MAX_ARTWORK_JOB_POINTS = 250000;
const MAX_PRIORITY_MASK_PIXELS = 4_000_000;
const ARTWORK_JOB_ACTIONS = new Set([
  'stroke',
  'shape',
  'checkpoint',
  'set-tool',
  'set-brush-preset',
  'set-brush',
  'set-palette',
  'set-gradient-source',
  'set-gradient',
  'set-eraser',
]);
const ARTWORK_JOB_PHASES = new Set(['establish', 'develop', 'deepen']);
const CHECKPOINT_CAPTURES = new Set(['final-thumbnail', 'full']);

const readCanvas = (command, project) => {
  const canvas = command.canvas ?? project;
  if (canvas === undefined) return undefined;
  if (!canvas || typeof canvas !== 'object' || Array.isArray(canvas) ||
      !Number.isInteger(canvas.width) || canvas.width < 1 ||
      !Number.isInteger(canvas.height) || canvas.height < 1) {
    throw new Error('Artwork job canvas must contain positive integer width and height');
  }
  if (command.canvas && project &&
      (command.canvas.width !== project.width || command.canvas.height !== project.height)) {
    throw new Error('Artwork job canvas does not match the current Vessel project');
  }
  return { width: canvas.width, height: canvas.height };
};

const assertCheckpoint = (operation, index, checkpointNames) => {
  if (typeof operation.name !== 'string' || operation.name.trim().length === 0) {
    throw new Error(`Artwork job checkpoint ${index} requires a name`);
  }
  if (operation.name.trim().length > 64) {
    throw new Error(`Artwork job checkpoint ${index} name cannot exceed 64 characters`);
  }
  if (checkpointNames.has(operation.name)) {
    throw new Error('Artwork job checkpoint names must be unique');
  }
  if (operation.capture !== undefined && !CHECKPOINT_CAPTURES.has(operation.capture)) {
    throw new Error(`Artwork job checkpoint ${index} capture must be final-thumbnail or full`);
  }
  if (operation.thumbnailMaxSize !== undefined &&
      (!Number.isInteger(operation.thumbnailMaxSize) ||
        operation.thumbnailMaxSize < 256 || operation.thumbnailMaxSize > 1024)) {
    throw new Error(`Artwork job checkpoint ${index} thumbnailMaxSize must be between 256 and 1024`);
  }
  checkpointNames.add(operation.name);
};

const assertIdentifier = (value, label) => {
  if (typeof value !== 'string' || !/^[a-z0-9][a-z0-9._:-]{0,127}$/i.test(value)) {
    throw new Error(`${label} must use 1-128 safe identifier characters`);
  }
};

const readMassObservationPlan = (value) => {
  if (value === undefined) return undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Artwork job massObservationPlan must be an object');
  }
  if (value.schemaVersion !== 3) {
    throw new Error('Artwork job massObservationPlan schemaVersion must be 3');
  }
  assertIdentifier(value.checkpointId, 'Artwork job mass observation checkpointId');
  assertIdentifier(value.fingerprint, 'Artwork job mass observation fingerprint');
  if (!Number.isInteger(value.observedMassCount) || value.observedMassCount < 1) {
    throw new Error('Artwork job mass observation observedMassCount must be a positive integer');
  }
  if (!Number.isInteger(value.basedOnRevision) || value.basedOnRevision < 0 ||
      !Object.hasOwn(value, 'basedOnCheckpointId') ||
      (value.basedOnCheckpointId !== null &&
        (typeof value.basedOnCheckpointId !== 'string' || value.basedOnCheckpointId.length === 0))) {
    throw new Error('Artwork job mass observation requires revision and checkpoint provenance');
  }
  return value;
};

const assertPriorityCoverage = (coverage, canvas, expectedRevision) => {
  if (coverage === undefined) return;
  if (!coverage || typeof coverage !== 'object' || Array.isArray(coverage)) {
    throw new Error('Artwork job priorityCoverage must be an object');
  }
  assertIdentifier(coverage.priorityMaskId, 'Artwork job priorityMaskId');
  assertIdentifier(coverage.priorityMaskFingerprint, 'Artwork job priorityMaskFingerprint');
  if (!Number.isInteger(coverage.coverageBaselineRevision) ||
      coverage.coverageBaselineRevision < 0 ||
      coverage.coverageBaselineRevision > expectedRevision) {
    throw new Error('Artwork job coverage baseline must be a non-negative fenced revision');
  }
  if (!Number.isInteger(coverage.width) || !Number.isInteger(coverage.height) ||
      coverage.width < 1 || coverage.height < 1 ||
      (canvas && (coverage.width !== canvas.width || coverage.height !== canvas.height))) {
    throw new Error('Artwork job priority coverage dimensions must match the canvas');
  }
  if (!Array.isArray(coverage.spans) || coverage.spans.length === 0) {
    throw new Error('Artwork job priority coverage must contain spans');
  }
  const occupied = new Set();
  coverage.spans.forEach((span, index) => {
    if (!span || typeof span !== 'object' || Array.isArray(span) ||
        !Number.isInteger(span.y) || !Number.isInteger(span.xStart) ||
        !Number.isInteger(span.xEndExclusive) || span.y < 0 ||
        span.y >= coverage.height || span.xStart < 0 ||
        span.xStart >= span.xEndExclusive || span.xEndExclusive > coverage.width) {
      throw new Error(`Artwork job priority coverage span ${index} is invalid`);
    }
    for (let x = span.xStart; x < span.xEndExclusive; x += 1) {
      const pixel = span.y * coverage.width + x;
      if (occupied.has(pixel)) throw new Error('Artwork job priority coverage spans overlap');
      occupied.add(pixel);
      if (occupied.size > MAX_PRIORITY_MASK_PIXELS) {
        throw new Error('Artwork job priority coverage exceeds 4000000 pixels');
      }
    }
  });
};

export const preflightArtworkJob = (command, { project, requireCanvas = true } = {}) => {
  if (command.action !== 'artwork-job') return command;
  if (!Array.isArray(command.operations) || command.operations.length === 0) {
    throw new Error('Artwork job operations must contain at least one operation');
  }
  if (command.operations.length > MAX_ARTWORK_JOB_OPERATIONS) {
    throw new Error(
      `Artwork jobs cannot contain more than ${MAX_ARTWORK_JOB_OPERATIONS} operations`,
    );
  }
  if (command.capture === 'each-thumbnail') {
    throw new Error('Artwork jobs use named checkpoints instead of each-thumbnail capture');
  }
  if (!command.runtimeFence ||
      typeof command.runtimeFence.expectedProjectId !== 'string' ||
      command.runtimeFence.expectedProjectId.length === 0 ||
      !Number.isInteger(command.runtimeFence.expectedProjectRevision) ||
      command.runtimeFence.expectedProjectRevision < 0 ||
      !Object.hasOwn(command.runtimeFence, 'expectedCheckpointId') ||
      (command.runtimeFence.expectedCheckpointId !== null &&
        (typeof command.runtimeFence.expectedCheckpointId !== 'string' ||
          command.runtimeFence.expectedCheckpointId.length === 0))) {
    throw new Error(
      'Artwork jobs require runtimeFence project, revision, and checkpoint expectations',
    );
  }
  if (project && command.runtimeFence.expectedProjectId !== project.id) {
    throw new Error('Artwork job runtime fence does not match the current Vessel project');
  }

  const canvas = readCanvas(command, project);
  const massObservationPlan = readMassObservationPlan(command.massObservationPlan);
  if (massObservationPlan &&
      (massObservationPlan.basedOnRevision !== command.runtimeFence.expectedProjectRevision ||
       massObservationPlan.basedOnCheckpointId !== command.runtimeFence.expectedCheckpointId)) {
    throw new Error('Artwork job mass observation must match its revision and checkpoint fence');
  }
  assertPriorityCoverage(
    command.priorityCoverage,
    canvas,
    command.runtimeFence.expectedProjectRevision,
  );
  const checkpointNames = new Set();
  const gestureIds = new Set();
  const sourceRegionIds = new Set();
  let gestureCount = 0;
  let pointCount = 0;
  for (let index = 0; index < command.operations.length; index += 1) {
    const operation = command.operations[index];
    if (!operation || typeof operation !== 'object' || Array.isArray(operation) ||
        !ARTWORK_JOB_ACTIONS.has(operation.action)) {
      throw new Error(`Artwork job operation ${index} has an unsupported action`);
    }
    if (operation.action === 'checkpoint') {
      assertCheckpoint(operation, index, checkpointNames);
      continue;
    }
    if (operation.action !== 'stroke' && operation.action !== 'shape') continue;
    gestureCount += 1;
    if (!ARTWORK_JOB_PHASES.has(operation.phase)) {
      throw new Error(`Artwork job gesture ${index} requires a construction phase`);
    }
    assertIdentifier(operation.id, `Artwork job gesture ${index} id`);
    if (gestureIds.has(operation.id)) {
      throw new Error(`Artwork job gesture ID is duplicated: ${operation.id}`);
    }
    gestureIds.add(operation.id);
    if (operation.boundaryAnchorCount !== undefined &&
        (!Number.isInteger(operation.boundaryAnchorCount) ||
          operation.boundaryAnchorCount < 20 || operation.boundaryAnchorCount > 60)) {
      throw new Error(`Artwork job gesture ${index} boundaryAnchorCount must be between 20 and 60`);
    }
    if (massObservationPlan) {
      assertIdentifier(
        operation.sourceRegionId,
        `Artwork job gesture ${index} sourceRegionId`,
      );
      if (sourceRegionIds.has(operation.sourceRegionId)) {
        throw new Error('Artwork job mass-observed gestures must use distinct sourceRegionId values');
      }
      sourceRegionIds.add(operation.sourceRegionId);
      if (operation.action === 'shape' && operation.boundaryAnchorCount === undefined) {
        throw new Error(
          `Artwork job gesture ${index} boundaryAnchorCount is required by the mass observation plan`,
        );
      }
      if (operation.action === 'shape' && operation.phase !== 'establish') {
        assertIdentifier(
          operation.parentMassId,
          `Artwork job gesture ${index} parentMassId`,
        );
      }
    }
    if (operation.basedOnRevision !== undefined &&
        operation.basedOnRevision !== command.runtimeFence.expectedProjectRevision) {
      throw new Error(`Artwork job gesture ${index} was derived from a stale revision`);
    }
    if (operation.points?.length > 10000 || operation.direction?.length > 10000) {
      throw new Error(`Artwork job gesture ${index} cannot contain more than 10000 points per path`);
    }
    if (operation.pointsPerFrame !== undefined &&
        operation.pointsPerFrame !== 1 && operation.pointsPerFrame !== 2) {
      throw new Error(`Artwork job gesture ${index} pointsPerFrame must be 1 or 2`);
    }
    if (operation.action === 'stroke' && operation.pointsPerFrame === 2 &&
        operation.points.length > 16) {
      throw new Error(
        `Artwork job gesture ${index} pointsPerFrame can only be 2 for strokes with at most 16 points`,
      );
    }
    if (!canvas && requireCanvas) {
      throw new Error('Artwork jobs with gestures require known canvas dimensions before dispatch');
    }
    const geometryError = geometryCore.resolveGestureGeometryError({
      operation,
      canvasWidth: canvas?.width ?? Number.MAX_SAFE_INTEGER,
      canvasHeight: canvas?.height ?? Number.MAX_SAFE_INTEGER,
      label: `Artwork job gesture ${index}`,
    });
    if (geometryError) throw new Error(geometryError);
    pointCount += operation.points.length;
    if (operation.action === 'shape') pointCount += operation.direction?.length ?? 0;
  }
  if (checkpointNames.size !== 1 || command.operations.at(-1)?.action !== 'checkpoint') {
    throw new Error('Artwork jobs require exactly one final named checkpoint');
  }
  if (pointCount > MAX_ARTWORK_JOB_POINTS) {
    throw new Error(`Artwork jobs cannot contain more than ${MAX_ARTWORK_JOB_POINTS} points`);
  }
  if (massObservationPlan && gestureCount > massObservationPlan.observedMassCount) {
    throw new Error('Artwork job gestures exceed the observed mass inventory');
  }

  const expanded = { ...command };
  delete expanded.canvas;
  return expanded;
};

export const expandArtworkJobFile = async (command, options = {}) => {
  if (command.action !== 'artwork-job' || command.planFile === undefined) {
    return preflightArtworkJob(command, options);
  }
  const planPath = path.resolve(String(command.planFile));
  const plan = JSON.parse(await fs.readFile(planPath, 'utf8'));
  const planCommand = Array.isArray(plan) ? { operations: plan } : plan;
  if (!planCommand || typeof planCommand !== 'object' || Array.isArray(planCommand)) {
    throw new Error('Artwork job plan file must contain an object or operation array');
  }
  if (planCommand.action !== undefined && planCommand.action !== 'artwork-job') {
    throw new Error('Artwork job plan file has a conflicting action');
  }
  const expanded = {
    ...planCommand,
    ...command,
    action: 'artwork-job',
    operations: planCommand.operations,
    canvas: command.canvas ?? planCommand.canvas,
  };
  delete expanded.planFile;
  return preflightArtworkJob(expanded, options);
};
