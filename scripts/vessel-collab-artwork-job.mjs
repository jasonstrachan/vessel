import fs from 'node:fs/promises';
import path from 'node:path';

import geometryCore from '../src/collaboration/vesselCollaborationGeometryCore.cjs';

const MAX_ARTWORK_JOB_OPERATIONS = 2000;
const MAX_ARTWORK_JOB_POINTS = 250000;
const MAX_ARTWORK_JOB_CHECKPOINTS = 8;
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
const ARTWORK_JOB_PHASES = new Set(['primary', 'medium', 'focal', 'revision']);
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
      !Object.hasOwn(command.runtimeFence, 'expectedProjectId') ||
      !Number.isInteger(command.runtimeFence.expectedProjectRevision)) {
    throw new Error('Artwork jobs require runtimeFence.expectedProjectId and expectedProjectRevision');
  }
  if (project && command.runtimeFence.expectedProjectId !== project.id) {
    throw new Error('Artwork job runtime fence does not match the current Vessel project');
  }

  const canvas = readCanvas(command, project);
  const checkpointNames = new Set();
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
    if (!ARTWORK_JOB_PHASES.has(operation.phase)) {
      throw new Error(`Artwork job gesture ${index} requires a construction phase`);
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
  if (checkpointNames.size === 0) {
    throw new Error('Artwork jobs must contain at least one named checkpoint');
  }
  if (checkpointNames.size > MAX_ARTWORK_JOB_CHECKPOINTS) {
    throw new Error(
      `Artwork jobs cannot contain more than ${MAX_ARTWORK_JOB_CHECKPOINTS} checkpoints`,
    );
  }
  if (pointCount > MAX_ARTWORK_JOB_POINTS) {
    throw new Error(`Artwork jobs cannot contain more than ${MAX_ARTWORK_JOB_POINTS} points`);
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
