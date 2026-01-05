import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useBrushEngineSimplified } from './useBrushEngineSimplified';
import { useUserBrushEngine } from './useUserBrushEngine';
import { BrushShape, type Layer, type CanvasSnapshot, type Tool } from '../types';
import { shouldApplyGridSnapPure, snapToGridPure, calculateGridSpacing } from '../hooks/brushEngine/utilities';
import { shouldDrawStamp, createPixelQueue } from '../hooks/brushEngine/strokeProcessor';
import type { PixelQueue } from '@/hooks/brushEngine/types';
import { getColorCycleBrushManager } from '../stores/colorCycleBrushManager';
import { appendSegmentWithDynamicResampling, ensurePolygonFromDrag } from '../utils/shapeMaker';
import { logError, debugWarn, debugLog } from '../utils/debug';
import { CC_DEBUG, ccGroup, ccGroupEnd, ccLog, dumpLayerFlags } from '@/debug/ccDebug';
import { FF } from '@/config/ccFeatureFlags';
import {
  setSharedColorCycleGradient,
  buildForegroundDerivedGradientSpec,
  clampForegroundDerivedBands,
  deriveForegroundGradientStops,
} from '../utils/colorCycleGradients';
import type { AppState, CCReason } from '@/stores/useAppStore';
import {
  selectColorCycleDesiredPlaying,
  selectColorCycleSuspendDepth,
  selectEffectiveColorCyclePlaying,
  useAppStore
} from '@/stores/useAppStore';
import {
  selectShapeMode,
  selectToolsState,
} from '@/stores/selectors/toolsSelectors';
import type { ColorCycleBrushImplementation } from '@/hooks/brushEngine/ColorCycleBrushMigration';
import type { CustomBrushStrokeData } from './brushEngine/BrushEngineFacade';
import { FinalizeQueue } from '@/lib/canvas';
import { captureColorCycleBrushState } from '@/history/helpers/colorCycle';
import type { ColorCycleSerializedState } from '@/history/helpers/colorCycle';
import { commitLayerHistory } from '@/history/helpers/layerHistory';
import { trackPendingColorCycleSave, registerFinalizeQueue } from '@/stores/pendingColorCycleSaves';
import { perfMark, perfMeasure, timeAsync, timeSync } from '@/utils/perf/ccPerfProbe';
import { getMaskManager } from '@/layers/MaskManager';
import { BrushStampSource } from '@/tools/stamps/BrushStampSource';
import { EraserTool } from '@/tools/EraserTool';
import { useStoreSelectorRef } from './useStoreSelectorRef';
import { captureBrushFromCanvas } from '@/utils/customBrushCapture';
import { applyPolygonLostEdgeErosion } from '@/hooks/canvas/handlers/shapes/ShapeFinalizeHandler';
import { createPressureResolutionState } from '@/utils/pressureResolution';
import {
  buildLostEdgePolygon,
  commitRasterShapeFill,
  finalizeDitherGradientShape,
  finalizeRasterShapeFill,
} from '@/hooks/canvas/handlers/shapes/ShapeFinalizeHandler';
import type { AutoSampleStops } from '@/hooks/canvas/handlers/shapes/ShapeFinalizeHandler';
import {
  scheduleDeferredColorCycleSave as scheduleDeferredColorCycleSaveExternal,
  scheduleHistoryCommit as scheduleHistoryCommitExternal,
} from '@/hooks/canvas/handlers/colorCycle/colorCycleHistory';
import {
  commitRasterOverlay as commitRasterOverlayExternal,
  scheduleDeferredColorCycleSaveWithState as scheduleDeferredColorCycleSaveWithStateExternal,
  type CommitRasterOverlayOptions,
} from '@/hooks/canvas/handlers/colorCycle/colorCycleCommit';
import {
  computeFallbackLinearDirection,
  runColorCycleShapeFill,
} from '@/hooks/canvas/handlers/colorCycle/colorCycleShapeFill';
import {
  pauseColorCycleForNonCCInteraction as pauseColorCycleForNonCCInteractionExternal,
  resumeColorCycleAfterInteraction as resumeColorCycleAfterInteractionExternal,
  pauseAllBrushCCAnimationsNow as pauseAllBrushCCAnimationsNowExternal,
  resumePausedBrushCCAnimations as resumePausedBrushCCAnimationsExternal,
} from '@/hooks/canvas/handlers/colorCycle/colorCycleInteraction';
import {
  cancelDeferredOverlayRender as cancelDeferredOverlayRenderExternal,
  renderAllColorCycleLayers as renderAllColorCycleLayersExternal,
  scheduleDeferredOverlayRender as scheduleDeferredOverlayRenderExternal,
} from '@/hooks/canvas/handlers/colorCycle/colorCycleRender';
import {
  startContinuousColorCycleAnimationCore as startContinuousColorCycleAnimationCoreExternal,
  stopContinuousColorCycleAnimationCore as stopContinuousColorCycleAnimationCoreExternal,
} from '@/hooks/canvas/handlers/colorCycle/colorCyclePlayback';
import {
  finalizeColorCycleBrush as finalizeColorCycleBrushExternal,
} from '@/hooks/canvas/handlers/colorCycle/colorCycleFinalize';
import {
  commitColorCycleStrokeIfNeeded as commitColorCycleStrokeIfNeededExternal,
} from '@/hooks/canvas/handlers/colorCycle/colorCycleStrokeCommit';
import {
  commitStrokeHistoryIfNeeded as commitStrokeHistoryIfNeededExternal,
} from '@/hooks/canvas/handlers/colorCycle/colorCycleStrokeHistory';
import {
  ensureColorCycleLayerCanvas as ensureColorCycleLayerCanvasExternal,
} from '@/hooks/canvas/handlers/colorCycle/colorCycleLayerInit';
import {
  getColorCycleBrushEraserSettings as getColorCycleBrushEraserSettingsExternal,
} from '@/hooks/canvas/handlers/colorCycle/colorCycleEraserSettings';
import {
  getColorCycleStampTargetCtx as getColorCycleStampTargetCtxExternal,
} from '@/hooks/canvas/handlers/colorCycle/colorCycleStampTarget';
import {
  flushColorCycleQueueBeforeFinalize as flushColorCycleQueueBeforeFinalizeExternal,
} from '@/hooks/canvas/handlers/colorCycle/colorCycleFinalizeQueue';
import {
  bindBrushToCanvas,
  refreshLayerCCSurface,
} from '@/hooks/canvas/handlers/colorCycle/colorCycleSurface';
import {
  ensureOverlayInitialized as ensureOverlayInitializedExternal,
  ensureOverlaySize as ensureOverlaySizeExternal,
  initDrawingCanvas as initDrawingCanvasExternal,
} from '@/hooks/canvas/handlers/overlayCanvas';
import {
  finalizeEraserStroke as finalizeEraserStrokeExternal,
  finalizePendingEraserTool as finalizePendingEraserToolExternal,
} from '@/hooks/canvas/handlers/eraserFinalize';
import {
  prepareStrokeCapture as prepareStrokeCaptureExternal,
} from '@/hooks/canvas/handlers/strokeCapture';
import {
  buildStrokeCoalescePayload as buildStrokeCoalescePayloadExternal,
} from '@/hooks/canvas/handlers/strokeHistoryCoalesce';
import {
  finalizeStrokePrep as finalizeStrokePrepExternal,
} from '@/hooks/canvas/handlers/strokeFinalizePrep';
import {
  evaluateFinalizeGuards as evaluateFinalizeGuardsExternal,
} from '@/hooks/canvas/handlers/finalizeGuards';
import {
  createFinalizeBusyLock as createFinalizeBusyLockExternal,
} from '@/hooks/canvas/handlers/finalizeBusyLock';
import {
  clearFinalizeOverlayIfNeeded as clearFinalizeOverlayIfNeededExternal,
} from '@/hooks/canvas/handlers/finalizeOverlayClear';
import {
  finalizeDrawingCleanup as finalizeDrawingCleanupExternal,
} from '@/hooks/canvas/handlers/finalizeCleanup';
import {
  beginMaskHealingStroke as beginMaskHealingStrokeExternal,
  endMaskHealingStroke as endMaskHealingStrokeExternal,
  extendMaskHealingStroke as extendMaskHealingStrokeExternal,
  type MaskHealState,
} from '@/hooks/canvas/handlers/maskHealing';
import {
  captureResamplerSingleSample as captureResamplerSingleSampleExternal,
} from '@/hooks/canvas/handlers/customBrushCapture';
import {
  processBatchedStrokes as processBatchedStrokesExternal,
  resetColorCyclePixelQueue as resetColorCyclePixelQueueExternal,
} from '@/hooks/canvas/handlers/strokeBatching';
import {
  startShapeDrawing as startShapeDrawingExternal,
  continueShapeDrawing as continueShapeDrawingExternal,
  finalizeShapeDrawing as finalizeShapeDrawingExternal,
} from '@/hooks/canvas/handlers/shapes/shapeDrawing';
import {
  resolveStrokeHistoryMetadata as resolveStrokeHistoryMetadataExternal,
} from '@/hooks/canvas/handlers/strokeHistoryMetadata';
import {
  capturePendingShapeSnapshot as capturePendingShapeSnapshotExternal,
  clearShapeBeforeSnapshot as clearShapeBeforeSnapshotExternal,
} from '@/hooks/canvas/handlers/shapeSnapshots';
import {
  computeShapePixelSize as computeShapePixelSizeExternal,
  createShapePressureRefs as createShapePressureRefsExternal,
  updateShapePressure as updateShapePressureExternal,
} from '@/hooks/canvas/handlers/shapePressure';
import {
  beginStrokeSession as beginStrokeSessionExternal,
  clearStrokeSession as clearStrokeSessionExternal,
  endStrokeSession as endStrokeSessionExternal,
  type BeginStrokeSessionOptions,
  type BrushStrokeSession,
} from '@/hooks/canvas/handlers/strokeSession';
import {
  alignPointToPixel,
  boundingBoxToCaptureRegion,
  captureRegionFromPoints,
  createBoundingBox,
  expandBoundingBox,
  mergeBoundingBox,
  rectToCaptureRegion,
  shouldPixelAlignBrush,
  unionCaptureRegions,
  type BoundingBox,
  type CaptureRegion,
} from '@/hooks/canvas/utils/captureRegions';
import { computeStrokeCapturePadding } from '@/hooks/canvas/utils/strokeCapturePadding';
import {
  cloneStops,
  getNextGradientSlot,
  resolveActiveColorCycleGradient,
} from '@/hooks/canvas/utils/colorCycleHelpers';
import { getColorCycleBrushFlags } from '@/hooks/canvas/utils/colorCycleBrushFlags';
import { resolveActiveCustomBrushData } from '@/hooks/canvas/utils/customBrushData';
import { resolveBrushRotation } from '@/hooks/canvas/utils/brushRotation';
import {
  runIdle as runIdleExternal,
  runIdleAsync as runIdleAsyncExternal,
} from '@/hooks/canvas/utils/idle';
import { applyBackdropFromSnapshot } from '@/hooks/canvas/utils/canvasBackdrop';
import { isColorCycleLayerWithData } from '@/hooks/canvas/utils/layerGuards';
import { clipLineSegment } from '@/hooks/canvas/utils/lineClipping';
import { createPerfDebug } from '@/hooks/canvas/utils/perfDebug';
import {
  captureLayerRegionImageData,
  ensureLayerSnapshotWithRetry,
  inflateShapeBeforeSnapshot,
  type ShapeBeforeSnapshot,
} from '@/hooks/canvas/utils/snapshots';
import {
  AUTO_SAMPLE_MAX_STOPS,
  MIN_AUTO_SAMPLE_PREVIEW_DISTANCE,
  computeAutoSampleStopsFromPolyline,
  computeDitherGradSampleStopsFromPolyline,
  computePolylineLength,
  dedupePolylineForSampling,
  type PolyPoint,
} from '@/hooks/canvas/utils/autoSampleGradient';
import {
  clearBrushSamplingPreview as clearBrushSamplingPreviewExternal,
  computeAutoSampleStops as computeAutoSampleStopsExternal,
  renderBrushSamplingPreview as renderBrushSamplingPreviewExternal,
  resetAutoSampleState as resetAutoSampleStateExternal,
  sampleHexAt as sampleHexAtExternal,
  updateAutoSampledGradient as updateAutoSampledGradientExternal,
  updateDitherGradSamples as updateDitherGradSamplesExternal,
} from '@/hooks/canvas/handlers/brushSampling';

export {
  AUTO_SAMPLE_MAX_STOPS,
  MIN_AUTO_SAMPLE_PREVIEW_DISTANCE,
  computeAutoSampleStopsFromPolyline,
  computeDitherGradSampleStopsFromPolyline,
  computePolylineLength,
  dedupePolylineForSampling
} from '@/hooks/canvas/utils/autoSampleGradient';

// Section map (refactor guide)
// 1) Constants/types and low-level helpers
// 2) Canvas/brush engine setup + refs
// 3) Sampling/preview helpers and auto-sample gradient wiring
// 4) Pointer event handlers (down/move/up/leave/cancel)
// 5) Tool flows: selection/crop, recolor sampling, shapes
// 6) Color-cycle pipeline + history/commit/finalize
// 7) Cleanup + __TESTING__ exports

// Pressure tuning shared with brush engine
const MAX_PRESSURE_DECAY_PER_MS = 0.003;
const MIN_DROP_PER_EVENT = 0.01;
const SHAPE_PRESSURE_SMOOTHING = 0.6;
const SHAPE_PRESSURE_SAMPLE_WINDOW = 5;

interface UseDrawingHandlersProps {
  project: { width: number; height: number } | null;
  screenToWorld: (x: number, y: number) => { x: number; y: number };
  viewTransformRef: React.MutableRefObject<{ scale: number; offsetX: number; offsetY: number }>;
  canvasRef: React.RefObject<HTMLCanvasElement>;
  isBusyRef?: React.MutableRefObject<boolean>;
  sampleColorAt?: (x: number, y: number) => string;
}

type ManagedColorCycleBrush = ColorCycleBrushImplementation & {
  commitCurrentStroke?: (layerId?: string) => void;
  finalizeCurrentStroke?: (layerId?: string) => void;
  commitToLayer?: (canvas: HTMLCanvasElement, layerId: string) => void;
  renderDirectToCanvas?: (canvas: HTMLCanvasElement, layerId: string) => void;
  clearPaintBuffer?: (layerId?: string) => void;
  flush?: (layerId?: string) => void;
  updateColorCycleTexture?: () => void;
};

type DebugBrush = Partial<ManagedColorCycleBrush> & {
  layerStrokes?: Map<string, { strokeCounter?: number }>;
  strokeCounter?: number;
};

type FinalizeDrawingOptions = {
  skipSave?: boolean;
  historyActionType?: CanvasSnapshot['actionType'];
  historyDescription?: string;
  captureRegionOverride?: CaptureRegion | null;
};

type LayerHistoryPayload = Parameters<typeof commitLayerHistory>[0];

type DeferredColorCycleSaveOptions = {
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
};

type RecomposeRegion = { x: number; y: number; width: number; height: number };

const BRUSH_HISTORY_COALESCE_WINDOW_MS = 250;
const STOP_COOLDOWN_MS = 200;
const START_CC_TRACE_THROTTLE_MS = 2000;
const SYNTHETIC_STOP_THROTTLE_MS = 200;
const START_CC_COOLDOWN_MS = 200;
const SKIP_CC_LOG_THROTTLE_MS = 1000;
const HISTORY_FINALIZE_LANE = '__history__';

const SYNTHETIC_CC_STOP_REASONS = new Set<string>([
  'shape-tool-start',
  'shape-tool-drag',
  'pointer-drag',
  'layer-create',
  'layer-switch',
  'overlay-reinit',
  'unknown',
  'event'
]);

const { debugTime, debugTimeEnd, debugVerbose, withTiming } = createPerfDebug({
  perfMark,
  perfMeasure,
  timeAsync,
  debugEnabled: () => CC_DEBUG.on,
  debugTimingEnabled: () => CC_DEBUG.timing,
  debugVerboseEnabled: () => CC_DEBUG.verbose,
});

const ROI_PADDING_PX = 2;

export function useDrawingHandlers({
  project,
  screenToWorld: _screenToWorld,
  viewTransformRef: _viewTransformRef,
  canvasRef: _canvasRef,
  isBusyRef,
  sampleColorAt,
}: UseDrawingHandlersProps) {
  // Unused props in this harness; kept for API compatibility
  void _screenToWorld;
  void _viewTransformRef;
  void _canvasRef;
  const cancelAnimationFrameSafe = useMemo(() => {
    if (typeof window === 'undefined' || typeof window.cancelAnimationFrame !== 'function') {
      return (_handle: number) => {};
    }
    return window.cancelAnimationFrame.bind(window);
  }, []);
  const brushEngine = useBrushEngineSimplified();
  const ensureActiveColorCycleGradientSlot = useCallback((
    state: AppState,
    layer: Layer,
    brush?: ColorCycleBrushImplementation | null
  ) => {
    const brushSettings = state.tools.brushSettings;
    const useForegroundGradient = Boolean(brushSettings.colorCycleUseForegroundGradient);
    const {
      gradientDefs,
      slotPalettes,
      activeGradientId,
      activeSlot,
      activeStops,
      needsBootstrap
    } = resolveActiveColorCycleGradient(layer, brushSettings);

    if (!useForegroundGradient) {
      if (brush && typeof (brush as { setPreserveGradientPhase?: (enabled: boolean) => void }).setPreserveGradientPhase === 'function') {
        (brush as { setPreserveGradientPhase: (enabled: boolean) => void }).setPreserveGradientPhase(false);
      }
      if (needsBootstrap) {
        try {
          state.updateLayer(layer.id, {
            colorCycleData: {
              ...(layer.colorCycleData ?? {}),
              gradientDefs,
              slotPalettes,
              activeGradientId,
              gradient: activeStops
            }
          });
        } catch {}
      }
      if (brush) {
        brush.setGradientSlot(layer.id, activeSlot, activeStops);
        brush.setActiveGradientSlot(layer.id, activeSlot);
      }
      return;
    }

    if (brush && typeof (brush as { setPreserveGradientPhase?: (enabled: boolean) => void }).setPreserveGradientPhase === 'function') {
      (brush as { setPreserveGradientPhase: (enabled: boolean) => void }).setPreserveGradientPhase(true);
    }
    const foregroundColor = state.palette.foregroundColor ?? brushSettings.color ?? '#ffffff';
    const bands = clampForegroundDerivedBands(brushSettings.colorCycleFgStops);
    const derivedSpec = buildForegroundDerivedGradientSpec({
      baseColor: foregroundColor,
      lightness: brushSettings.colorCycleFgLightness,
      variance: brushSettings.colorCycleFgVariance,
      hueShift: brushSettings.colorCycleFgHueShift,
      saturationShift: brushSettings.colorCycleFgSaturationShift,
      opacity: brushSettings.colorCycleFgOpacity,
      bands,
    });
    const derivedStops = deriveForegroundGradientStops(derivedSpec);
    const derivedGradients = layer.colorCycleData?.derivedGradients ?? [];
    const existingDerived = derivedGradients.find((entry) => entry.key === derivedSpec.key);
    let nextSlotPalettes = slotPalettes;
    let nextDerivedGradients = derivedGradients;
    let targetSlot: number | null = existingDerived?.slot ?? null;
    let stopsToApply = derivedStops;

    if (targetSlot !== null) {
      const existingPalette = slotPalettes.find((entry) => entry.slot === targetSlot);
      if (existingPalette?.stops?.length) {
        stopsToApply = existingPalette.stops;
      } else {
        nextSlotPalettes = [...slotPalettes, { slot: targetSlot, stops: cloneStops(derivedStops) }];
      }
    } else {
      const usedSlots = new Set<number>();
      slotPalettes.forEach((entry) => usedSlots.add(entry.slot));
      gradientDefs.forEach((entry) => usedSlots.add(entry.currentSlot));
      const nextSlot = getNextGradientSlot(usedSlots);
      if (nextSlot !== null) {
        targetSlot = nextSlot;
        nextSlotPalettes = [...slotPalettes, { slot: nextSlot, stops: cloneStops(derivedStops) }];
        nextDerivedGradients = [
          ...derivedGradients,
          { key: derivedSpec.key, slot: nextSlot, spec: derivedSpec }
        ];
      }
    }

    if (targetSlot === null) {
      if (needsBootstrap) {
        try {
          state.updateLayer(layer.id, {
            colorCycleData: {
              ...(layer.colorCycleData ?? {}),
              gradientDefs,
              slotPalettes,
              activeGradientId,
              gradient: activeStops
            }
          });
        } catch {}
      }
      return;
    }

    if (needsBootstrap || nextSlotPalettes !== slotPalettes || nextDerivedGradients !== derivedGradients) {
      try {
        state.updateLayer(layer.id, {
          colorCycleData: {
            ...(layer.colorCycleData ?? {}),
            gradientDefs,
            slotPalettes: nextSlotPalettes,
            activeGradientId,
            derivedGradients: nextDerivedGradients,
            ...(needsBootstrap ? { gradient: activeStops } : {})
          }
        });
      } catch {}
    }

    if (brush) {
      const currentSlot =
        typeof brush.getActiveGradientSlot === 'function'
          ? brush.getActiveGradientSlot(layer.id)
          : undefined;
      const shouldSwitch = typeof currentSlot === 'number' ? currentSlot !== targetSlot : true;
      if (shouldSwitch) {
        try {
          brush.commitCurrentStroke?.(layer.id);
          brush.flush?.(layer.id);
        } catch {}
      }
      brush.setGradientSlot(layer.id, targetSlot, stopsToApply);
      if (shouldSwitch) {
        brush.setActiveGradientSlot(layer.id, targetSlot);
      }
    }
  }, []);
  const resetShapePressureState = useCallback(() => {
    createShapePressureRefsExternal({
      latestShapePressureRef,
      lastNonZeroShapePressureRef,
      latestShapePixelSizeRef,
      shapeSampleCountRef,
      penLiftHoldUntilRef,
      shapeMaxPressureRef,
      hadValidShapePressureRef,
      lastStablePressureRef,
      lastShapePressureTimeRef,
      shapePressureGainRef,
      shapePixelResStateRef,
    });
  }, []);

  useEffect(() => {
    // Clear cached pressure-derived pixel size when fill resolution settings change
    const selector = (state: AppState) => ({
      fillResolution: state.tools.brushSettings.fillResolution,
      pressureLinkedFillResolution: state.tools.brushSettings.pressureLinkedFillResolution
    });

    let prev = selector(useAppStore.getState());
    const unsubscribe = useAppStore.subscribe((state) => {
      const next = selector(state);
      const pressureToggled =
        next.pressureLinkedFillResolution !== prev.pressureLinkedFillResolution;
      const fillResolutionChanged = next.fillResolution !== prev.fillResolution;
      const shouldReset =
        pressureToggled ||
        (fillResolutionChanged && !next.pressureLinkedFillResolution);

      if (shouldReset) {
        resetShapePressureState();
      }
      prev = next;
    });
    return () => unsubscribe();
  }, [resetShapePressureState]);

  useEffect(() => {
    let prevZoom = useAppStore.getState().canvas?.zoom ?? 1;

    const unsubscribe = useAppStore.subscribe((state: AppState) => {
      const nextZoom = state.canvas?.zoom ?? 1;
      if (nextZoom !== prevZoom) {
        // Zoom changed: flush per-shape state so pressure/dither caches cannot leak across zoom levels
        resetShapePressureState();
        strokeBoundingBoxRef.current = null;
        strokeCapturePaddingRef.current = 0;
        shapePointsRef.current = [];
        isDrawingShapeRef.current = false;
        shapeDragStartRef.current = null;
        shapeDragLastRef.current = null;
        shapeDragMovedRef.current = false;
      }
      prevZoom = nextZoom;
    });

    return () => unsubscribe();
  }, [resetShapePressureState]);
  const userBrushEngine = useUserBrushEngine();
  const captureCanvasToActiveLayer = useAppStore((state) => state.captureCanvasToActiveLayer);
  const shapeMode = useAppStore(selectShapeMode);
  const activeLayerWidth = useAppStore((state) => {
    const layer = state.layers.find((l) => l.id === state.activeLayerId);
    return layer?.imageData?.width ?? layer?.framebuffer?.width ?? null;
  });
  const activeLayerHeight = useAppStore((state) => {
    const layer = state.layers.find((l) => l.id === state.activeLayerId);
    return layer?.imageData?.height ?? layer?.framebuffer?.height ?? null;
  });
  const toolsRef = useStoreSelectorRef(selectToolsState);
  
  // Feedback message state
  const feedbackMessageRef = useRef<((message: string) => void) | null>(null);
  
  const drawingCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawingCtxRef = useRef<CanvasRenderingContext2D | null>(null);
  const drawingCanvasHasContent = useRef(false);
  const isCapturing = useRef(false);
  const lastDrawPosRef = useRef<{ x: number; y: number } | null>(null);
  
  // Performance optimization: Throttling for stroke processing
  const strokeBatchRef = useRef<Array<{ pos: { x: number; y: number }, pressure: number }>>([]);
  const strokeBatchTimerRef = useRef<number | null>(null);
  const lastProcessedTimeRef = useRef<number>(0);
  const THROTTLE_MS = 12; // Process strokes at ~83fps max to reduce handler pressure
  
  // OPTIMIZATION: The separate eraser mask canvas is no longer needed.
  // We will perform erasing directly on the drawingCanvas.
  
  const shapePointsRef = useRef<Array<{ x: number; y: number }>>([]);
  const isDrawingShapeRef = useRef(false);
  const isSelectingDirectionRef = useRef(false);
  const directionPreviewRef = useRef<{ x: number; y: number } | null>(null);
  const shapeDragStartRef = useRef<{ x: number; y: number } | null>(null);
  const shapeDragLastRef = useRef<{ x: number; y: number } | null>(null);
  const shapeDragMovedRef = useRef(false);
  const simpleShapePreviewRendererRef = useRef<(() => void) | null>(null);
  const lastShapePreviewTsRef = useRef(0);
  const activeStrokeSessionRef = useRef<BrushStrokeSession | null>(null);
  const strokeBeforeColorStateRef = useRef<ColorCycleSerializedState | null>(null);
  const strokeBeforeImageRef = useRef<ImageData | null>(null);
  const shapeBeforeImageRef = useRef<ShapeBeforeSnapshot | null>(null);
  const shapeBeforeSnapshotCapturedRef = useRef(false);
  const renderAllCCLogTSRef = useRef(0);
  const lastRendererLogTS = useRef(0);
  const firstPaintRef = useRef(true);
  const lastStopAtRef = useRef(0);
  const startContinuousColorCycleTraceStateRef = useRef<{
    lastByReason: Record<string, number>;
    suppressedByReason: Record<string, number>;
  }>({
    lastByReason: Object.create(null) as Record<string, number>,
    suppressedByReason: Object.create(null) as Record<string, number>,
  });
  const maskManager = useMemo(() => getMaskManager(), []);
  const eraserToolRef = useRef<EraserTool | null>(null);
  const storeRef = useStoreSelectorRef((state: AppState) => state);
  const resetShapeDragRefs = useCallback(() => {
    shapeDragStartRef.current = null;
    shapeDragLastRef.current = null;
    shapeDragMovedRef.current = false;
  }, []);

  const triggerSimpleShapePreview = useCallback(() => {
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    // Throttle to ~60fps to avoid repainting huge polygons on every stylus sample.
    if (now - lastShapePreviewTsRef.current < 16) {
      return;
    }
    lastShapePreviewTsRef.current = now;
    simpleShapePreviewRendererRef.current?.();
  }, []);

  const setSimpleShapePreviewRenderer = useCallback((renderer: (() => void) | null) => {
    simpleShapePreviewRendererRef.current = renderer;
  }, []);

  const getEffectiveColorCyclePlaying = useCallback(
    () => selectEffectiveColorCyclePlaying(storeRef.current),
    [storeRef]
  );

  const runIdle = useCallback((cb: () => void) => {
    runIdleExternal(cb);
  }, []);

  const runIdleAsync = useCallback(
    <T>(task: () => Promise<T> | T): Promise<T> =>
      runIdleAsyncExternal(task, runIdleExternal),
    []
  );

  const scheduleHistoryCommit = useCallback(
    (payload: LayerHistoryPayload): Promise<void> =>
      scheduleHistoryCommitExternal({
        payload,
        finalizeQueueRef,
        runIdleAsync,
        withTiming,
        logError,
        finalizeLane: HISTORY_FINALIZE_LANE,
      }),
    [runIdleAsync]
  );

  const commitRasterOverlay = useCallback(async (options: CommitRasterOverlayOptions) => {
    await commitRasterOverlayExternal(options, {
      project,
      captureCanvasToActiveLayer,
      scheduleHistoryCommit,
      withTiming,
    });
  }, [captureCanvasToActiveLayer, project, scheduleHistoryCommit]);
  const eraserRoiRef = useRef<{ x: number; y: number; width: number; height: number } | null>(null);
  const createBrushStampSource = useCallback(
    () =>
      new BrushStampSource({
        getState: () => storeRef.current,
        brushEngine,
        userBrushEngine,
        resolveCustomBrush: resolveActiveCustomBrushData
      }),
    [brushEngine, userBrushEngine, storeRef]
  );
  const maskHealStateRef = useRef<MaskHealState | null>(null);
  const endMaskHealingStroke = useCallback(() => {
    endMaskHealingStrokeExternal(maskHealStateRef, {
      maskManager,
      isEnabled: FF.ERASER_V2,
    });
  }, [maskManager]);
  const beginMaskHealingStroke = useCallback(
    (layerId: string, startPoint: { x: number; y: number }, pressure: number) => {
      beginMaskHealingStrokeExternal(
        { layerId, startPoint, pressure, maskHealStateRef },
        {
          createBrushStampSource,
          maskManager,
          debugWarn,
          isEnabled: FF.ERASER_V2,
        }
      );
    },
    [createBrushStampSource, maskManager]
  );
  const extendMaskHealingStroke = useCallback(
    (from: { x: number; y: number }, to: { x: number; y: number }, pressure: number) => {
      extendMaskHealingStrokeExternal(
        { from, to, pressure, maskHealStateRef },
        { debugWarn, isEnabled: FF.ERASER_V2 }
      );
    },
    []
  );
  useEffect(() => {
    return () => {
      endMaskHealingStroke();
    };
  }, [endMaskHealingStroke]);
  const getBrushHalfSize = useCallback(() => {
    const state = storeRef.current;
    const brushSize = state.tools.brushSettings.size ?? state.globalBrushSize;
    const eraserSettings = state.tools.eraserSettings;
    const effectiveSize =
      eraserSettings.linkSizeToBrush === false
        ? eraserSettings.size ?? brushSize
        : brushSize;
    return Math.max(1, effectiveSize ?? 1) / 2;
  }, [storeRef]);
  const getColorCycleBrushEraserSettings = useCallback(() => {
    const state = storeRef.current;
    return getColorCycleBrushEraserSettingsExternal({
      state,
      resamplerBrushData: resamplerBrushDataRef.current,
    });
  }, [storeRef]);

  const getCCStampTargetCtx = useCallback(
    (): CanvasRenderingContext2D | null =>
      getColorCycleStampTargetCtxExternal({ storeRef, drawingCtxRef }),
    [storeRef, drawingCtxRef]
  );

  const beginStrokeSession = useCallback(
    (options: BeginStrokeSessionOptions) =>
      beginStrokeSessionExternal(options, activeStrokeSessionRef),
    []
  );

  const endStrokeSession = useCallback(
    (endedAt?: number) => endStrokeSessionExternal(activeStrokeSessionRef, endedAt),
    []
  );

  const clearStrokeSession = useCallback(
    () => clearStrokeSessionExternal(activeStrokeSessionRef),
    []
  );

  const resetPolygonState = useCallback(() => {
    const setPolygonGradientState = storeRef.current.setPolygonGradientState;
    setPolygonGradientState({
      drawingState: 'idle',
      points: [],
      previewPath: undefined,
      vertices: undefined,
      fillColor: undefined,
      mode: undefined,
      tempRotation: undefined,
      tempSpacing: undefined,
      tempMaxSteps: undefined,
      tempOrientation: undefined,
      tempNoiseStrength: undefined,
      tempSize: undefined,
      adjustmentStartPos: undefined,
      rotationReferenceAngle: undefined,
      rotationInitialRotation: undefined,
      sizeReferenceDistance: undefined,
      sizeInitialSize: undefined,
      spacingReferenceDistance: undefined,
      spacingReferenceSpacing: undefined,
      flowRandomSeed: undefined,
      gpuJobId: undefined,
    });
  }, [storeRef]);
  
  // Store resampler brush data for the entire stroke
  const resamplerBrushDataRef = useRef<CustomBrushStrokeData | undefined>(undefined);
  const strokeBoundingBoxRef = useRef<BoundingBox | null>(null);
  const strokeCapturePaddingRef = useRef(0);
  
  // Track stamp count for continuous resampling
  const stampCounterRef = useRef<number>(0);
  
  // Animation frame for color cycle rendering
  const colorCycleAnimationRef = useRef<number | null>(null);
  
  // Track distance for color cycle stamp spacing
  const colorCycleDistanceRef = useRef<number>(0);
  const colorCycleLastPosRef = useRef<{ x: number; y: number } | null>(null);
  const colorCycleLastRotationRef = useRef<number | undefined>(undefined);
  
  // Pixel queue for color cycle dashed pattern support
  const colorCyclePixelQueue = useRef<PixelQueue | null>(createPixelQueue());
  const pendingRecomposeRef = useRef(false);
  const scheduleRecompose = useCallback((roi?: RecomposeRegion) => {
    if (typeof window === 'undefined') {
      return;
    }
    if (pendingRecomposeRef.current) {
      return;
    }
    const dispatch = () => {
      pendingRecomposeRef.current = false;
      try {
        window.dispatchEvent(
          new CustomEvent('colorCycleFrameUpdate', {
            detail: { onlyActiveLayer: true, roi }
          })
        );
      } catch {}
    };

    pendingRecomposeRef.current = true;
    if (typeof window.requestAnimationFrame === 'function') {
      window.requestAnimationFrame(dispatch);
    } else {
      dispatch();
    }
  }, []);
  
  // Continuous animation for color cycle when play button is pressed
  const continuousColorCycleAnimationRef = useRef<number | null>(null);
  const continuousColorCycleAnimationActiveRef = useRef(false);
  const startingColorCycleAnimationRef = useRef(false);
  const startPlaybackRef = useRef<((reason?: string) => void) | null>(null);
  const lastStartAtRef = useRef<number>(0);
  const startupKickDoneRef = useRef<boolean>(false);
  const skipStartLogAtRef = useRef<Record<string, number>>({});
  const skipStopLogAtRef = useRef<Record<string, number>>({});
  const deferredOverlayRenderHandleRef = useRef<number | null>(null);
  const deferredOverlayRenderKindRef = useRef<'idle' | 'timeout' | null>(null);

  // Finalization queue to prevent concurrent finalization operations
  const finalizeQueueRef = useRef(new FinalizeQueue());

  useEffect(() => {
    registerFinalizeQueue(finalizeQueueRef.current);
    return () => {
      registerFinalizeQueue(null);
    };
  }, []);


  const scheduleDeferredColorCycleSave = useCallback(
    (options: DeferredColorCycleSaveOptions): Promise<void> =>
      scheduleDeferredColorCycleSaveExternal(options, {
        captureCanvasToActiveLayer,
        project,
        runIdle,
        runIdleAsync,
        finalizeQueueRef,
        trackPendingColorCycleSave,
        boundingBoxToCaptureRegion,
        perfMark,
        perfMeasure,
        debugTime,
        debugTimeEnd,
        debugVerbose,
        logError,
        withTiming,
        historyFinalizeLane: HISTORY_FINALIZE_LANE,
      }),
    [captureCanvasToActiveLayer, project, runIdle, runIdleAsync]
  );

  const scheduleDeferredColorCycleSaveWithState = useCallback(
    (args: Parameters<typeof scheduleDeferredColorCycleSaveWithStateExternal>[0]) =>
      scheduleDeferredColorCycleSaveWithStateExternal(args, {
        scheduleDeferredColorCycleSave,
        captureColorCycleBrushState,
        perfMark,
        perfMeasure,
        debugTime,
        debugTimeEnd,
      }),
    [scheduleDeferredColorCycleSave]
  );


  // Auto-sample gradient (for color cycle brushes)
  const autoSamplePointsRef = useRef<Array<{ x: number; y: number }>>([]);
  const autoSampleLastUpdateRef = useRef<number>(0);
  const autoSampleForkRef = useRef<boolean>(true);
  const ditherGradSampleLastUpdateRef = useRef<number>(0);
  const brushSamplingPreviewActiveRef = useRef<boolean>(false);

  const sampleHexAt = useCallback(
    (x: number, y: number): string =>
      sampleHexAtExternal({
        x,
        y,
        deps: {
          storeRef,
          drawingCanvasRef,
          drawingCtxRef,
          drawingCanvasHasContent,
          sampleColorAt,
        },
      }),
    [storeRef, drawingCanvasRef, drawingCtxRef, drawingCanvasHasContent, sampleColorAt]
  );

  const computeAutoSampleStops = useCallback(
    (sourcePts: Array<{ x: number; y: number }>, options: { allowTiny?: boolean } = {}) =>
      computeAutoSampleStopsExternal({
        sourcePts,
        sampleColor: sampleHexAt,
        options,
      }),
    [sampleHexAt]
  );
  
  const setSharedColorCycleGradientForShapes = useCallback((stops: AutoSampleStops | null) => {
    if (!stops) {
      return;
    }
    setSharedColorCycleGradient(stops);
  }, []);

  const renderBrushSamplingPreview = useCallback((points: PolyPoint[]) => {
    renderBrushSamplingPreviewExternal({
      points,
      deps: {
        storeRef,
        drawingCanvasRef,
        drawingCtxRef,
        drawingCanvasHasContent,
        sampleColorAt,
      },
    });
  }, [storeRef, drawingCanvasRef, drawingCtxRef, drawingCanvasHasContent, sampleColorAt]);

  const clearBrushSamplingPreview = useCallback(() => {
    clearBrushSamplingPreviewExternal({
      deps: {
        storeRef,
        drawingCanvasRef,
        drawingCtxRef,
        drawingCanvasHasContent,
        sampleColorAt,
      },
    });
  }, [storeRef, drawingCanvasRef, drawingCtxRef, drawingCanvasHasContent, sampleColorAt]);

  const resetAutoSampleState = useCallback((disableGradient: boolean = true) => {
    resetAutoSampleStateExternal({
      storeRef,
      autoSamplePointsRef,
      autoSampleLastUpdateRef,
      brushSamplingPreviewActiveRef,
      disableGradient,
    });
  }, [storeRef]);

  const updateAutoSampledGradient = useCallback((sourcePts: Array<{ x: number; y: number }>) => {
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    updateAutoSampledGradientExternal({
      sourcePts,
      now,
      autoSampleLastUpdateRef,
      autoSampleForkRef,
      deps: {
        storeRef,
        drawingCanvasRef,
        drawingCtxRef,
        drawingCanvasHasContent,
        sampleColorAt,
      },
    });
  }, [storeRef, drawingCanvasRef, drawingCtxRef, drawingCanvasHasContent, sampleColorAt]);

  const updateDitherGradSamples = useCallback(
    (sourcePts: Array<{ x: number; y: number }>) => {
      const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
      updateDitherGradSamplesExternal({
        sourcePts,
        now,
        ditherGradSampleLastUpdateRef,
        deps: {
          storeRef,
          drawingCanvasRef,
          drawingCtxRef,
          drawingCanvasHasContent,
          sampleColorAt,
        },
      });
    },
    [storeRef, drawingCanvasRef, drawingCtxRef, drawingCanvasHasContent, sampleColorAt]
  );

  // Track which CC layers were animating so we can resume them after interaction
  const pausedCCLayerIdsRef = useRef<string[]>([]);
  const recolorWasAnimatingRef = useRef<boolean>(false);
  const shouldResumeColorCycleAfterInteractionRef = useRef<boolean>(false);
  // Tracks if we've already paused for the current CC shape preview
  const ccShapePreviewPauseStartedRef = useRef<boolean>(false);

  // Helper: pause animation for all brush-based CC layers and remember which were playing
  const pauseAllBrushCCAnimationsNow = useCallback(() => {
    return pauseAllBrushCCAnimationsNowExternal({
      pausedCCLayerIdsRef,
      recolorWasAnimatingRef,
      storeRef,
      getEffectiveColorCyclePlaying,
      getColorCycleBrushManager,
      continuousColorCycleAnimationRef,
      continuousColorCycleAnimationActiveRef,
      cancelAnimationFrame: cancelAnimationFrameSafe,
      ccGroup,
      ccGroupEnd,
      ccLog,
      dumpLayerFlags,
    });
  }, [
    getEffectiveColorCyclePlaying,
    storeRef,
  ]);

  const pauseColorCycleForNonCCInteraction = useCallback((reason: CCReason = 'shape-preview') => {
    pauseColorCycleForNonCCInteractionExternal({
      reason,
      shouldResumeRef: shouldResumeColorCycleAfterInteractionRef,
      recolorWasAnimatingRef,
      storeRef,
      getEffectiveColorCyclePlaying,
      pauseAllBrushCCAnimationsNow,
      ccLog,
    });
  }, [pauseAllBrushCCAnimationsNow, getEffectiveColorCyclePlaying, storeRef]);

  const resumeColorCycleAfterInteraction = useCallback(async () => {
    await resumeColorCycleAfterInteractionExternal({
      shouldResumeRef: shouldResumeColorCycleAfterInteractionRef,
      storeRef,
      getEffectiveColorCyclePlaying,
      ccGroup,
      ccGroupEnd,
      ccLog,
    });
  }, [getEffectiveColorCyclePlaying, storeRef]);

  // Helper: resume previously paused brush-based CC layers
  // NOTE: Currently unused because global playback flow handles resume/restoration.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const resumePausedBrushCCAnimations = useCallback(() => {
    resumePausedBrushCCAnimationsExternal({
      pausedCCLayerIdsRef,
      recolorWasAnimatingRef,
      storeRef,
      getEffectiveColorCyclePlaying,
      getColorCycleBrushManager,
    });
  }, [getEffectiveColorCyclePlaying, storeRef]);


  // Helper function to render all visible color cycle layers
  const renderAllColorCycleLayers = useCallback(
    (targetCtx?: CanvasRenderingContext2D, onlyActiveLayer: boolean = false) =>
      renderAllColorCycleLayersExternal(
        {
          storeRef,
          maskManager,
          renderAllCCLogTSRef,
          ccLog,
          getColorCycleBrushManager,
          refreshLayerCCSurface,
          bindBrushToCanvas,
        },
        targetCtx,
        onlyActiveLayer
      ),
    [maskManager, storeRef]
  );

  const cancelDeferredOverlayRender = useCallback(() => {
    cancelDeferredOverlayRenderExternal({
      deferredOverlayRenderHandleRef,
      deferredOverlayRenderKindRef,
    });
  }, []);

  const scheduleDeferredOverlayRender = useCallback(() => {
    scheduleDeferredOverlayRenderExternal({
      deferredOverlayRenderHandleRef,
      deferredOverlayRenderKindRef,
      renderAllColorCycleLayers,
      cancelDeferredOverlayRender,
      dispatchFrameUpdate: () => {
        try {
          window.dispatchEvent(new CustomEvent('colorCycleFrameUpdate'));
        } catch {}
      },
    });
  }, [cancelDeferredOverlayRender, renderAllColorCycleLayers]);

  // Stop continuous color cycle animation AND pause it (applies to all brush-based CC layers)
  const stopContinuousColorCycleAnimationCore = useCallback((reason = 'unknown') => {
    stopContinuousColorCycleAnimationCoreExternal(reason, {
      cancelDeferredOverlayRender,
      storeRef,
      ccLog,
      ccGroup,
      ccGroupEnd,
      dumpLayerFlags,
      pauseAllBrushCCAnimationsNow,
      continuousColorCycleAnimationActiveRef,
      continuousColorCycleAnimationRef,
      colorCycleAnimationRef,
      shouldResumeColorCycleAfterInteractionRef,
      drawingCtxRef,
      drawingCanvasRef,
      drawingCanvasHasContent,
      lastStopAtRef,
      stopCooldownMs: STOP_COOLDOWN_MS,
      syntheticStopThrottleMs: SYNTHETIC_STOP_THROTTLE_MS,
      syntheticStopReasons: SYNTHETIC_CC_STOP_REASONS,
    });
  }, [pauseAllBrushCCAnimationsNow, storeRef, cancelDeferredOverlayRender]);

  // DEBUG ONLY
  const stopContinuousColorCycleAnimation = useCallback((reason = 'unknown') => {
    if (CC_DEBUG.on && CC_DEBUG.verbose) {
      try {
        console.groupCollapsed('[CC:TRACE] stopContinuousColorCycleAnimation', { reason });
        console.log(new Error('stopContinuousColorCycleAnimation').stack);
        console.groupEnd();
      } catch {}
    }
    return stopContinuousColorCycleAnimationCore(reason);
  }, [stopContinuousColorCycleAnimationCore]);

  const initDrawingCanvas = useCallback(() => {
    initDrawingCanvasExternal({
      project,
      storeRef,
      drawingCanvasRef,
      drawingCtxRef,
    });
  }, [project, storeRef]);

  const ensureOverlayInitialized = useCallback(() => {
    return ensureOverlayInitializedExternal({
      project,
      storeRef,
      drawingCanvasRef,
      drawingCtxRef,
      drawingCanvasHasContent,
      activeLayerWidth,
      activeLayerHeight,
    });
  }, [project, storeRef, activeLayerWidth, activeLayerHeight]);

  useEffect(() => {
    ensureOverlayInitialized();
  }, [ensureOverlayInitialized]);

  // Pre-size the overlay canvas when project or active layer dimensions change
  useEffect(() => {
    const projWidth = project?.width ?? null;
    const projHeight = project?.height ?? null;

    const targetWidth = projWidth || activeLayerWidth;
    const targetHeight = projHeight || activeLayerHeight;
    if (!targetWidth || !targetHeight) {
      return;
    }

    ensureOverlaySizeExternal({
      targetWidth,
      targetHeight,
      drawingCanvasRef,
      drawingCtxRef,
      drawingCanvasHasContent,
    });
  }, [project?.width, project?.height, activeLayerWidth, activeLayerHeight]);

  // OPTIMIZATION: Helper function to draw an eraser segment. Using a stroked
  // line is often faster than stamping multiple circles.
  const drawEraserSegment = useCallback((
    ctx: CanvasRenderingContext2D,
    p1: { x: number; y: number },
    p2: { x: number; y: number }
  ) => {
    const { tools } = storeRef.current;
    const eraserSize =
      tools.eraserSettings.size ??
      tools.brushSettings.size ??
      20;
    const opacity = tools.eraserSettings.opacity || 1;

    // Use the configured eraser size directly; doubling was making the stroke appear oversized.
    ctx.lineWidth = eraserSize;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    // The "color" of the eraser determines its strength. Black with opacity.
    ctx.strokeStyle = `rgba(0, 0, 0, ${opacity})`;
    
    ctx.beginPath();
    ctx.moveTo(p1.x, p1.y);
    ctx.lineTo(p2.x, p2.y);
    ctx.stroke();
  }, [storeRef]);
  
  const seedManualStrokeBoundingBox = useCallback((
    points: Array<{ x: number; y: number }> | null,
    padding: number = 0
  ) => {
    if (!points || points.length === 0) {
      strokeBoundingBoxRef.current = null;
      strokeCapturePaddingRef.current = Math.max(0, padding);
      return;
    }
    let bbox = createBoundingBox(points[0]);
    for (let i = 1; i < points.length; i += 1) {
      const point = points[i];
      if (!point) continue;
      bbox = expandBoundingBox(bbox, point);
    }
    strokeBoundingBoxRef.current = bbox;
    strokeCapturePaddingRef.current = Math.max(0, padding);
  }, []);
  
  const startDrawing = useCallback((rawWorldPos: { x: number; y: number }, pressure: number = 0.5) => {
    // removed debug log
    let currentState = storeRef.current;
    const currentTool = currentState.tools.currentTool;
    const currentBrushId = currentState.currentBrushPreset?.id;
    let brushSettings = currentState.tools.brushSettings;
    const alignPixelStrokes = shouldPixelAlignBrush(brushSettings);
    const ccFlags = getColorCycleBrushFlags(brushSettings);
    const worldPos = alignPointToPixel(rawWorldPos, alignPixelStrokes);
    let runtimeProject = project ?? currentState.project ?? null;

    // Auto-pick brush color from canvas/reference layer for regular brushes
    if (
      currentTool === 'brush' &&
      !ccFlags.isAny &&
      brushSettings.brushShape !== BrushShape.RESAMPLER &&
      brushSettings.autoSampleColor
    ) {
      try {
        const sampler = typeof sampleColorAt === 'function' ? sampleColorAt : sampleHexAt;
        const sampledColor = sampler(worldPos.x, worldPos.y) ?? brushSettings.color;
        debugLog('auto-sample', {
          phase: 'start',
          brushId: currentBrushId ?? 'unknown',
          tool: currentTool,
          brushShape: brushSettings.brushShape,
          beforeColor: brushSettings.color,
          sampledColor,
          sampler: typeof sampleColorAt === 'function' ? 'reference-aware' : 'composite-fallback',
          hasOffscreen: Boolean(storeRef.current.currentOffscreenCanvas)
        });
        if (sampledColor && sampledColor !== brushSettings.color) {
          const updatedBrushSettings = { ...brushSettings, color: sampledColor, useSwatchColor: true };
          currentState.setBrushSettings(updatedBrushSettings);
          // Keep local settings and engine config in sync for this stroke
          brushSettings = updatedBrushSettings;
          // Refresh local state snapshot so downstream logic uses the new color immediately
          const refreshed = useAppStore.getState();
          currentState = refreshed;
          brushSettings = refreshed.tools.brushSettings;
          if (brushEngine.engine && typeof brushEngine.engine.updateConfig === 'function') {
            brushEngine.engine.updateConfig({ brushSettings: updatedBrushSettings });
          }
          debugLog('auto-sample', {
            phase: 'applied',
            appliedColor: updatedBrushSettings.color,
            useSwatchColor: updatedBrushSettings.useSwatchColor,
            brushId: currentBrushId ?? 'unknown'
          });
        }
      } catch {}
    }

    if (currentTool === 'brush') {
      strokeBoundingBoxRef.current = createBoundingBox(worldPos);
      const activeCustomBrush = resolveActiveCustomBrushData(currentState) ?? resamplerBrushDataRef.current;
      strokeCapturePaddingRef.current = computeStrokeCapturePadding(brushSettings, activeCustomBrush ?? null);
    } else {
      strokeBoundingBoxRef.current = null;
      strokeCapturePaddingRef.current = 0;
    }

    // Layer type handling and validation
    const activeLayer = currentState.layers.find(l => l.id === currentState.activeLayerId);
    if (!runtimeProject && activeLayer?.imageData) {
      runtimeProject = {
        width: activeLayer.imageData.width,
        height: activeLayer.imageData.height
      };
    }
    if (activeLayer) {
      // Prevent drawing on hidden layers - show cursor but don't draw
      if (!activeLayer.visible) {
        return; // Exit silently, cursor will still show
      }
      const isAnyColorCycleBrush = ccFlags.isAny;
      
      // IMPORTANT: Layers can NEVER be converted from one type to another.
      // You simply can't draw on the wrong layer with a CC brush and vice versa.
      {
        // Validate layer/brush compatibility - STRICT ENFORCEMENT
        const isColorCycleLayer = activeLayer.layerType === 'color-cycle';
        
        
        // Check for incompatible combinations
        if (isAnyColorCycleBrush && !isColorCycleLayer) {
          // CC brush on normal layer
          if (feedbackMessageRef.current) {
            feedbackMessageRef.current("Can't use Color Cycle brush on a normal layer. Create a new layer.");
          }
          return; // Block drawing
        }
        
        if (!isAnyColorCycleBrush && isColorCycleLayer && currentTool !== 'eraser') {
          // Normal brush on CC layer (allow eraser on any layer)
          if (feedbackMessageRef.current) {
            feedbackMessageRef.current("Can't use regular brushes on a Color Cycle layer. Switch layers.");
          }
          return; // Block drawing
        }
        
        // Check gradient compatibility for CC layers
        if (isAnyColorCycleBrush && isColorCycleLayer) {
          if (!runtimeProject) {
            logError('Cannot initialize color cycle layer without project dimensions.');
            return;
          }
          const colorCycleBrushManager = getColorCycleBrushManager();
          if (!colorCycleBrushManager.getBrush(activeLayer.id)) {
            currentState.initColorCycleForLayer(activeLayer.id, runtimeProject.width, runtimeProject.height);
          }
          const colorCycleBrush = colorCycleBrushManager.getBrush(activeLayer.id);
          ensureActiveColorCycleGradientSlot(currentState, activeLayer, colorCycleBrush);
        }
      }
    }
    
    // Capture "before" state BEFORE any stroke data is written
    const activeLayerForCapture = currentState.layers.find(l => l.id === currentState.activeLayerId);
    // Defer expensive snapshots until finalize; capture ROI-based snapshots there.
    strokeBeforeImageRef.current = null;

    // Ensure CC brush exists before capturing state
    if (activeLayerForCapture?.layerType === 'color-cycle') {
      const colorCycleBrushManager = getColorCycleBrushManager();
      if (!colorCycleBrushManager.getBrush(activeLayerForCapture.id)) {
        if (!runtimeProject) {
          logError('Cannot init color cycle layer without project dimensions.');
          return;
        }
        currentState.initColorCycleForLayer(
          activeLayerForCapture.id,
          runtimeProject.width,
          runtimeProject.height
        );
      }

      try {
        const refreshedState = storeRef.current;
        const refreshedLayer = refreshedState.layers.find(l => l.id === refreshedState.activeLayerId);
        if (refreshedLayer?.layerType === 'color-cycle') {
          const colorCycleBrushManager = getColorCycleBrushManager();
          const colorCycleBrush = colorCycleBrushManager.getBrush(refreshedLayer.id);
          ensureActiveColorCycleGradientSlot(refreshedState, refreshedLayer, colorCycleBrush);
        }

        const desiredPlaying = selectColorCycleDesiredPlaying(refreshedState);
        const effectivePlaying = selectEffectiveColorCyclePlaying(refreshedState);
        const lastReason = refreshedState.colorCyclePlayback.lastReason;
        if (!desiredPlaying && !effectivePlaying && (lastReason === 'startup' || lastReason === 'auto-start')) {
          refreshedState.playColorCycle('auto-start');
        }

        const postState = storeRef.current;
        const shouldBePlaying = selectEffectiveColorCyclePlaying(postState);
        if (
          shouldBePlaying &&
          !continuousColorCycleAnimationActiveRef.current &&
          !startingColorCycleAnimationRef.current
        ) {
          Promise.resolve().then(() => startPlaybackRef.current?.('stroke-start'));
        }
      } catch {}
    }

    if (activeLayerForCapture && isColorCycleLayerWithData(activeLayerForCapture)) {
      const beforeState = captureColorCycleBrushState(activeLayerForCapture.id);
      const manager = getColorCycleBrushManager();
      const brush = manager.getBrush(activeLayerForCapture.id) as DebugBrush | undefined;
      const layerStrokeData = brush?.layerStrokes?.get(activeLayerForCapture.id);
      debugVerbose(
        '[cc-before-capture] brushCounter:',
        brush?.strokeCounter ?? -1,
        'layerDataCounter:',
        layerStrokeData?.strokeCounter ?? -1,
        'serializedCounter:',
        beforeState?.layers?.[0]?.strokeData?.strokeCounter ?? -1
      );
      strokeBeforeColorStateRef.current = beforeState;
    } else {
      strokeBeforeColorStateRef.current = null;
    }

    beginStrokeSession({
      pointerId: 0,
      layerId: currentState.activeLayerId ?? null,
      tool: currentTool,
      brushId: currentBrushId ?? null,
    });

    ensureOverlayInitialized();

    // Initialize auto-sampling for color cycle stroke
    try {
      const isCCStroke = ccFlags.isAny;
      const autoSample = !!currentState.tools.brushSettings.autoSampleGradient;
      if (isCCStroke && autoSample) {
        autoSamplePointsRef.current = [worldPos];
        autoSampleLastUpdateRef.current = 0;
        autoSampleForkRef.current = true;
        brushSamplingPreviewActiveRef.current = true;
        renderBrushSamplingPreview(autoSamplePointsRef.current);
      }
    } catch {}
    if (brushSamplingPreviewActiveRef.current) {
      return;
    }
    let colorCyclePlayingAtStrokeStart = false;
    colorCycleLastRotationRef.current = undefined;

    // Reset stroke for new drawing (modular engine)
    if (brushEngine.resetStroke) {
      brushEngine.resetStroke();
    }

    // Respect toolbar playback state for CC brushes; do not auto-start here.
    if (!ccFlags.isAny) {
      // Pause animations for non-CC brushes only
      pauseColorCycleForNonCCInteraction('brush-stroke');
    }

    // Reset color cycle brush for new stroke and start animation
    if (ccFlags.isAny) {
      // Don't set up callback here - let startContinuousColorCycleAnimation handle it
      const globalIsPlaying = getEffectiveColorCyclePlaying();
      colorCyclePlayingAtStrokeStart = globalIsPlaying;
      const shouldAnimateLive = !globalIsPlaying;

      // Reset distance tracking for consistent spacing
      colorCycleDistanceRef.current = 0;
      colorCycleLastPosRef.current = null;
      colorCycleLastRotationRef.current = undefined;

      // Reset pixel queue for dashed pattern support
      resetColorCyclePixelQueueExternal(colorCyclePixelQueue, { createPixelQueue });

      // Always arm the brush so parametric counters advance even when global play is active
      brushEngine.resetColorCycle();

      if (!shouldAnimateLive) {
        colorCycleAnimationRef.current = null;
      }
    }
    
    // Reset stamp counter for continuous sampling
    stampCounterRef.current = 0;
    const drawCtx = drawingCtxRef.current;
    if (!drawCtx || !drawingCanvasRef.current) return;
      
    if (drawingCanvasHasContent.current) {
      // Avoid clearing a large overlay if it's already empty; this save a full-surface fill on stroke start.
      drawCtx.clearRect(0, 0, drawingCanvasRef.current.width, drawingCanvasRef.current.height);
    }
    drawingCanvasHasContent.current = !(ccFlags.isAny && colorCyclePlayingAtStrokeStart);
    lastDrawPosRef.current = worldPos;

    if (currentState.palette.activeSlot === 'foreground') {
      const paletteColor = currentState.palette.foregroundColor;
      const isAutoSampleBrush =
        currentTool === 'brush' &&
        currentState.tools.brushSettings.autoSampleColor &&
        !ccFlags.isAny &&
        currentState.tools.brushSettings.brushShape !== BrushShape.RESAMPLER;

      if (isAutoSampleBrush) {
        // When auto-sampling, keep the sampled color intact and sync the swatch instead.
        const sampledColor = currentState.tools.brushSettings.color;
        if (sampledColor && sampledColor !== paletteColor) {
          currentState.setPaletteColor('foreground', sampledColor);
        }
      } else if (currentTool === 'brush') {
        currentState.setBrushSettings({ color: paletteColor });
      } else if (currentTool === 'eraser') {
        currentState.setEraserSettings({ color: paletteColor });
      }
    }

    if (currentTool === 'eraser') {
      if (FF.ERASER_V2 && drawCtx) {
        const activeLayer = currentState.layers.find(l => l.id === currentState.activeLayerId);
        if (!activeLayer) {
          return;
        }
        const isColorCycleLayer = activeLayer.layerType === 'color-cycle';
        if (!isColorCycleLayer && activeLayer.imageData) {
          drawCtx.putImageData(activeLayer.imageData, 0, 0);
          drawingCanvasHasContent.current = true;
        } else if (!isColorCycleLayer) {
          drawingCanvasHasContent.current = true;
        } else {
          drawingCanvasHasContent.current = false;
        }

        const eraserOpacity = currentState.tools.eraserSettings.opacity ?? 1;
        const tool = new EraserTool(
          activeLayer,
          { opacity: eraserOpacity },
          {
            overlayCtx: drawCtx,
            maskManager,
            createStampSource: createBrushStampSource,
            brushHalfSize: getBrushHalfSize,
            getBrushSettings: getColorCycleBrushEraserSettings
          }
        );
        eraserToolRef.current = tool;
        eraserRoiRef.current = null;
        tool.begin(worldPos, pressure);
        eraserRoiRef.current = tool.getROI();
      } else {
        // OPTIMIZATION: Copy the active layer to the drawing canvas ONCE at the start.
        const activeLayer = currentState.layers.find(l => l.id === currentState.activeLayerId);
        if (activeLayer?.imageData) {
          drawCtx.putImageData(activeLayer.imageData, 0, 0);
        }

        // Prepare to erase using the active brush tip by drawing with destination-out.
        drawCtx.globalCompositeOperation = 'destination-out';
        const eraserOpacity = currentState.tools.eraserSettings.opacity ?? 1;
        const canMirrorBrush = !ccFlags.isAny;

        if (canMirrorBrush) {
          drawCtx.globalAlpha = eraserOpacity;

          if (currentBrushId && userBrushEngine.isUserBrush(currentBrushId)) {
            userBrushEngine.setActiveBrush(currentBrushId);
            userBrushEngine.startStroke(drawCtx, worldPos.x, worldPos.y, pressure);
          } else if (brushEngine) {
            const customBrushData: CustomBrushStrokeData | undefined =
              resolveActiveCustomBrushData(currentState);
            brushEngine.drawBrush(drawCtx, worldPos, worldPos, { pressure, customBrushData });
          } else {
            drawCtx.globalAlpha = 1;
            drawEraserSegment(drawCtx, worldPos, worldPos);
          }
        } else {
          drawCtx.globalAlpha = 1;
          drawEraserSegment(drawCtx, worldPos, worldPos);
        }
      }
    } else { // Brush tool
      drawCtx.globalAlpha = 1.0;
      drawCtx.globalCompositeOperation = 'source-over';
      
      // Check if this is a user brush
      if (currentBrushId && userBrushEngine.isUserBrush(currentBrushId)) {
        userBrushEngine.setActiveBrush(currentBrushId);
        userBrushEngine.startStroke(drawCtx, worldPos.x, worldPos.y, pressure);
      } else if (brushEngine) {
        let customBrushData: CustomBrushStrokeData | undefined = resolveActiveCustomBrushData(currentState);
        const ccStrokeFlags = getColorCycleBrushFlags(currentState.tools.brushSettings);

        if (ccStrokeFlags.isAny) {
          const activeLayer = currentState.layers.find(l => l.id === currentState.activeLayerId);
          const isColorCycleLayer = activeLayer?.layerType === 'color-cycle';

          if (!isColorCycleLayer) {
            return;
          }

          if (activeLayer && FF.ERASER_V2) {
            beginMaskHealingStroke(activeLayer.id, worldPos, pressure);
          }
          {
            const colorCycleBrushManager = getColorCycleBrushManager();
            const colorCycleBrush = colorCycleBrushManager.getBrush(activeLayer.id);
            ensureActiveColorCycleGradientSlot(currentState, activeLayer, colorCycleBrush);
            const strokeFlowMode = currentState.tools.brushSettings.colorCycleFlowMode ?? 'reverse';
            if (colorCycleBrush) {
              if (typeof colorCycleBrush.setFlowMode === 'function') {
                colorCycleBrush.setFlowMode(strokeFlowMode);
              } else if (typeof colorCycleBrush.setFlowDirection === 'function') {
                colorCycleBrush.setFlowDirection(strokeFlowMode === 'reverse' ? 'backward' : 'forward');
              }
            }
            if (!activeLayer.colorCycleData?.flowMode) {
              try {
                currentState.updateLayer(activeLayer.id, {
                  colorCycleData: {
                    ...(activeLayer.colorCycleData ?? {}),
                    flowMode: strokeFlowMode,
                  },
                });
              } catch {}
            }
          }

          const rawSpacing = currentState.tools.brushSettings.spacing || 1;
          const pausedForStart = !selectEffectiveColorCyclePlaying(currentState);
          const pixelQueue = colorCyclePixelQueue.current ?? (() => {
            const queue = createPixelQueue();
            colorCyclePixelQueue.current = queue;
            return queue;
          })();
          const brushSize = currentState.tools.brushSettings.size || 1;
          const recomposeHalf = Math.ceil(brushSize / 2) + 2;
          const effectiveSpacing = pausedForStart
            ? Math.max(1, Math.round(rawSpacing * 1.25))
            : rawSpacing;
          const markDirty = (cx: number, cy: number) => {
            if (!pausedForStart) {
              return;
            }
            const width = recomposeHalf * 2;
            const height = width;
            const x = Math.floor(cx - recomposeHalf);
            const y = Math.floor(cy - recomposeHalf);
            if (typeof pixelQueue.addDirtyRect === 'function') {
              pixelQueue.addDirtyRect(x, y, width, height);
            } else {
              scheduleRecompose({ x, y, width, height });
            }
          };

          if (ccStrokeFlags.isCustom) {
            const brushData = customBrushData ?? resamplerBrushDataRef.current;
            if (!brushData) {
              return;
            }

            if (colorCycleLastPosRef.current) {
              const dx = worldPos.x - colorCycleLastPosRef.current.x;
              const dy = worldPos.y - colorCycleLastPosRef.current.y;
              const distance = Math.sqrt(dx * dx + dy * dy);

              colorCycleDistanceRef.current += distance;
              const { rotation, nextRotation } = resolveBrushRotation(
                !!currentState.tools.brushSettings.rotationEnabled,
                dx,
                dy,
                distance,
                colorCycleLastRotationRef.current
              );
              colorCycleLastRotationRef.current = nextRotation;

              if (colorCycleDistanceRef.current >= effectiveSpacing) {
                const targetCtx = getCCStampTargetCtx();
                if (!targetCtx) return;
                targetCtx.globalCompositeOperation = 'source-over';
                targetCtx.globalAlpha = 1;
                const stampX = worldPos.x;
                const stampY = worldPos.y;
                pixelQueue.enqueue(() => {
                  brushEngine.drawColorCycle(targetCtx, stampX, stampY, pressure, rotation, {
                    customStamp: brushData
                  });
                });
                markDirty(stampX, stampY);
                colorCycleDistanceRef.current = Math.max(0, colorCycleDistanceRef.current - effectiveSpacing);
              }
            } else {
              const targetCtx = getCCStampTargetCtx();
              if (!targetCtx) return;
              targetCtx.globalCompositeOperation = 'source-over';
              targetCtx.globalAlpha = 1;
              const stampX = worldPos.x;
              const stampY = worldPos.y;
              pixelQueue.enqueue(() => {
                brushEngine.drawColorCycle(targetCtx, stampX, stampY, pressure, 0, {
                  customStamp: brushData
                });
              });
              markDirty(stampX, stampY);
              colorCycleLastRotationRef.current = 0;
            }

            colorCycleLastPosRef.current = worldPos;
            return;
          }

          if (colorCycleLastPosRef.current) {
            const dx = worldPos.x - colorCycleLastPosRef.current.x;
            const dy = worldPos.y - colorCycleLastPosRef.current.y;
            const distance = Math.sqrt(dx * dx + dy * dy);

            colorCycleDistanceRef.current += distance;
            const { rotation, nextRotation } = resolveBrushRotation(
              !!currentState.tools.brushSettings.rotationEnabled,
              dx,
              dy,
              distance,
              colorCycleLastRotationRef.current
            );
            colorCycleLastRotationRef.current = nextRotation;

            if (colorCycleDistanceRef.current >= effectiveSpacing) {
              const targetCtx = getCCStampTargetCtx();
              if (!targetCtx) return;
              targetCtx.globalCompositeOperation = 'source-over';
              targetCtx.globalAlpha = 1;
              const stampX = worldPos.x;
              const stampY = worldPos.y;
              pixelQueue.enqueue(() => {
                brushEngine.drawColorCycle(targetCtx, stampX, stampY, pressure, rotation);
              });
              markDirty(stampX, stampY);
              colorCycleDistanceRef.current = Math.max(0, colorCycleDistanceRef.current - effectiveSpacing);
            }
          } else {
            const targetCtx = getCCStampTargetCtx();
            if (!targetCtx) return;
            targetCtx.globalCompositeOperation = 'source-over';
            targetCtx.globalAlpha = 1;
            const stampX = worldPos.x;
            const stampY = worldPos.y;
            pixelQueue.enqueue(() => {
              brushEngine.drawColorCycle(targetCtx, stampX, stampY, pressure, 0);
            });
            markDirty(stampX, stampY);
            colorCycleLastRotationRef.current = 0;
          }

          colorCycleLastPosRef.current = worldPos;
          return;
        } else if (currentState.tools.brushSettings.brushShape === BrushShape.RESAMPLER &&
            !currentState.tools.brushSettings.continuousSampling) {
          // Use the exact same approach as CustomBrushPanel for capturing
          const resamplerSample = captureResamplerSingleSampleExternal({
            samplePos: worldPos,
            brushSize: currentState.tools.brushSettings.size || 20,
            compositeCanvas: currentState.currentOffscreenCanvas ?? null,
            resamplerBrushDataRef,
          }, {
            captureBrushFromCanvas,
          });
          if (resamplerSample) {
            customBrushData = resamplerSample;
          }
        }

        if (currentState.tools.brushSettings.brushShape === BrushShape.RESAMPLER) {
          customBrushData = resamplerBrushDataRef.current ?? customBrushData;
        }

        brushEngine.drawBrush(
          drawCtx,
          worldPos,
          worldPos,
          { pressure, customBrushData }
        );
      }
    }
    
    // Initial point drawn - parent component will handle redraw
  }, [
    brushEngine,
    userBrushEngine,
    project,
    drawEraserSegment,
    pauseColorCycleForNonCCInteraction,
    beginStrokeSession,
    getCCStampTargetCtx,
    scheduleRecompose,
    createBrushStampSource,
    getColorCycleBrushEraserSettings,
    maskManager,
    renderBrushSamplingPreview,
    getEffectiveColorCyclePlaying,
    ensureOverlayInitialized,
    ensureActiveColorCycleGradientSlot,
    getBrushHalfSize,
    storeRef,
    beginMaskHealingStroke,
    sampleHexAt,
    sampleColorAt
  ]);

  // Process batched stroke points
  const processBatchedStrokes = useCallback(() => {
    processBatchedStrokesExternal({
      strokeBatchRef,
      strokeBatchTimerRef,
      drawingCtxRef,
      lastDrawPosRef,
      brushSamplingPreviewActiveRef,
      autoSamplePointsRef,
      resamplerBrushDataRef,
      stampCounterRef,
      colorCyclePixelQueueRef: colorCyclePixelQueue,
      colorCycleDistanceRef,
      colorCycleLastPosRef,
      colorCycleLastRotationRef,
      eraserToolRef,
      eraserRoiRef,
    }, {
      storeRef,
      project,
      brushEngine,
      userBrushEngine,
      drawEraserSegment,
      updateAutoSampledGradient,
      renderBrushSamplingPreview,
      getCCStampTargetCtx,
      scheduleRecompose,
      extendMaskHealingStroke,
      createPixelQueue,
      getColorCycleBrushManager,
      ensureActiveColorCycleGradientSlot,
      resolveActiveCustomBrushData,
      getColorCycleBrushFlags,
      selectEffectiveColorCyclePlaying,
      shouldPixelAlignBrush,
      alignPointToPixel,
      clipLineSegment,
      shouldDrawStamp,
      shouldApplyGridSnapPure,
      calculateGridSpacing,
      snapToGridPure,
      resolveBrushRotation,
      captureBrushFromCanvas,
      isEraserV2: FF.ERASER_V2,
    });
  }, [
    brushEngine,
    userBrushEngine,
    project,
    drawEraserSegment,
    updateAutoSampledGradient,
    getCCStampTargetCtx,
    scheduleRecompose,
    renderBrushSamplingPreview,
    storeRef,
    extendMaskHealingStroke,
    ensureActiveColorCycleGradientSlot
  ]);

  const continueDrawing = useCallback((rawWorldPos: { x: number; y: number }, pressure: number = 0.5) => {
    // Check if layer is still visible before continuing drawing
    const currentState = storeRef.current;
    const activeLayer = currentState.layers.find(l => l.id === currentState.activeLayerId);
    if (activeLayer && !activeLayer.visible) {
      endStrokeSession();
      return; // Exit silently if layer became hidden mid-stroke
    }

    const now = performance.now();
    const throttleBudget = THROTTLE_MS;
    const brushSettings = currentState.tools.brushSettings;
    const worldPos = alignPointToPixel(rawWorldPos, shouldPixelAlignBrush(brushSettings));

    if (currentState.tools.currentTool === 'brush' && !brushSamplingPreviewActiveRef.current) {
      strokeBoundingBoxRef.current = mergeBoundingBox(strokeBoundingBoxRef.current, worldPos);
      const activeCustomBrush = resolveActiveCustomBrushData(currentState) ?? resamplerBrushDataRef.current;
      const dynamicPadding = computeStrokeCapturePadding(brushSettings, activeCustomBrush ?? null);
      if (dynamicPadding > strokeCapturePaddingRef.current) {
        strokeCapturePaddingRef.current = dynamicPadding;
      }
    }

    // Add to batch
    strokeBatchRef.current.push({ pos: worldPos, pressure });
    
    // Check if we should process immediately (throttling)
    if (now - lastProcessedTimeRef.current >= throttleBudget) {
      // Process immediately
      processBatchedStrokes();
      lastProcessedTimeRef.current = now;
    } else {
      // Schedule batch processing if not already scheduled
      if (!strokeBatchTimerRef.current) {
        strokeBatchTimerRef.current = window.requestAnimationFrame(() => {
          processBatchedStrokes();
          lastProcessedTimeRef.current = performance.now();
        });
      }
    }
  }, [processBatchedStrokes, endStrokeSession, storeRef]);
  
  // Drawing/brush finalize matrix (non-shape-fill entry point):
  //  - Raster brushes & eraser on raster layers: merge overlay `drawingCanvas` into a temp canvas,
  //    persist with `captureCanvasToActiveLayer`, then commit history (default branch below).
  //  - Color-cycle brushes on CC layers: short-circuit into CC brush managers, capture CC canvas,
  //    and use deferred save scheduling (see `isColorCycleBrush` branch).
  //  - Shape fills on raster layers: handled upstream by `ShapeToolHandler.finalizeShapeFillResult`,
  //    which composites manually and calls `commitLayerHistory` before clearing the overlay.
  //  - Shape fills or brushes on CC layers with no CC canvas fall back to this method’s
  //    `skipSave`/`finalizeDrawing` guard to avoid corrupt history entries.
  const finalizeDrawing = useCallback(async (skipSaveOrOptions?: boolean | FinalizeDrawingOptions) => {
    let finalizeVisibleTimerStarted = false;
    const startFinalizeVisibleTimer = () => {
      if (finalizeVisibleTimerStarted) {
        return;
      }
      if (CC_DEBUG.on) {
        debugTime('cc:visible-finalize');
      }
      perfMark('cc:visible-finalize:start');
      finalizeVisibleTimerStarted = true;
    };
    const endFinalizeVisibleTimer = () => {
      if (finalizeVisibleTimerStarted) {
        if (CC_DEBUG.on) {
          debugTimeEnd('cc:visible-finalize');
        }
        finalizeVisibleTimerStarted = false;
        perfMark('cc:visible-finalize:end');
        perfMeasure('cc:visible-finalize', 'cc:visible-finalize:start', 'cc:visible-finalize:end');
      }
    };
    const options =
      typeof skipSaveOrOptions === 'object' && skipSaveOrOptions !== null
        ? skipSaveOrOptions
        : {};
    const skipSave =
      typeof skipSaveOrOptions === 'boolean'
        ? skipSaveOrOptions
        : options.skipSave ?? false;
    const historyActionOverride = options.historyActionType;
    const historyDescriptionOverride = options.historyDescription;

    const snapshot = storeRef.current;
    const activeLayerSnapshot = snapshot.layers.find(l => l.id === snapshot.activeLayerId);
    const isCCLayerSnapshot = activeLayerSnapshot?.layerType === 'color-cycle';
    const isCCBrushSnapshot = getColorCycleBrushFlags(snapshot.tools.brushSettings).isAny;
    const guardResult = evaluateFinalizeGuardsExternal({
      hasCanvas: Boolean(drawingCanvasRef.current),
      busy: isBusyRef?.current ?? false,
      project,
      isCCLayerSnapshot,
      isCCBrushSnapshot,
      isEraserV2: FF.ERASER_V2,
      isEraserTool: snapshot.tools.currentTool === 'eraser',
      drawingCanvasHasContent: drawingCanvasHasContent.current,
    });
    const overlayHasContent = guardResult.overlayHasContent;
    if (!guardResult.shouldProceed) {
      endMaskHealingStroke();
      return;
    }

    const pendingEraserTool =
      FF.ERASER_V2 && snapshot.tools.currentTool === 'eraser'
        ? eraserToolRef.current
        : null;

    const finalizeTool = snapshot.tools.currentTool as Tool | 'eraser';

    try {
      const { release: releaseBusyLock } = createFinalizeBusyLockExternal(isBusyRef);
      
      // Process any remaining batched strokes
      if (strokeBatchRef.current.length > 0) {
        processBatchedStrokes();
      }

      // Ensure any deferred color-cycle stamps are rendered before finalizing
      const activeQueue = colorCyclePixelQueue.current;
      const shouldAwaitQueueIdle =
        Boolean(activeQueue?.onIdle) && isCCLayerSnapshot && isCCBrushSnapshot;
      await flushColorCycleQueueBeforeFinalizeExternal({
        queue: activeQueue,
        shouldAwait: Boolean(activeQueue?.onIdle) && isCCLayerSnapshot && isCCBrushSnapshot,
      });

      finalizePendingEraserToolExternal({
        pendingEraserTool,
        eraserToolRef,
        eraserRoiRef,
      });

      const finalizeAfterQueue = async () => {
        let currentState = snapshot;
        let activeLayer = currentState.layers.find(l => l.id === currentState.activeLayerId);
        const currentTool: Tool | 'eraser' = currentState.tools.currentTool as Tool | 'eraser';
        const currentBrushId = currentState.currentBrushPreset?.id;

        const engineStrokeBounds = finalizeStrokePrepExternal({
          finalizeTool,
          isEraserV2: FF.ERASER_V2,
          strokeBatchTimerRef,
          lastDrawPosRef,
          resamplerBrushDataRef,
          stampCounterRef,
          drawingCtx: drawingCtxRef.current,
          currentBrushId,
        }, {
          brushEngine,
          userBrushEngine,
          cancelAnimationFrame: cancelAnimationFrameSafe,
        });

        if (activeLayer) {
          const activeLayerIdString = activeLayer.id;
          const drawingCanvas = drawingCanvasRef.current;
          // Try to capture the minimal "before" state; prefer ROI-based snapshot at finalize.
          let layerBeforeImage = strokeBeforeImageRef.current;
          const layerBeforeColorState = strokeBeforeColorStateRef.current;
          let coalescePayload = buildStrokeCoalescePayloadExternal({
            activeStrokeSessionRef,
            endStrokeSession,
            activeLayerId: activeLayerIdString,
            currentTool,
            maxIntervalMs: BRUSH_HISTORY_COALESCE_WINDOW_MS,
          });

          let historyHandled = false;
          const capturePrep = await prepareStrokeCaptureExternal({
            activeLayer,
            project,
            drawingCanvas,
            overlayHasContent,
            strokeBoundingBox: strokeBoundingBoxRef.current,
            strokeCapturePadding: strokeCapturePaddingRef.current,
            roiPadding: ROI_PADDING_PX,
            engineStrokeBounds,
            captureRegionOverride: options.captureRegionOverride ?? null,
            layerBeforeImage,
            skipSave,
          }, {
            boundingBoxToCaptureRegion,
            rectToCaptureRegion,
            unionCaptureRegions,
            captureLayerRegionImageData,
            ensureLayerSnapshotWithRetry,
            logError,
          });
          const captureRoi = capturePrep.captureRoi;
          layerBeforeImage = capturePrep.layerBeforeImage;

          if (currentTool === 'eraser') {
            historyHandled = await finalizeEraserStrokeExternal({
              activeLayer,
              activeLayerId: activeLayerIdString,
              drawingCanvas,
              layerBeforeImage,
              layerBeforeColorState,
              historyAction: historyActionOverride,
              historyDescription: historyDescriptionOverride,
              captureRoi,
              eraserRoi: FF.ERASER_V2 ? eraserRoiRef.current : null,
              coalesce: coalescePayload,
              isEraserV2: FF.ERASER_V2,
              skipSave,
            }, {
              captureCanvasToActiveLayer,
              scheduleHistoryCommit,
              withTiming,
              logError,
            });
            eraserRoiRef.current = null;
          } else { // Brush tool
            const activeSettings = currentState.tools.brushSettings;
            const activeFlags = getColorCycleBrushFlags(activeSettings);
            const drawingCtx = drawingCtxRef.current;
            const isColorCycleLayer = activeLayer?.layerType === 'color-cycle';
            const isColorCycleBrush = activeFlags.isAny;

            const { shouldReturn } = await finalizeColorCycleBrushExternal({
              activeFlags,
              activeSettings,
              currentState,
            }, {
              storeRef,
              brushEngine,
              drawingCanvas,
              drawingCtx,
              drawingCanvasHasContent,
              colorCycleAnimationRef,
              brushSamplingPreviewActiveRef,
              autoSamplePointsRef,
              autoSampleLastUpdateRef,
              computeAutoSampleStops,
              clearBrushSamplingPreview,
              getBrushForLayer: (layerId) =>
                getColorCycleBrushManager().getBrush(layerId) as ManagedColorCycleBrush | undefined,
              bindBrushToCanvas,
              getEffectiveColorCyclePlaying,
              startPlaybackRef,
            });
            if (shouldReturn) {
              return;
            }
            
            // Handle capture differently for CC layers vs regular layers
            // Treat stroke, shape, and custom CC variants as CC for saving
            const shouldDisableCoalescing = isColorCycleLayer && isColorCycleBrush;
            if (shouldDisableCoalescing) {
              coalescePayload = undefined;
            }
            const isAnyColorCycleBrush = isColorCycleBrush;

            // Ensure CC layer has a canvas before attempting to save
            const ensureResult = ensureColorCycleLayerCanvasExternal({
              isColorCycleLayer,
              activeLayer,
              project: currentState.project,
            }, { storeRef });
            currentState = ensureResult.state;
            activeLayer = ensureResult.activeLayer ?? activeLayer;

            if (!activeLayer) {
              return;
            }
            const activeLayerIdString = activeLayer.id;

            const isShapeMode = currentState.tools.shapeMode;

            const historyMetadata = resolveStrokeHistoryMetadataExternal({
              state: storeRef.current,
              isShapeMode,
              isColorCycleLayer,
              isColorCycleBrush,
              historyActionOverride,
              historyDescriptionOverride,
            });
            const resolvedHistoryAction = historyMetadata.actionType;
            const resolvedHistoryDescription = historyMetadata.description;

            let brushForCleanup: ManagedColorCycleBrush | undefined;
            let deferredLayerCanvas: HTMLCanvasElement | null = null;
            let strokeCaptureRoi: CaptureRegion | undefined;

            // Polygon Gradient lost-edge (raster layers, before overlay commit)
            if (!isColorCycleLayer && drawingCanvasRef.current && drawingCtxRef.current) {
              const polyState = storeRef.current.polygonGradientState;
              applyPolygonLostEdgeErosion({
                ctx: drawingCtxRef.current,
                canvas: drawingCanvasRef.current,
                brushShape: activeSettings.brushShape,
                lostEdge: activeSettings.lostEdge,
                thickness: activeSettings.thickness,
                spacing: activeSettings.spacing,
                polygonVertices: polyState.vertices,
                polygonPoints: polyState.points,
                fallbackPoints: shapePointsRef.current,
              });
            }

            const colorCycleCommitResult = await commitColorCycleStrokeIfNeededExternal({
              isColorCycleLayer,
              isColorCycleBrush: isAnyColorCycleBrush,
              activeLayer,
              brushSettings: activeSettings,
              project,
              drawingCanvas,
              strokeBoundingBox: strokeBoundingBoxRef.current,
              strokeCapturePadding: strokeCapturePaddingRef.current,
              roiPadding: ROI_PADDING_PX,
              enableCaptureRoi: FF.CC_CAPTURE_ROI,
            }, {
              getBrushForLayer: (layerId) =>
                getColorCycleBrushManager().getBrush(layerId) as ManagedColorCycleBrush | undefined,
              bindBrushToCanvas,
              markLayerHasContent: (layerId) => {
                try {
                  const st = storeRef.current;
                  const freshLayer = st.layers.find(l => l.id === layerId);
                  if (freshLayer?.colorCycleData) {
                    st.updateLayer(layerId, {
                      colorCycleData: {
                        ...freshLayer.colorCycleData,
                        hasContent: true,
                      }
                    });
                  }
                } catch {}
              },
              perfMark,
              perfMeasure,
              startFinalizeVisibleTimer,
              endFinalizeVisibleTimer,
              dispatchFrameUpdate: (layerId) => {
                window.dispatchEvent(new CustomEvent('colorCycleFrameUpdate'));
                ccLog('stroke: frameUpdate dispatched', { layerId: layerId.slice(-6) });
              },
            });

            if (colorCycleCommitResult.handled) {
              strokeCaptureRoi = colorCycleCommitResult.strokeCaptureRoi;
              deferredLayerCanvas = colorCycleCommitResult.deferredLayerCanvas ?? null;
              brushForCleanup = colorCycleCommitResult.brushForCleanup;
            } else if (!colorCycleCommitResult.skipped) {
              if (!skipSave && !layerBeforeImage) {
                logError('[finalize] brush beforeImage missing; skipping history to avoid destructive undo.');
                historyHandled = true;
              } else {
                // Polygon Gradient lost-edge: erode overlay before committing
                // polygon gradient lost-edge (non-CC layers)
                if (!isColorCycleLayer && drawingCanvasRef.current && drawingCtxRef.current) {
                  const polyState = storeRef.current.polygonGradientState;
                  applyPolygonLostEdgeErosion({
                    ctx: drawingCtxRef.current,
                    canvas: drawingCanvasRef.current,
                    brushShape: activeSettings.brushShape,
                    lostEdge: activeSettings.lostEdge,
                    thickness: activeSettings.thickness,
                    spacing: activeSettings.spacing,
                    polygonVertices: polyState.vertices,
                    polygonPoints: polyState.points,
                    fallbackPoints: shapePointsRef.current,
                    logDevStats: process.env.NODE_ENV !== 'production',
                  });
                }

                await commitRasterOverlay({
                  layer: activeLayer,
                  overlayCanvas: drawingCanvasRef.current ?? null,
                  beforeImage: layerBeforeImage,
                  beforeColorState: layerBeforeColorState,
                  historyAction: resolvedHistoryAction,
                  historyDescription: resolvedHistoryDescription,
                  tool: currentTool,
                  coalesce: skipSave ? undefined : coalescePayload,
                  bitmapRoi: captureRoi ?? undefined,
                  skipHistory: skipSave,
                  deferHistory: !skipSave,
                });
                if (!skipSave) {
                  historyHandled = true;
                }
              }
            }

          // Clear transient drawing canvas content before scheduling history work
          clearFinalizeOverlayIfNeededExternal({
            state: currentState,
            isColorCycleLayer,
            isColorCycleBrush,
            drawingCanvasRef,
            drawingCtxRef,
            drawingCanvasHasContent,
          });

          releaseBusyLock();

          if (!historyHandled) {
            historyHandled = await commitStrokeHistoryIfNeededExternal({
              shouldCommit: !skipSave,
              activeLayerId: activeLayerIdString,
              layerBeforeImage,
              layerBeforeColorState,
              actionType: resolvedHistoryAction,
              description: resolvedHistoryDescription,
              tool: currentTool,
              coalesce: shouldDisableCoalescing ? undefined : coalescePayload,
              historyBitmapRoi: strokeCaptureRoi ?? captureRoi,
              shouldSkipBitmapDelta: shouldDisableCoalescing,
              isColorCycleLayer,
              isColorCycleBrush,
              deferredLayerCanvas,
              strokeCaptureRoi,
              brushForCleanup,
            }, {
              scheduleDeferredColorCycleSave,
              scheduleHistoryCommit,
              captureColorCycleBrushState,
              perfMark,
              perfMeasure,
              debugTime,
              debugTimeEnd,
              debugVerbose,
            });
          }

          if (!(isColorCycleLayer && isAnyColorCycleBrush)) {
            brushForCleanup?.clearPaintBuffer?.(activeLayerIdString);
          }
        }
      }
      };

      if (shouldAwaitQueueIdle) {
        await runIdleAsync(finalizeAfterQueue);
      } else {
        await finalizeAfterQueue();
      }

      // Parent component will handle final redraw
    } catch (error) {
      logError('Error during finalization:', error);
    } finally {
      await finalizeDrawingCleanupExternal({
        endMaskHealingStroke,
        resetAutoSampleState,
        clearStrokeSession,
        strokeBeforeImageRef,
        strokeBeforeColorStateRef,
        drawingCtxRef,
        drawingCanvasRef,
        drawingCanvasHasContent,
        resumeColorCycleAfterInteraction,
        endFinalizeVisibleTimer,
        strokeBoundingBoxRef,
        strokeCapturePaddingRef,
        isBusyRef,
      });
    }
  }, [
    project,
    captureCanvasToActiveLayer,
    isBusyRef,
    userBrushEngine,
    brushEngine,
    processBatchedStrokes,
    resumeColorCycleAfterInteraction,
    endStrokeSession,
    clearStrokeSession,
    scheduleDeferredColorCycleSave,
    runIdleAsync,
    clearBrushSamplingPreview,
    resetAutoSampleState,
    commitRasterOverlay,
    computeAutoSampleStops,
    getEffectiveColorCyclePlaying,
    storeRef,
    endMaskHealingStroke,
    scheduleHistoryCommit
  ]);

  const finalizeStroke = useCallback(() => {
    void finalizeDrawing(false);
  }, [finalizeDrawing]);
  
  const clearDrawingCanvas = useCallback(() => {
    if (drawingCtxRef.current && drawingCanvasRef.current) {
      drawingCtxRef.current.clearRect(0, 0, drawingCanvasRef.current.width, drawingCanvasRef.current.height);
    }
    drawingCanvasHasContent.current = false;
    lastDrawPosRef.current = null;
    if (FF.ERASER_V2 && eraserToolRef.current) {
      eraserToolRef.current.cancel();
      eraserToolRef.current = null;
      eraserRoiRef.current = null;
    }
    endMaskHealingStroke();
    resetShapeDragRefs();
  }, [endMaskHealingStroke, resetShapeDragRefs]);

  const clearShapeBeforeSnapshot = useCallback(() => {
    clearShapeBeforeSnapshotExternal({
      shapeBeforeImageRef,
      shapeBeforeSnapshotCapturedRef,
    });
  }, []);

  const coerceDragShapeToPolygon = useCallback((): boolean => {
    if (!shapeDragMovedRef.current || !shapeDragStartRef.current || !shapeDragLastRef.current) {
      return false;
    }

    const store = storeRef.current;
    const zoom = store.canvas?.zoom || 1;
    const brushSize = store.tools.brushSettings.size ?? store.globalBrushSize ?? 12;

    const next = ensurePolygonFromDrag({
      existingPoints: shapePointsRef.current,
      start: shapeDragStartRef.current,
      end: shapeDragLastRef.current,
      zoom,
      brushSize,
    });

    if (!next) {
      return false;
    }

    shapePointsRef.current = next;
    seedManualStrokeBoundingBox(shapePointsRef.current, 2);
    triggerSimpleShapePreview();
    return true;
  }, [seedManualStrokeBoundingBox, storeRef, triggerSimpleShapePreview]);

  const capturePendingShapeSnapshot = useCallback(() => {
    capturePendingShapeSnapshotExternal({
      shapeBeforeSnapshotCapturedRef,
      shapeBeforeImageRef,
      storeRef,
      project,
      shapePointsRef,
      strokeCapturePaddingRef,
      roiPadding: ROI_PADDING_PX,
      captureRegionFromPoints,
      captureLayerRegionImageData,
    });
  }, [project, storeRef]);
  
  const latestShapePressureRef = useRef(0.5);
  const lastNonZeroShapePressureRef = useRef(0.5);
  const latestShapePixelSizeRef = useRef<number | null>(null);
  const shapeSampleCountRef = useRef(0);
  const penLiftHoldUntilRef = useRef<number>(0);
  const shapeMaxPressureRef = useRef(1);
  const hadValidShapePressureRef = useRef(false);
  const lastStablePressureRef = useRef(0.5);
  const lastShapePressureTimeRef = useRef<number>(0);
  const shapePressureGainRef = useRef(1);
  const shapePixelResStateRef = useRef(createPressureResolutionState(1));

  const computeShapePixelSize = useCallback((pressure: number): number => {
    const settings = storeRef.current.tools.brushSettings;
    const base = Math.max(1, Math.round(settings.fillResolution || 1));
    return computeShapePixelSizeExternal({
      pressure,
      baseResolution: base,
      pressureLinked: Boolean(settings.pressureLinkedFillResolution),
      stateRef: shapePixelResStateRef,
    });
  }, [storeRef]);

  const shapePressureDebugEnabled = useCallback(() => {
    if (typeof window === 'undefined') return false;
    return Boolean((window as { __shapePressureDebug?: unknown }).__shapePressureDebug);
  }, []);

  const updateShapePressure = useCallback((p?: number, timestamp?: number, raw?: number) => {
    updateShapePressureExternal({
      refs: {
        latestShapePressureRef,
        lastNonZeroShapePressureRef,
        latestShapePixelSizeRef,
        shapeSampleCountRef,
        penLiftHoldUntilRef,
        shapeMaxPressureRef,
        hadValidShapePressureRef,
        lastStablePressureRef,
        lastShapePressureTimeRef,
        shapePressureGainRef,
        shapePixelResStateRef,
      },
      constants: {
        maxPressureDecayPerMs: MAX_PRESSURE_DECAY_PER_MS,
        minDropPerEvent: MIN_DROP_PER_EVENT,
        smoothing: SHAPE_PRESSURE_SMOOTHING,
        sampleWindow: SHAPE_PRESSURE_SAMPLE_WINDOW,
      },
      deps: {
        computeShapePixelSize,
        debugEnabled: shapePressureDebugEnabled,
      },
      pressure: p,
      timestamp,
      rawPressure: raw,
    });
  }, [computeShapePixelSize, shapePressureDebugEnabled]);

  const shapeDrawingRefs = useMemo(() => ({
    isDrawingShapeRef,
    isSelectingDirectionRef,
    directionPreviewRef,
    shapePointsRef,
    shapeDragStartRef,
    shapeDragLastRef,
    shapeDragMovedRef,
    latestShapePressureRef,
    lastStablePressureRef,
    shapeBeforeImageRef,
    strokeBoundingBoxRef,
    strokeCapturePaddingRef,
    drawingCtxRef,
    drawingCanvasRef,
    drawingCanvasHasContent,
    autoSamplePointsRef,
    autoSampleForkRef,
    autoSampleLastUpdateRef,
    hadValidShapePressureRef,
    latestShapePixelSizeRef,
    shapeMaxPressureRef,
    ccShapePreviewPauseStartedRef,
    activeStrokeSessionRef,
    finalizeQueueRef,
  }), [
    autoSampleForkRef,
    autoSampleLastUpdateRef,
    autoSamplePointsRef,
    ccShapePreviewPauseStartedRef,
    directionPreviewRef,
    drawingCanvasHasContent,
    drawingCanvasRef,
    drawingCtxRef,
    finalizeQueueRef,
    hadValidShapePressureRef,
    isDrawingShapeRef,
    isSelectingDirectionRef,
    lastStablePressureRef,
    latestShapePixelSizeRef,
    latestShapePressureRef,
    shapeBeforeImageRef,
    shapeDragLastRef,
    shapeDragMovedRef,
    shapeDragStartRef,
    shapeMaxPressureRef,
    shapePointsRef,
    strokeBoundingBoxRef,
    strokeCapturePaddingRef,
    activeStrokeSessionRef,
  ]);

  const shapeDrawingDeps = useMemo(() => ({
    storeRef,
    toolsRef,
    project,
    isBusyRef,
    drawingCtxRef,
    drawingCanvasRef,
    drawingCanvasHasContent,
    strokeBoundingBoxRef,
    strokeCapturePaddingRef,
    shapeBeforeImageRef,
    latestShapePixelSizeRef,
    hadValidShapePressureRef,
    lastStablePressureRef,
    brushEngine,
    getColorCycleBrushManager,
    getColorCycleBrushFlags,
    sampleColorAt,
    sampleHexAt,
    initDrawingCanvas,
    startDrawing,
    continueDrawing,
    seedManualStrokeBoundingBox,
    triggerSimpleShapePreview,
    resetShapeDragRefs,
    resetShapePressureState,
    updateShapePressure,
    pauseColorCycleForNonCCInteraction,
    resumeColorCycleAfterInteraction,
    updateAutoSampledGradient,
    updateDitherGradSamples,
    capturePendingShapeSnapshot,
    clearShapeBeforeSnapshot,
    createBoundingBox,
    mergeBoundingBox,
    appendSegmentWithDynamicResampling,
    computeAutoSampleStops,
    computeShapePixelSize,
    finalizeDrawing,
    finalizeDitherGradientShape,
    finalizeRasterShapeFill,
    runColorCycleShapeFill,
    computeFallbackLinearDirection,
    captureRegionFromPoints,
    boundingBoxToCaptureRegion,
    commitRasterShapeFill,
    runIdle,
    scheduleDeferredColorCycleSaveWithState,
    bindBrushToCanvas,
    captureColorCycleBrushState,
    isColorCycleLayerWithData,
    setSharedColorCycleGradient: setSharedColorCycleGradientForShapes,
    logError,
    withTiming,
    timeAsync,
    timeSync,
    ccLog,
    ccDebug: CC_DEBUG,
    perfMark,
    perfMeasure,
    debugTime,
    debugTimeEnd,
    resetAutoSampleState,
    resetPolygonState,
    inflateShapeBeforeSnapshot,
    ensureLayerSnapshotWithRetry,
    applyBackdropFromSnapshot,
    captureCanvasToActiveLayer,
    scheduleHistoryCommit,
    ROI_PADDING_PX,
    FF,
  }), [
    brushEngine,
    captureCanvasToActiveLayer,
    capturePendingShapeSnapshot,
    clearShapeBeforeSnapshot,
    computeAutoSampleStops,
    computeShapePixelSize,
    continueDrawing,
    drawingCanvasHasContent,
    drawingCanvasRef,
    drawingCtxRef,
    finalizeDrawing,
    hadValidShapePressureRef,
    initDrawingCanvas,
    isBusyRef,
    lastStablePressureRef,
    latestShapePixelSizeRef,
    pauseColorCycleForNonCCInteraction,
    project,
    resetAutoSampleState,
    resetPolygonState,
    resetShapeDragRefs,
    resetShapePressureState,
    resumeColorCycleAfterInteraction,
    runIdle,
    sampleColorAt,
    sampleHexAt,
    scheduleDeferredColorCycleSaveWithState,
    scheduleHistoryCommit,
    seedManualStrokeBoundingBox,
    setSharedColorCycleGradientForShapes,
    shapeBeforeImageRef,
    startDrawing,
    storeRef,
    strokeBoundingBoxRef,
    strokeCapturePaddingRef,
    toolsRef,
    triggerSimpleShapePreview,
    updateAutoSampledGradient,
    updateDitherGradSamples,
    updateShapePressure,
  ]);

  const startShapeDrawing = useCallback(
    (worldPos: { x: number; y: number }, pressure: number = 0, timestamp?: number, rawPressure?: number) => {
      startShapeDrawingExternal({
        worldPos,
        pressure,
        timestamp,
        rawPressure,
        shapeMode,
        refs: shapeDrawingRefs,
      }, shapeDrawingDeps);
    },
    [shapeDrawingDeps, shapeDrawingRefs, shapeMode]
  );
  
  const continueShapeDrawing = useCallback(
    (worldPos: { x: number; y: number }, pressure: number = 0, timestamp?: number, rawPressure?: number) => {
      continueShapeDrawingExternal({
        worldPos,
        pressure,
        timestamp,
        rawPressure,
        shapeMode,
        refs: shapeDrawingRefs,
      }, shapeDrawingDeps);
    },
    [shapeDrawingDeps, shapeDrawingRefs, shapeMode]
  );
  
  const finalizeShapeDrawing = useCallback(async () => {
    await finalizeShapeDrawingExternal({
      shapeMode,
      refs: shapeDrawingRefs,
      toolsRef,
    }, shapeDrawingDeps);
  }, [shapeDrawingDeps, shapeDrawingRefs, shapeMode, toolsRef]);
  
  // Start continuous color cycle animation (for when play button is pressed)
  const startContinuousColorCycleAnimationCore = useCallback((reason = 'unknown') => {
    startContinuousColorCycleAnimationCoreExternal(reason, {
      brushEngine,
      ensureOverlayInitialized,
      renderAllColorCycleLayers,
      storeRef,
      getEffectiveColorCyclePlaying,
      cancelDeferredOverlayRender,
      scheduleDeferredOverlayRender,
      ccLog,
      ccGroup,
      ccGroupEnd,
      dumpLayerFlags,
      debugWarn,
      continuousColorCycleAnimationRef,
      continuousColorCycleAnimationActiveRef,
      startingColorCycleAnimationRef,
      lastStartAtRef,
      drawingCanvasRef,
      drawingCtxRef,
      drawingCanvasHasContent,
      firstPaintRef,
      lastRendererLogTS,
      startCooldownMs: START_CC_COOLDOWN_MS,
    });
  }, [
    brushEngine,
    ensureOverlayInitialized,
    renderAllColorCycleLayers,
    storeRef,
    getEffectiveColorCyclePlaying,
    cancelDeferredOverlayRender,
    scheduleDeferredOverlayRender,
  ]);

  // DEBUG ONLY - throttle noisy trace logs to avoid console spam while retaining stack samples
  const startContinuousColorCycleAnimation = useCallback((reason = 'unknown') => {
    if (startingColorCycleAnimationRef.current) {
      return;
    }
    if (continuousColorCycleAnimationRef.current != null) {
      return;
    }

    const now =
      typeof performance !== 'undefined' && typeof performance.now === 'function'
        ? performance.now()
        : Date.now();
    const traceState = startContinuousColorCycleTraceStateRef.current;
    const lastLoggedAt = traceState.lastByReason[reason];
    const elapsed = lastLoggedAt === undefined ? Number.POSITIVE_INFINITY : now - lastLoggedAt;
    const shouldAttemptLog = elapsed >= START_CC_TRACE_THROTTLE_MS;

    if (CC_DEBUG.on && CC_DEBUG.verbose && shouldAttemptLog) {
      const suppressedCount = traceState.suppressedByReason[reason] ?? 0;
      traceState.lastByReason[reason] = now;
      traceState.suppressedByReason[reason] = 0;
      try {
        console.groupCollapsed('[CC:TRACE] startContinuousColorCycleAnimation', {
          reason,
          suppressedCount,
        });
        if (suppressedCount > 0) {
          console.log(`suppressed ${suppressedCount} rapid calls`);
        }
        console.log(new Error('startContinuousColorCycleAnimation').stack);
        console.groupEnd();
      } catch {}
    } else if (CC_DEBUG.on && CC_DEBUG.verbose && !shouldAttemptLog) {
      traceState.suppressedByReason[reason] =
        (traceState.suppressedByReason[reason] ?? 0) + 1;
    } else if (shouldAttemptLog) {
      // Keep timestamps fresh even when debug logging is disabled.
      traceState.lastByReason[reason] = now;
      traceState.suppressedByReason[reason] = 0;
    }

    return startContinuousColorCycleAnimationCore(reason);
  }, [startContinuousColorCycleAnimationCore]);

  useEffect(() => {
    startPlaybackRef.current = startContinuousColorCycleAnimation;
    return () => {
      startPlaybackRef.current = null;
    };
  }, [startContinuousColorCycleAnimation]);

  useEffect(() => {
    return () => {
      cancelDeferredOverlayRender();
    };
  }, [cancelDeferredOverlayRender]);

  useEffect(() => {
    if (!project) {
      return;
    }
    if (typeof window === 'undefined') {
      return;
    }
    const ready = ensureOverlayInitialized();
    if (!ready) {
      return;
    }
    const isPlaying = getEffectiveColorCyclePlaying();
    if (isPlaying && !startupKickDoneRef.current) {
      startupKickDoneRef.current = true;
      Promise.resolve().then(() => {
        startContinuousColorCycleAnimation('store-sync');
      });
    }
  }, [project, ensureOverlayInitialized, startContinuousColorCycleAnimation, getEffectiveColorCyclePlaying]);
  
  useEffect(() => {
    let previous = getEffectiveColorCyclePlaying();

    const syncPlayback = (playing: boolean, reason: CCReason) => {
      if (playing) {
        let allAnimating = false;
        try {
          const st = storeRef.current;
          const ccLayers = st.layers.filter((layer) => layer.layerType === 'color-cycle');
          allAnimating =
            ccLayers.length > 0 &&
            ccLayers.every((layer) => !!layer.colorCycleData?.isAnimating);
        } catch {}
        if (!continuousColorCycleAnimationActiveRef.current && !startingColorCycleAnimationRef.current) {
          try {
            const st = storeRef.current;
            const depth = selectColorCycleSuspendDepth(st);
            if (depth > 0) {
              st.forceResumeColorCycle('toolbar');
              ccLog('forceResumeColorCycle(toolbar) due to suspend depth', { depth });
            }
          } catch {}
          startContinuousColorCycleAnimation(reason);
        } else {
          const now =
            typeof performance !== 'undefined' && typeof performance.now === 'function'
              ? performance.now()
              : Date.now();
          const lastAt = skipStartLogAtRef.current[reason] ?? 0;
          if (now - lastAt >= SKIP_CC_LOG_THROTTLE_MS) {
            skipStartLogAtRef.current[reason] = now;
            ccLog('skip startContinuousColorCycleAnimation (already running)', {
              reason,
              allAnimating
            });
          }
        }
      } else {
        let anyAnimating = false;
        try {
          const st = storeRef.current;
          anyAnimating = st.layers.some(
            (layer) => layer.layerType === 'color-cycle' && !!layer.colorCycleData?.isAnimating
          );
        } catch {}

        if (
          anyAnimating ||
          continuousColorCycleAnimationActiveRef.current ||
          startingColorCycleAnimationRef.current
        ) {
          stopContinuousColorCycleAnimation(reason);
        } else {
          const now =
            typeof performance !== 'undefined' && typeof performance.now === 'function'
              ? performance.now()
              : Date.now();
          const lastAt = skipStopLogAtRef.current[reason] ?? 0;
          if (now - lastAt >= SKIP_CC_LOG_THROTTLE_MS) {
            skipStopLogAtRef.current[reason] = now;
            ccLog('skip stopContinuousColorCycleAnimation (already stopped)', {
              reason,
              anyAnimating
            });
          }
        }
      }
    };

    // Ensure initial alignment with store state
    syncPlayback(previous, 'startup');

    const unsubscribe = useAppStore.subscribe((state) => {
      const next = selectEffectiveColorCyclePlaying(state);
      if (next === previous) {
        return;
      }
      previous = next;
      syncPlayback(next, 'store-sync');
    });

    return () => {
      unsubscribe();
    };
  }, [startContinuousColorCycleAnimation, stopContinuousColorCycleAnimation, getEffectiveColorCyclePlaying, storeRef]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    const handleClearOverlay = () => {
      try {
        const ctx = drawingCtxRef.current;
        const canvas = drawingCanvasRef.current;
        if (!ctx || !canvas) return;
        ctx.setTransform?.(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        drawingCanvasHasContent.current = false;
      } catch {}
    };
    window.addEventListener('cc:clear-overlay', handleClearOverlay);
    return () => {
      window.removeEventListener('cc:clear-overlay', handleClearOverlay);
    };
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    initDrawingCanvas();
  }, [initDrawingCanvas]);

  useEffect(() => {
    if (!shapeMode) {
      return;
    }
    initDrawingCanvas();
  }, [shapeMode, initDrawingCanvas]);

  useEffect(() => {
    type LayerSnapshot = {
      id: string;
      mode: string | null;
      isAnimating: boolean | null;
    };

    const buildSnapshot = (layers: Layer[]): Record<string, LayerSnapshot> => (
      layers.reduce<Record<string, LayerSnapshot>>((acc, layer) => {
        acc[layer.id] = {
          id: layer.id,
          mode: (layer.colorCycleData?.mode ?? null) as LayerSnapshot['mode'],
          isAnimating: (layer.colorCycleData?.isAnimating ?? null) as LayerSnapshot['isAnimating']
        };
        return acc;
      }, {})
    );

    let previousSnapshots = buildSnapshot(storeRef.current.layers);

    const unsubscribe = useAppStore.subscribe((state: AppState) => {
      const nextSnapshots = buildSnapshot(state.layers);

      Object.values(nextSnapshots).forEach((entry) => {
        const prevEntry = previousSnapshots[entry.id];
        if (!prevEntry) {
          return;
        }
        if (prevEntry.isAnimating !== entry.isAnimating) {
          ccLog('STORE isAnimating flip', {
            id: entry.id.slice(-6),
            mode: entry.mode,
            prev: prevEntry.isAnimating,
            next: entry.isAnimating
          });
        }
      });

      previousSnapshots = nextSnapshots;
    });

    return () => {
      unsubscribe();
    };
  }, [storeRef]);
  
  // Setter for feedback message callback
  const setFeedbackCallback = useCallback((callback: (message: string) => void) => {
    feedbackMessageRef.current = callback;
  }, []);
  
  return {
    drawingCanvasRef,
    drawingCanvasHasContent,
    isCapturing,
    initDrawingCanvas,
    startDrawing,
    continueDrawing,
    finalizeDrawing,
    finalizeStroke,
    clearDrawingCanvas,
    startShapeDrawing,
    continueShapeDrawing,
    finalizeShapeDrawing,
    latestShapePressureRef,
    lastNonZeroShapePressureRef,
    latestShapePixelSizeRef,
    shapeMaxPressureRef,
    hadValidShapePressureRef,
    lastStablePressureRef,
    resetShapePressureState,
    updateShapePressure,
    computeShapePixelSize,
    setSimpleShapePreviewRenderer,
    shapePointsRef,
    isDrawingShapeRef,
    isSelectingDirectionRef,  // Export this so DrawingCanvas knows we're in direction selection mode
    beginStrokeSession,
    endStrokeSession,
    clearStrokeSession,
    startContinuousColorCycleAnimation,
    stopContinuousColorCycleAnimation,
    resumeColorCycleAfterInteraction,
    setFeedbackCallback,
    commitRasterOverlay,
    seedManualStrokeBoundingBox,
    coerceDragShapeToPolygon,
    updateDitherGradSamples
  };
}

export type DrawingHandlers = ReturnType<typeof useDrawingHandlers>;

export const __TESTING__ = {
  computeStrokeCapturePadding,
  resolveActiveCustomBrushData,
  dedupePolylineForSampling,
  computePolylineLength,
  computeAutoSampleStopsFromPolyline,
  computeDitherGradSampleStopsFromPolyline,
  MIN_AUTO_SAMPLE_PREVIEW_DISTANCE,
  AUTO_SAMPLE_MAX_STOPS,
  buildLostEdgePolygon
};
