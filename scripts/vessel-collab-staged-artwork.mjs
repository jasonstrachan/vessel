import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

const STAGE_CAPTURES = new Set(['final-thumbnail', 'full']);
const GESTURE_ACTIONS = new Set(['shape', 'stroke']);
const ARTWORK_DECISIONS = new Set(['advance', 'repair-current', 'blocked']);
const COORDINATE_CONVENTIONS = new Set(['vessel-canvas-pixels-v1']);
const MAX_PRIORITY_MASK_PIXELS = 4_000_000;

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

const requireOptionalIdentifier = (value, label) => (
  value === undefined || value === null ? value : requireIdentifier(value, label)
);

const canonicalize = (value) => {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]),
  );
};

const fingerprint = (value) => crypto
  .createHash('sha256')
  .update(JSON.stringify(canonicalize(value)))
  .digest('hex');

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

const polygonArea = (points) => {
  if (!Array.isArray(points) || points.length < 3) return 0;
  let doubledArea = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    doubledArea += current.x * next.y - next.x * current.y;
  }
  return Math.abs(doubledArea) / 2;
};

const percentile = (sorted, proportion) => (
  sorted.length === 0 ? null : sorted[Math.floor((sorted.length - 1) * proportion)]
);

export const summarizeShapeFootprints = (areas, canvasArea) => {
  const sorted = areas.filter((area) => Number.isFinite(area) && area > 0).sort((a, b) => a - b);
  if (sorted.length === 0) {
    return {
      shapeCount: 0,
      p10: null,
      p50: null,
      p90: null,
      max: null,
      p90P10Ratio: null,
      scaleBands: [],
    };
  }
  const p10 = percentile(sorted, 0.1);
  const p50 = percentile(sorted, 0.5);
  const p90 = percentile(sorted, 0.9);
  const scaleBands = new Set(sorted.map((area) => {
    const normalized = canvasArea > 0 ? area / canvasArea : 0;
    if (normalized < 0.001) return 'micro';
    if (normalized < 0.01) return 'small';
    if (normalized < 0.1) return 'medium';
    return 'large';
  }));
  return {
    shapeCount: sorted.length,
    p10,
    p50,
    p90,
    max: sorted.at(-1),
    p90P10Ratio: p10 > 0 ? p90 / p10 : null,
    scaleBands: [...scaleBands],
  };
};

const readPriorityMasks = (value, width, height) => {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error('Staged artwork cache priorityMasks must be an array');
  const ids = new Set();
  return value.map((maskValue, maskIndex) => {
    const mask = requireRecord(maskValue, `Staged artwork cache priorityMasks[${maskIndex}]`);
    const id = requireIdentifier(mask.id, `Staged artwork cache priorityMasks[${maskIndex}].id`);
    if (ids.has(id)) throw new Error(`Staged artwork priority mask ID is duplicated: ${id}`);
    ids.add(id);
    if (!Array.isArray(mask.spans) || mask.spans.length === 0) {
      throw new Error(`Staged artwork priority mask ${id} must contain spans`);
    }
    const occupied = new Set();
    const spans = mask.spans.map((spanValue, spanIndex) => {
      const span = requireRecord(
        spanValue,
        `Staged artwork priority mask ${id}.spans[${spanIndex}]`,
      );
      const y = requireNonNegativeInteger(span.y, `Staged artwork priority mask ${id}.spans[${spanIndex}].y`);
      const xStart = requireNonNegativeInteger(
        span.xStart,
        `Staged artwork priority mask ${id}.spans[${spanIndex}].xStart`,
      );
      const xEndExclusive = requirePositiveInteger(
        span.xEndExclusive,
        `Staged artwork priority mask ${id}.spans[${spanIndex}].xEndExclusive`,
      );
      if (y >= height || xStart >= xEndExclusive || xEndExclusive > width) {
        throw new Error(`Staged artwork priority mask ${id} span ${spanIndex} is outside the canvas`);
      }
      for (let x = xStart; x < xEndExclusive; x += 1) {
        const pixel = y * width + x;
        if (occupied.has(pixel)) {
          throw new Error(`Staged artwork priority mask ${id} contains overlapping spans`);
        }
        occupied.add(pixel);
        if (occupied.size > MAX_PRIORITY_MASK_PIXELS) {
          throw new Error(`Staged artwork priority mask ${id} exceeds 4000000 pixels`);
        }
      }
      return { y, xStart, xEndExclusive };
    });
    return {
      id,
      fingerprint: fingerprint({ width, height, spans }),
      width,
      height,
      spans,
      pixelCount: occupied.size,
    };
  });
};

const parseCache = (value, cachePath) => {
  const cache = requireRecord(value, 'Staged artwork cache');
  if (cache.schemaVersion !== 2) {
    throw new Error('Staged artwork cache schemaVersion must be 2');
  }
  const workflowId = requireIdentifier(cache.workflowId, 'Staged artwork cache workflowId');
  const cacheIdentity = requireRecord(cache.cacheIdentity, 'Staged artwork cache cacheIdentity');
  const referenceContentFingerprint = requireIdentifier(
    cacheIdentity.referenceContentFingerprint,
    'Staged artwork cache cacheIdentity.referenceContentFingerprint',
  );
  const referenceTransformFingerprint = requireIdentifier(
    cacheIdentity.referenceTransformFingerprint,
    'Staged artwork cache cacheIdentity.referenceTransformFingerprint',
  );
  const plannerSchemaVersion = requireIdentifier(
    cacheIdentity.plannerSchemaVersion,
    'Staged artwork cache cacheIdentity.plannerSchemaVersion',
  );
  if (!COORDINATE_CONVENTIONS.has(cacheIdentity.coordinateConvention)) {
    throw new Error('Staged artwork cache coordinateConvention must be vessel-canvas-pixels-v1');
  }
  const project = requireRecord(cache.project, 'Staged artwork cache project');
  const projectId = requireIdentifier(project.id, 'Staged artwork cache project.id');
  const width = requirePositiveInteger(project.width, 'Staged artwork cache project.width');
  const height = requirePositiveInteger(project.height, 'Staged artwork cache project.height');
  const priorityMasks = readPriorityMasks(cache.priorityMasks, width, height);
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
    const pointBudget = requireNonNegativeInteger(
      stage.pointBudget,
      `Staged artwork cache stages[${stageIndex}].pointBudget`,
    );
    const payloadByteBudget = requirePositiveInteger(
      stage.payloadByteBudget,
      `Staged artwork cache stages[${stageIndex}].payloadByteBudget`,
    );
    const minimumScaleBands = stage.minimumScaleBands === undefined
      ? 1
      : requirePositiveInteger(
          stage.minimumScaleBands,
          `Staged artwork cache stages[${stageIndex}].minimumScaleBands`,
        );
    if (minimumScaleBands > 4) {
      throw new Error(`Staged artwork cache stages[${stageIndex}].minimumScaleBands cannot exceed 4`);
    }
    const minimumP90P10Ratio = stage.minimumP90P10Ratio === undefined
      ? undefined
      : Number(stage.minimumP90P10Ratio);
    if (minimumP90P10Ratio !== undefined &&
        (!Number.isFinite(minimumP90P10Ratio) || minimumP90P10Ratio < 1)) {
      throw new Error(
        `Staged artwork cache stages[${stageIndex}].minimumP90P10Ratio must be at least 1`,
      );
    }
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
      return {
        id: candidateId,
        parentMassId: requireOptionalIdentifier(
          candidate.parentMassId,
          `Staged artwork candidate ${candidateId}.parentMassId`,
        ),
        sourceRegionId: requireOptionalIdentifier(
          candidate.sourceRegionId,
          `Staged artwork candidate ${candidateId}.sourceRegionId`,
        ),
        operations: structuredClone(candidate.operations),
      };
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
      pointBudget,
      payloadByteBudget,
      minimumScaleBands,
      minimumP90P10Ratio,
      thumbnailMaxSize,
      setupOperations: structuredClone(setupOperations),
      candidates: parsedCandidates,
    };
  });
  return {
    cachePath,
    cacheId: fingerprint(cache),
    workflowId,
    cacheIdentity: {
      referenceContentFingerprint,
      referenceTransformFingerprint,
      canvas: { width, height },
      plannerSchemaVersion,
      coordinateConvention: cacheIdentity.coordinateConvention,
    },
    project: { id: projectId, width, height },
    priorityMasks,
    stages,
  };
};

export const createStagedArtworkExpander = () => {
  const cachesByPath = new Map();
  const committedFootprintsByStage = new Map();
  const committedStageRequests = new Set();

  const loadCache = async (cacheFile) => {
    const cachePath = path.resolve(String(cacheFile));
    const text = await fs.readFile(cachePath, 'utf8');
    const contentFingerprint = crypto.createHash('sha256').update(text).digest('hex');
    const cached = cachesByPath.get(cachePath);
    if (cached?.contentFingerprint === contentFingerprint) {
      return { cache: cached.cache, cacheHit: true };
    }
    const parsed = parseCache(
      JSON.parse(text),
      cachePath,
    );
    cachesByPath.set(cachePath, { contentFingerprint, cache: parsed });
    return { cache: parsed, cacheHit: false };
  };

  const expand = async (command, { project } = {}) => {
    if (command.action !== 'artwork-stage') return { command, stageEvidence: undefined };
    if (!command.cacheFile) throw new Error('artwork-stage requires cacheFile');
    const { cache, cacheHit } = await loadCache(command.cacheFile);
    if (command.workflowId !== undefined && command.workflowId !== cache.workflowId) {
      throw new Error('artwork-stage workflowId does not match its cache');
    }
    if (command.cacheId !== undefined && command.cacheId !== cache.cacheId) {
      throw new Error('artwork-stage cacheId does not match its cache');
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
    const expectedRevision = command.runtimeFence?.expectedProjectRevision;
    if (!Number.isInteger(expectedRevision) || expectedRevision < 0) {
      throw new Error('artwork-stage requires runtimeFence.expectedProjectRevision');
    }
    if (!Object.hasOwn(command.runtimeFence, 'expectedCheckpointId')) {
      throw new Error('artwork-stage requires runtimeFence.expectedCheckpointId');
    }
    const expectedCheckpointId = requireOptionalIdentifier(
      command.runtimeFence.expectedCheckpointId,
      'artwork-stage runtimeFence.expectedCheckpointId',
    );
    const decision = requireRecord(command.decision, 'artwork-stage decision');
    if (!ARTWORK_DECISIONS.has(decision.status)) {
      throw new Error('artwork-stage decision.status must be advance, repair-current, or blocked');
    }
    const decisionRevision = requireNonNegativeInteger(
      decision.basedOnRevision,
      'artwork-stage decision.basedOnRevision',
    );
    const decisionCheckpointId = requireOptionalIdentifier(
      decision.basedOnCheckpointId,
      'artwork-stage decision.basedOnCheckpointId',
    );
    if (decisionRevision !== expectedRevision || decisionCheckpointId !== expectedCheckpointId) {
      throw new Error('artwork-stage decision must match its revision and checkpoint fence');
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
      selectedOperations.push(...candidate.operations.map((operation, operationIndex) => {
        const transformed = transformOperation(operation, transform);
        if (!GESTURE_ACTIONS.has(transformed.action)) return transformed;
        return {
          ...transformed,
          id: transformed.id ?? `${candidateId}:${operationIndex + 1}`,
          ...(transformed.parentMassId ?? candidate.parentMassId
            ? { parentMassId: transformed.parentMassId ?? candidate.parentMassId }
            : {}),
          ...(transformed.sourceRegionId ?? candidate.sourceRegionId
            ? { sourceRegionId: transformed.sourceRegionId ?? candidate.sourceRegionId }
            : {}),
        };
      }));
    }
    const residualOperations = command.residualOperations === undefined
      ? []
      : command.residualOperations;
    if (!Array.isArray(residualOperations)) {
      throw new Error('artwork-stage residualOperations must be an array');
    }
    assertNoCheckpointOperations(residualOperations, 'artwork-stage residualOperations');
    residualOperations.forEach((operation, index) => {
      if (!GESTURE_ACTIONS.has(operation?.action)) return;
      requireIdentifier(operation.id, `artwork-stage residualOperations[${index}].id`);
      const basedOnRevision = requireNonNegativeInteger(
        operation.basedOnRevision,
        `artwork-stage residualOperations[${index}].basedOnRevision`,
      );
      requireIdentifier(
        operation.parentMassId,
        `artwork-stage residualOperations[${index}].parentMassId`,
      );
      requireIdentifier(
        operation.sourceRegionId,
        `artwork-stage residualOperations[${index}].sourceRegionId`,
      );
      if (basedOnRevision !== expectedRevision) {
        throw new Error(
          `artwork-stage residualOperations[${index}] was not derived from the fenced revision`,
        );
      }
    });
    const operations = [
      ...structuredClone(stage.setupOperations),
      ...selectedOperations,
      ...structuredClone(residualOperations),
    ];
    const gestureCount = operations.filter((operation) => GESTURE_ACTIONS.has(operation.action)).length;
    if (decision.status === 'blocked' && gestureCount > 0) {
      throw new Error('artwork-stage cannot dispatch gestures after a blocked decision');
    }
    if (gestureCount > stage.gestureBudget) {
      throw new Error(
        `artwork-stage ${stageId} contains ${gestureCount} gestures, exceeding its budget of ${stage.gestureBudget}`,
      );
    }
    const gestureIds = operations
      .filter((operation) => GESTURE_ACTIONS.has(operation.action))
      .map((operation) => requireIdentifier(operation.id, 'artwork-stage gesture id'));
    if (new Set(gestureIds).size !== gestureIds.length) {
      throw new Error('artwork-stage gesture IDs must be unique after expansion');
    }
    const pointCount = operations.reduce((total, operation) => {
      if (operation.action === 'stroke') return total + operation.points.length;
      if (operation.action === 'shape') {
        return total + operation.points.length + (operation.direction?.length ?? 0);
      }
      return total;
    }, 0);
    if (pointCount > stage.pointBudget) {
      throw new Error(
        `artwork-stage ${stageId} contains ${pointCount} points, exceeding its budget of ${stage.pointBudget}`,
      );
    }
    const priorityMaskId = command.priorityMaskId === undefined
      ? undefined
      : requireIdentifier(command.priorityMaskId, 'artwork-stage priorityMaskId');
    const coverageBaselineRevision = command.coverageBaselineRevision === undefined
      ? undefined
      : requireNonNegativeInteger(
          command.coverageBaselineRevision,
          'artwork-stage coverageBaselineRevision',
        );
    if ((priorityMaskId === undefined) !== (coverageBaselineRevision === undefined)) {
      throw new Error(
        'artwork-stage priorityMaskId and coverageBaselineRevision must be provided together',
      );
    }
    const priorityMask = priorityMaskId === undefined
      ? undefined
      : cache.priorityMasks.find((mask) => mask.id === priorityMaskId);
    if (priorityMaskId !== undefined && !priorityMask) {
      throw new Error(`artwork-stage cache does not contain priority mask ${priorityMaskId}`);
    }
    if (coverageBaselineRevision !== undefined && coverageBaselineRevision > expectedRevision) {
      throw new Error('artwork-stage coverage baseline cannot be newer than its revision fence');
    }
    const currentFootprintAreas = operations
      .filter((operation) => operation.action === 'shape')
      .map((operation) => polygonArea(operation.points));
    const footprintKey = `${cache.cacheId}:${stageId}`;
    const cumulativeFootprintAreas = [
      ...(committedFootprintsByStage.get(footprintKey) ?? []),
      ...currentFootprintAreas,
    ];
    const footprintStatistics = summarizeShapeFootprints(
      cumulativeFootprintAreas,
      cache.project.width * cache.project.height,
    );
    if (footprintStatistics.shapeCount > 0 &&
        footprintStatistics.scaleBands.length < stage.minimumScaleBands) {
      throw new Error(
        `artwork-stage ${stageId} occupies ${footprintStatistics.scaleBands.length} scale bands; ${stage.minimumScaleBands} required`,
      );
    }
    if (stage.minimumP90P10Ratio !== undefined &&
        footprintStatistics.shapeCount >= 3 &&
        (footprintStatistics.p90P10Ratio ?? 0) < stage.minimumP90P10Ratio) {
      throw new Error(
        `artwork-stage ${stageId} p90/p10 footprint ratio is below ${stage.minimumP90P10Ratio}`,
      );
    }
    operations.push({
      action: 'checkpoint',
      name: command.checkpointName ?? stage.id,
      capture: readCapture(command.capture ?? stage.capture, 'artwork-stage capture'),
      thumbnailMaxSize: command.thumbnailMaxSize ?? stage.thumbnailMaxSize,
    });
    const expandedCommand = {
        action: 'artwork-job',
        requestId: command.requestId,
        runtimeFence: command.runtimeFence,
        canvas: { width: cache.project.width, height: cache.project.height },
        capture: 'none',
        operations,
        ...(priorityMask ? {
          priorityCoverage: {
            priorityMaskId: priorityMask.id,
            priorityMaskFingerprint: priorityMask.fingerprint,
            coverageBaselineRevision,
            width: priorityMask.width,
            height: priorityMask.height,
            spans: priorityMask.spans,
          },
        } : {}),
      };
    const payloadBytes = Buffer.byteLength(JSON.stringify(expandedCommand));
    if (payloadBytes > stage.payloadByteBudget) {
      throw new Error(
        `artwork-stage ${stageId} payload is ${payloadBytes} bytes, exceeding its budget of ${stage.payloadByteBudget}`,
      );
    }
    return {
      command: expandedCommand,
      stageEvidence: {
        type: 'stage-prepared',
        requestId: command.requestId,
        workflowId: cache.workflowId,
        cacheIdentity: cache.cacheIdentity,
        stageId,
        cacheId: cache.cacheId,
        cacheHit,
        selectedCandidateCount: selectedIds.length,
        residualGestureCount: residualOperations.filter(
          (operation) => GESTURE_ACTIONS.has(operation?.action),
        ).length,
        gestureCount,
        gestureBudget: stage.gestureBudget,
        pointCount,
        pointBudget: stage.pointBudget,
        payloadBytes,
        payloadByteBudget: stage.payloadByteBudget,
        decision: {
          status: decision.status,
          basedOnRevision: decisionRevision,
          basedOnCheckpointId: decisionCheckpointId,
        },
        footprintKey,
        currentFootprintAreas,
        footprintStatistics,
        priorityCoverage: priorityMask ? {
          priorityMaskId: priorityMask.id,
          priorityMaskFingerprint: priorityMask.fingerprint,
          maskPixels: priorityMask.pixelCount,
          coverageBaselineRevision,
        } : undefined,
        capture: command.capture ?? stage.capture,
      },
    };
  };

  const commit = (stageEvidence) => {
    if (!stageEvidence?.footprintKey || !Array.isArray(stageEvidence.currentFootprintAreas)) {
      return stageEvidence;
    }
    const commitKey = stageEvidence.requestId
      ? `${stageEvidence.footprintKey}:${stageEvidence.requestId}`
      : undefined;
    if (commitKey && committedStageRequests.has(commitKey)) {
      const committed = committedFootprintsByStage.get(stageEvidence.footprintKey) ?? [];
      return {
        ...stageEvidence,
        footprintStatistics: summarizeShapeFootprints(
          committed,
          stageEvidence.cacheIdentity.canvas.width * stageEvidence.cacheIdentity.canvas.height,
        ),
      };
    }
    const committed = [
      ...(committedFootprintsByStage.get(stageEvidence.footprintKey) ?? []),
      ...stageEvidence.currentFootprintAreas,
    ];
    committedFootprintsByStage.set(stageEvidence.footprintKey, committed);
    if (commitKey) committedStageRequests.add(commitKey);
    return {
      ...stageEvidence,
      footprintStatistics: summarizeShapeFootprints(
        committed,
        stageEvidence.cacheIdentity.canvas.width * stageEvidence.cacheIdentity.canvas.height,
      ),
    };
  };

  return { expand, commit };
};
