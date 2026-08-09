import type React from 'react';

import { getPresetCapabilities } from '@/presets/brushPresets';
import { normalizeColorCycleLayerDocumentState } from '@/lib/colorCycle/document';
import { getAppStoreState } from '@/stores/appStoreAccess';
import { getColorCycleBrushManager } from '@/stores/colorCycleBrushManager';
import { setSharedColorCycleGradient } from '@/utils/colorCycleGradients';
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
import { shouldEnterCcGradientDirectionStage } from '@/hooks/canvas/handlers/colorCycle/ccGradientDirectionContract';

import type {
  VesselCollaborationBatchOperation,
  VesselCollaborationCapturePolicy,
  VesselCollaborationCommand,
  VesselCollaborationExecutionEvent,
  VesselCollaborationFrame,
  VesselCollaborationMarkEvidence,
  VesselCollaborationProfile,
  VesselCollaborationPoint,
  VesselCollaborationResult,
} from './vesselCollaborationProtocol';
import type { VesselCanonicalGesture } from './commitVesselCollaborationGesture';
import { evaluateVesselCollaborationMarkImpact } from './vesselCollaborationMarkImpact';
import {
  assertVesselCollaborationGestureGeometry,
} from './vesselCollaborationGeometry';
import { summarizeVesselCollaborationOutcome } from './vesselCollaborationOutcomes';
import {
  assertVesselCollaborationRuntimeFence,
  type VesselCollaborationRuntimeIdentity,
} from './vesselCollaborationRuntimeIdentity';

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
  { action: 'artwork-job' | 'batch' | 'wait-for-frame' }
>;
type MutationOperation = SimpleCommand | Exclude<
  VesselCollaborationBatchOperation,
  CheckpointOperation
>;

export interface VesselCollaborationRuntime {
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  compositeCanvasDirtyRef: React.MutableRefObject<boolean>;
  commitGesture?: (gesture: VesselCanonicalGesture) => Promise<void>;
  /** Test/backward-compatibility seam. The mounted Vessel runtime never uses it. */
  dispatchStroke?: (
    points: StrokeOperation['points'],
    options: { pointsPerFrame: number; framePacing?: 'per-move' | 'finalize-only' },
  ) => Promise<void>;
  rebuildStaticComposite: () => boolean | Promise<boolean>;
  requestRedraw: () => void;
}

export interface VesselCollaborationExecutionOptions {
  signal?: AbortSignal;
  onEvent?: (event: VesselCollaborationExecutionEvent) => void | Promise<void>;
}

interface VesselCollaborationExecutorOptions {
  getRuntimeIdentity?: () => VesselCollaborationRuntimeIdentity;
  requireRuntimeFence?: boolean;
  enforceGeometryPreflight?: boolean;
  waitForCanonicalIdle?: () => Promise<void>;
}

const commitRuntimeGesture = async (
  runtime: VesselCollaborationRuntime,
  gesture: VesselCanonicalGesture,
  legacyPointsPerFrame = DEFAULT_POINTS_PER_FRAME,
) => {
  if (runtime.commitGesture) {
    await runtime.commitGesture(gesture);
    return;
  }
  if (!runtime.dispatchStroke) {
    throw new Error('Canonical Vessel gesture runtime is unavailable');
  }
  await runtime.dispatchStroke(gesture.points, {
    pointsPerFrame: gesture.kind === 'shape' ? 1 : legacyPointsPerFrame,
    ...(gesture.kind === 'shape' ? { framePacing: 'finalize-only' as const } : {}),
  });
  if (gesture.kind === 'shape' && gesture.direction) {
    await runtime.dispatchStroke(gesture.direction, {
      pointsPerFrame: 1,
      framePacing: 'finalize-only',
    });
  }
};

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

const readActiveColorCycleEvidence = (
  state: ReturnType<typeof getAppStoreState>,
) => {
  const layer = state.layers.find((candidate) => candidate.id === state.activeLayerId);
  if (!layer || layer.layerType !== 'color-cycle' || !state.project) {
    return null;
  }

  const liveDocumentState = getColorCycleBrushManager().getDocument(layer.id)?.read().snapshot;
  const documentResult = normalizeColorCycleLayerDocumentState(layer, {
    fallbackWidth: state.project.width,
    fallbackHeight: state.project.height,
    completeMotionBuffers: false,
  });
  if (!liveDocumentState && !documentResult.ok) {
    return {
      hasContent: Boolean(layer.colorCycleData?.hasContent),
      gradientDefinitionCount: layer.colorCycleData?.gradientDefStore?.length ?? 0,
      sampledGradientDefinitionCount:
        layer.colorCycleData?.gradientDefStore?.filter((entry) => entry.source === 'sampled').length ?? 0,
      sampledPaintedPixelCount: 0,
      latestSampledGradient: null,
    };
  }

  const documentState = liveDocumentState ?? (documentResult.ok ? documentResult.state : null);
  if (!documentState) return null;
  const gradientDefinitions = documentState.gradientDefStore ?? [];
  const sampledDefinitions = gradientDefinitions.filter((entry) => entry.source === 'sampled');
  const sampledIds = new Set(sampledDefinitions.map((entry) => entry.id));
  const gradientDefIds = documentState.gradientDefIdBuffer
    ? new Uint16Array(documentState.gradientDefIdBuffer)
    : null;
  let sampledPaintedPixelCount = 0;
  if (gradientDefIds && sampledIds.size > 0) {
    for (const gradientDefId of gradientDefIds) {
      if (sampledIds.has(gradientDefId)) sampledPaintedPixelCount += 1;
    }
  }
  const latestSampledGradient = sampledDefinitions.reduce<(typeof sampledDefinitions)[number] | null>(
    (latest, entry) => (
      !latest || entry.createdAtMs > latest.createdAtMs ||
      (entry.createdAtMs === latest.createdAtMs && entry.id > latest.id)
        ? entry
        : latest
    ),
    null,
  );

  return {
    hasContent: documentState.hasContent,
    gradientDefinitionCount: gradientDefinitions.length,
    sampledGradientDefinitionCount: sampledDefinitions.length,
    sampledPaintedPixelCount,
    latestSampledGradient: latestSampledGradient
      ? {
          id: latestSampledGradient.id,
          stopCount: latestSampledGradient.stops.length,
          uniqueColorCount: new Set(
            latestSampledGradient.stops.map((stop) => stop.color.toLowerCase()),
          ).size,
          stops: latestSampledGradient.stops.map((stop) => ({ ...stop })),
        }
      : null,
  };
};

type CanonicalGestureRegionSnapshot = {
  layerId: string;
  documentVersion: number;
  dirtyRevision: number;
  x: number;
  y: number;
  width: number;
  height: number;
  paint: Uint8Array;
  gradientIds: Uint8Array;
  gradientDefIds: Uint16Array;
  speed: Uint8Array;
  flow: Uint8Array;
  phase: Uint8Array;
};

const resolveGestureRegion = (
  operation: StrokeOperation | ShapeOperation,
  state: ReturnType<typeof getAppStoreState>,
) => {
  const project = state.project;
  if (!project || operation.points.length === 0) return null;
  const radius = operation.action === 'shape'
    ? 2
    : Math.max(2, Math.ceil((state.tools.brushSettings.size ?? 1) / 2) + 2);
  const xs = operation.points.map((point) => point.x);
  const ys = operation.points.map((point) => point.y);
  const x = Math.max(0, Math.floor(Math.min(...xs) - radius));
  const y = Math.max(0, Math.floor(Math.min(...ys) - radius));
  const maxX = Math.min(project.width - 1, Math.ceil(Math.max(...xs) + radius));
  const maxY = Math.min(project.height - 1, Math.ceil(Math.max(...ys) + radius));
  return {
    x,
    y,
    width: Math.max(1, maxX - x + 1),
    height: Math.max(1, maxY - y + 1),
  };
};

const captureCanonicalGestureRegion = (
  operation: StrokeOperation | ShapeOperation,
  existingRegion?: Pick<CanonicalGestureRegionSnapshot, 'x' | 'y' | 'width' | 'height'>,
): CanonicalGestureRegionSnapshot | null => {
  const state = getAppStoreState();
  const layer = state.layers.find((candidate) => candidate.id === state.activeLayerId);
  if (!layer || layer.layerType !== 'color-cycle' || !state.project) return null;
  const region = existingRegion ?? resolveGestureRegion(operation, state);
  if (!region) return null;

  const documentRead = getColorCycleBrushManager().getDocument(layer.id)?.read();
  const documentState = documentRead?.snapshot;
  if (
    !documentState?.paintBuffer ||
    !documentState.gradientDefIdBuffer ||
    documentState.width !== state.project.width ||
    documentState.height !== state.project.height
  ) {
    return null;
  }

  const pixelCount = documentState.width * documentState.height;
  const sourcePaint = new Uint8Array(documentState.paintBuffer);
  const sourceGradientIds = documentState.gradientIdBuffer
    ? new Uint8Array(documentState.gradientIdBuffer)
    : new Uint8Array(pixelCount);
  const sourceGradientDefIds = new Uint16Array(documentState.gradientDefIdBuffer);
  const sourceSpeed = documentState.speedBuffer
    ? new Uint8Array(documentState.speedBuffer)
    : new Uint8Array(pixelCount);
  const sourceFlow = documentState.flowBuffer
    ? new Uint8Array(documentState.flowBuffer)
    : new Uint8Array(pixelCount);
  const sourcePhase = documentState.phaseBuffer
    ? new Uint8Array(documentState.phaseBuffer)
    : new Uint8Array(pixelCount);
  const paint = new Uint8Array(region.width * region.height);
  const gradientIds = new Uint8Array(region.width * region.height);
  const gradientDefIds = new Uint16Array(region.width * region.height);
  const speed = new Uint8Array(region.width * region.height);
  const flow = new Uint8Array(region.width * region.height);
  const phase = new Uint8Array(region.width * region.height);
  for (let row = 0; row < region.height; row += 1) {
    const sourceStart = (region.y + row) * documentState.width + region.x;
    const targetStart = row * region.width;
    paint.set(sourcePaint.subarray(sourceStart, sourceStart + region.width), targetStart);
    gradientIds.set(
      sourceGradientIds.subarray(sourceStart, sourceStart + region.width),
      targetStart,
    );
    gradientDefIds.set(
      sourceGradientDefIds.subarray(sourceStart, sourceStart + region.width),
      targetStart,
    );
    speed.set(sourceSpeed.subarray(sourceStart, sourceStart + region.width), targetStart);
    flow.set(sourceFlow.subarray(sourceStart, sourceStart + region.width), targetStart);
    phase.set(sourcePhase.subarray(sourceStart, sourceStart + region.width), targetStart);
  }

  return {
    ...region,
    layerId: layer.id,
    documentVersion: documentRead?.version ?? 0,
    dirtyRevision: state.autosave.dirtyRevision,
    paint,
    gradientIds,
    gradientDefIds,
    speed,
    flow,
    phase,
  };
};

const resolveMarkEvidence = (
  operation: MutationOperation,
  before: CanonicalGestureRegionSnapshot | null,
): VesselCollaborationMarkEvidence | undefined => {
  if ((operation.action !== 'stroke' && operation.action !== 'shape') || !before) {
    return undefined;
  }
  const after = captureCanonicalGestureRegion(operation, before);
  if (!after || after.layerId !== before.layerId) {
    throw new Error('Canonical Color Cycle evidence became unavailable during the gesture');
  }
  let changedPixels = 0;
  let minChangedX = before.width;
  let minChangedY = before.height;
  let maxChangedX = -1;
  let maxChangedY = -1;
  const changedChannels = new Set<VesselCollaborationMarkEvidence['changedChannels'][number]>();
  for (let index = 0; index < before.paint.length; index += 1) {
    const paintChanged = before.paint[index] !== after.paint[index];
    const gradientChanged = before.gradientIds[index] !== after.gradientIds[index] ||
      before.gradientDefIds[index] !== after.gradientDefIds[index];
    const speedChanged = before.speed[index] !== after.speed[index];
    const flowChanged = before.flow[index] !== after.flow[index];
    const phaseChanged = before.phase[index] !== after.phase[index];
    if (paintChanged || gradientChanged || speedChanged || flowChanged || phaseChanged) {
      changedPixels += 1;
      const localX = index % before.width;
      const localY = Math.floor(index / before.width);
      minChangedX = Math.min(minChangedX, localX);
      minChangedY = Math.min(minChangedY, localY);
      maxChangedX = Math.max(maxChangedX, localX);
      maxChangedY = Math.max(maxChangedY, localY);
      if (paintChanged) changedChannels.add('paint');
      if (gradientChanged) changedChannels.add('gradient');
      if (speedChanged) changedChannels.add('speed');
      if (flowChanged) changedChannels.add('flow');
      if (phaseChanged) changedChannels.add('phase');
    }
  }
  const state = getAppStoreState();
  if (!state.project) {
    throw new Error('Vessel project became unavailable during the gesture');
  }
  return evaluateVesselCollaborationMarkImpact({
    layerId: before.layerId,
    markType: operation.action,
    phase: operation.phase,
    changedPixels,
    dirtyRevisionDelta: Math.max(0, after.dirtyRevision - before.dirtyRevision),
    documentVersion: after.documentVersion,
    documentVersionDelta: Math.max(0, after.documentVersion - before.documentVersion),
    affectedBounds: changedPixels > 0 ? {
      x: before.x + minChangedX,
      y: before.y + minChangedY,
      width: maxChangedX - minChangedX + 1,
      height: maxChangedY - minChangedY + 1,
    } : undefined,
    changedChannels: [...changedChannels],
    points: operation.points,
    canvasWidth: state.project.width,
    canvasHeight: state.project.height,
  });
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
    colorCycle: readActiveColorCycleEvidence(state),
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
    getAppStoreState().initColorCycleForLayer(
      layerId,
      state.project.width,
      state.project.height,
    );
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

const assertGestureStartsInsideProject = (
  points: VesselCollaborationPoint[],
  label: string,
) => {
  const project = getAppStoreState().project;
  if (!project) {
    throw new Error('No Vessel project is loaded');
  }
  const start = points[0];
  if (
    !start ||
    start.x < 0 ||
    start.x >= project.width ||
    start.y < 0 ||
    start.y >= project.height
  ) {
    throw new Error(`${label} must start inside the project canvas`);
  }
};

const assertArtworkJobGeometry = (
  operations: VesselCollaborationBatchOperation[],
) => {
  operations.forEach((operation, index) => {
    if (operation.action !== 'stroke' && operation.action !== 'shape') return;
    if (!operation.phase) {
      throw new Error(`operations[${index}].phase is required for artwork job gestures`);
    }
    const project = getAppStoreState().project;
    if (!project) throw new Error('No Vessel project is loaded');
    assertVesselCollaborationGestureGeometry({
      operation,
      canvasWidth: project.width,
      canvasHeight: project.height,
      label: `operations[${index}]`,
    });
  });
};

const assertGestureExecutionContract = (operation: StrokeOperation | ShapeOperation) => {
  const { state, layer } = requireDrawableLayer();
  if (operation.action === 'shape') {
    if (!state.tools.brushSettings.shapeEnabled) {
      throw new Error('A shape operation requires a shape brush');
    }
    if (
      shouldEnterCcGradientDirectionStage(
        state.tools,
        state.currentBrushPreset?.id ?? null,
      ) &&
      !operation.direction
    ) {
      throw new Error('This Color Cycle shape requires direction points');
    }
  } else {
    const tool = operation.tool ?? state.tools.currentTool;
    if (tool !== 'brush' && tool !== 'eraser') {
      throw new Error('A stroke requires the brush or eraser tool');
    }
    if (tool === 'eraser') return;
  }

  const usesColorCycle = isCurrentColorCycleBrush(state);
  if (usesColorCycle && layer.layerType !== 'color-cycle') {
    throw new Error(`Color Cycle brush requires a Color Cycle layer: ${layer.name}`);
  }
  if (!usesColorCycle && layer.layerType === 'color-cycle') {
    throw new Error(`Normal brush requires a normal layer: ${layer.name}`);
  }
};

const executeStroke = async (
  operation: Pick<StrokeOperation, 'points' | 'pointsPerFrame' | 'tool'>,
  getRuntime: () => VesselCollaborationRuntime,
) => {
  assertGestureStartsInsideProject(operation.points, 'stroke');
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
  const runtime = getRuntime();
  runtime.compositeCanvasDirtyRef.current = true;
  const canCoalesceStrokePoints = operation.points.length <= MAX_COALESCED_STROKE_POINTS;
  await commitRuntimeGesture(
    runtime,
    { kind: 'stroke', points: operation.points },
    canCoalesceStrokePoints
      ? operation.pointsPerFrame ?? DEFAULT_POINTS_PER_FRAME
      : 1,
  );
};

const executeShape = async (
  operation: ShapeOperation,
  getRuntime: () => VesselCollaborationRuntime,
) => {
  const currentState = getAppStoreState();
  if (!currentState.tools.brushSettings.shapeEnabled) {
    throw new Error('A shape operation requires a shape brush');
  }
  if (
    shouldEnterCcGradientDirectionStage(
      currentState.tools,
      currentState.currentBrushPreset?.id ?? null,
    ) &&
    !operation.direction
  ) {
    throw new Error('This Color Cycle shape requires direction points');
  }

  assertGestureStartsInsideProject(operation.points, 'shape');
  if (operation.direction) assertGestureStartsInsideProject(operation.direction, 'shape direction');
  const { state, layer } = requireDrawableLayer();
  const usesColorCycle = isCurrentColorCycleBrush(state);
  if (usesColorCycle && layer.layerType !== 'color-cycle') {
    throw new Error(`Color Cycle brush requires a Color Cycle layer: ${layer.name}`);
  }
  if (!usesColorCycle && layer.layerType === 'color-cycle') {
    throw new Error(`Normal brush requires a normal layer: ${layer.name}`);
  }
  state.setCurrentTool('brush');
  if (layer.layerType === 'color-cycle') {
    const ready = await state.ensureColorCycleLayerRuntime(layer.id, { target: 'active' });
    if (!ready) throw new Error(`Color-cycle layer is not editable: ${layer.name}`);
  }
  await nextPaint();
  const runtime = getRuntime();
  runtime.compositeCanvasDirtyRef.current = true;
  await commitRuntimeGesture(runtime, {
    kind: 'shape',
    points: operation.points,
    ...(operation.direction ? { direction: operation.direction } : {}),
  });
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
    // A collaboration gradient command is a completed authoring decision, not
    // an in-progress toolbar edit. Fork the active layer palette so the next
    // mark owns these stops without recolouring earlier marks.
    setSharedColorCycleGradient(operation.stops, { fork: true });
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
  getRuntime: () => VesselCollaborationRuntime,
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
      await executeStroke(operation, getRuntime);
      return;
    case 'shape':
      await executeShape(operation, getRuntime);
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
    (command.action === 'batch' || command.action === 'artwork-job') &&
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

export const createVesselCollaborationExecutor = (
  getRuntime: () => VesselCollaborationRuntime,
  executorOptions: VesselCollaborationExecutorOptions = {},
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

  const settleExternalRevision = async () => {
    let stableFrames = 0;
    let previous = syncExternalRevision();
    for (let frame = 0; frame < 4 && stableFrames < 2; frame += 1) {
      await nextPaint();
      const current = syncExternalRevision();
      stableFrames = current === previous ? stableFrames + 1 : 0;
      previous = current;
    }
    return revision;
  };

  const settleCanonicalRevision = async () => {
    await executorOptions.waitForCanonicalIdle?.();
    return settleExternalRevision();
  };

  const presentCanonicalAndCapture = async (
    runtime: VesselCollaborationRuntime,
    capturePolicy: VesselCollaborationCapturePolicy,
    thumbnailMaxSize: number,
  ) => {
    await executorOptions.waitForCanonicalIdle?.();
    const captured = await presentAndCapture(runtime, capturePolicy, thumbnailMaxSize);
    // Presentation can overlap work that was registered after the first idle
    // boundary. Do not publish a captured checkpoint until that owned work has
    // reached idle and its canonical dirty revision is observable.
    await settleCanonicalRevision();
    return captured;
  };

  const updateRevisionAfterMutation = () => {
    syncExternalRevision();
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

  return async (
    command: VesselCollaborationCommand,
    options: VesselCollaborationExecutionOptions = {},
  ): Promise<VesselCollaborationResult> => {
    const startedAt = performance.now();
    const capturePolicy = defaultCapturePolicy(command);
    const thumbnailMaxSize = command.thumbnailMaxSize ?? DEFAULT_THUMBNAIL_MAX_SIZE;
    let mutationMs = 0;
    let presentationMs = 0;
    let captureMs = 0;
    let completedOperations = 0;
    const operationProfiles: NonNullable<VesselCollaborationProfile['operations']> = [];
    const batchFrames: NonNullable<VesselCollaborationResult['frames']> = [];
    const emitEvent = async (event: VesselCollaborationExecutionEvent) => {
      try {
        await options.onEvent?.(event);
      } catch {
        // Progress transport is best-effort and must never stop authoring.
      }
    };

    try {
      await executorOptions.waitForCanonicalIdle?.();
      syncExternalRevision();
      const runtimeIdentity = executorOptions.getRuntimeIdentity?.();
      if (executorOptions.requireRuntimeFence) {
        if (!runtimeIdentity) {
          throw new Error('Vessel collaboration runtime identity is unavailable');
        }
        assertVesselCollaborationRuntimeFence({
          fence: command.runtimeFence,
          identity: runtimeIdentity,
          projectId: getAppStoreState().project?.id ?? null,
          projectRevision: revision,
        });
      }
      if (command.action === 'wait-for-frame') {
        const changed = await waitForFrameRevision(command.afterRevision, command.timeoutMs ?? 25000);
        let frame: VesselCollaborationFrame | undefined;
        if (changed && capturePolicy !== 'none') {
          const captured = await presentCanonicalAndCapture(
            getRuntime(),
            capturePolicy,
            thumbnailMaxSize,
          );
          presentationMs += captured.presentationMs;
          captureMs += captured.captureMs;
          frame = captured.frame;
        }
        syncExternalRevision();
        return {
          ok: true,
          commandId: command.id,
          action: command.action,
          revision,
          ...(runtimeIdentity ? { runtime: runtimeIdentity } : {}),
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

      if (command.action === 'batch' || command.action === 'artwork-job') {
        const isArtworkJob = command.action === 'artwork-job';
        const totalOperations = command.operations.length;
        const progressStride = Math.max(1, Math.ceil(totalOperations / 240));
        let hasPresentedFrame = false;
        let cancelled = false;

        if (isArtworkJob) {
          assertArtworkJobGeometry(command.operations);
          await emitEvent({ type: 'validated', totalOperations });
        }

        for (let index = 0; index < command.operations.length; index += 1) {
          if (isArtworkJob && options.signal?.aborted) {
            cancelled = true;
            break;
          }
          const operation = command.operations[index];
          if (operation.action === 'checkpoint') {
            const captured = await presentCanonicalAndCapture(
              getRuntime(),
              operation.capture ?? 'final-thumbnail',
              operation.thumbnailMaxSize ?? thumbnailMaxSize,
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
              const checkpointFrame = {
                operationIndex: index,
                revision,
                checkpointName: operation.name,
                frame: captured.frame,
              };
              if (isArtworkJob) {
                await emitEvent({
                  type: 'checkpoint',
                  operationIndex: index,
                  checkpointName: operation.name,
                  completedOperations,
                  totalOperations,
                  revision,
                  frame: captured.frame,
                });
              } else {
                batchFrames.push(checkpointFrame);
              }
            }
            continue;
          }
          const operationStartedAt = performance.now();
          const beforeGesture = operation.action === 'stroke' || operation.action === 'shape'
            ? captureCanonicalGestureRegion(operation)
            : null;
          if (
            isArtworkJob &&
            executorOptions.enforceGeometryPreflight === true &&
            (operation.action === 'stroke' || operation.action === 'shape')
          ) {
            assertGestureExecutionContract(operation);
          }
          await executeMutation(operation, getRuntime);
          updateRevisionAfterMutation();
          const markEvidence = resolveMarkEvidence(operation, beforeGesture);
          completedOperations += 1;
          const operationMutationMs = roundMs(performance.now() - operationStartedAt);
          mutationMs += operationMutationMs;
          operationProfiles.push({
            index,
            action: operation.action,
            mutationMs: operationMutationMs,
            revision,
            ...(markEvidence ? { markEvidence } : {}),
          });

          if (isArtworkJob) {
            if (
              completedOperations === totalOperations ||
              completedOperations === 1 ||
              completedOperations % progressStride === 0
            ) {
              await emitEvent({
                type: 'progress',
                completedOperations,
                totalOperations,
                revision,
                ...(markEvidence ? { markEvidence } : {}),
              });
            }
          }

          if (
            capturePolicy === 'each-thumbnail' &&
            (operation.action === 'stroke' || operation.action === 'shape')
          ) {
            const captured = await presentCanonicalAndCapture(
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
            const captured = await presentCanonicalAndCapture(
              getRuntime(),
              capturePolicy,
              thumbnailMaxSize,
            );
            presentationMs += captured.presentationMs;
            captureMs += captured.captureMs;
            frame = captured.frame;
          }
        } else if (!hasPresentedFrame) {
          const captured = await presentCanonicalAndCapture(
            getRuntime(),
            'none',
            thumbnailMaxSize,
          );
          presentationMs += captured.presentationMs;
        }

        await settleCanonicalRevision();

        return {
          ok: true,
          commandId: command.id,
          action: command.action,
          revision,
          ...(runtimeIdentity ? { runtime: runtimeIdentity } : {}),
          state: readState(),
          frame,
          frames: batchFrames.length > 0 ? batchFrames : undefined,
          completedOperations,
          cancelled: isArtworkJob ? cancelled : undefined,
          outcome: isArtworkJob
            ? summarizeVesselCollaborationOutcome({
                profiles: operationProfiles,
                cancelled,
                hasCheckpoint: operationProfiles.some(
                  (profile) => profile.action === 'checkpoint',
                ),
              })
            : undefined,
          profile: {
            mutationMs: roundMs(mutationMs),
            presentationMs: roundMs(presentationMs),
            captureMs: roundMs(captureMs),
            totalMs: roundMs(performance.now() - startedAt),
            operations: operationProfiles,
          },
        };
      }

      const mutationStartedAt = performance.now();
      const beforeGesture = command.action === 'stroke' || command.action === 'shape'
        ? captureCanonicalGestureRegion(command)
        : null;
      await executeMutation(command, getRuntime);
      updateRevisionAfterMutation();
      const markEvidence = resolveMarkEvidence(command, beforeGesture);
      mutationMs = roundMs(performance.now() - mutationStartedAt);

      let frame: VesselCollaborationFrame | undefined;
      if (needsPresentation(command.action) || capturePolicy !== 'none') {
        const captured = await presentCanonicalAndCapture(
          getRuntime(),
          capturePolicy,
          thumbnailMaxSize,
        );
        presentationMs += captured.presentationMs;
        captureMs += captured.captureMs;
        frame = captured.frame;
      }

      syncExternalRevision();

      return {
        ok: true,
        commandId: command.id,
        action: command.action,
        revision,
        ...(runtimeIdentity ? { runtime: runtimeIdentity } : {}),
        state: readState(),
        frame,
        ...(markEvidence ? { markEvidence } : {}),
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
        ...(executorOptions.getRuntimeIdentity
          ? { runtime: executorOptions.getRuntimeIdentity() }
          : {}),
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
