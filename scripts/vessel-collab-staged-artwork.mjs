import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

const STAGE_CAPTURES = new Set(['final-thumbnail', 'full']);
const GESTURE_ACTIONS = new Set(['shape', 'stroke']);

const assertNoCheckpointOperations = (operations, label) => {
  const checkpointIndex = operations.findIndex((operation) => operation?.action === 'checkpoint');
  if (checkpointIndex >= 0) {
    throw new Error(`${label}[${checkpointIndex}] cannot define a checkpoint`);
  }
};

const requireRecord = (value, label) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value;
};

const requireIdentifier = (value, label) => {
  if (typeof value !== 'string' || !/^[a-z0-9][a-z0-9._:-]{0,127}$/i.test(value)) {
    throw new Error(`${label} must use 1-128 letters, numbers, dots, colons, dashes, or underscores`);
  }
  return value;
};

const requirePositiveInteger = (value, label) => {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${label} must be a positive integer`);
  }
  return value;
};

const requireNonNegativeInteger = (value, label) => {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative integer`);
  }
  return value;
};

const readCapture = (value, label) => {
  if (!STAGE_CAPTURES.has(value)) {
    throw new Error(`${label} must be final-thumbnail or full`);
  }
  return value;
};

const readTransform = (value, label) => {
  if (value === undefined) {
    return {
      translateX: 0,
      translateY: 0,
      scaleX: 1,
      scaleY: 1,
      rotationRadians: 0,
      originX: 0,
      originY: 0,
    };
  }
  const transform = requireRecord(value, label);
  const readFinite = (field, fallback) => {
    const candidate = transform[field] ?? fallback;
    if (!Number.isFinite(candidate)) throw new Error(`${label}.${field} must be finite`);
    return candidate;
  };
  return {
    translateX: readFinite('translateX', 0),
    translateY: readFinite('translateY', 0),
    scaleX: readFinite('scaleX', 1),
    scaleY: readFinite('scaleY', 1),
    rotationRadians: readFinite('rotationDegrees', 0) * Math.PI / 180,
    originX: readFinite('originX', 0),
    originY: readFinite('originY', 0),
  };
};

const transformPoint = (point, transform) => {
  const relativeX = (point.x - transform.originX) * transform.scaleX;
  const relativeY = (point.y - transform.originY) * transform.scaleY;
  const cosine = Math.cos(transform.rotationRadians);
  const sine = Math.sin(transform.rotationRadians);
  return {
    ...point,
    x: transform.originX + relativeX * cosine - relativeY * sine + transform.translateX,
    y: transform.originY + relativeX * sine + relativeY * cosine + transform.translateY,
  };
};

const transformOperation = (operation, transform) => {
  const cloned = structuredClone(operation);
  if (!GESTURE_ACTIONS.has(cloned.action)) return cloned;
  cloned.points = cloned.points.map((point) => transformPoint(point, transform));
  if (cloned.action === 'shape' && cloned.direction) {
    cloned.direction = cloned.direction.map((point) => transformPoint(point, transform));
  }
  return cloned;
};

const parseCache = (value, cachePath) => {
  const cache = requireRecord(value, 'Staged artwork cache');
  if (cache.schemaVersion !== 1) {
    throw new Error('Staged artwork cache schemaVersion must be 1');
  }
  const workflowId = requireIdentifier(cache.workflowId, 'Staged artwork cache workflowId');
  const sourceFingerprint = cache.sourceFingerprint === undefined
    ? undefined
    : requireIdentifier(
        cache.sourceFingerprint,
        'Staged artwork cache sourceFingerprint',
      );
  const project = requireRecord(cache.project, 'Staged artwork cache project');
  const projectId = requireIdentifier(project.id, 'Staged artwork cache project.id');
  const width = requirePositiveInteger(project.width, 'Staged artwork cache project.width');
  const height = requirePositiveInteger(project.height, 'Staged artwork cache project.height');
  if (!Array.isArray(cache.stages) || cache.stages.length === 0) {
    throw new Error('Staged artwork cache must contain stages');
  }
  const stageIds = new Set();
  const stages = cache.stages.map((stageValue, stageIndex) => {
    const stage = requireRecord(stageValue, `Staged artwork cache stages[${stageIndex}]`);
    const id = requireIdentifier(stage.id, `Staged artwork cache stages[${stageIndex}].id`);
    if (stageIds.has(id)) throw new Error(`Staged artwork stage ID is duplicated: ${id}`);
    stageIds.add(id);
    const capture = readCapture(
      stage.capture ?? 'final-thumbnail',
      `Staged artwork cache stages[${stageIndex}].capture`,
    );
    const gestureBudget = requireNonNegativeInteger(
      stage.gestureBudget,
      `Staged artwork cache stages[${stageIndex}].gestureBudget`,
    );
    const thumbnailMaxSize = stage.thumbnailMaxSize ?? 512;
    if (!Number.isInteger(thumbnailMaxSize) || thumbnailMaxSize < 256 || thumbnailMaxSize > 1024) {
      throw new Error(
        `Staged artwork cache stages[${stageIndex}].thumbnailMaxSize must be between 256 and 1024`,
      );
    }
    if (stage.candidates !== undefined && !Array.isArray(stage.candidates)) {
      throw new Error(`Staged artwork cache stages[${stageIndex}].candidates must be an array`);
    }
    if (stage.setupOperations !== undefined && !Array.isArray(stage.setupOperations)) {
      throw new Error(`Staged artwork cache stages[${stageIndex}].setupOperations must be an array`);
    }
    const candidates = stage.candidates ?? [];
    const candidateIds = new Set();
    const parsedCandidates = candidates.map((candidateValue, candidateIndex) => {
      const candidate = requireRecord(
        candidateValue,
        `Staged artwork cache stages[${stageIndex}].candidates[${candidateIndex}]`,
      );
      const candidateId = requireIdentifier(
        candidate.id,
        `Staged artwork cache stages[${stageIndex}].candidates[${candidateIndex}].id`,
      );
      if (candidateIds.has(candidateId)) {
        throw new Error(`Staged artwork candidate ID is duplicated in ${id}: ${candidateId}`);
      }
      candidateIds.add(candidateId);
      if (!Array.isArray(candidate.operations) || candidate.operations.length === 0) {
        throw new Error(`Staged artwork candidate ${candidateId} must contain operations`);
      }
      assertNoCheckpointOperations(
        candidate.operations,
        `Staged artwork candidate ${candidateId}.operations`,
      );
      return { id: candidateId, operations: structuredClone(candidate.operations) };
    });
    const setupOperations = stage.setupOperations ?? [];
    assertNoCheckpointOperations(
      setupOperations,
      `Staged artwork cache stages[${stageIndex}].setupOperations`,
    );
    return {
      id,
      capture,
      gestureBudget,
      thumbnailMaxSize,
      setupOperations: structuredClone(setupOperations),
      candidates: parsedCandidates,
    };
  });
  return {
    cachePath,
    cacheId: crypto.createHash('sha256').update(JSON.stringify(cache)).digest('hex'),
    workflowId,
    sourceFingerprint,
    project: { id: projectId, width, height },
    stages,
  };
};

export const createStagedArtworkExpander = () => {
  const cachesByPath = new Map();

  const loadCache = async (cacheFile) => {
    const cachePath = path.resolve(String(cacheFile));
    const cached = cachesByPath.get(cachePath);
    if (cached) return { cache: cached, cacheHit: true };
    const parsed = parseCache(
      JSON.parse(await fs.readFile(cachePath, 'utf8')),
      cachePath,
    );
    cachesByPath.set(cachePath, parsed);
    return { cache: parsed, cacheHit: false };
  };

  const expand = async (command, { project } = {}) => {
    if (command.action !== 'artwork-stage') return { command, stageEvidence: undefined };
    if (!command.cacheFile) throw new Error('artwork-stage requires cacheFile');
    const { cache, cacheHit } = await loadCache(command.cacheFile);
    if (command.workflowId !== undefined && command.workflowId !== cache.workflowId) {
      throw new Error('artwork-stage workflowId does not match its cache');
    }
    if (command.sourceFingerprint !== undefined &&
        command.sourceFingerprint !== cache.sourceFingerprint) {
      throw new Error('artwork-stage sourceFingerprint does not match its cache');
    }
    const currentProject = project ?? cache.project;
    if (currentProject.id !== cache.project.id ||
        currentProject.width !== cache.project.width ||
        currentProject.height !== cache.project.height) {
      throw new Error('artwork-stage cache does not match the current Vessel project');
    }
    if (command.runtimeFence?.expectedProjectId !== undefined &&
        command.runtimeFence.expectedProjectId !== cache.project.id) {
      throw new Error('artwork-stage runtime fence does not match its cached project');
    }
    const stageId = requireIdentifier(command.stageId, 'artwork-stage stageId');
    const stage = cache.stages.find((candidate) => candidate.id === stageId);
    if (!stage) throw new Error(`artwork-stage cache does not contain stage ${stageId}`);
    const selectedIds = command.candidateIds ?? [];
    if (!Array.isArray(selectedIds)) throw new Error('artwork-stage candidateIds must be an array');
    if (new Set(selectedIds).size !== selectedIds.length) {
      throw new Error('artwork-stage candidateIds must be unique');
    }
    const adjustments = command.adjustments === undefined
      ? {}
      : requireRecord(command.adjustments, 'artwork-stage adjustments');
    const candidatesById = new Map(stage.candidates.map((candidate) => [candidate.id, candidate]));
    const selectedOperations = [];
    for (const adjustedId of Object.keys(adjustments)) {
      if (!selectedIds.includes(adjustedId)) {
        throw new Error(`artwork-stage adjustment targets unselected candidate ${adjustedId}`);
      }
    }
    for (const candidateIdValue of selectedIds) {
      const candidateId = requireIdentifier(candidateIdValue, 'artwork-stage candidateId');
      const candidate = candidatesById.get(candidateId);
      if (!candidate) throw new Error(`artwork-stage stage ${stageId} has no candidate ${candidateId}`);
      const transform = readTransform(adjustments[candidateId], `artwork-stage adjustments.${candidateId}`);
      selectedOperations.push(
        ...candidate.operations.map((operation) => transformOperation(operation, transform)),
      );
    }
    const residualOperations = command.residualOperations === undefined
      ? []
      : command.residualOperations;
    if (!Array.isArray(residualOperations)) {
      throw new Error('artwork-stage residualOperations must be an array');
    }
    assertNoCheckpointOperations(residualOperations, 'artwork-stage residualOperations');
    const operations = [
      ...structuredClone(stage.setupOperations),
      ...selectedOperations,
      ...structuredClone(residualOperations),
    ];
    const gestureCount = operations.filter((operation) => GESTURE_ACTIONS.has(operation.action)).length;
    if (gestureCount > stage.gestureBudget) {
      throw new Error(
        `artwork-stage ${stageId} contains ${gestureCount} gestures, exceeding its budget of ${stage.gestureBudget}`,
      );
    }
    operations.push({
      action: 'checkpoint',
      name: command.checkpointName ?? stage.id,
      capture: readCapture(command.capture ?? stage.capture, 'artwork-stage capture'),
      thumbnailMaxSize: command.thumbnailMaxSize ?? stage.thumbnailMaxSize,
    });
    return {
      command: {
        action: 'artwork-job',
        requestId: command.requestId,
        runtimeFence: command.runtimeFence,
        canvas: { width: cache.project.width, height: cache.project.height },
        capture: 'none',
        operations,
      },
      stageEvidence: {
        type: 'stage-prepared',
        workflowId: cache.workflowId,
        sourceFingerprint: cache.sourceFingerprint,
        stageId,
        cacheId: cache.cacheId,
        cacheHit,
        selectedCandidateCount: selectedIds.length,
        residualGestureCount: residualOperations.filter(
          (operation) => GESTURE_ACTIONS.has(operation?.action),
        ).length,
        gestureCount,
        gestureBudget: stage.gestureBudget,
        capture: command.capture ?? stage.capture,
      },
    };
  };

  return { expand };
};
