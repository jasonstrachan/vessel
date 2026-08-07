import type React from 'react';

import { isCcGradientPreset } from '@/presets/brushPresets';
import { getAppStoreState } from '@/stores/appStoreAccess';
import { deserializeProject } from '@/utils/projectIO';

import type {
  VesselCollaborationBatchOperation,
  VesselCollaborationCapturePolicy,
  VesselCollaborationCommand,
  VesselCollaborationFrame,
  VesselCollaborationProfile,
  VesselCollaborationResult,
} from './vesselCollaborationProtocol';

const DEFAULT_THUMBNAIL_MAX_SIZE = 768;
const DEFAULT_POINTS_PER_FRAME = 2;
const MAX_COALESCED_STROKE_POINTS = 16;

type StrokeOperation = Extract<VesselCollaborationBatchOperation, { action: 'stroke' }>;
type ShapeOperation = Extract<VesselCollaborationBatchOperation, { action: 'shape' }>;
type SimpleCommand = Exclude<
  VesselCollaborationCommand,
  { action: 'batch' | 'wait-for-frame' }
>;
type MutationOperation = SimpleCommand | VesselCollaborationBatchOperation;

export interface VesselCollaborationRuntime {
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  compositeCanvasDirtyRef: React.MutableRefObject<boolean>;
  dispatchStroke: (
    points: StrokeOperation['points'],
    options: { pointsPerFrame: number },
  ) => Promise<void>;
  rebuildStaticComposite: () => boolean | Promise<boolean>;
  requestRedraw: () => void;
}

const nextPaint = () =>
  new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });

const waitForRevisionPoll = () =>
  new Promise<void>((resolve) => {
    window.setTimeout(resolve, 25);
  });

const roundMs = (value: number) => Math.round(value * 10) / 10;

const captureFrame = (
  canvas: HTMLCanvasElement | null,
  capturePolicy: Exclude<VesselCollaborationCapturePolicy, 'none' | 'each-thumbnail'>,
  thumbnailMaxSize: number,
): VesselCollaborationFrame => {
  if (!canvas || canvas.width < 1 || canvas.height < 1) {
    throw new Error('Rendered Vessel canvas is unavailable');
  }

  const isFull = capturePolicy === 'full';
  const scale = isFull
    ? 1
    : Math.min(1, thumbnailMaxSize / Math.max(canvas.width, canvas.height));
  const width = Math.max(1, Math.round(canvas.width * scale));
  const height = Math.max(1, Math.round(canvas.height * scale));
  let dataUrl: string;

  if (width === canvas.width && height === canvas.height) {
    dataUrl = canvas.toDataURL('image/png');
  } else {
    const thumbnailCanvas = document.createElement('canvas');
    thumbnailCanvas.width = width;
    thumbnailCanvas.height = height;
    const context = thumbnailCanvas.getContext('2d');
    if (!context) {
      throw new Error('Vessel thumbnail canvas is unavailable');
    }
    context.imageSmoothingEnabled = false;
    context.drawImage(canvas, 0, 0, width, height);
    dataUrl = thumbnailCanvas.toDataURL('image/png');
  }

  return {
    mimeType: 'image/png',
    kind: isFull ? 'full' : 'thumbnail',
    width,
    height,
    sourceWidth: canvas.width,
    sourceHeight: canvas.height,
    dataUrl,
  };
};

const readState = () => {
  const state = getAppStoreState();
  return {
    project: state.project
      ? {
          id: state.project.id,
          name: state.project.name,
          width: state.project.width,
          height: state.project.height,
        }
      : null,
    activeLayerId: state.activeLayerId,
    currentTool: state.tools.currentTool,
    currentBrushPresetId: state.currentBrushPreset?.id ?? null,
    brush: {
      size: state.tools.brushSettings.size,
      opacity: state.tools.brushSettings.opacity,
      color: state.tools.brushSettings.color,
      spacing: state.tools.brushSettings.spacing,
      shapeEnabled: Boolean(state.tools.brushSettings.shapeEnabled),
      ditherEnabled: Boolean(state.tools.brushSettings.ditherEnabled),
      ditherAlgorithm: state.tools.brushSettings.ditherAlgorithm ?? null,
      fillResolution: state.tools.brushSettings.fillResolution ?? null,
      pressureLinkedFillResolution: Boolean(state.tools.brushSettings.pressureLinkedFillResolution),
      pressureLinkedFillMaxResolution:
        state.tools.brushSettings.pressureLinkedFillMaxResolution ?? null,
    },
    dirtyRevision: state.autosave.dirtyRevision,
    layers: state.layers.map((layer) => ({
      id: layer.id,
      name: layer.name,
      type: layer.layerType,
      visible: layer.visible,
      locked: layer.locked,
      opacity: layer.opacity,
    })),
  };
};

const requireDrawableLayer = () => {
  const state = getAppStoreState();
  if (!state.project) {
    throw new Error('No Vessel project is loaded');
  }
  const layer = state.layers.find((candidate) => candidate.id === state.activeLayerId);
  if (!layer) {
    throw new Error('No active layer is selected');
  }
  if (!layer.visible) {
    throw new Error(`Active layer is hidden: ${layer.name}`);
  }
  if (layer.locked) {
    throw new Error(`Active layer is locked: ${layer.name}`);
  }
  return { state, layer };
};

const decodeProjectBase64 = (dataBase64: string): ArrayBuffer => {
  const binary = atob(dataBase64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes.buffer;
};

const executeStroke = async (
  operation: Pick<StrokeOperation, 'points' | 'pointsPerFrame' | 'tool'>,
  runtime: VesselCollaborationRuntime,
) => {
  const { state, layer } = requireDrawableLayer();
  const tool = operation.tool ?? state.tools.currentTool;
  if (tool !== 'brush' && tool !== 'eraser') {
    throw new Error('A stroke requires the brush or eraser tool');
  }

  state.setCurrentTool(tool);
  if (
    !state.tools.brushSettings.shapeEnabled &&
    typeof state.setShapeMode === 'function'
  ) {
    state.setShapeMode(false);
  }
  if (layer.layerType === 'color-cycle') {
    const ready = await state.ensureColorCycleLayerRuntime(layer.id, { target: 'active' });
    if (!ready) {
      throw new Error(`Color-cycle layer is not editable: ${layer.name}`);
    }
  }
  await nextPaint();
  runtime.compositeCanvasDirtyRef.current = true;
  const canCoalescePoints =
    !state.tools.brushSettings.shapeEnabled &&
    operation.points.length <= MAX_COALESCED_STROKE_POINTS;
  await runtime.dispatchStroke(operation.points, {
    pointsPerFrame: canCoalescePoints
      ? operation.pointsPerFrame ?? DEFAULT_POINTS_PER_FRAME
      : 1,
  });
};

const executeShape = async (
  operation: ShapeOperation,
  runtime: VesselCollaborationRuntime,
) => {
  const state = getAppStoreState();
  if (!state.tools.brushSettings.shapeEnabled) {
    throw new Error('A shape operation requires a shape brush');
  }
  if (isCcGradientPreset(state.currentBrushPreset?.id) && !operation.direction) {
    throw new Error('This Color Cycle shape requires direction points');
  }

  await executeStroke(operation, runtime);
  if (operation.direction) {
    await executeStroke({
      points: operation.direction,
      pointsPerFrame: operation.pointsPerFrame,
    }, runtime);
  }
};

const executeMutation = async (
  operation: MutationOperation,
  runtime: VesselCollaborationRuntime,
) => {
  const state = getAppStoreState();
  switch (operation.action) {
    case 'observe':
      return;
    case 'open-project': {
      const project = await deserializeProject(decodeProjectBase64(operation.dataBase64), {
        lazyColorCycleRuntime: true,
      });
      await state.importProject(project, { fileName: operation.fileName, fileHandle: null });
      return;
    }
    case 'stroke':
      await executeStroke(operation, runtime);
      return;
    case 'shape':
      await executeShape(operation, runtime);
      return;
    case 'set-tool':
      state.setCurrentTool(operation.tool);
      return;
    case 'set-brush-preset': {
      const preset = state.getBrushPresetById(operation.presetId);
      if (!preset) {
        throw new Error(`Brush preset not found: ${operation.presetId}`);
      }
      state.setBrushPreset(preset);
      return;
    }
    case 'set-brush':
      state.setBrushSettings(operation.settings);
      return;
    case 'set-active-layer': {
      const layer = state.layers.find((candidate) => candidate.id === operation.layerId);
      if (!layer) {
        throw new Error(`Layer not found: ${operation.layerId}`);
      }
      state.setActiveLayer(layer.id);
      return;
    }
    case 'undo':
      await state.undo();
      return;
    case 'redo':
      await state.redo();
      return;
    case 'save':
      await state.saveProject(operation.filename);
  }
};

const defaultCapturePolicy = (
  command: VesselCollaborationCommand,
): VesselCollaborationCapturePolicy => {
  if (command.capture) return command.capture;
  switch (command.action) {
    case 'set-tool':
    case 'set-brush-preset':
    case 'set-brush':
    case 'set-active-layer':
    case 'save':
      return 'none';
    default:
      return 'final-thumbnail';
  }
};

const needsPresentation = (action: MutationOperation['action']) =>
  action === 'open-project' ||
  action === 'stroke' ||
  action === 'shape' ||
  action === 'undo' ||
  action === 'redo';

const presentAndCapture = async (
  runtime: VesselCollaborationRuntime,
  capturePolicy: VesselCollaborationCapturePolicy,
  thumbnailMaxSize: number,
) => {
  const presentationStartedAt = performance.now();
  await nextPaint();
  await runtime.rebuildStaticComposite();
  runtime.requestRedraw();
  await nextPaint();
  const presentationMs = roundMs(performance.now() - presentationStartedAt);

  if (capturePolicy === 'none') {
    return { presentationMs, captureMs: 0, frame: undefined };
  }

  const captureStartedAt = performance.now();
  const frame = captureFrame(
    runtime.canvasRef.current,
    capturePolicy === 'full' ? 'full' : 'final-thumbnail',
    thumbnailMaxSize,
  );
  return {
    presentationMs,
    captureMs: roundMs(performance.now() - captureStartedAt),
    frame,
  };
};

const isGestureAction = (action: MutationOperation['action']) =>
  action === 'stroke' ||
  action === 'shape' ||
  action === 'open-project' ||
  action === 'undo' ||
  action === 'redo';

export const createVesselCollaborationExecutor = (
  getRuntime: () => VesselCollaborationRuntime,
) => {
  const initialState = getAppStoreState();
  let revision = 0;
  let observedProjectId = initialState.project?.id ?? null;
  let observedDirtyRevision = initialState.autosave.dirtyRevision;

  const syncExternalRevision = () => {
    const state = getAppStoreState();
    const projectId = state.project?.id ?? null;
    const dirtyRevision = state.autosave.dirtyRevision;
    if (projectId !== observedProjectId || dirtyRevision < observedDirtyRevision) {
      revision += 1;
    } else if (dirtyRevision > observedDirtyRevision) {
      revision += dirtyRevision - observedDirtyRevision;
    }
    observedProjectId = projectId;
    observedDirtyRevision = dirtyRevision;
    return revision;
  };

  const updateRevisionAfterMutation = (action: MutationOperation['action'], beforeRevision: number) => {
    syncExternalRevision();
    if (isGestureAction(action) && revision === beforeRevision) {
      revision += 1;
    }
    return revision;
  };

  const waitForFrameRevision = async (afterRevision: number, timeoutMs: number) => {
    const timeoutAt = performance.now() + timeoutMs;
    syncExternalRevision();
    while (revision <= afterRevision && performance.now() < timeoutAt) {
      await waitForRevisionPoll();
      syncExternalRevision();
    }
    return revision > afterRevision;
  };

  return async (command: VesselCollaborationCommand): Promise<VesselCollaborationResult> => {
    const startedAt = performance.now();
    const capturePolicy = defaultCapturePolicy(command);
    const thumbnailMaxSize = command.thumbnailMaxSize ?? DEFAULT_THUMBNAIL_MAX_SIZE;
    let mutationMs = 0;
    let presentationMs = 0;
    let captureMs = 0;
    let completedOperations = 0;
    const operationProfiles: NonNullable<VesselCollaborationProfile['operations']> = [];
    const batchFrames: NonNullable<VesselCollaborationResult['frames']> = [];

    try {
      if (command.action === 'wait-for-frame') {
        const changed = await waitForFrameRevision(command.afterRevision, command.timeoutMs ?? 25000);
        let frame: VesselCollaborationFrame | undefined;
        if (changed && capturePolicy !== 'none') {
          const captured = await presentAndCapture(getRuntime(), capturePolicy, thumbnailMaxSize);
          presentationMs += captured.presentationMs;
          captureMs += captured.captureMs;
          frame = captured.frame;
        }
        return {
          ok: true,
          commandId: command.id,
          action: command.action,
          revision,
          state: readState(),
          frame,
          timedOut: !changed,
          profile: {
            mutationMs,
            presentationMs,
            captureMs,
            totalMs: roundMs(performance.now() - startedAt),
          },
        };
      }

      if (command.action === 'batch') {
        const runtime = getRuntime();
        let hasPresentedGesture = false;

        for (let index = 0; index < command.operations.length; index += 1) {
          const operation = command.operations[index];
          const operationStartedAt = performance.now();
          const beforeRevision = revision;
          await executeMutation(operation, runtime);
          updateRevisionAfterMutation(operation.action, beforeRevision);
          completedOperations += 1;
          const operationMutationMs = roundMs(performance.now() - operationStartedAt);
          mutationMs += operationMutationMs;
          operationProfiles.push({
            index,
            action: operation.action,
            mutationMs: operationMutationMs,
            revision,
          });

          if (
            capturePolicy === 'each-thumbnail' &&
            (operation.action === 'stroke' || operation.action === 'shape')
          ) {
            const captured = await presentAndCapture(
              getRuntime(),
              'final-thumbnail',
              thumbnailMaxSize,
            );
            presentationMs += captured.presentationMs;
            captureMs += captured.captureMs;
            hasPresentedGesture = true;
            if (captured.frame) {
              batchFrames.push({ operationIndex: index, revision, frame: captured.frame });
            }
          }
        }

        let frame: VesselCollaborationFrame | undefined;
        if (capturePolicy !== 'each-thumbnail') {
          const shouldPresent = command.operations.some((operation) => needsPresentation(operation.action)) ||
            capturePolicy !== 'none';
          if (shouldPresent) {
            const captured = await presentAndCapture(runtime, capturePolicy, thumbnailMaxSize);
            presentationMs += captured.presentationMs;
            captureMs += captured.captureMs;
            frame = captured.frame;
          }
        } else if (!hasPresentedGesture) {
          const captured = await presentAndCapture(runtime, 'none', thumbnailMaxSize);
          presentationMs += captured.presentationMs;
        }

        return {
          ok: true,
          commandId: command.id,
          action: command.action,
          revision,
          state: readState(),
          frame,
          frames: batchFrames.length > 0 ? batchFrames : undefined,
          completedOperations,
          profile: {
            mutationMs: roundMs(mutationMs),
            presentationMs: roundMs(presentationMs),
            captureMs: roundMs(captureMs),
            totalMs: roundMs(performance.now() - startedAt),
            operations: operationProfiles,
          },
        };
      }

      const runtime = getRuntime();
      const mutationStartedAt = performance.now();
      const beforeRevision = revision;
      await executeMutation(command, runtime);
      updateRevisionAfterMutation(command.action, beforeRevision);
      mutationMs = roundMs(performance.now() - mutationStartedAt);

      let frame: VesselCollaborationFrame | undefined;
      if (needsPresentation(command.action) || capturePolicy !== 'none') {
        const captured = await presentAndCapture(runtime, capturePolicy, thumbnailMaxSize);
        presentationMs += captured.presentationMs;
        captureMs += captured.captureMs;
        frame = captured.frame;
      }

      return {
        ok: true,
        commandId: command.id,
        action: command.action,
        revision,
        state: readState(),
        frame,
        profile: {
          mutationMs,
          presentationMs,
          captureMs,
          totalMs: roundMs(performance.now() - startedAt),
        },
      };
    } catch (error) {
      syncExternalRevision();
      return {
        ok: false,
        commandId: command.id,
        action: command.action,
        revision,
        state: readState(),
        frames: batchFrames.length > 0 ? batchFrames : undefined,
        completedOperations: completedOperations > 0 ? completedOperations : undefined,
        profile: {
          mutationMs: roundMs(mutationMs),
          presentationMs: roundMs(presentationMs),
          captureMs: roundMs(captureMs),
          totalMs: roundMs(performance.now() - startedAt),
          operations: operationProfiles.length > 0 ? operationProfiles : undefined,
        },
        error: error instanceof Error ? error.message : 'Unknown Vessel collaboration error',
      };
    }
  };
};
