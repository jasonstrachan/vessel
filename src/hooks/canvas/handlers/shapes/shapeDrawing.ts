import { getAppStoreState } from '@/stores/appStoreAccess';
import type React from 'react';
import { BrushShape, type BrushSettings, type CanvasSnapshot, type Layer, type Tool } from '@/types';
import { type AppState, type CCReason } from '@/stores/useAppStore';
import type { ColorCycleSerializedState } from '@/history/helpers/colorCycle';
import type { CaptureRegion, BoundingBox } from '@/hooks/canvas/utils/captureRegions';
import type { ShapeBeforeSnapshot } from '@/hooks/canvas/utils/snapshots';
import type { AutoSampleStops } from '@/hooks/canvas/handlers/shapes/ShapeFinalizeHandler';
import type { BrushStrokeSession } from '@/hooks/canvas/handlers/strokeSession';
import type { FinalizeQueue } from '@/lib/canvas';
import type { ColorCycleBrushImplementation } from '@/hooks/brushEngine/ColorCycleBrushMigration';
import type { LayerHistoryPayload } from '@/history/helpers/layerHistory';
import type { BrushEngine } from '@/hooks/useBrushEngineSimplified';
import type { ShapeInteractionPhase } from '@/hooks/canvas/useDrawingHandlerRefs';
import {
  beginMarkGradientSession,
  captureFrozenCcDitherRenderConfig,
  finalizeMarkGradientSession,
  type MarkGradientSession,
} from '@/hooks/canvas/utils/colorCycleMarkSession';
import {
  dedupeSequentialPoints,
  isColorCycleGradientShapePreset,
} from '@/hooks/brushEngine/colorCycleGridSnap';
import { resolveActiveColorCycleGradient } from '@/hooks/canvas/utils/colorCycleHelpers';
import { hashStops, type GradientDefSource, type StoredStop } from '@/utils/colorCycleGradientDefs';
import { debugLog, isDebugEnabled, debugWarn } from '@/utils/debug';
import { recordSampledCcShapeBreadcrumb } from '@/hooks/canvas/utils/sampledCcShapeBreadcrumbs';
import {
  calculatePressureAwareGridSpacing,
  snapToGridPure,
} from '@/hooks/brushEngine/utilities';
import { buildSampledStops } from '@/hooks/canvas/handlers/colorCycle/ccSampling';

type ShapeDrawingRefs = {
  isDrawingShapeRef: React.MutableRefObject<boolean>;
  isSelectingDirectionRef: React.MutableRefObject<boolean>;
  directionPreviewRef: React.MutableRefObject<{ x: number; y: number } | null>;
  shapePointsRef: React.MutableRefObject<Array<{ x: number; y: number }>>;
  shapeDragStartRef: React.MutableRefObject<{ x: number; y: number } | null>;
  shapeDragLastRef: React.MutableRefObject<{ x: number; y: number } | null>;
  shapeDragMovedRef: React.MutableRefObject<boolean>;
  shapeInteractionPhaseRef: React.MutableRefObject<ShapeInteractionPhase>;
  latestShapePressureRef: React.MutableRefObject<number>;
  lastStablePressureRef: React.MutableRefObject<number>;
  shapeBeforeImageRef: React.MutableRefObject<ShapeBeforeSnapshot | null>;
  strokeBoundingBoxRef: React.MutableRefObject<BoundingBox | null>;
  strokeCapturePaddingRef: React.MutableRefObject<number>;
  drawingCtxRef: React.MutableRefObject<CanvasRenderingContext2D | null>;
  drawingCanvasRef: React.MutableRefObject<HTMLCanvasElement | null>;
  drawingCanvasHasContent: React.MutableRefObject<boolean>;
  autoSamplePointsRef: React.MutableRefObject<Array<{ x: number; y: number }>>;
  autoSampleForkRef: React.MutableRefObject<boolean>;
  autoSampleLastUpdateRef: React.MutableRefObject<number>;
  ccSampledPointsRef: React.MutableRefObject<Array<{ x: number; y: number }>>;
  ccGradientSampleSessionRef: React.MutableRefObject<{
    active: boolean;
    strokeId: string | null;
    tempSlot: number;
    stops: AutoSampleStops | null;
    hash: string;
    polyline: Array<{ x: number; y: number }>;
  }>;
  ccGradientSampleLastUpdateRef: React.MutableRefObject<number>;
  hadValidShapePressureRef: React.MutableRefObject<boolean>;
  latestShapePixelSizeRef: React.MutableRefObject<number | null>;
  shapeMaxPressureRef: React.MutableRefObject<number>;
  ccShapePreviewPauseStartedRef: React.MutableRefObject<boolean>;
  activeStrokeSessionRef: React.MutableRefObject<BrushStrokeSession | null>;
  finalizeQueueRef: React.MutableRefObject<FinalizeQueue>;
};

const resolveColorCycleDitherPixelSize = ({
  settings,
  hadValidPressure,
  lastStablePressure,
  computeShapePixelSize,
}: {
  settings: BrushSettings;
  hadValidPressure: boolean;
  lastStablePressure: number;
  computeShapePixelSize: (pressure: number) => number;
}): { pixelSize: number; effectivePressure: number; usePressure: boolean } => {
  const sliderBase = Math.max(1, Math.round(settings.fillResolution || 1));
  const usePressure = Boolean(settings.pressureLinkedFillResolution && hadValidPressure);
  const effectivePressure = usePressure ? lastStablePressure : 0;
  let pixelSize = usePressure ? computeShapePixelSize(effectivePressure) : sliderBase;
  pixelSize = Math.max(1, Math.round(pixelSize || 1));
  return { pixelSize, effectivePressure, usePressure };
};

const resolveColorCycleFillMode = (
  mode?: 'linear' | 'concentric' | 'circular'
): 'linear' | 'concentric' => {
  return mode === 'concentric' || mode === 'circular' ? 'concentric' : 'linear';
};

const resolveFallbackMarkSource = (state: AppState): GradientDefSource => {
  if (state.tools.ccGradientSource === 'sampled') {
    return 'sampled';
  }
  if (state.tools.ccGradientSource === 'fg') {
    return 'fg';
  }
  return 'manual';
};

const isSampledCcShapeDrag = (state: AppState): boolean =>
  state.tools.brushSettings.brushShape === BrushShape.COLOR_CYCLE_SHAPE &&
  state.tools.ccGradientSource === 'sampled';

const canContinueShapeDrawing = (
  phaseRef: React.MutableRefObject<ShapeInteractionPhase>
): boolean => phaseRef.current === 'drawing';

const resolveCapturedShapeFinalizeLayer = (
  state: Pick<AppState, 'activeLayerId' | 'layers'>,
  capturedLayerId: string | null
): Layer | null => {
  const layerId = capturedLayerId ?? state.activeLayerId ?? null;
  if (!layerId) {
    return null;
  }
  return state.layers.find((layer) => layer.id === layerId) ?? null;
};

const shouldSkipRasterFallbackAfterColorCycleFinalize = (
  state: Pick<AppState, 'layers'>,
  handledColorCycleShape: boolean,
  finalizedTargetLayerId: string | null
): boolean => {
  if (!handledColorCycleShape || !finalizedTargetLayerId) {
    return false;
  }
  return state.layers.find((layer) => layer.id === finalizedTargetLayerId)?.layerType === 'color-cycle';
};

const buildFallbackMarkSession = (
  layer: Layer,
  state: AppState,
  gradientKind: 'linear' | 'concentric'
): MarkGradientSession | null => {
  if (layer.layerType !== 'color-cycle') {
    return null;
  }

  const resolved = resolveActiveColorCycleGradient(layer, state.tools.brushSettings, {
    fgColorHex: state.palette.foregroundColor,
    fgLightness: state.tools.brushSettings.colorCycleFgLightness,
    fgVariance: state.tools.brushSettings.colorCycleFgVariance,
    fgHueShift: state.tools.brushSettings.colorCycleFgHueShift,
    fgSaturationShift: state.tools.brushSettings.colorCycleFgSaturationShift,
    fgOpacity: state.tools.brushSettings.colorCycleFgOpacity,
    fgStops: state.tools.brushSettings.colorCycleFgStops,
  });

  if (!resolved.activeStops.length) {
    return null;
  }

  return {
    markId: 'cc-shape-fallback',
    layerId: layer.id,
    markKind: 'shape',
    gradientKind,
    source: resolveFallbackMarkSource(state),
    frozenStopsStored: resolved.activeStops,
    frozenHash: hashStops(resolved.activeStops, gradientKind),
    binding: null,
    speedCps: state.tools.brushSettings.colorCycleSpeed,
    ditherRenderConfig: captureFrozenCcDitherRenderConfig(),
  };
};

const resolveShapeSampleColor = (
  deps: Pick<ShapeDrawingDeps, 'sampleColorAt' | 'sampleHexAt'>,
  fallbackColor: string
) => (x: number, y: number): string => {
  const sampled =
    (typeof deps.sampleColorAt === 'function' ? deps.sampleColorAt(x, y) : null) ??
    deps.sampleHexAt(x, y);
  return sampled ?? fallbackColor;
};

const beginFinalSampledShapeSession = (params: {
  layer: Layer;
  state: AppState;
  shapePoints: Array<{ x: number; y: number }>;
  deps: Pick<ShapeDrawingDeps, 'sampleColorAt' | 'sampleHexAt'>;
}): MarkGradientSession | null => {
  if (params.layer.layerType !== 'color-cycle') {
    return null;
  }

  const gradientKind = resolveColorCycleFillMode(params.state.tools.brushSettings.colorCycleFillMode);
  const fallbackResolved = resolveActiveColorCycleGradient(params.layer, params.state.tools.brushSettings, {
    fgColorHex: params.state.palette.foregroundColor,
    fgLightness: params.state.tools.brushSettings.colorCycleFgLightness,
    fgVariance: params.state.tools.brushSettings.colorCycleFgVariance,
    fgHueShift: params.state.tools.brushSettings.colorCycleFgHueShift,
    fgSaturationShift: params.state.tools.brushSettings.colorCycleFgSaturationShift,
    fgOpacity: params.state.tools.brushSettings.colorCycleFgOpacity,
    fgStops: params.state.tools.brushSettings.colorCycleFgStops,
  });
  const fallbackStops = fallbackResolved.activeStops;
  const fallbackColor =
    params.state.palette.foregroundColor ??
    params.state.tools.brushSettings.color ??
    '#000000';
  const sampledPreview = buildSampledStops({
    sourcePts: params.shapePoints,
    sampleColor: resolveShapeSampleColor(params.deps, fallbackColor),
    allowTiny: true,
  });
  const previewStops: StoredStop[] | null =
    sampledPreview?.stops && sampledPreview.stops.length >= 2
      ? sampledPreview.stops
      : null;

  const session = beginMarkGradientSession({
    layerId: params.layer.id,
    markKind: 'shape',
    gradientKind,
    source: 'sampled',
    stops: fallbackStops,
    speedCps: params.state.tools.brushSettings.colorCycleSpeed,
  });
  if (!session) {
    return null;
  }

  session.fallbackStopsStored = fallbackStops;
  session.previewStopsStored = previewStops;
  session.previewHash = previewStops ? hashStops(previewStops, gradientKind) : '';

  return session;
};

const shouldSnapShapePreviewToGrid = (state: AppState): boolean => {
  const presetId = state.currentBrushPreset?.id ?? null;
  const { brushSettings } = state.tools;
  if (brushSettings.gridSnapEnabled !== true) {
    return false;
  }

  const isDitherPreset = presetId === 'dither-stroke' || presetId === 'dither-shape';
  if (isDitherPreset) {
    return true;
  }

  return isColorCycleGradientShapePreset(presetId, brushSettings.brushShape);
};

const resolveDitherGridSnapPoint = (
  worldPos: { x: number; y: number },
  state: AppState,
  pressure?: number
): { x: number; y: number } => {
  const { brushSettings } = state.tools;
  if (!shouldSnapShapePreviewToGrid(state)) {
    return worldPos;
  }

  const gridSpacing = calculatePressureAwareGridSpacing(brushSettings, pressure);
  return snapToGridPure(worldPos.x, worldPos.y, gridSpacing);
};

const normalizeSnappedShapePoints = (
  points: Array<{ x: number; y: number }>,
  state: AppState,
  pressure?: number
): Array<{ x: number; y: number }> => {
  if (
    points.length <= 1 ||
    !isColorCycleGradientShapePreset(
      state.currentBrushPreset?.id,
      state.tools.brushSettings.brushShape,
    ) ||
    state.tools.brushSettings.gridSnapEnabled !== true
  ) {
    return points;
  }

  return dedupeSequentialPoints(
    points.map((point) => resolveDitherGridSnapPoint(point, state, pressure)),
  );
};

const shouldUseSimpleShapePreview = (state: AppState): boolean => {
  const brushSettings = state.tools.brushSettings;
  const isCCShape = brushSettings.brushShape === BrushShape.COLOR_CYCLE_SHAPE;
  if (!isCCShape) {
    return true;
  }

  const presetId = state.currentBrushPreset?.id ?? null;
  const isLinearPreview = brushSettings.colorCycleFillMode === 'linear';
  const isGradientPreset = presetId === 'color-cycle-gradient';
  const isDitherPreview = Boolean(brushSettings.ditherEnabled) && (isLinearPreview || isGradientPreset);

  return !isDitherPreview;
};

const shouldKeepColorCycleShapeOverlayAfterFinalize = (): boolean => {
  // CC shape overlays are transient preview/vector UI and should clear on mouse-up.
  return false;
};

const canStartShapeDrawing = ({
  isBusyRef,
  finalizeQueueRef,
}: {
  isBusyRef?: React.MutableRefObject<boolean> | null;
  finalizeQueueRef: React.MutableRefObject<FinalizeQueue>;
}): boolean => {
  if (isBusyRef?.current) {
    return false;
  }

  return !finalizeQueueRef.current.isBusy();
};

type ShapeDrawingDeps = {
  storeRef: React.MutableRefObject<AppState>;
  toolsRef: React.MutableRefObject<AppState['tools']>;
  project: { width: number; height: number } | null;
  isBusyRef?: React.MutableRefObject<boolean> | null;
  drawingCtxRef: React.MutableRefObject<CanvasRenderingContext2D | null>;
  drawingCanvasRef: React.MutableRefObject<HTMLCanvasElement | null>;
  drawingCanvasHasContent: React.MutableRefObject<boolean>;
  strokeBoundingBoxRef: React.MutableRefObject<BoundingBox | null>;
  strokeCapturePaddingRef: React.MutableRefObject<number>;
  shapeBeforeImageRef: React.MutableRefObject<ShapeBeforeSnapshot | null>;
  latestShapePixelSizeRef: React.MutableRefObject<number | null>;
  hadValidShapePressureRef: React.MutableRefObject<boolean>;
  lastStablePressureRef: React.MutableRefObject<number>;
  brushEngine: BrushEngine;
  getColorCycleBrushManager: () => { getBrush: (layerId: string) => ColorCycleBrushImplementation | null | undefined };
  getColorCycleBrushFlags: (settings: BrushSettings) => { isAny: boolean };
  sampleColorAt?: (x: number, y: number) => string | null;
  sampleHexAt: (x: number, y: number) => string | null;
  initDrawingCanvas: () => void;
  startDrawing: (worldPos: { x: number; y: number }, pressure?: number) => void;
  continueDrawing: (worldPos: { x: number; y: number }, pressure?: number) => void;
  seedManualStrokeBoundingBox: (points: Array<{ x: number; y: number }>, padding: number) => void;
  triggerSimpleShapePreview: () => void;
  resetShapeDragRefs: () => void;
  resetCcGradientSample: () => void;
  updateShapePressure: (pressure?: number, timestamp?: number, rawPressure?: number) => void;
  pauseColorCycleForNonCCInteraction: (reason?: CCReason) => void;
  resumeColorCycleAfterInteraction: () => Promise<void>;
  updateAutoSampledGradient: (points: Array<{ x: number; y: number }>) => void;
  updateCcSampledGradient: (
    points: Array<{ x: number; y: number }>,
    options?: { layerId?: string | null; markKind?: 'stroke' | 'shape' }
  ) => void;
  updateCcGradientSample: (points: Array<{ x: number; y: number }>, strokeId?: string | null) => void;
  updateDitherGradSamples: (points: Array<{ x: number; y: number }>) => void;
  capturePendingShapeSnapshot: () => void;
  clearShapeBeforeSnapshot: () => void;
  createBoundingBox: (point: { x: number; y: number }) => BoundingBox;
  mergeBoundingBox: (bbox: BoundingBox | null, point: { x: number; y: number }) => BoundingBox;
  appendSegmentWithDynamicResampling: (
    points: Array<{ x: number; y: number }>,
    worldPos: { x: number; y: number },
    zoom: number,
    brushSize: number,
    minSpacing: number,
    maxSpacing: number
  ) => number;
  computeAutoSampleStops: (
    points: Array<{ x: number; y: number }>,
    options?: { allowTiny?: boolean }
  ) => Array<{ position: number; color: string }> | null;
  computeShapePixelSize: (pressure: number) => number;
  finalizeDrawing: (skipSaveOrOptions?: boolean | { skipSave?: boolean }) => Promise<void>;
  finalizeDitherGradientShape: (args: {
    drawCtx: CanvasRenderingContext2D;
    canvas: HTMLCanvasElement;
    drawingCanvasHasContent: React.MutableRefObject<boolean>;
    liveBrushSettings: BrushSettings;
    polygonState: AppState['polygonGradientState'];
    shapePoints: Array<{ x: number; y: number }>;
    palette: AppState['palette'];
    project: AppState['project'];
    strokeBoundingBoxRef: React.MutableRefObject<BoundingBox | null>;
    strokeCapturePaddingRef: React.MutableRefObject<number>;
    roiPadding: number;
    lastStablePressure: number;
    latestShapePixelSizeRef: React.MutableRefObject<number | null>;
    computeShapePixelSize: ShapeDrawingDeps['computeShapePixelSize'];
  }) => void;
  finalizeRasterShapeFill: (args: {
    drawCtx: CanvasRenderingContext2D;
    brushEngine: BrushEngine;
    storeRef: React.MutableRefObject<AppState>;
    liveBrushSettings: BrushSettings;
    shapePoints: Array<{ x: number; y: number }>;
    ditherGradPoints: Array<{ x: number; y: number }> | null;
    strokeBoundingBox: BoundingBox | null;
    project: { width: number; height: number } | null;
    roiPadding: number;
    computeAutoSampleStops: ShapeDrawingDeps['computeAutoSampleStops'];
    setSharedColorCycleGradient: (stops: AutoSampleStops | null) => void;
    computeShapePixelSize: ShapeDrawingDeps['computeShapePixelSize'];
    hadValidShapePressureRef: React.MutableRefObject<boolean>;
    lastStablePressureRef: React.MutableRefObject<number>;
    latestShapePixelSizeRef: React.MutableRefObject<number | null>;
    boundingBoxToCaptureRegion: (bbox: BoundingBox | null, padding: number, project: { width: number; height: number } | null) => CaptureRegion | undefined;
    logError: (message: string, error?: unknown) => void;
    ccDebug: { on: boolean; timing: boolean; verbose: boolean };
  }) => void;
  runColorCycleShapeFill: (args: {
    mode: 'linear' | 'concentric';
    session: import('@/hooks/canvas/utils/colorCycleMarkSession').MarkGradientSession | null;
    shapePoints: Array<{ x: number; y: number }>;
    direction?: { x: number; y: number };
    activeLayerId: string;
    activeLayerCanvas: HTMLCanvasElement;
    overlayCanvas: HTMLCanvasElement | null;
    overlayCtx: CanvasRenderingContext2D | null;
    fallbackBlendMode: GlobalCompositeOperation;
    fallbackOpacity: number;
    shapeLayerId: string;
    beforeColorState: ColorCycleSerializedState | null;
    tool: Tool;
    roi?: CaptureRegion;
    ditherPixelSize?: number;
    keepOverlayAfter?: boolean;
  }, deps: {
    brushEngine: BrushEngine;
    getColorCycleBrushManager: ShapeDrawingDeps['getColorCycleBrushManager'];
    bindBrushToCanvas: (brush: ColorCycleBrushImplementation | null | undefined, canvas: HTMLCanvasElement | null | undefined) => void;
    timeAsync: <T>(label: string, task: () => Promise<T>) => Promise<T>;
    timeSync: <T>(label: string, task: () => T) => T;
    ccLog: (label: string, payload?: Record<string, unknown>) => void;
    scheduleDeferredColorCycleSaveWithState: (options: {
      layerId: string;
      canvas: HTMLCanvasElement;
      beforeColorState: ColorCycleSerializedState;
      afterColorState?: ColorCycleSerializedState;
      actionType: CanvasSnapshot['actionType'];
      description: string;
      tool: string;
      coalesce?: LayerHistoryPayload['coalesce'];
      beforeImage?: LayerHistoryPayload['beforeImage'];
      skipBitmapDelta?: boolean;
      roi?: { x: number; y: number; width: number; height: number };
    }) => Promise<void>;
    logError: (message: string, error?: unknown) => void;
    ccDebug: { on: boolean; timing: boolean; verbose: boolean };
    perfMark: (label: string) => void;
    perfMeasure: (label: string, start: string, end: string) => void;
    debugTime: (label: string) => void;
    debugTimeEnd: (label: string) => void;
  }) => Promise<void>;
  computeFallbackLinearDirection: (points: Array<{ x: number; y: number }>) => { x: number; y: number };
  ensureActiveColorCycleGradientSlot: (
    state: AppState,
    layer: Layer,
    brush?: ColorCycleBrushImplementation | null
  ) => void;
  captureRegionFromPoints: (points: Array<{ x: number; y: number }>, padding: number, project: { width: number; height: number } | null) => CaptureRegion | undefined;
  boundingBoxToCaptureRegion: (
    bbox: BoundingBox | null,
    padding: number,
    project: { width: number; height: number } | null
  ) => CaptureRegion | undefined;
  commitRasterShapeFill: (
    args: {
      shapePoints: Array<{ x: number; y: number }>;
      shapeBeforeSnapshot: ShapeBeforeSnapshot | null;
      shapeBeforeColorState: ColorCycleSerializedState | null;
      liveBrushSettings: BrushSettings;
      tool: string;
    },
    deps: {
      storeRef: React.MutableRefObject<AppState>;
      project: { width: number; height: number } | null;
      drawingCanvasRef: React.MutableRefObject<HTMLCanvasElement | null>;
      drawingCtxRef: React.MutableRefObject<CanvasRenderingContext2D | null>;
      drawingCanvasHasContent: React.MutableRefObject<boolean>;
      strokeBoundingBoxRef: React.MutableRefObject<BoundingBox | null>;
      strokeCapturePaddingRef: React.MutableRefObject<number>;
      roiPadding: number;
      captureRegionFromPoints: (
        points: Array<{ x: number; y: number }>,
        padding: number,
        project: { width: number; height: number } | null
      ) => CaptureRegion | undefined;
      boundingBoxToCaptureRegion: ShapeDrawingDeps['boundingBoxToCaptureRegion'];
      inflateShapeBeforeSnapshot: (
        layer: Layer | null | undefined,
        snapshot: ShapeBeforeSnapshot
      ) => ImageData | null;
      ensureLayerSnapshotWithRetry: (
        layer: Layer | null | undefined,
        existing: ImageData | null,
        maxAttempts?: number
      ) => Promise<ImageData | null>;
      applyBackdropFromSnapshot: (
        ctx: CanvasRenderingContext2D | null,
        image: ImageData | null,
        roi?: CaptureRegion
      ) => void;
      captureCanvasToActiveLayer: (canvas: HTMLCanvasElement, roi?: CaptureRegion) => Promise<void>;
      scheduleHistoryCommit: (payload: LayerHistoryPayload) => Promise<void>;
      clearShapeBeforeSnapshot: () => void;
      resetPolygonState: () => void;
      resumeColorCycleAfterInteraction: () => Promise<void>;
      setBusy: (busy: boolean) => void;
      withTiming: <T>(label: string, task: () => Promise<T> | T) => Promise<T>;
      logError: (message: string, error?: unknown) => void;
    }
  ) => Promise<boolean>;
  runIdle: (task: () => void) => void;
  scheduleDeferredColorCycleSaveWithState: (args: {
    layerId: string;
    canvas: HTMLCanvasElement;
    beforeColorState: ColorCycleSerializedState | null;
    actionType: CanvasSnapshot['actionType'];
    description: string;
    tool: string;
    roi?: CaptureRegion;
  }) => Promise<void>;
  bindBrushToCanvas: (brush: ColorCycleBrushImplementation | null | undefined, canvas: HTMLCanvasElement | null | undefined) => void;
  captureColorCycleBrushState: (layerId: string) => ColorCycleSerializedState;
  isColorCycleLayerWithData: (layer: Layer) => boolean;
  setSharedColorCycleGradient: (stops: AutoSampleStops | null) => void;
  logError: (message: string, error?: unknown) => void;
  withTiming: <T>(label: string, task: () => Promise<T> | T) => Promise<T>;
  timeAsync: <T>(label: string, task: () => Promise<T>) => Promise<T>;
  timeSync: <T>(label: string, task: () => T) => T;
  ccLog: (label: string, payload?: Record<string, unknown>) => void;
  ccDebug: { on: boolean; timing: boolean; verbose: boolean };
  perfMark: (label: string) => void;
  perfMeasure: (label: string, start: string, end: string) => void;
  debugTime: (label: string) => void;
  debugTimeEnd: (label: string) => void;
  resetAutoSampleState: (disableGradient?: boolean) => void;
  resetShapePressureState: () => void;
  resetPolygonState: () => void;
  inflateShapeBeforeSnapshot: (
    layer: Layer | null | undefined,
    snapshot: ShapeBeforeSnapshot
  ) => ImageData | null;
  ensureLayerSnapshotWithRetry: (
    layer: Layer | null | undefined,
    existing: ImageData | null,
    maxAttempts?: number
  ) => Promise<ImageData | null>;
  applyBackdropFromSnapshot: (
    ctx: CanvasRenderingContext2D | null,
    image: ImageData | null,
    roi?: CaptureRegion
  ) => void;
  captureCanvasToActiveLayer: (canvas: HTMLCanvasElement, roi?: CaptureRegion) => Promise<void>;
  scheduleHistoryCommit: (payload: LayerHistoryPayload) => Promise<void>;
  ROI_PADDING_PX: number;
  FF: { CC_CAPTURE_ROI: boolean };
};

export const startShapeDrawing = (
  args: {
    worldPos: { x: number; y: number };
    pressure?: number;
    timestamp?: number;
    rawPressure?: number;
    shapeMode: boolean;
    refs: ShapeDrawingRefs;
    renderPreview?: boolean;
  },
  deps: ShapeDrawingDeps
): boolean => {
  if (args.refs.shapeInteractionPhaseRef.current === 'finalizing') {
    return false;
  }

  if (
    !canStartShapeDrawing({
      isBusyRef: deps.isBusyRef,
      finalizeQueueRef: args.refs.finalizeQueueRef,
    })
  ) {
    return false;
  }

  const { worldPos, pressure = 0, timestamp, rawPressure, shapeMode, refs } = args;
  const drawPos = resolveDitherGridSnapPoint(worldPos, deps.storeRef.current, pressure);
  const renderPreview = args.renderPreview !== false;
  const isNewShape = !refs.isDrawingShapeRef.current || refs.shapePointsRef.current.length === 0;

  if (isNewShape) {
    refs.shapeInteractionPhaseRef.current = 'drawing';
    deps.resetShapePressureState();
  }

  const effectivePressure = pressure;
  const rawVal = typeof rawPressure === 'number' ? rawPressure : pressure;

  refs.shapeMaxPressureRef.current = rawVal || refs.latestShapePressureRef.current || 0.5;
  deps.updateShapePressure(effectivePressure, timestamp, rawVal);
  if (refs.isSelectingDirectionRef.current) {
    refs.directionPreviewRef.current = drawPos;
    return true;
  }

  try {
    const store = deps.storeRef.current;
    const currentTool = store.tools.currentTool;
    const brushSettings = store.tools.brushSettings;
    const ccFlags = deps.getColorCycleBrushFlags(brushSettings);
    const shouldAutoSample =
      currentTool === 'brush' &&
      brushSettings.autoSampleColor &&
      !ccFlags.isAny &&
      brushSettings.brushShape !== BrushShape.RESAMPLER;

    if (shouldAutoSample) {
      const sampler = typeof deps.sampleColorAt === 'function' ? deps.sampleColorAt : deps.sampleHexAt;
      const sampledColor = sampler(drawPos.x, drawPos.y) ?? brushSettings.color;
      if (sampledColor && sampledColor !== brushSettings.color) {
        store.setBrushSettings({ color: sampledColor, useSwatchColor: true });
        if (store.palette.activeSlot === 'foreground') {
          store.setPaletteColor('foreground', sampledColor);
        }
        if (deps.brushEngine.engine && typeof deps.brushEngine.engine.updateConfig === 'function') {
          deps.brushEngine.engine.updateConfig({
            brushSettings: { ...brushSettings, color: sampledColor, useSwatchColor: true }
          });
        }
      }
    }
  } catch {}

  if (shapeMode) {
    const shouldResetBounding =
      !refs.isDrawingShapeRef.current || refs.shapePointsRef.current.length === 0;
    if (shouldResetBounding) {
      refs.strokeBoundingBoxRef.current = deps.createBoundingBox(drawPos);
      refs.strokeCapturePaddingRef.current = deps.ROI_PADDING_PX;
    } else {
      refs.strokeBoundingBoxRef.current = deps.mergeBoundingBox(refs.strokeBoundingBoxRef.current, drawPos);
      refs.strokeCapturePaddingRef.current = Math.max(
        refs.strokeCapturePaddingRef.current,
        deps.ROI_PADDING_PX
      );
    }
    if (!refs.isDrawingShapeRef.current) {
      deps.clearShapeBeforeSnapshot();
    }
    try {
      const st = deps.storeRef.current;
      const isCCShape = st.tools.brushSettings.brushShape === BrushShape.COLOR_CYCLE_SHAPE;
      if (!isCCShape) {
        deps.initDrawingCanvas();
      }
    } catch {
      deps.initDrawingCanvas();
    }
    const shapeStoreSnapshot = deps.storeRef.current;
    const activeShape = shapeStoreSnapshot.tools.brushSettings.brushShape;
    const isAdvancedShape =
      activeShape === BrushShape.CONTOUR_POLYGON ||
      activeShape === BrushShape.CONTOUR_LINES2 ||
      activeShape === BrushShape.RECTANGLE_GRADIENT ||
      activeShape === BrushShape.POLYGON_GRADIENT ||
      activeShape === BrushShape.DITHER_GRADIENT ||
      activeShape === BrushShape.COLOR_CYCLE_SHAPE ||
      activeShape === BrushShape.SHAPE_FILL;

    if (isAdvancedShape && refs.isDrawingShapeRef.current && refs.shapePointsRef.current.length > 0) {
      refs.shapePointsRef.current.push(drawPos);
      deps.seedManualStrokeBoundingBox(refs.shapePointsRef.current, 2);
      if (renderPreview && shouldUseSimpleShapePreview(deps.storeRef.current)) {
        deps.triggerSimpleShapePreview();
      }
      try {
        const st = deps.storeRef.current;
        if (
          st.tools.brushSettings.brushShape === BrushShape.DITHER_GRADIENT &&
          st.tools.brushSettings.ditherGradSampleEnabled
        ) {
          deps.updateDitherGradSamples(refs.shapePointsRef.current);
        }
      } catch (error) {
        const currentState = deps.storeRef.current;
        deps.logError('CC shape pointerdown sampled update failed', {
          error: error instanceof Error ? error.message : String(error),
          layerId: currentState.activeLayerId ?? null,
          ccGradientSource: currentState.tools.ccGradientSource,
          pointCount: refs.shapePointsRef.current.length,
        });
      }
    } else {
      refs.shapePointsRef.current = [drawPos];
      deps.seedManualStrokeBoundingBox(refs.shapePointsRef.current, 2);
      refs.isDrawingShapeRef.current = true;
      getAppStoreState().setShapeDrawing(true);
      refs.shapeDragStartRef.current = drawPos;
      refs.shapeDragLastRef.current = drawPos;
      refs.shapeDragMovedRef.current = false;
      if (renderPreview && shouldUseSimpleShapePreview(deps.storeRef.current)) {
        deps.triggerSimpleShapePreview();
      }
      if (isSampledCcShapeDrag(shapeStoreSnapshot)) {
        recordSampledCcShapeBreadcrumb({
          event: 'pointer-down',
          activeLayerId: shapeStoreSnapshot.activeLayerId ?? null,
          pointCount: refs.shapePointsRef.current.length,
          source: shapeStoreSnapshot.tools.ccGradientSource ?? null,
          x: drawPos.x,
          y: drawPos.y,
        });
      }
      try {
        const st = deps.storeRef.current;
        const isCCShape = st.tools.brushSettings.brushShape === BrushShape.COLOR_CYCLE_SHAPE;
        const sampledSource = isSampledCcShapeDrag(st);
        const autoSampleEnabled =
          st.tools.brushSettings.autoSampleGradient ||
          st.tools.brushSettings.autoSampleGradientRealtime;
        if (isCCShape && st.activeLayerId && !sampledSource) {
          const activeLayer = st.layers.find((layer) => layer.id === st.activeLayerId);
          if (activeLayer?.layerType === 'color-cycle') {
            const resolved = resolveActiveColorCycleGradient(activeLayer, st.tools.brushSettings, {
              fgColorHex: st.palette.foregroundColor,
              fgLightness: st.tools.brushSettings.colorCycleFgLightness,
              fgVariance: st.tools.brushSettings.colorCycleFgVariance,
              fgHueShift: st.tools.brushSettings.colorCycleFgHueShift,
              fgSaturationShift: st.tools.brushSettings.colorCycleFgSaturationShift,
              fgOpacity: st.tools.brushSettings.colorCycleFgOpacity,
              fgStops: st.tools.brushSettings.colorCycleFgStops,
            });
            const gradientKind =
              resolveColorCycleFillMode(st.tools.brushSettings.colorCycleFillMode) === 'linear'
                ? 'linear'
                : 'concentric';
            const desiredSource =
              st.tools.ccGradientSource ??
              (st.tools.brushSettings.colorCycleUseForegroundGradient ? 'fg' : 'manual');
            const source =
              desiredSource === 'sampled'
                ? 'sampled'
                : desiredSource === 'fg'
                  ? 'fg'
                  : 'manual';
            const s = getAppStoreState();
            const logCcFg = isDebugEnabled('cc-fg');
            if (logCcFg) {
              debugLog('cc-fg', '[CC FG] pointerdown tools', {
                ccGradientSource: s.tools.ccGradientSource,
                fgColor: s.palette.foregroundColor,
                bands: s.tools.brushSettings.gradientBands,
                fillMode: s.tools.brushSettings.colorCycleFillMode,
              });
            }
            const resolvedForHash = resolveActiveColorCycleGradient(activeLayer, s.tools.brushSettings, {
              fgColorHex: s.palette.foregroundColor,
              fgLightness: s.tools.brushSettings.colorCycleFgLightness,
              fgVariance: s.tools.brushSettings.colorCycleFgVariance,
              fgHueShift: s.tools.brushSettings.colorCycleFgHueShift,
              fgSaturationShift: s.tools.brushSettings.colorCycleFgSaturationShift,
              fgOpacity: s.tools.brushSettings.colorCycleFgOpacity,
              fgStops: s.tools.brushSettings.colorCycleFgStops,
            });
            const kindForHash =
              resolveColorCycleFillMode(s.tools.brushSettings.colorCycleFillMode) === 'linear'
                ? 'linear'
                : 'concentric';
            if (logCcFg) {
              debugLog('cc-fg', '[CC FG] resolved stops hash', hashStops(resolvedForHash.activeStops, kindForHash));
            }
            beginMarkGradientSession({
              layerId: activeLayer.id,
              markKind: 'shape',
              gradientKind,
              source,
              stops: resolved.activeStops,
              speedCps: s.tools.brushSettings.colorCycleSpeed,
            });
          }
        }
        if (isCCShape && autoSampleEnabled && !sampledSource) {
          refs.autoSamplePointsRef.current = [...refs.shapePointsRef.current];
          refs.autoSampleForkRef.current = true;
          refs.autoSampleLastUpdateRef.current = 0;
          deps.updateAutoSampledGradient(refs.autoSamplePointsRef.current);
        }
        if (
          st.tools.brushSettings.brushShape === BrushShape.DITHER_GRADIENT &&
          st.tools.brushSettings.ditherGradSampleEnabled
        ) {
          deps.updateDitherGradSamples(refs.shapePointsRef.current);
        }
      } catch {}
    }
  } else {
    deps.startDrawing(drawPos, pressure);
  }

  return true;
};

export const continueShapeDrawing = (
  args: {
    worldPos: { x: number; y: number };
    pressure?: number;
    timestamp?: number;
    rawPressure?: number;
    shapeMode: boolean;
    refs: ShapeDrawingRefs;
    renderPreview?: boolean;
  },
  deps: ShapeDrawingDeps
): void => {
  if (!canContinueShapeDrawing(args.refs.shapeInteractionPhaseRef)) {
    return;
  }

  const { worldPos, pressure = 0, timestamp, rawPressure, shapeMode, refs } = args;
  const drawPos = resolveDitherGridSnapPoint(worldPos, deps.storeRef.current, pressure);
  const renderPreview = args.renderPreview !== false;
  const rawVal = typeof rawPressure === 'number' ? rawPressure : pressure;
  deps.updateShapePressure(pressure, timestamp, rawVal);

  if (shapeMode && !refs.ccShapePreviewPauseStartedRef.current) {
    const state = deps.storeRef.current;
    const isCCShape = state.tools.brushSettings.brushShape === BrushShape.COLOR_CYCLE_SHAPE;

    if (!isCCShape) {
      deps.pauseColorCycleForNonCCInteraction();
    }
    refs.ccShapePreviewPauseStartedRef.current = true;
  }

  const currentState = deps.storeRef.current;
  const activeLayer = currentState.layers.find(l => l.id === currentState.activeLayerId);
  if (activeLayer && !activeLayer.visible) {
    return;
  }

  if (refs.isSelectingDirectionRef.current && refs.shapePointsRef.current.length >= 3) {
    if (!deps.drawingCtxRef.current || !deps.drawingCanvasRef.current) {
      deps.initDrawingCanvas();
    }

    const drawCtx = deps.drawingCtxRef.current;
    if (drawCtx && deps.drawingCanvasRef.current) {
      drawCtx.clearRect(0, 0, deps.drawingCanvasRef.current.width, deps.drawingCanvasRef.current.height);
      drawCtx.fillStyle = 'rgba(0, 0, 0, 0.3)';
      drawCtx.beginPath();
      drawCtx.moveTo(refs.shapePointsRef.current[0].x, refs.shapePointsRef.current[0].y);
      for (let i = 1; i < refs.shapePointsRef.current.length; i++) {
        drawCtx.lineTo(refs.shapePointsRef.current[i].x, refs.shapePointsRef.current[i].y);
      }
      drawCtx.closePath();
      drawCtx.fill();

      let centerX = 0;
      let centerY = 0;
      for (const p of refs.shapePointsRef.current) {
        centerX += p.x;
        centerY += p.y;
      }
      centerX /= refs.shapePointsRef.current.length;
      centerY /= refs.shapePointsRef.current.length;

      drawCtx.save();
      drawCtx.globalCompositeOperation = 'difference';
      drawCtx.strokeStyle = '#000000';
      drawCtx.lineWidth = 1;
      drawCtx.beginPath();
      drawCtx.moveTo(centerX, centerY);
      drawCtx.lineTo(drawPos.x, drawPos.y);
      drawCtx.stroke();
      drawCtx.restore();
    }
    return;
  }

  if (shapeMode && refs.isDrawingShapeRef.current) {
    const store = deps.storeRef.current;
    const zoom = store.canvas?.zoom || 1;
    const brushSize = store.tools.brushSettings.size || 20;
    refs.latestShapePressureRef.current = pressure;
    refs.shapeDragLastRef.current = drawPos;
    if (refs.shapeDragStartRef.current) {
      const distFromStart = Math.hypot(
        drawPos.x - refs.shapeDragStartRef.current.x,
        drawPos.y - refs.shapeDragStartRef.current.y
      );
      if (distFromStart > 1) {
        refs.shapeDragMovedRef.current = true;
      }
    }
    const added = deps.appendSegmentWithDynamicResampling(
      refs.shapePointsRef.current,
      drawPos,
      zoom,
      brushSize,
      0.25,
      0.6
    );
    refs.shapePointsRef.current = normalizeSnappedShapePoints(
      refs.shapePointsRef.current,
      store,
      pressure
    );
    if (added > 0 || refs.shapeDragMovedRef.current) {
      deps.seedManualStrokeBoundingBox(refs.shapePointsRef.current, 2);
      if (renderPreview && shouldUseSimpleShapePreview(store)) {
        deps.capturePendingShapeSnapshot();
        deps.triggerSimpleShapePreview();
      }
      if (added > 0) {
        try {
          const isCCShape = store.tools.brushSettings.brushShape === BrushShape.COLOR_CYCLE_SHAPE;
          const sampledSource = isSampledCcShapeDrag(store);
          const autoSampleEnabled =
            store.tools.brushSettings.autoSampleGradient ||
            store.tools.brushSettings.autoSampleGradientRealtime;
          if (isCCShape && autoSampleEnabled && !sampledSource) {
            refs.autoSamplePointsRef.current = [...refs.shapePointsRef.current];
            refs.autoSampleForkRef.current = true;
            deps.updateAutoSampledGradient(refs.autoSamplePointsRef.current);
          }
          if (
            store.tools.brushSettings.brushShape === BrushShape.DITHER_GRADIENT &&
            store.tools.brushSettings.ditherGradSampleEnabled
          ) {
            deps.updateDitherGradSamples(refs.shapePointsRef.current);
          }
        } catch (error) {
          deps.logError('CC shape drag sampled update failed', {
            error: error instanceof Error ? error.message : String(error),
            layerId: store.activeLayerId ?? null,
            ccGradientSource: store.tools.ccGradientSource,
            pointCount: refs.shapePointsRef.current.length,
          });
        }
      }
    }
  } else if (!shapeMode) {
    deps.continueDrawing(drawPos);
  }
};

export const finalizeShapeDrawing = async (
  args: {
    shapeMode: boolean;
    refs: ShapeDrawingRefs;
    toolsRef: React.MutableRefObject<AppState['tools']>;
  },
  deps: ShapeDrawingDeps
): Promise<void> => {
  if (args.refs.shapeInteractionPhaseRef.current === 'finalizing') {
    return;
  }

  const polygonState = deps.storeRef.current.polygonGradientState;
  const toolsSnapshot = args.toolsRef.current;
  const liveBrushSettings = toolsSnapshot.brushSettings;
  const polygonPointCount = Math.max(
    polygonState.points?.length ?? 0,
    polygonState.vertices?.length ?? 0
  );
  const polygonActive = polygonState.drawingState !== 'idle' && polygonPointCount >= 3;
  const hasShapeInProgress =
    args.shapeMode ||
    polygonActive ||
    args.refs.isSelectingDirectionRef.current ||
    args.refs.isDrawingShapeRef.current;

  if (!hasShapeInProgress) {
    return deps.finalizeDrawing();
  }

  if (deps.isBusyRef?.current) {
    return;
  }

  let ditherGradPoints: Array<{ x: number; y: number }> | null = null;
  args.refs.shapeInteractionPhaseRef.current = 'finalizing';
  deps.ccLog('shape: finalize begin', {
    brushShape: liveBrushSettings.brushShape,
    isSelectingDirection: args.refs.isSelectingDirectionRef.current,
    isDrawingShape: args.refs.isDrawingShapeRef.current,
    pointCount: args.refs.shapePointsRef.current.length,
    polygonPointCount,
    source: liveBrushSettings.ccGradientSource ?? null,
  });
  if (liveBrushSettings.brushShape === BrushShape.COLOR_CYCLE_SHAPE && liveBrushSettings.ccGradientSource === 'sampled') {
    recordSampledCcShapeBreadcrumb({
      event: 'finalize-begin',
      activeLayerId: deps.storeRef.current.activeLayerId ?? null,
      pointCount: args.refs.shapePointsRef.current.length,
      polygonPointCount,
      isSelectingDirection: args.refs.isSelectingDirectionRef.current,
      isDrawingShape: args.refs.isDrawingShapeRef.current,
      source: liveBrushSettings.ccGradientSource ?? null,
    });
  }

  const finalizeTargetLayerId = deps.storeRef.current.activeLayerId ?? null;

  void args.refs.finalizeQueueRef.current.enqueue(async () => {
    let finalizeTriggered = false;
    let handledColorCycleShape = false;
    let handledColorCycleTargetLayerId: string | null = null;

    let shapeLayerId: string | null = null;
    let shapeBeforeColorState: ColorCycleSerializedState | null = null;

    if (liveBrushSettings.brushShape === BrushShape.DITHER_GRADIENT) {
      const points =
        polygonState.vertices && polygonState.vertices.length >= 3
          ? polygonState.vertices
          : polygonState.points && polygonState.points.length >= 3
            ? polygonState.points
            : args.refs.shapePointsRef.current;

      if (points && points.length >= 3) {
        ditherGradPoints = points;
        const drawCtx = deps.drawingCtxRef.current;
        const canvas = deps.drawingCanvasRef.current;
        if (drawCtx && canvas) {
          deps.finalizeDitherGradientShape({
            drawCtx,
            canvas,
            drawingCanvasHasContent: deps.drawingCanvasHasContent,
            liveBrushSettings,
            polygonState,
            shapePoints: points,
            palette: deps.storeRef.current.palette,
            project: deps.storeRef.current.project,
            strokeBoundingBoxRef: deps.strokeBoundingBoxRef,
            strokeCapturePaddingRef: deps.strokeCapturePaddingRef,
            roiPadding: deps.ROI_PADDING_PX,
            lastStablePressure: deps.lastStablePressureRef.current ?? 0.5,
            latestShapePixelSizeRef: deps.latestShapePixelSizeRef,
            computeShapePixelSize: deps.computeShapePixelSize,
          });
        }
      }
    }

    const handleLinearDirectionSelection = async (): Promise<boolean> => {
      if (!args.refs.isSelectingDirectionRef.current || !args.refs.directionPreviewRef.current) {
        return false;
      }

      try {
        if (deps.isBusyRef) deps.isBusyRef.current = true;

        const drawCtx = deps.drawingCtxRef.current;
        if (drawCtx && deps.brushEngine && args.refs.shapePointsRef.current.length >= 3) {
          const beforeState = deps.storeRef.current;
          const beforeLayer = resolveCapturedShapeFinalizeLayer(beforeState, finalizeTargetLayerId);
          shapeLayerId = beforeLayer?.id ?? null;
          if (!shapeLayerId || !beforeLayer?.colorCycleData?.canvas) {
            deps.drawingCanvasHasContent.current = true;
            args.refs.isSelectingDirectionRef.current = false;
            args.refs.directionPreviewRef.current = null;
            await deps.resumeColorCycleAfterInteraction();
            return true;
          }
          const shapeLayerIdString: string = shapeLayerId;
          shapeBeforeColorState = beforeLayer && deps.isColorCycleLayerWithData(beforeLayer)
            ? deps.captureColorCycleBrushState(beforeLayer.id)
            : null;

          let centerX = 0;
          let centerY = 0;
          for (const p of args.refs.shapePointsRef.current) {
            centerX += p.x;
            centerY += p.y;
          }
          centerX /= args.refs.shapePointsRef.current.length;
          centerY /= args.refs.shapePointsRef.current.length;

          const direction = {
            x: args.refs.directionPreviewRef.current.x - centerX,
            y: args.refs.directionPreviewRef.current.y - centerY
          };

          drawCtx.clearRect(0, 0, deps.drawingCanvasRef.current?.width || 0, deps.drawingCanvasRef.current?.height || 0);
          deps.drawingCanvasHasContent.current = false;

          const currentState = deps.storeRef.current;
          const targetLayer = resolveCapturedShapeFinalizeLayer(currentState, shapeLayerIdString);
          const isColorCycleLayer = targetLayer?.layerType === 'color-cycle';
          const targetLayerCanvas = targetLayer?.colorCycleData?.canvas ?? null;
          const activeSettings = beforeState.tools.brushSettings;

          const shapePointsSnapshot = [...args.refs.shapePointsRef.current];
          const directionSnapshot = { ...direction };

          let shapeCaptureRoi: CaptureRegion | undefined;
          if (deps.FF.CC_CAPTURE_ROI) {
            deps.perfMark('cc:roi:start');
            shapeCaptureRoi = deps.captureRegionFromPoints(
              shapePointsSnapshot,
              deps.ROI_PADDING_PX,
              deps.project
            );
            deps.perfMark('cc:roi:end');
            deps.perfMeasure('cc:roi', 'cc:roi:start', 'cc:roi:end');
          } else {
            shapeCaptureRoi = undefined;
          }

          deps.drawingCanvasHasContent.current = false;

          const activeLayerId = shapeLayerIdString;
          if (isColorCycleLayer && targetLayerCanvas && activeLayerId) {
            if (process.env.NODE_ENV !== 'production' && currentState.activeLayerId !== activeLayerId) {
              debugWarn('raw-console', '[CC] Shape finalize target differs from current active layer; using captured target', {
                targetLayerId: activeLayerId,
                currentActiveLayerId: currentState.activeLayerId,
              });
            }
            const ccBrush = (
              typeof currentState.getLayerColorCycleBrush === 'function'
                ? currentState.getLayerColorCycleBrush(activeLayerId)
                : null
            ) ?? deps.getColorCycleBrushManager().getBrush(activeLayerId) ?? null;
            if (targetLayer) {
              deps.ensureActiveColorCycleGradientSlot(currentState, targetLayer, ccBrush);
            }
            const { pixelSize } = resolveColorCycleDitherPixelSize({
              settings: activeSettings,
              hadValidPressure: deps.hadValidShapePressureRef.current,
              lastStablePressure: deps.lastStablePressureRef.current,
              computeShapePixelSize: deps.computeShapePixelSize,
            });
            deps.latestShapePixelSizeRef.current = pixelSize;
            const ditherPixelSize = pixelSize;
            if (ccBrush && typeof (ccBrush as { setDitherPixelSize?: (value: number) => void }).setDitherPixelSize === 'function') {
              (ccBrush as { setDitherPixelSize: (value: number) => void }).setDitherPixelSize(pixelSize);
            }
            const keepOverlayAfter = shouldKeepColorCycleShapeOverlayAfterFinalize();
            const currentFinalizeState = deps.storeRef.current;
            const sampledFinalizeSource = isSampledCcShapeDrag(currentFinalizeState);
            if (sampledFinalizeSource && targetLayer) {
              deps.ccLog('shape: sampled session begin', {
                layerId: targetLayer.id,
                pointCount: shapePointsSnapshot.length,
              });
              beginFinalSampledShapeSession({
                layer: targetLayer,
                state: currentFinalizeState,
                shapePoints: shapePointsSnapshot,
                deps,
              });
              deps.ccLog('shape: sampled session end', {
                layerId: targetLayer.id,
              });
            }
            const session = finalizeMarkGradientSession(shapeLayerIdString)
              ?? (targetLayer
                ? buildFallbackMarkSession(targetLayer, deps.storeRef.current, 'linear')
                : null);
            if (!session) {
              debugWarn('raw-console', '[CC] Missing mark session before shape finalize (linear selection)', {
                layerId: shapeLayerIdString,
                stack: new Error().stack,
              });
            }
            await deps.runColorCycleShapeFill({
              mode: 'linear',
              session,
              shapePoints: shapePointsSnapshot,
              direction: directionSnapshot,
              activeLayerId,
              activeLayerCanvas: targetLayerCanvas,
              overlayCanvas: deps.drawingCanvasRef.current,
              overlayCtx: deps.drawingCtxRef.current,
              fallbackBlendMode: (activeSettings.blendMode || 'source-over') as GlobalCompositeOperation,
              fallbackOpacity: activeSettings.opacity ?? 1,
              shapeLayerId: shapeLayerIdString,
              beforeColorState: shapeBeforeColorState,
              tool: toolsSnapshot.currentTool,
              roi: shapeCaptureRoi,
              ditherPixelSize,
              keepOverlayAfter,
            }, {
              brushEngine: deps.brushEngine,
              getColorCycleBrushManager: deps.getColorCycleBrushManager,
              bindBrushToCanvas: deps.bindBrushToCanvas,
              timeAsync: deps.timeAsync,
              timeSync: deps.timeSync,
              ccLog: deps.ccLog,
              scheduleDeferredColorCycleSaveWithState: deps.scheduleDeferredColorCycleSaveWithState,
              logError: deps.logError,
              ccDebug: deps.ccDebug,
              perfMark: deps.perfMark,
              perfMeasure: deps.perfMeasure,
              debugTime: deps.debugTime,
              debugTimeEnd: deps.debugTimeEnd,
            });
          }
        }

        args.refs.isSelectingDirectionRef.current = false;
        args.refs.directionPreviewRef.current = null;
        args.refs.shapePointsRef.current = [];
        if (shouldUseSimpleShapePreview(deps.storeRef.current)) {
          deps.triggerSimpleShapePreview();
        }
        args.refs.isDrawingShapeRef.current = false;
        args.refs.shapeInteractionPhaseRef.current = 'idle';
        getAppStoreState().setShapeDrawing(false);
        deps.resetShapeDragRefs();

        args.refs.ccShapePreviewPauseStartedRef.current = false;
        handledColorCycleShape = true;
        handledColorCycleTargetLayerId = shapeLayerId;

        deps.resetCcGradientSample();
        await deps.resumeColorCycleAfterInteraction();
        return true;
      } catch (error) {
        deps.logError('Error during linear gradient direction selection:', error);
        return true;
      } finally {
        if (deps.isBusyRef) deps.isBusyRef.current = false;
      }
    };

    if (await handleLinearDirectionSelection()) {
      return;
    }

    const handleShapeFinalize = async (): Promise<boolean> => {
      if (!deps.drawingCtxRef.current || !deps.drawingCanvasRef.current) {
        deps.initDrawingCanvas();
      }
      if (deps.isBusyRef) deps.isBusyRef.current = true;

      if (args.refs.isDrawingShapeRef.current && args.refs.shapePointsRef.current.length >= 3) {
        const drawCtx = deps.drawingCtxRef.current;
        let shapeBeforeColorStateLocal: ColorCycleSerializedState | null = null;
        if (drawCtx && deps.brushEngine) {
          drawCtx.globalAlpha = 1.0;
          drawCtx.globalCompositeOperation = 'source-over';

          const beforeState = deps.storeRef.current;
          const beforeLayer = resolveCapturedShapeFinalizeLayer(beforeState, finalizeTargetLayerId);
          const shapeLayerIdLocal = beforeLayer?.id ?? null;
          if (!shapeLayerIdLocal) {
            deps.drawingCanvasHasContent.current = false;
            args.refs.isSelectingDirectionRef.current = false;
            args.refs.directionPreviewRef.current = null;
            await deps.resumeColorCycleAfterInteraction();
            if (deps.isBusyRef) deps.isBusyRef.current = false;
            return true;
          }
          const shapeLayerIdString: string = shapeLayerIdLocal;
          shapeBeforeColorStateLocal = beforeLayer && deps.isColorCycleLayerWithData(beforeLayer)
            ? deps.captureColorCycleBrushState(beforeLayer.id)
            : null;

          const currentState = deps.storeRef.current;
          const targetLayer = resolveCapturedShapeFinalizeLayer(currentState, shapeLayerIdString);
          const isColorCycleLayer = targetLayer?.layerType === 'color-cycle';

          if (!isColorCycleLayer) {
            deps.finalizeRasterShapeFill({
              drawCtx,
              brushEngine: deps.brushEngine,
              storeRef: deps.storeRef,
              liveBrushSettings,
              shapePoints: args.refs.shapePointsRef.current,
              ditherGradPoints,
              strokeBoundingBox: deps.strokeBoundingBoxRef.current,
              project: deps.project,
              roiPadding: deps.ROI_PADDING_PX,
              computeAutoSampleStops: deps.computeAutoSampleStops,
              setSharedColorCycleGradient: deps.setSharedColorCycleGradient,
              computeShapePixelSize: deps.computeShapePixelSize,
              hadValidShapePressureRef: deps.hadValidShapePressureRef,
              lastStablePressureRef: deps.lastStablePressureRef,
              latestShapePixelSizeRef: deps.latestShapePixelSizeRef,
              boundingBoxToCaptureRegion: deps.boundingBoxToCaptureRegion,
              logError: deps.logError,
              ccDebug: deps.ccDebug,
            });
          }

          if (isColorCycleLayer && drawCtx) {
            deps.brushEngine.resetColorCycle(false);

            if (args.refs.shapePointsRef.current.length >= 3) {
              const fillMode = resolveColorCycleFillMode(liveBrushSettings.colorCycleFillMode);

              const points = args.refs.shapePointsRef.current.filter(
                (pt): pt is { x: number; y: number } => Boolean(pt)
              );
              const shapePointsSnapshot = [...points];
              const currentFinalizeState = deps.storeRef.current;
              const targetLayerCanvas = targetLayer?.colorCycleData?.canvas ?? null;
              const overlayCtx = drawCtx;
              const overlayCanvas = deps.drawingCanvasRef.current;
              const fallbackBlendMode = (liveBrushSettings?.blendMode || 'source-over') as GlobalCompositeOperation;
              const fallbackOpacity = liveBrushSettings?.opacity ?? 1;

              let shapeCaptureRoi: CaptureRegion | undefined;
              if (deps.FF.CC_CAPTURE_ROI) {
                deps.perfMark('cc:roi:start');
                shapeCaptureRoi = deps.captureRegionFromPoints(
                  shapePointsSnapshot,
                  deps.ROI_PADDING_PX,
                  deps.project
                );
                deps.perfMark('cc:roi:end');
                deps.perfMeasure('cc:roi', 'cc:roi:start', 'cc:roi:end');
              } else {
                shapeCaptureRoi = undefined;
              }

              deps.drawingCanvasHasContent.current = false;

              const activeLayerId = shapeLayerIdString;
              if (activeLayerId && targetLayerCanvas) {
                if (process.env.NODE_ENV !== 'production' && currentState.activeLayerId !== activeLayerId) {
                  debugWarn('raw-console', '[CC] Shape finalize target differs from current active layer; using captured target', {
                    targetLayerId: activeLayerId,
                    currentActiveLayerId: currentState.activeLayerId,
                  });
                }
                const ccBrush = (
                  typeof deps.storeRef.current.getLayerColorCycleBrush === 'function'
                    ? deps.storeRef.current.getLayerColorCycleBrush(activeLayerId)
                    : null
                ) ?? deps.getColorCycleBrushManager().getBrush(activeLayerId) ?? null;
                if (targetLayer) {
                  deps.ensureActiveColorCycleGradientSlot(deps.storeRef.current, targetLayer, ccBrush);
                }
                const { pixelSize } = resolveColorCycleDitherPixelSize({
                  settings: liveBrushSettings,
                  hadValidPressure: deps.hadValidShapePressureRef.current,
                  lastStablePressure: deps.lastStablePressureRef.current,
                  computeShapePixelSize: deps.computeShapePixelSize,
                });
                deps.latestShapePixelSizeRef.current = pixelSize;
                const ditherPixelSize = pixelSize;
                if (ccBrush && typeof (ccBrush as { setDitherPixelSize?: (value: number) => void }).setDitherPixelSize === 'function') {
                  (ccBrush as { setDitherPixelSize: (value: number) => void }).setDitherPixelSize(pixelSize);
                }
                const keepOverlayAfter = shouldKeepColorCycleShapeOverlayAfterFinalize();
                const sampledFinalizeSource = isSampledCcShapeDrag(currentFinalizeState);
                if (sampledFinalizeSource && targetLayer) {
                  deps.ccLog('shape: sampled session begin', {
                    layerId: targetLayer.id,
                    pointCount: shapePointsSnapshot.length,
                  });
                  beginFinalSampledShapeSession({
                    layer: targetLayer,
                    state: currentFinalizeState,
                    shapePoints: shapePointsSnapshot,
                    deps,
                  });
                  deps.ccLog('shape: sampled session end', {
                    layerId: targetLayer.id,
                  });
                }
                const session = finalizeMarkGradientSession(shapeLayerIdString)
                  ?? (targetLayer
                    ? buildFallbackMarkSession(targetLayer, deps.storeRef.current, fillMode)
                    : null);
                if (!session) {
                  debugWarn('raw-console', '[CC] Missing mark session before shape finalize', {
                    layerId: shapeLayerIdString,
                    stack: new Error().stack,
                  });
                }
                const resolvedMode = session?.gradientKind ?? fillMode;
                const isLinearMode = resolvedMode === 'linear';
                const shouldResetLinearMode = isLinearMode;
                await deps.runColorCycleShapeFill({
                  mode: isLinearMode ? 'linear' : 'concentric',
                  session,
                  shapePoints: shapePointsSnapshot,
                  direction: isLinearMode
                    ? deps.computeFallbackLinearDirection(shapePointsSnapshot)
                    : undefined,
                  activeLayerId,
                  activeLayerCanvas: targetLayerCanvas,
                  overlayCanvas,
                  overlayCtx,
                  fallbackBlendMode,
                  fallbackOpacity,
                  shapeLayerId: shapeLayerIdString,
                  beforeColorState: shapeBeforeColorStateLocal,
                  tool: toolsSnapshot.currentTool,
                  roi: shapeCaptureRoi,
                  ditherPixelSize,
                  keepOverlayAfter,
                }, {
                  brushEngine: deps.brushEngine,
                  getColorCycleBrushManager: deps.getColorCycleBrushManager,
                  bindBrushToCanvas: deps.bindBrushToCanvas,
                  timeAsync: deps.timeAsync,
                  timeSync: deps.timeSync,
                  ccLog: deps.ccLog,
                  scheduleDeferredColorCycleSaveWithState: deps.scheduleDeferredColorCycleSaveWithState,
                  logError: deps.logError,
                  ccDebug: deps.ccDebug,
                  perfMark: deps.perfMark,
                  perfMeasure: deps.perfMeasure,
                  debugTime: deps.debugTime,
                  debugTimeEnd: deps.debugTimeEnd,
                });
                if (targetLayer?.colorCycleData?.canvas) {
                  handledColorCycleShape = true;
                  handledColorCycleTargetLayerId = activeLayerId;
                }
                if (shouldResetLinearMode) {
                  args.refs.isSelectingDirectionRef.current = false;
                  args.refs.directionPreviewRef.current = null;
                }
              }
            }
          }

          deps.drawingCanvasHasContent.current = false;
        }

        const shapePointsSnapshotForRaster = [...args.refs.shapePointsRef.current];

        if (!args.refs.isSelectingDirectionRef.current) {
          args.refs.shapePointsRef.current = [];
          if (shouldUseSimpleShapePreview(deps.storeRef.current)) {
            deps.triggerSimpleShapePreview();
          }
          args.refs.isDrawingShapeRef.current = false;
          args.refs.shapeInteractionPhaseRef.current = 'idle';
          getAppStoreState().setShapeDrawing(false);
          deps.resetShapeDragRefs();
        }

        const currentState = deps.storeRef.current;

        if (shouldSkipRasterFallbackAfterColorCycleFinalize(
          currentState,
          handledColorCycleShape,
          handledColorCycleTargetLayerId
        )) {
          deps.resetAutoSampleState(false);
          deps.resetCcGradientSample();
          args.refs.ccShapePreviewPauseStartedRef.current = false;
          await deps.resumeColorCycleAfterInteraction();
          deps.resetPolygonState();
          if (deps.isBusyRef) deps.isBusyRef.current = false;
          deps.ccLog('shape: finalize end', {
            kind: 'color-cycle',
            handled: true,
          });
          if (liveBrushSettings.brushShape === BrushShape.COLOR_CYCLE_SHAPE && liveBrushSettings.ccGradientSource === 'sampled') {
            recordSampledCcShapeBreadcrumb({
              event: 'finalize-end',
              activeLayerId: deps.storeRef.current.activeLayerId ?? null,
              kind: 'color-cycle',
              handled: true,
            });
          }
          finalizeTriggered = true;
          return true;
        }

        const rasterHandled = await deps.commitRasterShapeFill({
          shapePoints: shapePointsSnapshotForRaster,
          shapeBeforeSnapshot: deps.shapeBeforeImageRef.current,
          shapeBeforeColorState: shapeBeforeColorStateLocal,
          liveBrushSettings,
          tool: toolsSnapshot.currentTool,
        }, {
          storeRef: deps.storeRef,
          project: deps.project,
          drawingCanvasRef: deps.drawingCanvasRef,
          drawingCtxRef: deps.drawingCtxRef,
          drawingCanvasHasContent: deps.drawingCanvasHasContent,
          strokeBoundingBoxRef: deps.strokeBoundingBoxRef,
          strokeCapturePaddingRef: deps.strokeCapturePaddingRef,
          roiPadding: deps.ROI_PADDING_PX,
          captureRegionFromPoints: deps.captureRegionFromPoints,
          boundingBoxToCaptureRegion: deps.boundingBoxToCaptureRegion,
          inflateShapeBeforeSnapshot: deps.inflateShapeBeforeSnapshot,
          ensureLayerSnapshotWithRetry: deps.ensureLayerSnapshotWithRetry,
          applyBackdropFromSnapshot: deps.applyBackdropFromSnapshot,
          captureCanvasToActiveLayer: deps.captureCanvasToActiveLayer,
          scheduleHistoryCommit: deps.scheduleHistoryCommit,
          clearShapeBeforeSnapshot: deps.clearShapeBeforeSnapshot,
          resetPolygonState: deps.resetPolygonState,
          resumeColorCycleAfterInteraction: deps.resumeColorCycleAfterInteraction,
          setBusy: (busy) => {
            if (deps.isBusyRef) deps.isBusyRef.current = busy;
          },
          withTiming: deps.withTiming,
          logError: deps.logError,
        });

        if (rasterHandled) {
          finalizeTriggered = true;
          args.refs.ccShapePreviewPauseStartedRef.current = false;
          deps.ccLog('shape: finalize end', {
            kind: 'raster',
            handled: true,
          });
          if (liveBrushSettings.brushShape === BrushShape.COLOR_CYCLE_SHAPE && liveBrushSettings.ccGradientSource === 'sampled') {
            recordSampledCcShapeBreadcrumb({
              event: 'finalize-end',
              activeLayerId: deps.storeRef.current.activeLayerId ?? null,
              kind: 'raster',
              handled: true,
            });
          }
          return true;
        }

        if (deps.isBusyRef) deps.isBusyRef.current = false;
        await deps.finalizeDrawing();
        finalizeTriggered = true;
        args.refs.ccShapePreviewPauseStartedRef.current = false;
        await deps.resumeColorCycleAfterInteraction();
        deps.ccLog('shape: finalize end', {
          kind: 'fallback',
          handled: true,
        });
        if (liveBrushSettings.brushShape === BrushShape.COLOR_CYCLE_SHAPE && liveBrushSettings.ccGradientSource === 'sampled') {
          recordSampledCcShapeBreadcrumb({
            event: 'finalize-end',
            activeLayerId: deps.storeRef.current.activeLayerId ?? null,
            kind: 'fallback',
            handled: true,
          });
        }
        return true;
      }

      if (args.refs.isDrawingShapeRef.current) {
        args.refs.shapePointsRef.current = [];
        if (shouldUseSimpleShapePreview(deps.storeRef.current)) {
          deps.triggerSimpleShapePreview();
        }
        args.refs.isDrawingShapeRef.current = false;
        args.refs.shapeInteractionPhaseRef.current = 'idle';
        getAppStoreState().setShapeDrawing(false);
        deps.resetShapeDragRefs();
      }

      if (!finalizeTriggered) {
        if (deps.isBusyRef) {
          deps.isBusyRef.current = false;
        }
        await deps.finalizeDrawing();
        finalizeTriggered = true;
        deps.resetPolygonState();
        deps.ccLog('shape: finalize end', {
          kind: 'fallback',
          handled: true,
        });
        if (liveBrushSettings.brushShape === BrushShape.COLOR_CYCLE_SHAPE && liveBrushSettings.ccGradientSource === 'sampled') {
          recordSampledCcShapeBreadcrumb({
            event: 'finalize-end',
            activeLayerId: deps.storeRef.current.activeLayerId ?? null,
            kind: 'fallback',
            handled: true,
          });
        }
      }
      return true;
    };

    try {
      const handled = await handleShapeFinalize();
      if (!handled) {
        return;
      }
    } catch (error) {
      deps.logError('Error during shape finalization:', error);
    } finally {
      if (deps.isBusyRef) deps.isBusyRef.current = false;
      if (args.refs.shapeInteractionPhaseRef.current === 'finalizing') {
        args.refs.shapeInteractionPhaseRef.current = args.refs.isDrawingShapeRef.current ? 'drawing' : 'idle';
      }
      deps.clearShapeBeforeSnapshot();
      deps.resetShapePressureState();
    }
  });
};

export const __TESTING__ = {
  resolveColorCycleDitherPixelSize,
  resolveColorCycleFillMode,
  resolveDitherGridSnapPoint,
  normalizeSnappedShapePoints,
  shouldUseSimpleShapePreview,
  shouldKeepColorCycleShapeOverlayAfterFinalize,
  canStartShapeDrawing,
  canContinueShapeDrawing,
  resolveCapturedShapeFinalizeLayer,
  shouldSkipRasterFallbackAfterColorCycleFinalize,
};
