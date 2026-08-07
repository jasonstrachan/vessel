import type React from 'react';

import { getPresetCapabilities, isCcGradientPreset } from '@/presets/brushPresets';
import { getAppStoreState } from '@/stores/appStoreAccess';
import {
  createEraserTipSettingsPatch,
  resolveEraserTipOption,
} from '@/stores/helpers/eraserSettings';
import {
  isColorCycleBrushShape,
  isColorCyclePresetId,
} from '@/stores/helpers/toolsState';
import type { Layer } from '@/types';
import { BrushShape } from '@/types';
import { DEFAULT_GRADIENT_STOPS } from '@/utils/gradientPresets';
import { createDefaultLayerAlignment } from '@/utils/layoutDefaults';
import { supportsDither } from '@/utils/brushCategories';
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
type CheckpointOperation = Extract<VesselCollaborationBatchOperation, { action: 'checkpoint' }>;
type CreateLayerOperation = Extract<
  VesselCollaborationBatchOperation,
  { action: 'create-layer' }
>;
type ImportReferenceImageCommand = Extract<
  VesselCollaborationCommand,
  { action: 'import-reference-image' }
>;
type SimpleCommand = Exclude<
  VesselCollaborationCommand,
  { action: 'batch' | 'wait-for-frame' }
>;
type MutationOperation = SimpleCommand | Exclude<
  VesselCollaborationBatchOperation,
  CheckpointOperation
>;

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

const resolveDocumentCaptureCanvas = (
  fallbackCanvas: HTMLCanvasElement | null,
): HTMLCanvasElement | null => {
  const state = getAppStoreState();
  if (
    !state.project ||
    typeof document === 'undefined' ||
    typeof state.compositeLayersToCanvasSync !== 'function'
  ) {
    return fallbackCanvas;
  }

  const documentCanvas = document.createElement('canvas');
  documentCanvas.width = state.project.width;
  documentCanvas.height = state.project.height;
  return state.compositeLayersToCanvasSync(documentCanvas)
    ? documentCanvas
    : fallbackCanvas;
};

const readState = () => {
  const state = getAppStoreState();
  const brush = state.tools.brushSettings;
  const eraser = state.tools.eraserSettings ?? brush;
  const palette = state.palette ?? {
    foregroundColor: brush.color,
    backgroundColor: '#ffffff',
    activeSlot: 'foreground' as const,
  };
  const presetCapabilities = state.currentBrushPreset
    ? getPresetCapabilities(state.currentBrushPreset.id, state.currentBrushPreset)
    : {};
  const canDither = presetCapabilities.canDither ?? supportsDither(
    brush.brushShape ?? BrushShape.ROUND,
  );
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
    referenceLayerId: state.referenceLayerId ?? null,
    preferReferenceSampling: state.colorPickerPreferReferenceLayer !== false,
    currentTool: state.tools.currentTool,
    currentBrushPresetId: state.currentBrushPreset?.id ?? null,
    currentBrushCapabilities: {
      canDither,
      forceDither: presetCapabilities.forceDither === true,
    },
    availableBrushPresets: (state.brushPresets ?? []).map((preset) => ({
      id: preset.id,
      name: preset.name,
      category: preset.category,
      isCustomBrush: preset.isCustomBrush === true,
    })),
    palette: {
      foreground: palette.foregroundColor,
      background: palette.backgroundColor,
      activeSlot: palette.activeSlot,
    },
    gradient: {
      source: state.tools.ccGradientSource,
      stops: (brush.colorCycleGradient ?? DEFAULT_GRADIENT_STOPS).map((stop) => ({ ...stop })),
      foreground: {
        lightness: brush.colorCycleFgLightness ?? 50,
        hueShift: brush.colorCycleFgHueShift ?? 0,
        saturationShift: brush.colorCycleFgSaturationShift ?? 0,
        opacity: brush.colorCycleFgOpacity ?? 100,
        stopCount: brush.colorCycleFgStops ?? 2,
      },
      sampleCount: state.ccGradientSampleCount ?? 0,
    },
    brush: {
      size: brush.size,
      opacity: brush.opacity,
      color: brush.color,
      spacing: brush.spacing,
      shapeEnabled: Boolean(brush.shapeEnabled),
      ditherEnabled: Boolean(brush.ditherEnabled),
      ditherAlgorithm: brush.ditherAlgorithm ?? null,
      patternStyle: brush.patternStyle ?? null,
      fillResolution: brush.fillResolution ?? null,
      pressureLinkedFillResolution: Boolean(brush.pressureLinkedFillResolution),
      pressureLinkedFillMaxResolution:
        brush.pressureLinkedFillMaxResolution ?? null,
      ditherBackgroundFill: brush.ditherBackgroundFill !== false,
      ditherGradBgFill: (brush.ditherGradBgFill ?? brush.ditherBackgroundFill) !== false,
      ditherPaletteSpread: brush.ditherPaletteSpread ?? 0,
      ditherPatternDiversity: brush.ditherPatternDiversity ?? 100,
      ditherPhaseJitter: brush.ditherPhaseJitter ?? 0,
      ccGradientRangeContrast: brush.ccGradientRangeContrast ?? 100,
      ccSampledSoftSeamEnabled: brush.ccSampledSoftSeamEnabled !== false,
      lostEdge: brush.lostEdge ?? 0,
      pxlEdge: brush.pxlEdge === true,
      colorCycleSpeed: brush.colorCycleSpeed ?? null,
      gradientBands: brush.gradientBands ?? null,
      colorCycleFillMode: brush.colorCycleFillMode ?? null,
      ccGradientDrawingShape: brush.ccGradientDrawingShape ?? null,
      colorCycleStampDitherEnabled: brush.colorCycleStampDitherEnabled === true,
      colorCycleStampDitherPixelSize: brush.colorCycleStampDitherPixelSize ?? null,
      colorCycleStampDitherPressureLinked: brush.colorCycleStampDitherPressureLinked === true,
      colorCycleStampDitherBgFill: typeof brush.colorCycleStampDitherBgFill === 'boolean'
        ? brush.colorCycleStampDitherBgFill
        : brush.colorCycleStampDitherClears !== true,
      colorCycleStampShape: brush.colorCycleStampShape ?? null,
    },
    eraser: {
      size: eraser.linkSizeToBrush === false ? eraser.size : brush.size,
      opacity: eraser.opacity,
      linkSizeToBrush: eraser.linkSizeToBrush !== false,
      tip: resolveEraserTipOption(eraser),
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

const nextLayerName = (layers: Layer[], layerType: CreateLayerOperation['layerType']) => {
  const prefix = layerType === 'color-cycle' ? 'CC Layer' : 'Layer';
  const pattern = new RegExp(`^${prefix} (\\d+)$`);
  const highestSuffix = layers.reduce((highest, layer) => {
    if (layer.layerType !== layerType) return highest;
    const suffix = Number(layer.name.match(pattern)?.[1]);
    return Number.isFinite(suffix) ? Math.max(highest, suffix) : highest;
  }, 0);
  return `${prefix} ${highestSuffix + 1}`;
};

const executeCreateLayer = async (operation: CreateLayerOperation) => {
  const state = getAppStoreState();
  if (!state.project) {
    throw new Error('No Vessel project is loaded');
  }

  const framebuffer = document.createElement('canvas');
  framebuffer.width = 1;
  framebuffer.height = 1;
  const commonLayer = {
    name: operation.name ?? nextLayerName(state.layers, operation.layerType),
    visible: true,
    opacity: 1,
    blendMode: 'source-over' as const,
    locked: false,
    transparencyLocked: false,
    imageData: null,
    framebuffer,
    alignment: createDefaultLayerAlignment(),
  };
  const layer: Omit<Layer, 'id' | 'order'> = operation.layerType === 'color-cycle'
    ? {
        ...commonLayer,
        layerType: 'color-cycle',
        colorCycleData: {
          gradient: (
            state.tools.brushSettings.colorCycleGradient ?? DEFAULT_GRADIENT_STOPS
          ).map((stop) => ({ ...stop })),
          isAnimating: true,
          flowMode: state.tools.brushSettings.colorCycleFlowMode ?? 'forward',
        },
      }
    : {
        ...commonLayer,
        layerType: 'normal',
      };

  const layerId = state.addLayer(layer);
  if (!layerId) {
    throw new Error(`Failed to create ${operation.layerType} layer`);
  }
  if (operation.layerType === 'color-cycle') {
    const ready = await getAppStoreState().ensureColorCycleLayerRuntime(layerId, {
      target: 'active',
    });
    if (!ready) {
      throw new Error(`Color-cycle layer is not editable: ${commonLayer.name}`);
    }
  }
};

const isCurrentColorCycleBrush = (state: ReturnType<typeof getAppStoreState>) => {
  const presetId = state.currentBrushPreset?.id;
  if (presetId && isColorCyclePresetId(presetId)) return true;
  const settings = state.tools.brushSettings;
  return isColorCycleBrushShape(settings.brushShape) || (
    settings.brushShape === BrushShape.CUSTOM &&
    Boolean(settings.selectedCustomBrush) &&
    settings.customBrushColorCycle === true
  );
};

const decodeProjectBase64 = (dataBase64: string): ArrayBuffer => {
  const binary = atob(dataBase64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes.buffer;
};

const executeImportReferenceImage = async (operation: ImportReferenceImageCommand) => {
  const state = getAppStoreState();
  if (!state.project) {
    throw new Error('No Vessel project is loaded');
  }
  if (typeof createImageBitmap !== 'function') {
    throw new Error('Reference image decoding is unavailable');
  }

  const source = decodeProjectBase64(operation.dataBase64);
  const bitmap = await createImageBitmap(new Blob([source], { type: operation.mimeType }));
  try {
    if (bitmap.width < 1 || bitmap.height < 1) {
      throw new Error('Reference image has invalid dimensions');
    }
    const framebuffer = document.createElement('canvas');
    framebuffer.width = state.project.width;
    framebuffer.height = state.project.height;
    const context = framebuffer.getContext('2d', { willReadFrequently: true });
    if (!context) {
      throw new Error('Reference image canvas is unavailable');
    }
    context.clearRect(0, 0, framebuffer.width, framebuffer.height);
    context.imageSmoothingEnabled = true;

    const fit = operation.fit ?? 'contain';
    if (fit === 'stretch') {
      context.drawImage(bitmap, 0, 0, framebuffer.width, framebuffer.height);
    } else {
      const scale = fit === 'cover'
        ? Math.max(framebuffer.width / bitmap.width, framebuffer.height / bitmap.height)
        : Math.min(framebuffer.width / bitmap.width, framebuffer.height / bitmap.height);
      const width = bitmap.width * scale;
      const height = bitmap.height * scale;
      context.drawImage(
        bitmap,
        (framebuffer.width - width) / 2,
        (framebuffer.height - height) / 2,
        width,
        height,
      );
    }

    const imageData = context.getImageData(0, 0, framebuffer.width, framebuffer.height);
    const layerId = state.addLayer({
      name: operation.fileName,
      visible: true,
      opacity: 1,
      blendMode: 'source-over',
      locked: false,
      transparencyLocked: false,
      imageData,
      framebuffer,
      alignment: createDefaultLayerAlignment(),
      layerType: 'normal',
    });
    if (!layerId) {
      throw new Error('Failed to create reference image layer');
    }

    const nextState = getAppStoreState();
    const sourceIndex = nextState.layers.findIndex((layer) => layer.id === layerId);
    if (sourceIndex > 0) {
      nextState.reorderLayers(sourceIndex, 0);
    }
    getAppStoreState().setReferenceLayer(layerId);
    getAppStoreState().setColorPickerPreferReferenceLayer(true);
  } finally {
    bitmap.close();
  }
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

  if (tool === 'brush') {
    const usesColorCycle = isCurrentColorCycleBrush(state);
    if (usesColorCycle && layer.layerType !== 'color-cycle') {
      throw new Error(`Color Cycle brush requires a Color Cycle layer: ${layer.name}`);
    }
    if (!usesColorCycle && layer.layerType === 'color-cycle') {
      throw new Error(`Normal brush requires a normal layer: ${layer.name}`);
    }
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

  await executeStroke({ ...operation, tool: 'brush' }, runtime);
  if (operation.direction) {
    await executeStroke({
      points: operation.direction,
      pointsPerFrame: operation.pointsPerFrame,
      tool: 'brush',
    }, runtime);
  }
};

const executeSetPalette = (
  operation: Extract<VesselCollaborationBatchOperation, { action: 'set-palette' }>,
) => {
  const state = getAppStoreState();
  if (operation.swap) {
    state.swapPaletteColors();
  }
  if (operation.foreground !== undefined) {
    state.setPaletteColor('foreground', operation.foreground);
  }
  if (operation.background !== undefined) {
    state.setPaletteColor('background', operation.background);
  }
  if (operation.activeSlot !== undefined) {
    state.setActivePaletteSlot(operation.activeSlot);
  }
};

const executeSetGradient = (
  operation: Extract<VesselCollaborationBatchOperation, { action: 'set-gradient' }>,
) => {
  const state = getAppStoreState();
  if (operation.stops) {
    state.commitColorCycleGradientDraft(operation.stops);
  }
  if (operation.foreground) {
    state.setBrushSettings({
      ...(operation.foreground.lightness === undefined
        ? {}
        : { colorCycleFgLightness: operation.foreground.lightness }),
      ...(operation.foreground.hueShift === undefined
        ? {}
        : { colorCycleFgHueShift: operation.foreground.hueShift }),
      ...(operation.foreground.saturationShift === undefined
        ? {}
        : { colorCycleFgSaturationShift: operation.foreground.saturationShift }),
      ...(operation.foreground.opacity === undefined
        ? {}
        : { colorCycleFgOpacity: operation.foreground.opacity }),
      ...(operation.foreground.stopCount === undefined
        ? {}
        : { colorCycleFgStops: operation.foreground.stopCount }),
    });
  }
  if (operation.resetSample) {
    state.resetCcGradientSample();
  }
};

const executeSetEraser = (
  operation: Extract<VesselCollaborationBatchOperation, { action: 'set-eraser' }>,
) => {
  const state = getAppStoreState();
  const { tip, ...settings } = operation.settings;
  state.setEraserSettings({
    ...settings,
    ...(tip === undefined ? {} : createEraserTipSettingsPatch(tip)),
  });
};

const executeMutation = async (
  operation: MutationOperation,
  runtime: VesselCollaborationRuntime,
) => {
  const state = getAppStoreState();
  switch (operation.action) {
    case 'observe':
      return;
    case 'new-project':
      state.newProject(operation.width, operation.height, operation.name);
      return;
    case 'open-project': {
      const project = await deserializeProject(decodeProjectBase64(operation.dataBase64), {
        lazyColorCycleRuntime: true,
      });
      await state.importProject(project, { fileName: operation.fileName, fileHandle: null });
      return;
    }
    case 'import-reference-image':
      await executeImportReferenceImage(operation);
      return;
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
    case 'set-palette':
      executeSetPalette(operation);
      return;
    case 'set-gradient-source':
      state.setCcGradientSource(operation.source);
      return;
    case 'set-gradient':
      executeSetGradient(operation);
      return;
    case 'set-eraser':
      executeSetEraser(operation);
      return;
    case 'set-active-layer': {
      const layer = state.layers.find((candidate) => candidate.id === operation.layerId);
      if (!layer) {
        throw new Error(`Layer not found: ${operation.layerId}`);
      }
      state.setActiveLayer(layer.id);
      return;
    }
    case 'set-layer-visibility': {
      const layer = state.layers.find((candidate) => candidate.id === operation.layerId);
      if (!layer) {
        throw new Error(`Layer not found: ${operation.layerId}`);
      }
      state.setLayersVisibility([layer.id], operation.visible);
      return;
    }
    case 'create-layer':
      await executeCreateLayer(operation);
      return;
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
  if (
    command.action === 'batch' &&
    command.operations.some((operation) => operation.action === 'checkpoint')
  ) {
    return 'none';
  }
  switch (command.action) {
    case 'set-tool':
    case 'set-brush-preset':
    case 'set-brush':
    case 'set-palette':
    case 'set-gradient-source':
    case 'set-gradient':
    case 'set-eraser':
    case 'set-active-layer':
    case 'create-layer':
    case 'set-layer-visibility':
    case 'save':
      return 'none';
    default:
      return 'final-thumbnail';
  }
};

const needsPresentation = (action: MutationOperation['action']) =>
  action === 'new-project' ||
  action === 'open-project' ||
  action === 'import-reference-image' ||
  action === 'set-layer-visibility' ||
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
    resolveDocumentCaptureCanvas(runtime.canvasRef.current),
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
  action === 'new-project' ||
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
        let hasPresentedFrame = false;

        for (let index = 0; index < command.operations.length; index += 1) {
          const operation = command.operations[index];
          if (operation.action === 'checkpoint') {
            const captured = await presentAndCapture(
              runtime,
              'final-thumbnail',
              thumbnailMaxSize,
            );
            presentationMs += captured.presentationMs;
            captureMs += captured.captureMs;
            hasPresentedFrame = true;
            completedOperations += 1;
            operationProfiles.push({
              index,
              action: operation.action,
              mutationMs: 0,
              revision,
            });
            if (captured.frame) {
              batchFrames.push({
                operationIndex: index,
                revision,
                checkpointName: operation.name,
                frame: captured.frame,
              });
            }
            continue;
          }
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
            hasPresentedFrame = true;
            if (captured.frame) {
              batchFrames.push({ operationIndex: index, revision, frame: captured.frame });
            }
          }
        }

        let frame: VesselCollaborationFrame | undefined;
        if (capturePolicy !== 'each-thumbnail') {
          const lastOperationIsCheckpoint = command.operations.at(-1)?.action === 'checkpoint';
          const shouldPresent = (
            !lastOperationIsCheckpoint &&
            command.operations.some((operation) =>
              operation.action !== 'checkpoint' && needsPresentation(operation.action))
          ) || capturePolicy !== 'none';
          if (shouldPresent) {
            const captured = await presentAndCapture(runtime, capturePolicy, thumbnailMaxSize);
            presentationMs += captured.presentationMs;
            captureMs += captured.captureMs;
            frame = captured.frame;
          }
        } else if (!hasPresentedFrame) {
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
