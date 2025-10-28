import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useBrushEngineSimplified } from './useBrushEngineSimplified';
import { useUserBrushEngine } from './useUserBrushEngine';
import { BrushShape, type BrushSettings, type CustomBrush, type Layer, type CanvasSnapshot, type Tool } from '../types';
import { getRisographPattern } from '../utils/risographTexture';
import { shouldApplyGridSnapPure, snapToGridPure, calculateGridSpacing } from '../hooks/brushEngine/utilities';
import { shouldDrawStamp, createPixelQueue } from '../hooks/brushEngine/strokeProcessor';
import { getColorCycleBrushManager } from '../stores/colorCycleBrushManager';
import { appendSegmentWithDynamicResampling } from '../utils/shapeMaker';
import { logError, debugWarn } from '../utils/debug';
import { CC_DEBUG, ccGroup, ccGroupEnd, ccLog, dumpLayerFlags } from '@/debug/ccDebug';
import { FF } from '@/config/ccFeatureFlags';
import { RecolorManager } from '../lib/colorCycle/RecolorManager';
import { setSharedColorCycleGradient } from '../utils/colorCycleGradients';
import type { CCReason } from '../stores/useAppStore';
import {
  selectColorCycleDesiredPlaying,
  selectColorCycleSuspendDepth,
  selectEffectiveColorCyclePlaying,
  useAppStore
} from '../stores/useAppStore';
import type { ColorCycleBrushImplementation } from '@/hooks/brushEngine/ColorCycleBrushMigration';
import type { CustomBrushStrokeData } from './brushEngine/BrushEngineFacade';
import { FinalizeQueue } from '@/lib/canvas';
import { captureColorCycleBrushState } from '@/history/helpers/colorCycle';
import type { ColorCycleSerializedState } from '@/history/helpers/colorCycle';
import { commitLayerHistory } from '@/history/helpers/layerHistory';
import { markPendingColorCycleSaveEnd, markPendingColorCycleSaveStart, registerFinalizeQueue } from '@/stores/pendingColorCycleSaves';
import { perfMark, perfMeasure, timeAsync, timeSync } from '@/utils/perf/ccPerfProbe';
import { getMaskManager } from '@/layers/MaskManager';
import { BrushStampSource } from '@/tools/stamps/BrushStampSource';
import { EraserTool } from '@/tools/EraserTool';
import { unwrapAngle } from '@/utils/angles';

interface UseDrawingHandlersProps {
  project: { width: number; height: number } | null;
  screenToWorld: (x: number, y: number) => { x: number; y: number };
  viewTransformRef: React.MutableRefObject<{ scale: number; offsetX: number; offsetY: number }>;
  canvasRef: React.RefObject<HTMLCanvasElement>;
  isBusyRef?: React.MutableRefObject<boolean>;
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

type BoundingBox = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
};

type StampCmd = {
  x: number;
  y: number;
  pressure: number;
  rotation: number;
  customStamp?: CustomBrushStrokeData;
};

type CaptureRegion = { x: number; y: number; width: number; height: number };
type RecomposeRegion = { x: number; y: number; width: number; height: number };

type CommitRasterOverlayOptions = {
  layer: Layer;
  overlayCanvas: HTMLCanvasElement | null;
  beforeImage: ImageData | null;
  beforeColorState: ColorCycleSerializedState | null;
  historyAction: CanvasSnapshot['actionType'];
  historyDescription: string;
  tool: string;
  coalesce?: LayerHistoryPayload['coalesce'];
  bitmapRoi?: CaptureRegion;
  skipHistory?: boolean;
  skipBitmapDelta?: boolean;
};

const BRUSH_HISTORY_COALESCE_WINDOW_MS = 250;
const STOP_COOLDOWN_MS = 200;
const START_CC_TRACE_THROTTLE_MS = 2000;
const SYNTHETIC_STOP_THROTTLE_MS = 200;
const START_CC_COOLDOWN_MS = 200;
const SKIP_CC_LOG_THROTTLE_MS = 1000;
const HISTORY_FINALIZE_LANE = '__history__';

const ROTATION_DISTANCE_EPSILON = 1e-3;

const resolveBrushRotation = (
  rotationEnabled: boolean,
  dx: number,
  dy: number,
  distance: number,
  previousRotation: number | undefined
): { rotation: number; nextRotation: number | undefined } => {
  if (!rotationEnabled) {
    return { rotation: 0, nextRotation: undefined };
  }
  const baseRotation = Math.atan2(dy, dx);
  const rotation =
    distance >= ROTATION_DISTANCE_EPSILON
      ? unwrapAngle(previousRotation, baseRotation)
      : previousRotation ?? baseRotation;
  return { rotation, nextRotation: rotation };
};

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

const getDesiredColorCyclePlaying = () =>
  selectColorCycleDesiredPlaying(useAppStore.getState());

const getEffectiveColorCyclePlaying = () =>
  selectEffectiveColorCyclePlaying(useAppStore.getState());

const ensureCanvasPixelSize = (canvas: HTMLCanvasElement): void => {
  if (
    !canvas ||
    typeof window === 'undefined' ||
    typeof canvas.getBoundingClientRect !== 'function'
  ) {
    return;
  }
  const isConnected =
    typeof (canvas as { isConnected?: unknown }).isConnected === 'boolean'
      ? Boolean((canvas as { isConnected?: unknown }).isConnected)
      : true;
  if (!isConnected) {
    return;
  }
  const rect = canvas.getBoundingClientRect();
  if (!rect.width && !rect.height) {
    return;
  }
  const dpr = window.devicePixelRatio || 1;
  const targetWidth = Math.max(1, Math.round(rect.width * dpr));
  const targetHeight = Math.max(1, Math.round(rect.height * dpr));
  if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
    canvas.width = targetWidth;
    canvas.height = targetHeight;
  }
};

const bindBrushToCanvas = (
  brush: ColorCycleBrushImplementation | null | undefined,
  canvas: HTMLCanvasElement | null | undefined
): void => {
  if (!brush || !canvas) {
    return;
  }
  const brushWithTarget = brush as ColorCycleBrushImplementation & {
    setTargetCanvas?: (canvas: HTMLCanvasElement | null) => void;
  };
  if (typeof brushWithTarget.setTargetCanvas === 'function') {
    const isConnected =
      typeof (canvas as { isConnected?: unknown }).isConnected === 'boolean'
        ? Boolean((canvas as { isConnected?: unknown }).isConnected)
        : false;
    if (isConnected) {
      ensureCanvasPixelSize(canvas);
    }
    brushWithTarget.setTargetCanvas(canvas);
  }
};

const refreshLayerCCSurface = (
  brush: ColorCycleBrushImplementation,
  layerId: string
): HTMLCanvasElement | null => {
  const state = useAppStore.getState();
  const layer = state.layers.find((candidate) => candidate.id === layerId);
  if (!layer) {
    return null;
  }

  const storedCanvas = layer.colorCycleData?.canvas as HTMLCanvasElement | undefined;
  const liveCanvas = brush.getCanvas?.() as HTMLCanvasElement | undefined;

  if (liveCanvas && (!storedCanvas || storedCanvas !== liveCanvas)) {
    try {
      state.updateLayer(layerId, {
        colorCycleData: {
          ...(layer.colorCycleData ?? {}),
          canvas: liveCanvas
        }
      });
      return liveCanvas;
    } catch {
      // Ignore update failures; fall back to best-known canvas.
    }
  }

  return storedCanvas ?? liveCanvas ?? null;
};

const getShapeFillHistoryDescription = (): string => {
  const { shapeFill } = useAppStore.getState();
  const lastFinalize = shapeFill.lastFinalize;
  const label = lastFinalize?.strategy?.label?.trim();
  if (label) {
    return `Shape Fill: ${label}`;
  }
  const fillId = lastFinalize?.fillId;
  if (fillId) {
    return `Shape Fill: ${fillId}`;
  }
  return 'Shape Fill';
};

const lastSyntheticStopAtMap = new Map<string, number>();

type BrushStrokeSession = {
  id: string;
  pointerId: number | string;
  layerId: string | null;
  tool: string;
  brushId?: string | null;
  startedAt: number;
  endedAt?: number;
};

type BeginStrokeSessionOptions = {
  id?: string;
  pointerId: number | string;
  layerId: string | null;
  tool: string;
  brushId?: string | null;
  startedAt?: number;
};

const cloneImageData = (imageData: ImageData | null | undefined): ImageData | null => {
  if (!imageData) {
    return null;
  }
  return new ImageData(new Uint8ClampedArray(imageData.data), imageData.width, imageData.height);
};

const debugTime = (label: string) => {
  if (CC_DEBUG.on) {
    console.time(label);
  }
};

const debugTimeEnd = (label: string) => {
  if (CC_DEBUG.on) {
    console.timeEnd(label);
  }
};

const debugVerbose = (...args: Parameters<typeof console.debug>) => {
  if (CC_DEBUG.on) {
    console.debug(...args);
  }
};

const withTiming = async <T>(label: string, task: () => Promise<T>): Promise<T> => {
  debugTime(label);
  const startMark = `${label}:start`;
  const endMark = `${label}:end`;
  perfMark(startMark);
  try {
    const result = await timeAsync(label, task);
    return result;
  } finally {
    perfMark(endMark);
    perfMeasure(label, startMark, endMark);
    debugTimeEnd(label);
  }
};

const noopPromise = async () => {};

const ROI_PADDING_PX = 2;

const computeStrokeCapturePadding = (
  settings?: BrushSettings | null,
  customBrush?: CustomBrushStrokeData | null
): number => {
  if (!settings) {
    return 0;
  }

  const sliderSize = typeof settings.size === 'number' && Number.isFinite(settings.size)
    ? settings.size
    : 1;

  let effectiveSize = sliderSize;

  if (customBrush && !customBrush.isResampler) {
    const maxDimension = Math.max(customBrush.width ?? 0, customBrush.height ?? 0);
    if (Number.isFinite(maxDimension) && maxDimension > 0) {
      const scale = sliderSize / 100;
      effectiveSize = Math.max(1, maxDimension * (Number.isFinite(scale) ? scale : 1));
    }
  } else if (customBrush?.isResampler) {
    effectiveSize = Math.max(1, sliderSize);
  }

  if (settings.pressureEnabled) {
    const maxPressure = typeof settings.maxPressure === 'number' && Number.isFinite(settings.maxPressure)
      ? settings.maxPressure
      : undefined;
    if (typeof maxPressure === 'number') {
      effectiveSize = Math.max(effectiveSize, maxPressure);
    }
  }

  const radius = Math.max(1, effectiveSize) / 2;
  const antialiasPadding = settings.antialiasing ? 2 : 0;
  const softEdgePadding = settings.brushShape && (
    settings.brushShape === BrushShape.ROUND ||
    settings.brushShape === BrushShape.RISOGRAPH_SOFT ||
    settings.brushShape === BrushShape.RISOGRAPH_ULTRA
  ) ? 2 : 0;

  return radius + Math.max(antialiasPadding, softEdgePadding);
};

const createBoundingBox = (point: { x: number; y: number }): BoundingBox => ({
  minX: point.x,
  minY: point.y,
  maxX: point.x,
  maxY: point.y,
});

const expandBoundingBox = (bbox: BoundingBox, point: { x: number; y: number }): BoundingBox => ({
  minX: Math.min(bbox.minX, point.x),
  minY: Math.min(bbox.minY, point.y),
  maxX: Math.max(bbox.maxX, point.x),
  maxY: Math.max(bbox.maxY, point.y),
});

const mergeBoundingBox = (bbox: BoundingBox | null, point: { x: number; y: number }): BoundingBox =>
  bbox ? expandBoundingBox(bbox, point) : createBoundingBox(point);

const boundingBoxToCaptureRegion = (
  bbox: BoundingBox | null,
  padding: number,
  project: { width: number; height: number } | null
): CaptureRegion | undefined => {
  if (!bbox || !project) {
    return undefined;
  }
  const minX = Math.min(bbox.minX, bbox.maxX);
  const maxX = Math.max(bbox.minX, bbox.maxX);
  const minY = Math.min(bbox.minY, bbox.maxY);
  const maxY = Math.max(bbox.minY, bbox.maxY);
  if (
    !Number.isFinite(minX) ||
    !Number.isFinite(maxX) ||
    !Number.isFinite(minY) ||
    !Number.isFinite(maxY)
  ) {
    return undefined;
  }
  const pad = Math.max(0, padding);
  const x = Math.max(0, Math.floor(minX) - pad);
  const y = Math.max(0, Math.floor(minY) - pad);
  const right = Math.min(project.width, Math.ceil(maxX) + pad);
  const bottom = Math.min(project.height, Math.ceil(maxY) + pad);
  if (right <= x || bottom <= y) {
    return undefined;
  }
  return {
    x,
    y,
    width: Math.max(1, right - x),
    height: Math.max(1, bottom - y),
  };
};

const captureRegionFromPoints = (
  points: Array<{ x: number; y: number }> | undefined,
  padding: number,
  project: { width: number; height: number } | null
): CaptureRegion | undefined => {
  if (!points || points.length === 0) {
    return undefined;
  }
  let bbox = createBoundingBox(points[0]);
  for (let i = 1; i < points.length; i += 1) {
    const point = points[i];
    if (!point) {
      continue;
    }
    bbox = expandBoundingBox(bbox, point);
  }
  return boundingBoxToCaptureRegion(bbox, padding, project);
};

const isColorCycleLayerWithData = (
  layer: Layer | undefined | null
): layer is Layer & { colorCycleData: NonNullable<Layer['colorCycleData']> } =>
  Boolean(layer && layer.layerType === 'color-cycle' && layer.colorCycleData);

/**
 * Clips a line segment to a rectangular boundary.
 */
function clipLineSegment(
  p1: { x: number; y: number },
  p2: { x: number; y: number },
  rect: { x: number; y: number; width: number; height: number }
): [{ x: number; y: number }, { x: number; y: number }] | null {
  const x1 = p1.x, y1 = p1.y, x2 = p2.x, y2 = p2.y;
  const { x: xmin, y: ymin, width, height } = rect;
  const xmax = xmin + width;
  const ymax = ymin + height;

  let t0 = 0, t1 = 1;
  const dx = x2 - x1;
  const dy = y2 - y1;

  const checks = [
    { p: -dx, q: x1 - xmin },
    { p: dx, q: xmax - x1 },
    { p: -dy, q: y1 - ymin },
    { p: dy, q: ymax - y1 }
  ];

  for (const { p, q } of checks) {
    if (p === 0 && q < 0) return null;

    const r = q / p;
    if (p < 0) {
      if (r > t1) return null;
      if (r > t0) t0 = r;
    } else if (p > 0) {
      if (r < t0) return null;
      if (r < t1) t1 = r;
    }
  }

  return [
    { x: x1 + t0 * dx, y: y1 + t0 * dy },
    { x: x1 + t1 * dx, y: y1 + t1 * dy }
  ];
}

export function useDrawingHandlers({
  project,
  isBusyRef,
}: UseDrawingHandlersProps) {
  const brushEngine = useBrushEngineSimplified();
  const userBrushEngine = useUserBrushEngine();
  const { captureCanvasToActiveLayer, tools, activeLayerId } = useAppStore();
  
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
  const activeStrokeSessionRef = useRef<BrushStrokeSession | null>(null);
  const strokeBeforeColorStateRef = useRef<ColorCycleSerializedState | null>(null);
  const strokeBeforeImageRef = useRef<ImageData | null>(null);
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

  const commitRasterOverlay = useCallback(async (options: CommitRasterOverlayOptions) => {
    if (!project) {
      return;
    }

    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = project.width;
    tempCanvas.height = project.height;
    const tempCtx = tempCanvas.getContext('2d', {
      willReadFrequently: true,
      alpha: true,
    });

    if (!tempCtx) {
      return;
    }

    if (options.layer.imageData) {
      tempCtx.putImageData(options.layer.imageData, 0, 0);
    }

    if (options.overlayCanvas) {
      tempCtx.globalCompositeOperation = 'source-over';
      tempCtx.globalAlpha = 1;
      tempCtx.drawImage(options.overlayCanvas, 0, 0);
    }

    await withTiming('cc:capture', () =>
      captureCanvasToActiveLayer(tempCanvas, options.bitmapRoi)
    );

    tempCanvas.width = 1;
    tempCanvas.height = 1;
    const clearCtx = tempCanvas.getContext('2d');
    clearCtx?.clearRect(0, 0, 1, 1);

    if (options.skipHistory) {
      return;
    }

    await withTiming('cc:commit', () =>
      commitLayerHistory({
        layerId: options.layer.id,
        beforeImage: options.beforeImage,
        beforeColorState: options.beforeColorState,
        actionType: options.historyAction,
        description: options.historyDescription,
        tool: options.tool,
        coalesce: options.coalesce,
        bitmapRoi: options.bitmapRoi ?? undefined,
        skipBitmapDelta: options.skipBitmapDelta ?? false,
      })
    );
  }, [captureCanvasToActiveLayer, project]);
  const eraserRoiRef = useRef<{ x: number; y: number; width: number; height: number } | null>(null);
  const createBrushStampSource = useCallback(
    () =>
      new BrushStampSource({
        getState: useAppStore.getState,
        brushEngine,
        userBrushEngine,
        resolveCustomBrush: resolveActiveCustomBrushData
      }),
    [brushEngine, userBrushEngine]
  );
  const getBrushHalfSize = () => {
    const state = useAppStore.getState();
    const brushSize = state.tools.brushSettings.size ?? state.globalBrushSize;
    const eraserSettings = state.tools.eraserSettings;
    const effectiveSize =
      eraserSettings.linkSizeToBrush === false
        ? eraserSettings.size ?? brushSize
        : brushSize;
    return Math.max(1, effectiveSize ?? 1) / 2;
  };
  const getColorCycleBrushEraserSettings = useCallback(() => {
    const state = useAppStore.getState();
    const settings = state.tools.brushSettings;
    const flags = getColorCycleBrushFlags(settings);
    let customStamp = resolveActiveCustomBrushData(state);
    if (!customStamp && resamplerBrushDataRef.current) {
      customStamp = resamplerBrushDataRef.current;
    }
    const brushShape =
      settings.brushShape ??
      state.tools.lastRegularBrushShape ??
      BrushShape.ROUND;

    const baseSettings = {
      size: settings.size ?? state.globalBrushSize ?? 1,
      pressureEnabled: flags.isAny ? true : !!settings.pressureEnabled,
      minPressure: settings.minPressure ?? 50,
      maxPressure: settings.maxPressure ?? 200,
      brushShape
    };

    if (customStamp) {
      return { ...baseSettings, customStamp };
    }

    return baseSettings;
  }, []);

  const getCCStampTargetCtx = useCallback((): CanvasRenderingContext2D | null => {
    const st = useAppStore.getState();
    const layer = st.layers.find(l => l.id === st.activeLayerId);
    let layerCanvas = layer?.colorCycleData?.canvas;

    if (!layerCanvas && layer?.layerType === 'color-cycle' && st.project) {
      try {
        st.initColorCycleForLayer(layer.id, st.project.width, st.project.height);
      } catch {}
      layerCanvas = st.layers.find(l => l.id === st.activeLayerId)?.colorCycleData?.canvas;
    }

    if (layerCanvas) {
      const layerCtx = layerCanvas.getContext('2d');
      if (layerCtx) {
        return layerCtx;
      }
    }

    return drawingCtxRef.current;
  }, []);

  const beginStrokeSession = useCallback((options: BeginStrokeSessionOptions) => {
    const now = Date.now();
    const session: BrushStrokeSession = {
      id:
        options.id ??
        `stroke-${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      pointerId: options.pointerId,
      layerId: options.layerId,
      tool: options.tool,
      brushId: options.brushId,
      startedAt: options.startedAt ?? now,
    };
    activeStrokeSessionRef.current = session;
    return session;
  }, []);

  const endStrokeSession = useCallback((endedAt?: number) => {
    if (activeStrokeSessionRef.current) {
      activeStrokeSessionRef.current.endedAt = endedAt ?? Date.now();
    }
  }, []);

  const clearStrokeSession = useCallback(() => {
    activeStrokeSessionRef.current = null;
  }, []);

  const resetPolygonState = useCallback(() => {
    const setPolygonGradientState = useAppStore.getState().setPolygonGradientState;
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
  }, []);
  
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
  const colorCyclePixelQueue = useRef(createPixelQueue());
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

  // Finalization queue to prevent concurrent finalization operations
  const finalizeQueueRef = useRef(new FinalizeQueue());

  useEffect(() => {
    registerFinalizeQueue(finalizeQueueRef.current);
    return () => {
      registerFinalizeQueue(null);
    };
  }, []);

  const runIdle = useCallback((cb: () => void) => {
    if (typeof window !== 'undefined') {
      type RequestIdle = (callback: IdleRequestCallback, options?: IdleRequestOptions) => number;
      const requestIdle = (window as typeof window & { requestIdleCallback?: RequestIdle })
        .requestIdleCallback;
      if (typeof requestIdle === 'function') {
        requestIdle(() => cb(), { timeout: 60 });
        return;
      }
    }
    setTimeout(cb, 0);
  }, []);

  const runIdleAsync = useCallback(<T>(task: () => Promise<T> | T): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      runIdle(() => {
        try {
          Promise.resolve(task()).then(resolve, reject);
        } catch (error) {
          reject(error);
        }
      });
    }), [runIdle]);

  const scheduleDeferredColorCycleSave = useCallback(
    ({
      layerId,
      canvas,
      beforeColorState,
      afterColorState: providedAfterColorState,
      actionType,
      description,
      tool,
      coalesce,
      beforeImage = null,
      skipBitmapDelta = true,
      roi,
    }: DeferredColorCycleSaveOptions) => {
      markPendingColorCycleSaveStart(layerId);
      const shouldCaptureCanvas = !skipBitmapDelta;
      let sanitizedRoi: CaptureRegion | undefined;

      if (shouldCaptureCanvas && roi && project) {
        perfMark('cc:roi:start');
        sanitizedRoi = boundingBoxToCaptureRegion(
          {
            minX: roi.x,
            minY: roi.y,
            maxX: roi.x + roi.width,
            maxY: roi.y + roi.height,
          },
          0,
          project
        );
        perfMark('cc:roi:end');
        perfMeasure('cc:roi', 'cc:roi:start', 'cc:roi:end');
      }

      let nextAfterColorState: ColorCycleSerializedState | null = providedAfterColorState ?? null;

      const captureStage = async (): Promise<void> => {
        await runIdleAsync(async () => {
          if (shouldCaptureCanvas) {
            await withTiming('cc:capture', () => captureCanvasToActiveLayer(canvas, sanitizedRoi));
          }

          if (!nextAfterColorState) {
            perfMark('cc:state-serialize-after:start');
            debugTime('cc:state-serialize-after');
            nextAfterColorState = captureColorCycleBrushState(layerId);
            debugTimeEnd('cc:state-serialize-after');
            perfMark('cc:state-serialize-after:end');
            perfMeasure(
              'cc:state-serialize-after',
              'cc:state-serialize-after:start',
              'cc:state-serialize-after:end'
            );
          }

          debugVerbose('[cc-delta-capture]', {
            beforeBytes: beforeColorState?.layers?.[0]?.strokeData?.paintBuffer?.byteLength ?? -1,
            afterBytes: nextAfterColorState?.layers?.[0]?.strokeData?.paintBuffer?.byteLength ?? -1,
            beforeCtr: beforeColorState?.layers?.[0]?.strokeData?.strokeCounter ?? -1,
            afterCtr: nextAfterColorState?.layers?.[0]?.strokeData?.strokeCounter ?? -1,
          });
        });
      };

      const commitStage = async (): Promise<void> => {
        await runIdleAsync(async () => {
          await withTiming('cc:commit', () =>
            commitLayerHistory({
              layerId,
              beforeImage,
              beforeColorState,
              afterColorState: nextAfterColorState,
              actionType,
              description,
              tool,
              coalesce,
              skipBitmapDelta,
              bitmapRoi: sanitizedRoi ?? undefined,
            })
          );
        });
      };

      const scheduleError = (error: unknown) => {
        logError('Deferred color cycle save failed', error);
        markPendingColorCycleSaveEnd(layerId, error);
        if (process.env.NODE_ENV !== 'production') {
          console.error('[cc:defer] finalize queue rejected', error);
        }
      };

      runIdle(() => {
        try {
          const capturePromise = finalizeQueueRef.current.enqueue(captureStage, layerId);
          capturePromise
            .then(() => finalizeQueueRef.current.enqueue(commitStage, HISTORY_FINALIZE_LANE))
            .then(() => {
              markPendingColorCycleSaveEnd(layerId);
            })
            .catch(scheduleError);
        } catch (error) {
          scheduleError(error);
        }
      });
    },
    [captureCanvasToActiveLayer, project, runIdle, runIdleAsync]
  );


  // Auto-sample gradient (for color cycle brushes)
  const autoSamplePointsRef = useRef<Array<{ x: number; y: number }>>([]);
  const autoSampleLastUpdateRef = useRef<number>(0);

  const sampleHexAt = useCallback((x: number, y: number): string => {
    // Unify sampling for stroke and shape: always sample the composited canvas
    // so results reflect existing artwork, not the transient overlay.
    try {
      const toHex = (v: number) => v.toString(16).padStart(2, '0');

      const comp = useAppStore.getState().currentOffscreenCanvas;
      if (comp) {
        const ctx = comp.getContext('2d', { willReadFrequently: true });
        if (ctx) {
          const clampedX = Math.max(0, Math.min(comp.width - 1, Math.floor(x)));
          const clampedY = Math.max(0, Math.min(comp.height - 1, Math.floor(y)));
          const img = ctx.getImageData(clampedX, clampedY, 1, 1);
          let [r, g, b] = img.data;
          const a = img.data[3];
          if (a < 10) return '#ffffff';
          if (r <= 30 && g <= 30 && b <= 30) { r = 0; g = 0; b = 0; }
          if (r >= 225 && g >= 225 && b >= 225) { r = 255; g = 255; b = 255; }
          return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
        }
      }

      // Fallback: if offscreen composite is unavailable, try overlay as a last resort
      const overlay = drawingCanvasRef.current;
      if (overlay) {
        const octx = overlay.getContext('2d', { willReadFrequently: true });
        if (octx) {
          const clampedX = Math.max(0, Math.min(overlay.width - 1, Math.floor(x)));
          const clampedY = Math.max(0, Math.min(overlay.height - 1, Math.floor(y)));
          const img = octx.getImageData(clampedX, clampedY, 1, 1);
          let [r, g, b] = img.data;
          const a = img.data[3];
          if (a > 10) {
            if (r <= 30 && g <= 30 && b <= 30) { r = 0; g = 0; b = 0; }
            if (r >= 225 && g >= 225 && b >= 225) { r = 255; g = 255; b = 255; }
            return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
          }
        }
      }
    } catch {}
    return '#ffffff';
  }, []);

  const equidistantPointsOnPolyline = useCallback((pts: Array<{ x: number; y: number }>, count: number) => {
    if (pts.length === 0) return [] as Array<{ x: number; y: number }>;
    if (pts.length === 1 || count === 1) return [pts[0]];
    // Deduplicate nearly-identical consecutive points to avoid zero-length total
    const deduped: Array<{ x: number; y: number }> = [];
    const EPS = 0.25; // ~subpixel tolerance
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      const last = deduped[deduped.length - 1];
      if (!last || Math.hypot(p.x - last.x, p.y - last.y) > EPS) {
        deduped.push(p);
      }
    }
    if (deduped.length === 0) return [];
    if (deduped.length === 1) return [deduped[0]];
    // Compute cumulative lengths
    const segLens: number[] = [];
    let total = 0;
    for (let i = 0; i < deduped.length - 1; i++) {
      const dx = deduped[i + 1].x - deduped[i].x;
      const dy = deduped[i + 1].y - deduped[i].y;
      const len = Math.hypot(dx, dy);
      segLens.push(len);
      total += len;
    }
    if (total === 0) return [deduped[0]];
    const result: Array<{ x: number; y: number }> = [];
    for (let i = 0; i < count; i++) {
      const d = (i / Math.max(1, count - 1)) * total;
      // Find segment containing this distance
      let acc = 0;
      let segIndex = 0;
      while (segIndex < segLens.length && acc + segLens[segIndex] < d) {
        acc += segLens[segIndex];
        segIndex++;
      }
      if (segIndex >= segLens.length) {
        result.push(deduped[deduped.length - 1]);
        continue;
      }
      const segStart = deduped[segIndex];
      const segEnd = deduped[segIndex + 1];
      const segLen = segLens[segIndex] || 1;
      const t = (d - acc) / segLen;
      result.push({ x: segStart.x + (segEnd.x - segStart.x) * t, y: segStart.y + (segEnd.y - segStart.y) * t });
    }
    return result;
  }, []);

  const updateAutoSampledGradient = useCallback((sourcePts: Array<{ x: number; y: number }>) => {
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    if (now - autoSampleLastUpdateRef.current < 120) return; // throttle ~8fps
    autoSampleLastUpdateRef.current = now;

    // Dynamically choose sample count based on total path length so preview builds up quickly
    // Compute polyline length with basic dedupe to avoid zero-length segments
    const EPS = 0.25;
    let last = null as { x: number; y: number } | null;
    let totalLen = 0;
    for (let i = 0; i < sourcePts.length; i++) {
      const p = sourcePts[i];
      if (!last) { last = p; continue; }
      const dx = p.x - last.x; const dy = p.y - last.y;
      const d = Math.hypot(dx, dy);
      if (d > EPS) {
        totalLen += d;
        last = p;
      }
    }
    const maxStops = 6;
    const dynamicCount = Math.min(maxStops, Math.max(2, Math.floor(totalLen / 64) + 2));
    const samplePts = equidistantPointsOnPolyline(sourcePts, dynamicCount);
    if (samplePts.length === 0) return;

    const colors = samplePts.map(p => sampleHexAt(p.x, p.y));
    // Build gradient stops spaced 0..1
    const stops = colors.map((c, i) => ({ position: samplePts.length === 1 ? 0 : i / (samplePts.length - 1), color: c }));
    const store = useAppStore.getState();
    // Avoid redundant updates
    const current = store.tools.brushSettings.colorCycleGradient || [];
    const same = JSON.stringify(current) === JSON.stringify(stops);
    if (same) return;

    // Ensure we have enough bands to display distinct sampled colors
    try {
      const gb = store.tools.brushSettings.gradientBands || 0;
      if (gb < stops.length) {
        store.setBrushSettings({ gradientBands: stops.length });
      }
    } catch {}

    // Use shared setter to propagate to tools + active CC layer consistently
    try {
      setSharedColorCycleGradient(stops);
    } catch {
      // Fallback: update brush and active layer directly
      store.setBrushSettings({ colorCycleGradient: stops });
      const activeId = store.activeLayerId;
      if (activeId) {
        const layer = store.layers.find(l => l.id === activeId);
        if (layer && layer.layerType === 'color-cycle') {
          const updatedColorCycleData: Layer['colorCycleData'] = {
            ...(layer.colorCycleData ?? {}),
            gradient: stops,
            isAnimating: layer.colorCycleData?.isAnimating ?? false,
          };
          store.updateLayer(activeId, { colorCycleData: updatedColorCycleData });
        }
      }
    }

    // Also push updated gradient into the active ColorCycle brush instance
    try {
      brushEngine.updateColorCycleGradient?.(stops);
    } catch {}
  }, [brushEngine, equidistantPointsOnPolyline, sampleHexAt]);

  // Track which CC layers were animating so we can resume them after interaction
  const pausedCCLayerIdsRef = useRef<string[]>([]);
  const recolorWasAnimatingRef = useRef<boolean>(false);
  const shouldResumeColorCycleAfterInteractionRef = useRef<boolean>(false);
  // Tracks if we've already paused for the current CC shape preview
  const ccShapePreviewPauseStartedRef = useRef<boolean>(false);

  // Helper: pause animation for all brush-based CC layers and remember which were playing
  const pauseAllBrushCCAnimationsNow = useCallback(() => {
    ccGroup('pauseAllBrushCCAnimationsNow()');
    dumpLayerFlags();
    const state = useAppStore.getState();
    const toResume: string[] = [];
    state.layers.forEach(layer => {
      if (layer.layerType === 'color-cycle' && layer.colorCycleData?.mode !== 'recolor') {
        if (layer.colorCycleData?.isAnimating) {
          toResume.push(layer.id);
        }
        // Flip flag off
        const updatedColorCycleData: Layer['colorCycleData'] = {
          ...(layer.colorCycleData ?? {}),
          isAnimating: false,
        };
        state.updateLayer(layer.id, { colorCycleData: updatedColorCycleData });
        ccLog('pause layer', { id: layer.id.slice(-6) });
        // Pause brush animator instance if present
        try {
          const mgr = getColorCycleBrushManager();
          const brush = mgr.getBrush(layer.id);
          brush?.pause?.();
          brush?.stopAnimation?.();
        } catch {}
      }
    });
    
    // Stop any global continuous loop (defensive)
    if (continuousColorCycleAnimationRef.current) {
      continuousColorCycleAnimationActiveRef.current = false;
      cancelAnimationFrame(continuousColorCycleAnimationRef.current);
      continuousColorCycleAnimationRef.current = null;
      ccLog('cancel global RAF (pause helper)');
      if (typeof window !== 'undefined') {
        window.__ccRafAlive = false;
      }
    }
    
    // Also pause recolor animation if active
    try {
      const rm = RecolorManager.getInstance();
      recolorWasAnimatingRef.current = rm.isAnimating();
      if (recolorWasAnimatingRef.current) {
        rm.pause();
        ccLog('pause recolor manager');
      }
      
    } catch {}
    // Check global brush play state (toolbar) so we can resume even if no per-layer flags were set
    let globalShouldResume = false;
    try {
      globalShouldResume = getEffectiveColorCyclePlaying();
    } catch {}
    // Record and report state
    pausedCCLayerIdsRef.current = toResume;
    const result = toResume.length > 0 || globalShouldResume || recolorWasAnimatingRef.current;
    ccLog('pauseAllBrushCCAnimationsNow result', {
      toResume: toResume.map(id => id.slice(-6)),
      globalShouldResume,
      recolorWasAnimating: recolorWasAnimatingRef.current,
      result
    });
    ccGroupEnd();
    return result;
  }, []);

  const pauseColorCycleForNonCCInteraction = useCallback((reason: CCReason = 'shape-preview') => {
    if (shouldResumeColorCycleAfterInteractionRef.current) {
      ccLog('pauseColorCycleForNonCCInteraction: already scheduled resume');
      return;
    }

    const state = useAppStore.getState();
    const shape = state.tools.brushSettings.brushShape;
    const isCCBrush =
      shape === BrushShape.COLOR_CYCLE ||
      shape === BrushShape.COLOR_CYCLE_TRIANGLE ||
      shape === BrushShape.COLOR_CYCLE_SHAPE ||
      (shape === BrushShape.CUSTOM && !!state.tools.brushSettings.customBrushColorCycle);

    if (isCCBrush) {
      ccLog('pauseColorCycleForNonCCInteraction skipped (cc brush)', { shape });
      return;
    }

    const wasPlaying = getEffectiveColorCyclePlaying();
    ccLog('pauseColorCycleForNonCCInteraction', { wasPlaying, reason });
    const pausedAny = pauseAllBrushCCAnimationsNow();
    ccLog('pauseColorCycleForNonCCInteraction -> pauseAllBrush', { pausedAny });

    if (wasPlaying) {
      shouldResumeColorCycleAfterInteractionRef.current = true;
      ccLog('pauseColorCycleForNonCCInteraction: suspending playback', { reason });
      useAppStore.getState().suspendColorCycle(reason);
    }
  }, [pauseAllBrushCCAnimationsNow]);

  const resumeColorCycleAfterInteraction = useCallback(async () => {
    ccGroup('resumeColorCycleAfterInteraction()');
    const shouldResume = shouldResumeColorCycleAfterInteractionRef.current;
    const globalIsPlaying = getEffectiveColorCyclePlaying();
    ccLog('state', { shouldResume, globalIsPlaying });

    if (!shouldResume) {
      ccGroupEnd();
      return;
    }

    shouldResumeColorCycleAfterInteractionRef.current = false;

    const st = useAppStore.getState();
    const suspendDepth = selectColorCycleSuspendDepth(st);
    if (suspendDepth > 1) {
      st.forceResumeColorCycle('shape-preview');
      ccLog('forceResumeColorCycle', { suspendDepth });
    } else {
      st.resumeColorCycle('shape-preview');
      ccLog('resumeColorCycle', { suspendDepth });
    }
    ccGroupEnd();
  }, []);

  // Helper: resume previously paused brush-based CC layers
  // NOTE: Currently unused because global playback flow handles resume/restoration.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const resumePausedBrushCCAnimations = useCallback(() => {
    const state = useAppStore.getState();
    const mgr = getColorCycleBrushManager();
    const ids = pausedCCLayerIdsRef.current;
    let resumedAny = false;

    if (ids && ids.length > 0) {
      ids.forEach(id => {
        try {
          const layer = state.layers.find(l => l.id === id);
          if (!layer) return;
          const updatedColorCycleData: Layer['colorCycleData'] = {
            ...(layer.colorCycleData ?? {}),
            isAnimating: true,
          };
          state.updateLayer(id, { colorCycleData: updatedColorCycleData });
          const brush = mgr.getBrush(id);
          brush?.startAnimation?.();
          resumedAny = true;
        } catch {}
      });
    }
    pausedCCLayerIdsRef.current = [];

    // Resume recolor animation if it was playing
    if (recolorWasAnimatingRef.current) {
      try {
        RecolorManager.getInstance().resume();
        resumedAny = true;
      } catch {}
      recolorWasAnimatingRef.current = false;
    }

    const globalIsPlaying = getEffectiveColorCyclePlaying();

    if (globalIsPlaying) {
      const ccLayers = state.layers.filter(layer => layer.layerType === 'color-cycle' && layer.colorCycleData?.mode !== 'recolor');
      ccLayers.forEach(layer => {
        const wasAnimating = !!layer.colorCycleData?.isAnimating;
        if (!wasAnimating) {
          const resumedData: Layer['colorCycleData'] = {
            ...(layer.colorCycleData ?? {}),
            isAnimating: true,
          };
          state.updateLayer(layer.id, { colorCycleData: resumedData });
        }
        try {
          const brush = mgr.getBrush(layer.id);
          brush?.startAnimation?.();
        } catch {}
      });
      if (ccLayers.length > 0) {
        resumedAny = true;
      }
    }

    if (resumedAny || globalIsPlaying) {
      // Store-driven playback will notify subscribers.
    }
  }, []);

  // Stop continuous color cycle animation AND pause it (applies to all brush-based CC layers)
  const stopContinuousColorCycleAnimationCore = useCallback((reason = 'unknown') => {
    let isCCBrushActive = false;
    try {
      const st = useAppStore.getState();
      const brushShape = st.tools.brushSettings.brushShape;
      isCCBrushActive =
        brushShape === BrushShape.COLOR_CYCLE ||
        brushShape === BrushShape.COLOR_CYCLE_TRIANGLE ||
        brushShape === BrushShape.COLOR_CYCLE_SHAPE ||
        (brushShape === BrushShape.CUSTOM && !!st.tools.brushSettings.customBrushColorCycle);
    } catch {}

    if (SYNTHETIC_CC_STOP_REASONS.has(reason)) {
      try {
        const st = useAppStore.getState();
        const shape = st.tools.brushSettings.brushShape;
        const isCCShape = shape === BrushShape.COLOR_CYCLE_SHAPE;
        if (isCCShape && (reason === 'shape-tool-start' || reason === 'shape-tool-drag')) {
          ccLog('skip synthetic stop for CC shape', { reason });
          return;
        }
      } catch {}

      const now =
        typeof performance !== 'undefined' && typeof performance.now === 'function'
          ? performance.now()
          : Date.now();
      const last = lastSyntheticStopAtMap.get(reason) ?? 0;
      if (now - last < SYNTHETIC_STOP_THROTTLE_MS) {
        ccLog('skip synthetic stop (throttled)', { reason });
        return;
      }
      lastSyntheticStopAtMap.set(reason, now);

      ccLog('stopContinuousColorCycleAnimation synthetic stop', { reason });

      continuousColorCycleAnimationActiveRef.current = false;
      if (continuousColorCycleAnimationRef.current) {
        cancelAnimationFrame(continuousColorCycleAnimationRef.current);
        continuousColorCycleAnimationRef.current = null;
        ccLog('cancel global RAF (synthetic)', { reason });
      }
      if (colorCycleAnimationRef.current) {
        cancelAnimationFrame(colorCycleAnimationRef.current);
        colorCycleAnimationRef.current = null;
        ccLog('cancel per-stroke RAF (synthetic)', { reason });
      }
      if (typeof window !== 'undefined') {
        window.__ccRafAlive = false;
      }

      const pausedAny = pauseAllBrushCCAnimationsNow();
      ccLog('pauseAllBrushCCAnimationsNow() (synthetic)', { pausedAny, reason });

      try {
        if (!shouldResumeColorCycleAfterInteractionRef.current) {
          const st = useAppStore.getState();
          const wasPlaying = selectEffectiveColorCyclePlaying(st);
          if (wasPlaying) {
            st.suspendColorCycle(reason as CCReason);
            shouldResumeColorCycleAfterInteractionRef.current = true;
            ccLog('suspendColorCycle (synthetic)', { reason });
          }
        }
      } catch {}

      try {
        if (drawingCtxRef.current && drawingCanvasRef.current) {
          drawingCtxRef.current.clearRect(
            0,
            0,
            drawingCanvasRef.current.width,
            drawingCanvasRef.current.height
          );
          ccLog('cleared overlay canvas (synthetic)', { reason });
        }
      } catch {}
      drawingCanvasHasContent.current = false;

      try {
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('colorCycleFrameUpdate'));
          ccLog('dispatched colorCycleFrameUpdate (synthetic)', { reason });
        }
      } catch {}

      return;
    }

    if (!isCCBrushActive && reason === 'unknown') {
      ccLog('stopContinuousColorCycleAnimation skipped (unknown reason, no CC brush)', { reason });
      return;
    }

    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const bypassCooldown = reason === 'store-sync' || reason === 'toolbar';
    if (!bypassCooldown && now - lastStopAtRef.current < STOP_COOLDOWN_MS) {
      ccLog('stopContinuousColorCycleAnimation skipped (cooldown)', {
        reason,
        sinceLast: now - lastStopAtRef.current
      });
      return;
    }
    lastStopAtRef.current = now;

    ccGroup('stopContinuousColorCycleAnimation()', { reason });
    dumpLayerFlags();
    const pausedAny = pauseAllBrushCCAnimationsNow();
    ccLog('pauseAllBrushCCAnimationsNow()', { pausedAny, reason });

    const shouldAutoResume =
      reason === 'brush-stroke' ||
      reason === 'shape-preview' ||
      reason === 'history-apply' ||
      reason === 'visibility-hidden' ||
      reason === 'layer-switch';

    if (pausedAny && shouldAutoResume) {
      shouldResumeColorCycleAfterInteractionRef.current = true;
    }

    continuousColorCycleAnimationActiveRef.current = false;
    if (continuousColorCycleAnimationRef.current) {
      cancelAnimationFrame(continuousColorCycleAnimationRef.current);
      continuousColorCycleAnimationRef.current = null;
      ccLog('cancel global RAF', { reason });
    }
    if (typeof window !== 'undefined') {
      window.__ccRafAlive = false;
    }
    if (colorCycleAnimationRef.current) {
      cancelAnimationFrame(colorCycleAnimationRef.current);
      colorCycleAnimationRef.current = null;
      ccLog('cancel per-stroke RAF', { reason });
    }

    // Ensure store flags reflect paused state so overlay preview can render
    try {
      const st = useAppStore.getState();
      st.layers.forEach(layer => {
        const shouldPause =
          layer.layerType === 'color-cycle' &&
          layer.colorCycleData?.mode !== 'recolor' &&
          layer.colorCycleData?.isAnimating;

        if (!shouldPause || !layer.colorCycleData) {
          return;
        }

        const updatedData: Layer['colorCycleData'] = {
          ...layer.colorCycleData,
          isAnimating: false,
        };

        st.updateLayer(layer.id, { colorCycleData: updatedData });
        ccLog('mark isAnimating=false', { id: layer.id.slice(-6), reason });
      });
    } catch {}

    // Clear the overlay drawing canvas so CC frames don't sit above the layer stack
    try {
      if (drawingCtxRef.current && drawingCanvasRef.current) {
        drawingCtxRef.current.clearRect(
          0,
          0,
          drawingCanvasRef.current.width,
          drawingCanvasRef.current.height
        );
        ccLog('cleared overlay canvas', { reason });
      }
    } catch {}

    // Mark no overlay content; rely on compositeLayersToCanvas for final display
    drawingCanvasHasContent.current = false;
    ccLog('drawingCanvasHasContent -> false', { reason });

    // Ask the main canvas to recompose with current layer order
    try {
      window.dispatchEvent(new CustomEvent('colorCycleFrameUpdate'));
      ccLog('dispatched colorCycleFrameUpdate', { reason });
    } catch {}
    ccGroupEnd();

    if (reason === 'store-sync' || reason === 'toolbar') {
      try {
        const st = useAppStore.getState();
        const depth = selectColorCycleSuspendDepth(st);
        if (depth > 0) {
          st.forceResumeColorCycle('toolbar');
        }
        st.pauseColorCycle?.('toolbar');
      } catch {}
    }
  }, [pauseAllBrushCCAnimationsNow]);

  // DEBUG ONLY
  const stopContinuousColorCycleAnimation = useCallback((reason = 'unknown') => {
    if (CC_DEBUG.on) {
      try {
        console.groupCollapsed('[CC:TRACE] stopContinuousColorCycleAnimation', { reason });
        console.log(new Error('stopContinuousColorCycleAnimation').stack);
        console.groupEnd();
      } catch {}
    }
    return stopContinuousColorCycleAnimationCore(reason);
  }, [stopContinuousColorCycleAnimationCore]);

  const initDrawingCanvas = useCallback(() => {
    let width = project?.width ?? 0;
    let height = project?.height ?? 0;

    if (!width || !height) {
      try {
        const state = useAppStore.getState();
        const ccLayer = state.layers.find(layer => (
          layer.layerType === 'color-cycle' &&
          layer.colorCycleData?.canvas
        ));
        if (ccLayer?.colorCycleData?.canvas) {
          width = ccLayer.colorCycleData.canvas.width || width;
          height = ccLayer.colorCycleData.canvas.height || height;
        }
      } catch {}
    }

    if (!width || !height) {
      try {
        const state = useAppStore.getState();
        const activeLayer = state.layers.find(layer => layer.id === state.activeLayerId);
        const framebuffer = activeLayer?.framebuffer as { width?: number; height?: number } | undefined;
        if (framebuffer?.width && framebuffer?.height) {
          width = framebuffer.width || width;
          height = framebuffer.height || height;
        }
      } catch {}
    }

    if (!width || !height) {
      width = 64;
      height = 64;
    }

    if (!drawingCanvasRef.current) {
      drawingCanvasRef.current = document.createElement('canvas');
    }

    if (drawingCanvasRef.current.width !== width || drawingCanvasRef.current.height !== height) {
      drawingCanvasRef.current.width = width;
      drawingCanvasRef.current.height = height;
    }

    drawingCtxRef.current = drawingCanvasRef.current.getContext('2d', {
      willReadFrequently: true,
      alpha: true,
      desynchronized: true
    });
  }, [project]);

  const ensureOverlayInitialized = useCallback(() => {
    if (!drawingCtxRef.current || !drawingCanvasRef.current) {
      initDrawingCanvas();
    }
    return Boolean(drawingCtxRef.current && drawingCanvasRef.current);
  }, [initDrawingCanvas]);

  useEffect(() => {
    ensureOverlayInitialized();
  }, [ensureOverlayInitialized]);

  // OPTIMIZATION: Helper function to draw an eraser segment. Using a stroked
  // line is often faster than stamping multiple circles.
  const drawEraserSegment = useCallback((
    ctx: CanvasRenderingContext2D,
    p1: { x: number; y: number },
    p2: { x: number; y: number }
  ) => {
    const { tools } = useAppStore.getState();
    const eraserSize =
      tools.eraserSettings.size ??
      tools.brushSettings.size ??
      20;
    const opacity = tools.eraserSettings.opacity || 1;

    ctx.lineWidth = eraserSize * 2; // Diameter to match circle-based approach
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    // The "color" of the eraser determines its strength. Black with opacity.
    ctx.strokeStyle = `rgba(0, 0, 0, ${opacity})`;
    
    ctx.beginPath();
    ctx.moveTo(p1.x, p1.y);
    ctx.lineTo(p2.x, p2.y);
    ctx.stroke();
  }, []);
  
  const startDrawing = useCallback((worldPos: { x: number; y: number }, pressure: number = 0.5) => {
    // removed debug log
    const currentState = useAppStore.getState();
    const currentTool = currentState.tools.currentTool;
    const currentBrushId = currentState.currentBrushPreset?.id;
    const brushSettings = currentState.tools.brushSettings;
    const ccFlags = getColorCycleBrushFlags(brushSettings);


    // Early return if no project
    if (!project) return;

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
          const colorCycleBrushManager = getColorCycleBrushManager();
          if (!colorCycleBrushManager.getBrush(activeLayer.id)) {
            currentState.initColorCycleForLayer(activeLayer.id, project.width, project.height);
          }

          const brushGradient = currentState.tools.brushSettings.colorCycleGradient;
          const brushGradientVersion = currentState.tools.brushSettings.colorCycleGradientVersion ?? null;
          const layerGradient = activeLayer.colorCycleData?.gradient;
          const layerGradientVersion = activeLayer.colorCycleData?.gradientVersion ?? null;
          const layerGradientFingerprint =
            layerGradient && layerGradientVersion == null ? JSON.stringify(layerGradient) : null;
          const brushGradientFingerprint =
            brushGradient && brushGradientVersion == null ? JSON.stringify(brushGradient) : null;
          const gradientsMatch =
            !brushGradient ||
            !layerGradient
              ? brushGradient === layerGradient
              : brushGradientVersion != null && layerGradientVersion != null
                ? brushGradientVersion === layerGradientVersion
                : brushGradientFingerprint === layerGradientFingerprint;

          if (brushGradient && !gradientsMatch) {
            const nextVersion =
              brushGradientVersion ??
              ((activeLayer.colorCycleData?.gradientVersion ?? 0) + 1);
            try {
              currentState.updateLayer(activeLayer.id, {
                colorCycleData: {
                  ...(activeLayer.colorCycleData ?? {}),
                  gradient: brushGradient,
                  gradientVersion: nextVersion
                }
              });
            } catch {}
            try {
              brushEngine.updateColorCycleGradient?.(brushGradient);
            } catch {}
          }
        }
      }
    }
    
    // Capture "before" state BEFORE any stroke data is written
    const activeLayerForCapture = currentState.layers.find(l => l.id === currentState.activeLayerId);
    const shouldSkipStrokeBitmapClone =
      FF.CC_HISTORY_NO_BITMAP &&
      activeLayerForCapture?.layerType === 'color-cycle' &&
      ccFlags.isAny;
    strokeBeforeImageRef.current = shouldSkipStrokeBitmapClone
      ? null
      : cloneImageData(activeLayerForCapture?.imageData ?? null);

    // Ensure CC brush exists before capturing state
    if (activeLayerForCapture?.layerType === 'color-cycle') {
      const colorCycleBrushManager = getColorCycleBrushManager();
      if (!colorCycleBrushManager.getBrush(activeLayerForCapture.id)) {
        currentState.initColorCycleForLayer(activeLayerForCapture.id, project.width, project.height);
      }

      try {
        const refreshedState = useAppStore.getState();
        const refreshedLayer = refreshedState.layers.find(l => l.id === refreshedState.activeLayerId);
        const brushGradient = refreshedState.tools.brushSettings.colorCycleGradient;
        if (refreshedLayer?.layerType === 'color-cycle' && brushGradient) {
          const brushGradientVersion = refreshedState.tools.brushSettings.colorCycleGradientVersion ?? null;
          const existingGradient = refreshedLayer.colorCycleData?.gradient;
          const existingVersion = refreshedLayer.colorCycleData?.gradientVersion ?? null;
          const existingFingerprint =
            existingGradient && existingVersion == null ? JSON.stringify(existingGradient) : null;
          const brushFingerprint =
            brushGradient && brushGradientVersion == null ? JSON.stringify(brushGradient) : null;
          const gradientsMatch =
            !existingGradient ||
            !brushGradient
              ? existingGradient === brushGradient
              : brushGradientVersion != null && existingVersion != null
                ? brushGradientVersion === existingVersion
                : brushFingerprint === existingFingerprint;

          if (brushGradient && !gradientsMatch) {
            refreshedState.updateLayer(refreshedLayer.id, {
              colorCycleData: {
                ...(refreshedLayer.colorCycleData ?? {}),
                gradient: brushGradient,
                gradientVersion:
                  brushGradientVersion ??
                  ((refreshedLayer.colorCycleData?.gradientVersion ?? 0) + 1)
              }
            });
            try {
              brushEngine.updateColorCycleGradient?.(brushGradient);
            } catch {}
          }
        }

        const desiredPlaying = selectColorCycleDesiredPlaying(refreshedState);
        const effectivePlaying = selectEffectiveColorCyclePlaying(refreshedState);
        const lastReason = refreshedState.colorCyclePlayback.lastReason;
        if (!desiredPlaying && !effectivePlaying && (lastReason === 'startup' || lastReason === 'auto-start')) {
          refreshedState.playColorCycle('auto-start');
        }

        const rafAlive =
          typeof window !== 'undefined' &&
          ((window as typeof window & { __ccRafAlive?: boolean }).__ccRafAlive === true);
        const postState = useAppStore.getState();
        const shouldBePlaying = selectEffectiveColorCyclePlaying(postState);
        if (shouldBePlaying && !rafAlive) {
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

    initDrawingCanvas();

    // Initialize auto-sampling for color cycle stroke
    try {
      const isCCStroke = ccFlags.isAny;
      const autoSample = !!currentState.tools.brushSettings.autoSampleGradient;
      if (isCCStroke && autoSample) {
        autoSamplePointsRef.current = [worldPos];
        autoSampleLastUpdateRef.current = 0;
        // Apply an initial sample immediately (single point)
        updateAutoSampledGradient(autoSamplePointsRef.current);
      }
    } catch {}
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
      try {
        colorCyclePixelQueue.current?.flushNow();
      } catch {}
      colorCyclePixelQueue.current = createPixelQueue();
      try {
        colorCyclePixelQueue.current?.flushNow();
      } catch {}

      // Always arm the brush so parametric counters advance even when global play is active
      brushEngine.resetColorCycle();

      if (!shouldAnimateLive) {
        colorCycleAnimationRef.current = null;
      }
    }
    
    // Reset stamp counter for continuous sampling
    stampCounterRef.current = 0;
    const drawCtx = drawingCtxRef.current;
    if (!drawCtx || !drawingCanvasRef.current || !project) return;
      
    drawCtx.clearRect(0, 0, drawingCanvasRef.current.width, drawingCanvasRef.current.height);
    drawingCanvasHasContent.current = !(ccFlags.isAny && colorCyclePlayingAtStrokeStart);
    lastDrawPosRef.current = worldPos;

    if (currentState.palette.activeSlot === 'foreground') {
      const paletteColor = currentState.palette.foregroundColor;
      if (currentTool === 'brush') {
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

          const brushGradient = currentState.tools.brushSettings.colorCycleGradient;
          const brushGradientVersion = currentState.tools.brushSettings.colorCycleGradientVersion ?? null;
          const layerGradient = activeLayer.colorCycleData?.gradient;
          const layerGradientVersion = activeLayer.colorCycleData?.gradientVersion ?? null;
          const layerGradientFingerprint =
            layerGradient && layerGradientVersion == null ? JSON.stringify(layerGradient) : null;
          const brushGradientFingerprint =
            brushGradient && brushGradientVersion == null ? JSON.stringify(brushGradient) : null;
          const gradientsMatch =
            !brushGradient ||
            !layerGradient
              ? brushGradient === layerGradient
              : brushGradientVersion != null && layerGradientVersion != null
                ? brushGradientVersion === layerGradientVersion
                : brushGradientFingerprint === layerGradientFingerprint;

          if (!gradientsMatch && brushGradient) {
            try {
              currentState.updateLayer(activeLayer.id, {
                colorCycleData: {
                  ...(activeLayer.colorCycleData ?? {}),
                  gradient: brushGradient,
                  gradientVersion:
                    brushGradientVersion ??
                    ((activeLayer.colorCycleData?.gradientVersion ?? 0) + 1)
                }
              });
            } catch {}
            try {
              brushEngine.updateColorCycleGradient?.(brushGradient);
            } catch {}
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
          const brushSize = currentState.tools.brushSettings.size || 20;
          const halfSize = brushSize / 2;
          
          
          const compositeCanvas = currentState.currentOffscreenCanvas;
          if (compositeCanvas) {
            // Calculate bounds exactly like CustomBrushPanel
            const minX = Math.floor(worldPos.x - halfSize);
            const minY = Math.floor(worldPos.y - halfSize);
            const maxX = Math.floor(worldPos.x + halfSize);
            const maxY = Math.floor(worldPos.y + halfSize);
            
            // Clamp to canvas bounds
            const sampleX = Math.max(0, minX);
            const sampleY = Math.max(0, minY);
            const sampleEndX = Math.min(compositeCanvas.width, maxX);
            const sampleEndY = Math.min(compositeCanvas.height, maxY);
            const width = sampleEndX - sampleX;
            const height = sampleEndY - sampleY;
            
            if (width > 0 && height > 0) {
              // Create canvas to capture the selection - EXACTLY like CustomBrushPanel
              const captureCanvas = document.createElement('canvas');
              captureCanvas.width = width;
              captureCanvas.height = height;
              const captureCtx = captureCanvas.getContext('2d', { willReadFrequently: true });
              
              if (captureCtx) {
                // Capture the selection area from the composite canvas
                try {
                  captureCtx.drawImage(
                    compositeCanvas,
                    sampleX, sampleY, width, height, // Source rectangle
                    0, 0, width, height              // Destination rectangle
                  );
                  
                  // Get ImageData for the brush
                  const imageData = captureCtx.getImageData(0, 0, width, height);
                  
                  customBrushData = {
                    imageData,
                    width,
                    height,
                    isColorizable: false,
                    isResampler: true,
                    cacheKey: 'resampler:single'
                  };

                  resamplerBrushDataRef.current = customBrushData;
                  
                  // DON'T change brush size - keep it as is so the sample matches cursor size
                  // The captured area is already the right size based on current brush size
                  
                } catch (error) {
                  debugWarn('resampler', 'Failed to sample canvas for Resampler brush:', error);
                }
              }
            }
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
    initDrawingCanvas,
    brushEngine,
    userBrushEngine,
    project,
    drawEraserSegment,
    pauseColorCycleForNonCCInteraction,
    updateAutoSampledGradient,
    beginStrokeSession,
    getCCStampTargetCtx,
    scheduleRecompose,
    createBrushStampSource,
    getColorCycleBrushEraserSettings,
    maskManager
  ]);

  // Process batched stroke points
  const processBatchedStrokes = useCallback(() => {
    const batch = strokeBatchRef.current;
    if (batch.length === 0) return;
    
    const currentState = useAppStore.getState();
    const currentTool = currentState.tools.currentTool;
    const currentBrushId = currentState.currentBrushPreset?.id;
    const drawCtx = drawingCtxRef.current;

    const brushSettings = currentState.tools.brushSettings;
    const brushSize = brushSettings.size || 1;
    const doSnap = shouldApplyGridSnapPure(brushSettings);
    const gridSpacing = doSnap ? calculateGridSpacing() : 0;
    const paused = !selectEffectiveColorCyclePlaying(currentState);
    const brushGradient = brushSettings.colorCycleGradient;
    const brushGradientVersion = brushSettings.colorCycleGradientVersion ?? null;
    const brushGradientFingerprint =
      brushGradient && brushGradientVersion == null ? JSON.stringify(brushGradient) : null;
    
    if (!drawCtx || !project) {
      strokeBatchRef.current = [];
      return;
    }
    
    const boundary = { x: 0, y: 0, width: project.width, height: project.height };
    const ccProcessFlags = getColorCycleBrushFlags(currentState.tools.brushSettings);
    
    // Process all points in the batch
    for (let i = 0; i < batch.length; i++) {
      const { pos: worldPos, pressure } = batch[i];
      const lastPoint = lastDrawPosRef.current;
      
      if (!lastPoint) {
        lastDrawPosRef.current = worldPos;
        continue;
      }
      
      const clippedSegment = clipLineSegment(lastPoint, worldPos, boundary);
      
      if (clippedSegment) {
        const [clippedStart, clippedEnd] = clippedSegment;
        
        if (currentTool === 'eraser') {
          if (FF.ERASER_V2) {
            const eraserTool = eraserToolRef.current;
            if (eraserTool) {
              eraserTool.move(clippedEnd, pressure, clippedStart);
              const roi = eraserTool.getROI();
              eraserRoiRef.current = roi;
              if (roi) {
                const activeLayer = currentState.layers.find(l => l.id === currentState.activeLayerId);
                if (activeLayer?.layerType === 'color-cycle') {
                  scheduleRecompose(roi);
                }
              }
            }
          } else {
            const eraserOpacity = currentState.tools.eraserSettings.opacity ?? 1;
            const canMirrorBrush = !ccProcessFlags.isAny;
            drawCtx.save();
            try {
              drawCtx.globalCompositeOperation = 'destination-out';
              if (canMirrorBrush) {
                drawCtx.globalAlpha = eraserOpacity;
                if (currentBrushId && userBrushEngine.isUserBrush(currentBrushId)) {
                  userBrushEngine.continueStroke(drawCtx, clippedEnd.x, clippedEnd.y, pressure);
                } else if (brushEngine) {
                  const customBrushData: CustomBrushStrokeData | undefined =
                    resolveActiveCustomBrushData(currentState);
                  brushEngine.drawBrush(drawCtx, clippedStart, clippedEnd, { pressure, customBrushData });
                } else {
                  drawCtx.globalAlpha = 1;
                  drawEraserSegment(drawCtx, clippedStart, clippedEnd);
                }
              } else {
                drawCtx.globalAlpha = 1;
                drawEraserSegment(drawCtx, clippedStart, clippedEnd);
              }
            } finally {
              drawCtx.restore();
            }
          }
        } else {
          if (currentBrushId && userBrushEngine.isUserBrush(currentBrushId)) {
            userBrushEngine.continueStroke(drawCtx, clippedEnd.x, clippedEnd.y, pressure);
          } else if (brushEngine) {
            drawCtx.globalAlpha = 1.0;
            drawCtx.globalCompositeOperation = 'source-over';
            
            // Check if we're using a custom brush or resampler
            let customBrushData: CustomBrushStrokeData | undefined = resolveActiveCustomBrushData(currentState);
            
            // Check for Color Cycle brush with stroke processor features
            if (ccProcessFlags.isAny) {
              // GUARD: Verify layer compatibility before calling color cycle functions
              const activeLayer = currentState.layers.find(l => l.id === currentState.activeLayerId);
              const isColorCycleLayer = activeLayer?.layerType === 'color-cycle';
              
              if (!isColorCycleLayer && activeLayer?.layerType) {
                // Color cycle brush on non-CC layer - skip processing to prevent crash
                continue; // Skip this batch item and continue with next
              }

              // Decide where to paint CC stamps (layer canvas vs overlay)
              const targetCtx = getCCStampTargetCtx();
              const layerCanvas = activeLayer?.colorCycleData?.canvas ?? null;
              if (!targetCtx || targetCtx.canvas !== layerCanvas) {
                colorCycleLastPosRef.current = clippedEnd;
                continue;
              }
              targetCtx.globalCompositeOperation = 'source-over';
              targetCtx.globalAlpha = 1;
              
              const layerGradient = activeLayer?.colorCycleData?.gradient;
              const layerGradientVersion = activeLayer?.colorCycleData?.gradientVersion ?? null;
              const layerGradientFingerprint =
                layerGradient && layerGradientVersion == null ? JSON.stringify(layerGradient) : null;
              const gradientsMatch =
                !brushGradient ||
                !layerGradient
                  ? brushGradient === layerGradient
                  : brushGradientVersion != null && layerGradientVersion != null
                    ? brushGradientVersion === layerGradientVersion
                    : brushGradientFingerprint === layerGradientFingerprint;

              if (!gradientsMatch && brushGradient && activeLayer) {
                try {
                  currentState.updateLayer(activeLayer.id, {
                    colorCycleData: {
                      ...(activeLayer.colorCycleData ?? {}),
                      gradient: brushGradient,
                      gradientVersion:
                        brushGradientVersion ??
                        ((activeLayer.colorCycleData?.gradientVersion ?? 0) + 1)
                    }
                  });
                } catch {}
                try {
                  brushEngine.updateColorCycleGradient?.(brushGradient);
                } catch {}
              }

              const usingCustomStamp = ccProcessFlags.isCustom;
              const stampData = usingCustomStamp
                ? customBrushData ?? resamplerBrushDataRef.current
                : undefined;

              if (usingCustomStamp && !stampData) {
                continue;
              }
              const rawSpacing = brushSettings.spacing || 1;
              const effectiveSpacing = paused
                ? Math.max(1, Math.round(rawSpacing * 1.25))
                : rawSpacing;
              const rotationEnabled = !!brushSettings.rotationEnabled;
              const pixelQueue = colorCyclePixelQueue.current ?? (() => {
                const queue = createPixelQueue();
                colorCyclePixelQueue.current = queue;
                return queue;
              })();
              const stampCmds: StampCmd[] = [];
              const MAX_STAMPS_PER_BATCH = 128;

              const previousPos = colorCycleLastPosRef.current;
              if (previousPos) {
                const dx = clippedEnd.x - previousPos.x;
                const dy = clippedEnd.y - previousPos.y;
                const distance = Math.sqrt(dx * dx + dy * dy);

                colorCycleDistanceRef.current += distance;
                const { rotation, nextRotation } = resolveBrushRotation(
                  rotationEnabled,
                  dx,
                  dy,
                  distance,
                  colorCycleLastRotationRef.current
                );
                colorCycleLastRotationRef.current = nextRotation;

                let enqueuedStamps = false;
                let roiMinX = Number.POSITIVE_INFINITY;
                let roiMinY = Number.POSITIVE_INFINITY;
                let roiMaxX = Number.NEGATIVE_INFINITY;
                let roiMaxY = Number.NEGATIVE_INFINITY;

                while (distance > 0 && colorCycleDistanceRef.current >= effectiveSpacing) {
                  const t = 1 - (colorCycleDistanceRef.current - effectiveSpacing) / distance;
                  let stampX = previousPos.x + dx * t;
                  let stampY = previousPos.y + dy * t;

                  if (doSnap) {
                    const snapped = snapToGridPure(stampX, stampY, gridSpacing);
                    stampX = snapped.x;
                    stampY = snapped.y;
                  }

                  const dashAllows = shouldDrawStamp(brushSettings, pixelQueue, brushSize);
                  const allowStamp = dashAllows;

                  if (allowStamp) {
                    const sx = stampX;
                    const sy = stampY;
                    const sRotation = rotation;
                    const sPressure = pressure;
                    stampCmds.push({
                      x: sx,
                      y: sy,
                      pressure: sPressure,
                      rotation: sRotation,
                      customStamp: usingCustomStamp ? stampData : undefined
                    });

                    enqueuedStamps = true;
                    roiMinX = Math.min(roiMinX, sx);
                    roiMinY = Math.min(roiMinY, sy);
                    roiMaxX = Math.max(roiMaxX, sx);
                    roiMaxY = Math.max(roiMaxY, sy);
                  }

                  colorCycleDistanceRef.current -= effectiveSpacing;
                  if (stampCmds.length >= MAX_STAMPS_PER_BATCH) {
                    break;
                  }
                }

                if (stampCmds.length) {
                  const ctx = targetCtx;
                  const cmds = stampCmds.splice(0, stampCmds.length);
                  pixelQueue.enqueue(() => {
                    for (let i = 0; i < cmds.length; i++) {
                      const c = cmds[i];
                      if (c.customStamp) {
                        brushEngine.drawColorCycle(
                          ctx,
                          c.x,
                          c.y,
                          c.pressure,
                          c.rotation,
                          { customStamp: c.customStamp }
                        );
                      } else if (rotationEnabled && c.rotation !== 0) {
                        brushEngine.drawColorCycle(ctx, c.x, c.y, c.pressure, c.rotation);
                      } else {
                        brushEngine.drawColorCycle(ctx, c.x, c.y, c.pressure, 0);
                      }
                    }
                  });
                }

                if (paused && enqueuedStamps) {
                  const pad = Math.ceil(brushSize / 2) + 2;
                  const minX = Math.floor(Math.min(roiMinX, previousPos.x, clippedEnd.x) - pad);
                  const minY = Math.floor(Math.min(roiMinY, previousPos.y, clippedEnd.y) - pad);
                  const maxX = Math.ceil(Math.max(roiMaxX, previousPos.x, clippedEnd.x) + pad);
                  const maxY = Math.ceil(Math.max(roiMaxY, previousPos.y, clippedEnd.y) + pad);
                  const width = Math.max(0, maxX - minX);
                  const height = Math.max(0, maxY - minY);
                  if (width > 0 && height > 0) {
                    if (typeof pixelQueue.addDirtyRect === 'function') {
                      pixelQueue.addDirtyRect(minX, minY, width, height);
                    } else {
                      scheduleRecompose({ x: minX, y: minY, width, height });
                    }
                  }
                }
              } else {
                colorCycleLastRotationRef.current = rotationEnabled ? 0 : undefined;
              }

              colorCycleLastPosRef.current = clippedEnd;
              continue;
            } else if (currentState.tools.brushSettings.brushShape === BrushShape.RESAMPLER) {
              if (currentState.tools.brushSettings.continuousSampling) {
                // Continuous sampling mode - check if we need to resample
                stampCounterRef.current++;
                const resampleInterval = currentState.tools.brushSettings.resampleInterval || 5;
                
                // Resample when counter reaches interval or if we don't have data yet
                if (stampCounterRef.current >= resampleInterval || !resamplerBrushDataRef.current) {
                  // Reset counter
                  stampCounterRef.current = 0;
                  
                  // Capture new sample at current position
                  const brushSize = currentState.tools.brushSettings.size || 20;
                  const halfSize = brushSize / 2;
                  const compositeCanvas = currentState.currentOffscreenCanvas;
                  
                  if (compositeCanvas) {
                    // Use clippedEnd position for sampling
                    const samplePos = clippedEnd;
                    
                    // Calculate bounds
                    const minX = Math.floor(samplePos.x - halfSize);
                    const minY = Math.floor(samplePos.y - halfSize);
                    const maxX = Math.floor(samplePos.x + halfSize);
                    const maxY = Math.floor(samplePos.y + halfSize);
                    
                    // Clamp to canvas bounds
                    const sampleX = Math.max(0, minX);
                    const sampleY = Math.max(0, minY);
                    const sampleEndX = Math.min(compositeCanvas.width, maxX);
                    const sampleEndY = Math.min(compositeCanvas.height, maxY);
                    const width = sampleEndX - sampleX;
                    const height = sampleEndY - sampleY;
                    
                    if (width > 0 && height > 0) {
                      // Create canvas to capture the selection
                      const captureCanvas = document.createElement('canvas');
                      captureCanvas.width = width;
                      captureCanvas.height = height;
                      const captureCtx = captureCanvas.getContext('2d', { willReadFrequently: true });
                      
                      if (captureCtx) {
                        // Capture the selection area from the composite canvas
                        try {
                          captureCtx.drawImage(
                            compositeCanvas,
                            sampleX, sampleY, width, height, // Source rectangle
                            0, 0, width, height              // Destination rectangle
                          );
                          
                          // Get ImageData for the brush
                          const imageData = captureCtx.getImageData(0, 0, width, height);
                          
                          resamplerBrushDataRef.current = {
                            imageData,
                            width,
                            height,
                            isColorizable: false,
                            isResampler: true,
                            cacheKey: 'resampler:continuous'
                          };
                        } catch (error) {
                          debugWarn('resampler', 'Failed to sample canvas for continuous Resampler:', error);
                        }
                      }
                    }
                  }
                }
                
                // Use the current resampler data
                if (resamplerBrushDataRef.current) {
                  customBrushData = resamplerBrushDataRef.current;
                }
              } else if (resamplerBrushDataRef.current) {
                customBrushData = resamplerBrushDataRef.current;
              }
            }
            
            brushEngine.drawBrush(
              drawCtx,
              clippedStart,
              clippedEnd,
              { pressure, customBrushData }
            );
          }
        }
      }
      
      lastDrawPosRef.current = worldPos;

      // Record points for auto-sampling and defer gradient update to finalize
      try {
        const state = useAppStore.getState();
        const isCCStroke = getColorCycleBrushFlags(state.tools.brushSettings).isAny;
        if (isCCStroke && state.tools.brushSettings.autoSampleGradient) {
          autoSamplePointsRef.current.push(worldPos);
          if (autoSamplePointsRef.current.length > 5000) {
            autoSamplePointsRef.current.splice(0, autoSamplePointsRef.current.length - 5000);
          }
          // Live, throttled gradient update based on the whole stroke path so far
          updateAutoSampledGradient(autoSamplePointsRef.current);
        }
      } catch {}
    }
    
    // Clear the batch
    strokeBatchRef.current = [];
    strokeBatchTimerRef.current = null;
  }, [
    brushEngine,
    userBrushEngine,
    project,
    drawEraserSegment,
    updateAutoSampledGradient,
    getCCStampTargetCtx,
    scheduleRecompose
  ]);

  const continueDrawing = useCallback((worldPos: { x: number; y: number }, pressure: number = 0.5) => {
    // Check if layer is still visible before continuing drawing
    const currentState = useAppStore.getState();
    const activeLayer = currentState.layers.find(l => l.id === currentState.activeLayerId);
    if (activeLayer && !activeLayer.visible) {
      endStrokeSession();
      return; // Exit silently if layer became hidden mid-stroke
    }

    const now = performance.now();
    const throttleBudget = THROTTLE_MS;

    if (currentState.tools.currentTool === 'brush') {
      strokeBoundingBoxRef.current = mergeBoundingBox(strokeBoundingBoxRef.current, worldPos);
      const activeCustomBrush = resolveActiveCustomBrushData(currentState) ?? resamplerBrushDataRef.current;
      const dynamicPadding = computeStrokeCapturePadding(currentState.tools.brushSettings, activeCustomBrush ?? null);
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
  }, [processBatchedStrokes, endStrokeSession]);
  
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

    const hasCanvas = Boolean(drawingCanvasRef.current);
    const busy = isBusyRef?.current ?? false;
    const snapshot = useAppStore.getState();
    const activeLayerSnapshot = snapshot.layers.find(l => l.id === snapshot.activeLayerId);
    const isCCLayerSnapshot = activeLayerSnapshot?.layerType === 'color-cycle';
    const isCCBrushSnapshot = getColorCycleBrushFlags(snapshot.tools.brushSettings).isAny;
    const overlayHasContent = drawingCanvasHasContent.current;
    const overlayOptional = isCCLayerSnapshot && isCCBrushSnapshot;
    const allowEmptyOverlay = FF.ERASER_V2 && snapshot.tools.currentTool === 'eraser';
    if (busy || !hasCanvas || (!overlayHasContent && !overlayOptional && !allowEmptyOverlay) || !project) {
      return;
    }

    const pendingEraserTool =
      FF.ERASER_V2 && snapshot.tools.currentTool === 'eraser'
        ? eraserToolRef.current
        : null;

    const finalizeTool = snapshot.tools.currentTool as Tool | 'eraser';

    try {
      if (isBusyRef) isBusyRef.current = true;
      let busyReleased = false;
      const releaseBusyLock = () => {
        if (busyReleased) {
          return;
        }
        if (isBusyRef) {
          isBusyRef.current = false;
        }
        busyReleased = true;
      };
      
      // Process any remaining batched strokes
      if (strokeBatchRef.current.length > 0) {
        processBatchedStrokes();
      }

      // Ensure any deferred color-cycle stamps are rendered before finalizing
      const activeQueue = colorCyclePixelQueue.current;
      const shouldAwaitQueueIdle =
        Boolean(activeQueue?.onIdle) && isCCLayerSnapshot && isCCBrushSnapshot;
      if (shouldAwaitQueueIdle && activeQueue) {
        await new Promise<void>((resolve) => {
          activeQueue.onIdle(resolve);
        });
      } else {
        try {
          activeQueue?.flushNow();
        } catch {}
      }

      if (pendingEraserTool) {
        try {
          pendingEraserTool.end();
        } finally {
          eraserRoiRef.current = pendingEraserTool.getROI();
          if (eraserToolRef.current === pendingEraserTool) {
            eraserToolRef.current = null;
          }
        }
      }

      const finalizeAfterQueue = async () => {
        // Cancel any pending batch timer
        if (strokeBatchTimerRef.current) {
          cancelAnimationFrame(strokeBatchTimerRef.current);
          strokeBatchTimerRef.current = null;
        }
        
        lastDrawPosRef.current = null;
        
        // Clear resampler data and reset counter after stroke ends
        resamplerBrushDataRef.current = undefined;
        stampCounterRef.current = 0;

        // Finalize the stroke (draw any waiting pixels) for modular engine
        const shouldSkipEngineFinalize = FF.ERASER_V2 && finalizeTool === 'eraser';
        if (!shouldSkipEngineFinalize && brushEngine.finalizeStroke && drawingCtxRef.current) {
          brushEngine.finalizeStroke(drawingCtxRef.current);
        }

        let currentState = snapshot;
        let activeLayer = currentState.layers.find(l => l.id === currentState.activeLayerId);
        const currentTool: Tool | 'eraser' = currentState.tools.currentTool as Tool | 'eraser';
        const currentBrushId = currentState.currentBrushPreset?.id;
        
        // End stroke for user brushes
        if (currentBrushId && userBrushEngine.isUserBrush(currentBrushId)) {
          userBrushEngine.endStroke();
        }

        if (activeLayer) {
          const activeLayerIdString = activeLayer.id;
          const drawingCanvas = drawingCanvasRef.current;
          // Use "before" state captured at stroke start, not at finalization
          const layerBeforeImage = strokeBeforeImageRef.current;
          const layerBeforeColorState = strokeBeforeColorStateRef.current;
          const strokeSession = activeStrokeSessionRef.current;
          if (strokeSession && strokeSession.endedAt == null) {
            endStrokeSession();
          }
          const shouldCoalesceStroke =
            strokeSession &&
            strokeSession.layerId === activeLayer.id &&
            strokeSession.tool === currentTool &&
            (currentTool === 'brush' || currentTool === 'eraser');
          let coalescePayload = shouldCoalesceStroke
            ? {
                key: strokeSession.id,
                maxIntervalMs: BRUSH_HISTORY_COALESCE_WINDOW_MS,
                pointerSession: {
                  pointerId: strokeSession.pointerId,
                  startedAt: strokeSession.startedAt,
                  endedAt: strokeSession.endedAt ?? Date.now(),
                },
              }
            : undefined;

          let historyHandled = false;
          const boundingBoxRoi =
            project
              ? boundingBoxToCaptureRegion(
                  strokeBoundingBoxRef.current,
                  ROI_PADDING_PX + strokeCapturePaddingRef.current,
                  project
                )
              : undefined;

          if (currentTool === 'eraser') {
            const historyAction = historyActionOverride ?? 'eraser';
            const historyDescription = historyDescriptionOverride ?? 'Eraser Stroke';
            const roiForEraser = FF.ERASER_V2 ? eraserRoiRef.current : null;
            const isColorCycleLayer = activeLayer.layerType === 'color-cycle';
            const layerCanvas = activeLayer.colorCycleData?.canvas ?? null;

            if (FF.ERASER_V2 && isColorCycleLayer && layerCanvas) {
              await withTiming('cc:capture', () =>
                captureCanvasToActiveLayer(layerCanvas, roiForEraser ?? undefined)
              );
              if (!skipSave) {
                await withTiming('cc:commit', () =>
                  commitLayerHistory({
                    layerId: activeLayerIdString,
                    beforeImage: layerBeforeImage,
                    beforeColorState: layerBeforeColorState,
                    actionType: historyAction,
                    description: historyDescription,
                    tool: 'eraser',
                    coalesce: coalescePayload,
                    bitmapRoi: roiForEraser ?? undefined,
                    skipBitmapDelta: true,
                  })
                );
                historyHandled = true;
              }
            } else if (drawingCanvas) {
              if (skipSave) {
                await withTiming('cc:capture', () =>
                  captureCanvasToActiveLayer(drawingCanvas, (roiForEraser ?? boundingBoxRoi) ?? undefined)
                );
              } else {
                await withTiming('cc:capture', () =>
                  captureCanvasToActiveLayer(drawingCanvas, (roiForEraser ?? boundingBoxRoi) ?? undefined)
                );
                await withTiming('cc:commit', () =>
                  commitLayerHistory({
                    layerId: activeLayerIdString,
                    beforeImage: layerBeforeImage,
                    beforeColorState: layerBeforeColorState,
                    actionType: historyAction,
                    description: historyDescription,
                    tool: 'eraser',
                    coalesce: coalescePayload,
                    bitmapRoi: (roiForEraser ?? boundingBoxRoi) ?? undefined,
                    // Raster eraser strokes must record bitmap deltas so undo restores erased pixels.
                    skipBitmapDelta: false,
                  })
                );
                historyHandled = true;
              }
            }

            eraserRoiRef.current = null;
          } else { // Brush tool
            const activeSettings = currentState.tools.brushSettings;
            const activeFlags = getColorCycleBrushFlags(activeSettings);
            const drawingCtx = drawingCtxRef.current;
            const isColorCycleLayer = activeLayer?.layerType === 'color-cycle';
            const isColorCycleBrush = activeFlags.isAny;

            // For color cycle brush, stop the animation and do final render
            if (activeFlags.isAny && drawingCtx) {
              // If auto-sampling is enabled, compute final 8-stop gradient across full stroke path now
              try {
                if (activeSettings.autoSampleGradient && autoSamplePointsRef.current.length > 0) {
                  const finalPts = [...autoSamplePointsRef.current];
                  const maxStops = 6;
                  const samplePts = equidistantPointsOnPolyline(finalPts, Math.min(maxStops, Math.max(1, finalPts.length)));
                  if (samplePts.length > 0) {
                    const colors = samplePts.map(p => sampleHexAt(p.x, p.y));
                    const stops = colors.map((c, i) => ({ position: samplePts.length === 1 ? 0 : i / (samplePts.length - 1), color: c }));
                    try {
                      setSharedColorCycleGradient(stops);
                    } catch {
                      useAppStore.getState().setBrushSettings({ colorCycleGradient: stops });
                    }
                    // Push into live brush
                    try { brushEngine.updateColorCycleGradient?.(stops); } catch {}
                    // One-shot: auto-disable sampling after applying
                    try {
                      const st = useAppStore.getState();
                      if (st.tools.brushSettings.autoSampleGradient) {
                        st.setBrushSettings({ autoSampleGradient: false });
                      }
                    } catch {}
                  }
                }
              } catch {}
              // Stop animation loop
              if (colorCycleAnimationRef.current) {
                cancelAnimationFrame(colorCycleAnimationRef.current);
                colorCycleAnimationRef.current = null;
              }
              
              // End stroke and do final render
              brushEngine.endColorCycleStroke();
              
              // Phase 3: Direct rendering approach
              const refreshedActiveLayer = currentState.layers.find(l => l.id === currentState.activeLayerId);
              const colorCycleBrushManager = getColorCycleBrushManager();
              const colorCycleBrush = refreshedActiveLayer ? colorCycleBrushManager.getBrush(refreshedActiveLayer.id) : undefined;

              if (colorCycleBrush && refreshedActiveLayer?.colorCycleData?.canvas && drawingCanvas && drawingCtx) {
                bindBrushToCanvas(colorCycleBrush, refreshedActiveLayer.colorCycleData.canvas);
                // Final render directly to layer canvas at full opacity
                colorCycleBrush.renderDirectToCanvas(refreshedActiveLayer.colorCycleData.canvas, refreshedActiveLayer.id);
                
                // Clear transient overlay so compositor paints the next frame
                drawingCtx.clearRect(0, 0, drawingCanvas.width, drawingCanvas.height);
                drawingCanvasHasContent.current = false;
              } else if (drawingCanvas && drawingCtx) {
                // Fallback: Clear and do one final render at FULL OPACITY
                drawingCtx.clearRect(0, 0, drawingCanvas.width, drawingCanvas.height);
                drawingCanvasHasContent.current = false;
                brushEngine.renderColorCycle(drawingCtx, false); // false = don't apply opacity
              }
              
              // Keep runtime aligned with toolbar intent after finalize.
              if (getDesiredColorCyclePlaying()) {
                Promise.resolve().then(() => startPlaybackRef.current?.('stroke-end'));
              } else {
                stopContinuousColorCycleAnimation('brush-stroke');
              }
            }
            
            // Handle capture differently for CC layers vs regular layers
            // Treat stroke, shape, and custom CC variants as CC for saving
            const shouldDisableCoalescing = isColorCycleLayer && isColorCycleBrush;
            if (shouldDisableCoalescing) {
              coalescePayload = undefined;
            }
            const isAnyColorCycleBrush = isColorCycleBrush;

            // Ensure CC layer has a canvas before attempting to save
            if (isColorCycleLayer && !activeLayer?.colorCycleData?.canvas && currentState.project) {
              try {
                useAppStore.getState().initColorCycleForLayer(activeLayer.id, currentState.project.width, currentState.project.height);
                // Refresh state references after init
                currentState = useAppStore.getState();
                activeLayer = currentState.layers.find(l => l.id === currentState.activeLayerId);
              } catch {
                // Suppressed debug warn for finalize init
              }
            }

            if (!activeLayer) {
              return;
            }
            const activeLayerIdString = activeLayer.id;

            const isShapeMode = currentState.tools.shapeMode;

            const resolvedHistoryAction =
              historyActionOverride ?? (isShapeMode ? 'fill' : 'brush');

            const resolvedHistoryDescription = historyDescriptionOverride ?? (() => {
              if (isShapeMode) {
                if (isColorCycleLayer && isColorCycleBrush) {
                  return 'Color Cycle Fill';
                }
                return getShapeFillHistoryDescription();
              }
              if (isColorCycleLayer && isColorCycleBrush) {
                return 'Color Cycle Stroke';
              }
              return 'Brush Stroke';
            })();

            let brushForCleanup: ManagedColorCycleBrush | undefined;
            let deferredLayerCanvas: HTMLCanvasElement | null = null;
            let strokeCaptureRoi: CaptureRegion | undefined;

            if (isColorCycleLayer && isAnyColorCycleBrush && activeLayer?.colorCycleData?.canvas) {
              // Color-cycle brush on CC layer: render/commit directly into the layer canvas,
              // then schedule deferred state serialization instead of raster capture.
              const layerCanvas = activeLayer.colorCycleData.canvas;
              startFinalizeVisibleTimer();
              if (FF.CC_CAPTURE_ROI) {
                perfMark('cc:roi:start');
                strokeCaptureRoi = boundingBoxToCaptureRegion(
                  strokeBoundingBoxRef.current,
                  ROI_PADDING_PX + strokeCapturePaddingRef.current,
                  project
                );
                perfMark('cc:roi:end');
                perfMeasure('cc:roi', 'cc:roi:start', 'cc:roi:end');
              } else {
                strokeCaptureRoi = undefined;
              }
              deferredLayerCanvas = layerCanvas;
              const targetLayerId = activeLayer.id;
              try {
                const colorCycleBrushManager = getColorCycleBrushManager();
                const brush = colorCycleBrushManager.getBrush(targetLayerId) as ManagedColorCycleBrush | undefined;
                  if (brush) {
                    bindBrushToCanvas(brush, layerCanvas);
                    if (typeof brush.commitCurrentStroke === 'function') {
                    brush.commitCurrentStroke(targetLayerId);
                  } else {
                    brush.finalizeCurrentStroke?.(targetLayerId);
                  }

                  // Ensure animator texture/index reflect committed geometry
                  brush.updateColorCycleTexture?.();

                  if (typeof brush.commitToLayer === 'function') {
                    brush.commitToLayer(layerCanvas, targetLayerId);
                  } else {
                    brush.renderDirectToCanvas?.(layerCanvas, targetLayerId);
                  }

                  // Mark layer metadata so downstream consumers know content exists
                  try {
                    const st = useAppStore.getState();
                    const freshLayer = st.layers.find(l => l.id === targetLayerId);
                    if (freshLayer?.colorCycleData) {
                      st.updateLayer(targetLayerId, {
                        colorCycleData: {
                          ...freshLayer.colorCycleData,
                          hasContent: true
                        }
                      });
                    }
                  } catch {}

                  brushForCleanup = brush;
                } else if (drawingCanvas) {
                  try {
                    const targetCtx = layerCanvas.getContext('2d', { willReadFrequently: true });
                    if (targetCtx) {
                      targetCtx.save();
                        targetCtx.globalCompositeOperation = activeSettings.blendMode || 'source-over';
                        targetCtx.globalAlpha = activeSettings.opacity ?? 1;
                        targetCtx.drawImage(drawingCanvas, 0, 0);
                        targetCtx.restore();
                      }
                    } catch {}
                  }
              } catch {
                // Suppressed debug warn for buffer commit
              }
              try {
                window.dispatchEvent(new CustomEvent('colorCycleFrameUpdate'));
                ccLog('stroke: frameUpdate dispatched', { layerId: targetLayerId.slice(-6) });
              } catch {}
              endFinalizeVisibleTimer();

            } else if (isColorCycleLayer) {
              // On a color-cycle layer without a valid CC canvas, do not fall back to
              // regular layer saving, as that would create a misleading 'Drawing stroke'
              // history entry and break CC undo granularity. Skip saving in this edge case.
              // Reduce noise: suppressed finalize debug
            } else {
              await commitRasterOverlay({
                layer: activeLayer,
                overlayCanvas: drawingCanvasRef.current ?? null,
                beforeImage: layerBeforeImage,
                beforeColorState: layerBeforeColorState,
                historyAction: resolvedHistoryAction,
                historyDescription: resolvedHistoryDescription,
                tool: currentTool,
                coalesce: skipSave ? undefined : coalescePayload,
                bitmapRoi: boundingBoxRoi ?? undefined,
                skipHistory: skipSave,
              });
              historyHandled = historyHandled || !skipSave;
            }

          // Clear transient drawing canvas content before scheduling history work
          const polygonState = currentState.polygonGradientState;
          const isInAdjustmentMode =
            polygonState.drawingState === 'adjustingSpacing' ||
            polygonState.drawingState === 'adjustingRotation' ||
            polygonState.drawingState === 'adjustingSize';

          if (!isColorCycleLayer || !isColorCycleBrush) {
            if (!isInAdjustmentMode) {
              if (drawingCtxRef.current && drawingCanvasRef.current) {
                drawingCtxRef.current.clearRect(0, 0, drawingCanvasRef.current.width, drawingCanvasRef.current.height);
              }
              drawingCanvasHasContent.current = false;
            }
          }

          releaseBusyLock();

          if (!skipSave && !historyHandled) {
            const actionType = resolvedHistoryAction;
            const historyDescription = resolvedHistoryDescription;
            const shouldSkipBitmapDelta = shouldDisableCoalescing;
            const coalesceForHistory = shouldSkipBitmapDelta ? undefined : coalescePayload;

            if (brushForCleanup?.flush) {
              brushForCleanup.flush(activeLayerIdString);
            }

            const historyBitmapRoi = strokeCaptureRoi ?? boundingBoxRoi;

              const shouldDeferColorCycleSave =
                isColorCycleLayer &&
                isColorCycleBrush &&
                Boolean(deferredLayerCanvas);

              if (shouldDeferColorCycleSave && deferredLayerCanvas) {
                perfMark('cc:state-serialize-after:start');
                debugTime('cc:state-serialize-after');
                let afterColorState: ColorCycleSerializedState | null = null;
                try {
                  afterColorState = captureColorCycleBrushState(activeLayerIdString);
                } finally {
                  debugTimeEnd('cc:state-serialize-after');
                  perfMark('cc:state-serialize-after:end');
                  perfMeasure(
                    'cc:state-serialize-after',
                    'cc:state-serialize-after:start',
                    'cc:state-serialize-after:end'
                  );
                }

                scheduleDeferredColorCycleSave({
                  layerId: activeLayerIdString,
                  canvas: deferredLayerCanvas,
                  beforeColorState: layerBeforeColorState,
                  afterColorState,
                  actionType,
                  description: historyDescription,
                  tool: currentTool,
                  coalesce: undefined,
                  beforeImage: null,
                  skipBitmapDelta: true,
                  roi: strokeCaptureRoi,
                });
              } else {
                let afterColorState: ReturnType<typeof captureColorCycleBrushState> | null = null;

                if (shouldSkipBitmapDelta) {
                  perfMark('cc:state-serialize-after:start');
                  debugTime('cc:state-serialize-after');
                  try {
                    afterColorState = captureColorCycleBrushState(activeLayerIdString);
                  } finally {
                    debugTimeEnd('cc:state-serialize-after');
                    perfMark('cc:state-serialize-after:end');
                    perfMeasure(
                      'cc:state-serialize-after',
                      'cc:state-serialize-after:start',
                      'cc:state-serialize-after:end'
                    );
                  }
                  debugVerbose('[cc-delta-capture]', {
                    beforeBytes:
                      layerBeforeColorState?.layers?.[0]?.strokeData?.paintBuffer?.byteLength ?? -1,
                    afterBytes:
                      afterColorState?.layers?.[0]?.strokeData?.paintBuffer?.byteLength ?? -1,
                    beforeCtr:
                      layerBeforeColorState?.layers?.[0]?.strokeData?.strokeCounter ?? -1,
                    afterCtr:
                      afterColorState?.layers?.[0]?.strokeData?.strokeCounter ?? -1,
                  });
                }
                await withTiming('cc:commit', () =>
                  commitLayerHistory({
                    layerId: activeLayerIdString,
                    beforeImage: layerBeforeImage,
                    beforeColorState: layerBeforeColorState,
                    afterColorState,
                    actionType,
                    description: historyDescription,
                    tool: currentTool,
                    coalesce: coalesceForHistory,
                    skipBitmapDelta: shouldSkipBitmapDelta,
                    bitmapRoi: historyBitmapRoi ?? undefined,
                  })
                );
              }
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
      // Reset auto-sample state after stroke ends
      autoSamplePointsRef.current = [];
      autoSampleLastUpdateRef.current = 0;
      // Safety net: ensure one-shot sampling is turned off at end of stroke
      try {
        const st = useAppStore.getState();
        if (st.tools.brushSettings.autoSampleGradient) {
          st.setBrushSettings({ autoSampleGradient: false });
        }
      } catch {}
      clearStrokeSession();
      // Clear snapshot refs to avoid memory leaks
      strokeBeforeImageRef.current = null;
      strokeBeforeColorStateRef.current = null;
      if (drawingCtxRef.current && drawingCanvasRef.current) {
        drawingCtxRef.current.clearRect(0, 0, drawingCanvasRef.current.width, drawingCanvasRef.current.height);
      }
      drawingCanvasHasContent.current = false;
      await resumeColorCycleAfterInteraction();
      endFinalizeVisibleTimer();
      strokeBoundingBoxRef.current = null;
      strokeCapturePaddingRef.current = 0;
      if (isBusyRef) isBusyRef.current = false;
    }
  }, [
    project,
    captureCanvasToActiveLayer,
    isBusyRef,
    userBrushEngine,
    brushEngine,
    processBatchedStrokes,
    equidistantPointsOnPolyline,
    sampleHexAt,
    resumeColorCycleAfterInteraction,
    endStrokeSession,
    clearStrokeSession,
    scheduleDeferredColorCycleSave,
    stopContinuousColorCycleAnimation,
    runIdleAsync
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
  }, []);
  
  const startShapeDrawing = useCallback((worldPos: { x: number; y: number }, pressure: number = 0.5) => {
    strokeBoundingBoxRef.current = null;
    strokeCapturePaddingRef.current = 0;
    // If we're selecting direction for linear gradient, record the direction
    if (isSelectingDirectionRef.current) {
      directionPreviewRef.current = worldPos;
      // Direction selection will be finalized in finalizeShapeDrawing
      return;
    }

    if (tools.shapeMode) {
      const state = useAppStore.getState();
      const isCCShape = state.tools.brushSettings.brushShape === BrushShape.COLOR_CYCLE_SHAPE;

      if (!isCCShape) {
        // Only pause for non-CC shape brushes
        pauseColorCycleForNonCCInteraction();
      }
      // quiet
      // Avoid allocating the full-size drawing canvas at the first vertex for
      // Color Cycle Shape previews. We render previews on the lightweight overlay
      // canvas and defer allocation until direction selection or finalization.
      try {
        const st = useAppStore.getState();
        const isCCShape = st.tools.brushSettings.brushShape === BrushShape.COLOR_CYCLE_SHAPE;
        if (!isCCShape) {
          initDrawingCanvas();
        }
      } catch {
        initDrawingCanvas();
      }
      // Support click-to-add vertices: if already drawing a shape, append point instead of resetting
      if (isDrawingShapeRef.current && shapePointsRef.current.length > 0) {
        shapePointsRef.current.push(worldPos);
      } else {
        shapePointsRef.current = [worldPos];
        isDrawingShapeRef.current = true;
        // Initialize auto-sampling for CC shape
        try {
          const st = useAppStore.getState();
          const isCCShape = st.tools.brushSettings.brushShape === BrushShape.COLOR_CYCLE_SHAPE;
          if (isCCShape && st.tools.brushSettings.autoSampleGradient) {
            autoSamplePointsRef.current = [...shapePointsRef.current];
            autoSampleLastUpdateRef.current = 0;
            updateAutoSampledGradient(autoSamplePointsRef.current);
          }
        } catch {}
      }
    } else {
      startDrawing(worldPos, pressure);
    }
  }, [tools.shapeMode, initDrawingCanvas, startDrawing, pauseColorCycleForNonCCInteraction, updateAutoSampledGradient]);
  
  const continueShapeDrawing = useCallback((worldPos: { x: number; y: number }) => {
    // Handle animations based on brush type
    if (tools.shapeMode && !ccShapePreviewPauseStartedRef.current) {
      const state = useAppStore.getState();
      const isCCShape = state.tools.brushSettings.brushShape === BrushShape.COLOR_CYCLE_SHAPE;

      if (isCCShape) {
        ccLog('shape: CC preview, no pause');
      } else {
        // Only pause for non-CC shapes
        pauseColorCycleForNonCCInteraction();
      }
      ccLog('shape: preview pause begin', { isCCShape });
      ccShapePreviewPauseStartedRef.current = true;
    }
    // Check if layer is still visible before continuing shape drawing
    const currentState = useAppStore.getState();
    const activeLayer = currentState.layers.find(l => l.id === currentState.activeLayerId);
    if (activeLayer && !activeLayer.visible) {
      return; // Exit silently if layer became hidden mid-stroke
    }
    
    // If we're selecting direction, show preview line
    if (isSelectingDirectionRef.current && shapePointsRef.current.length >= 3) {
      // quiet
      
      // Make sure we have drawing context
      if (!drawingCtxRef.current || !drawingCanvasRef.current) {
        // quiet
        initDrawingCanvas();
      }
      
      const drawCtx = drawingCtxRef.current;
      if (drawCtx && drawingCanvasRef.current) {
        // quiet
        // Clear and redraw shape with transparent fill
        drawCtx.clearRect(0, 0, drawingCanvasRef.current.width, drawingCanvasRef.current.height);
        
        // Draw shape with transparent black fill (same as preview during drawing)
        drawCtx.fillStyle = 'rgba(0, 0, 0, 0.3)';
        drawCtx.beginPath();
        drawCtx.moveTo(shapePointsRef.current[0].x, shapePointsRef.current[0].y);
        for (let i = 1; i < shapePointsRef.current.length; i++) {
          drawCtx.lineTo(shapePointsRef.current[i].x, shapePointsRef.current[i].y);
        }
        drawCtx.closePath();
        drawCtx.fill();
        
        // Calculate shape center
        let centerX = 0, centerY = 0;
        for (const p of shapePointsRef.current) {
          centerX += p.x;
          centerY += p.y;
        }
        centerX /= shapePointsRef.current.length;
        centerY /= shapePointsRef.current.length;
        
        // Draw direction line with difference blending mode
        drawCtx.save();
        drawCtx.globalCompositeOperation = 'difference';
        drawCtx.strokeStyle = '#000000';  // Black line
        drawCtx.lineWidth = 1;  // 1px width
        drawCtx.beginPath();
        drawCtx.moveTo(centerX, centerY);
        drawCtx.lineTo(worldPos.x, worldPos.y);
        drawCtx.stroke();
        drawCtx.restore();
      }
      return;
    }
    
    if (tools.shapeMode && isDrawingShapeRef.current) {
      const store = useAppStore.getState();
      const zoom = store.canvas?.zoom || 1;
      const brushSize = store.tools.brushSettings.size || 20;
      const added = appendSegmentWithDynamicResampling(shapePointsRef.current, worldPos, zoom, brushSize, 0.25, 0.6);
      if (added > 0) {
        // Live auto-sampling for CC Shape while adding vertices/segments
        try {
          const isCCShape = store.tools.brushSettings.brushShape === BrushShape.COLOR_CYCLE_SHAPE;
          if (isCCShape && store.tools.brushSettings.autoSampleGradient) {
            // Use the current polyline of the shape for sampling
            autoSamplePointsRef.current = [...shapePointsRef.current];
            updateAutoSampledGradient(autoSamplePointsRef.current);
          }
        } catch {}
      }
    } else if (!tools.shapeMode) {
      continueDrawing(worldPos);
    }
  }, [tools.shapeMode, continueDrawing, pauseColorCycleForNonCCInteraction, updateAutoSampledGradient, initDrawingCanvas]);
  
  const finalizeShapeDrawing = useCallback(async () => {
    const polygonState = useAppStore.getState().polygonGradientState;
    const polygonPointCount = Math.max(polygonState.points?.length ?? 0, polygonState.vertices?.length ?? 0);
    const polygonActive = polygonState.drawingState !== 'idle' && polygonPointCount >= 3;
    const hasShapeInProgress = tools.shapeMode || polygonActive || isSelectingDirectionRef.current || isDrawingShapeRef.current;

    if (!hasShapeInProgress) {
      return finalizeDrawing();
    }

    if (isBusyRef?.current) {
      return;
    }

    // Use FinalizeQueue to prevent concurrent finalization operations
    void finalizeQueueRef.current.enqueue(async () => {
      let finalizeTriggered = false;
      // All finalization logic runs serially here
      let handledColorCycleShape = false;

      let shapeLayerId: string | null = null;
      let shapeBeforeImage: ImageData | null = null;
      let shapeBeforeColorState: ColorCycleSerializedState = null;
    
    // Check if we're in direction selection mode for linear gradient
    if (isSelectingDirectionRef.current && directionPreviewRef.current) {
      try {
        if (isBusyRef) isBusyRef.current = true;

        const drawCtx = drawingCtxRef.current;
        if (drawCtx && brushEngine && shapePointsRef.current.length >= 3) {
          const beforeState = useAppStore.getState();
          const beforeLayer = beforeState.layers.find(l => l.id === beforeState.activeLayerId);
          shapeLayerId = beforeLayer?.id ?? null;
          if (!shapeLayerId || !beforeLayer?.colorCycleData?.canvas) {
            drawingCanvasHasContent.current = true;
            isSelectingDirectionRef.current = false;
            directionPreviewRef.current = null;
            await resumeColorCycleAfterInteraction();
            if (isBusyRef) isBusyRef.current = false;
            return;
          }
          const shapeLayerIdString: string = shapeLayerId;
          shapeBeforeColorState = beforeLayer && isColorCycleLayerWithData(beforeLayer)
            ? captureColorCycleBrushState(beforeLayer.id)
            : null;
          // Calculate shape center
          let centerX = 0, centerY = 0;
          for (const p of shapePointsRef.current) {
            centerX += p.x;
            centerY += p.y;
          }
          centerX /= shapePointsRef.current.length;
          centerY /= shapePointsRef.current.length;
          
          // Calculate direction vector from center to click point
          const direction = {
            x: directionPreviewRef.current.x - centerX,
            y: directionPreviewRef.current.y - centerY
          };
          
          // Clear the canvas first
          drawCtx.clearRect(0, 0, drawingCanvasRef.current?.width || 0, drawingCanvasRef.current?.height || 0);
          drawingCanvasHasContent.current = false;
          
          const currentState = useAppStore.getState();
          const activeLayer = currentState.layers.find(l => l.id === currentState.activeLayerId);
          const isColorCycleLayer = activeLayer?.layerType === 'color-cycle';
          const activeLayerCanvas = activeLayer?.colorCycleData?.canvas ?? null;
          const activeSettings = beforeState.tools.brushSettings;

          const shapePointsSnapshot = [...shapePointsRef.current];
          const directionSnapshot = { ...direction };

          let shapeCaptureRoi: CaptureRegion | undefined;
          if (FF.CC_CAPTURE_ROI) {
            perfMark('cc:roi:start');
            shapeCaptureRoi = captureRegionFromPoints(
              shapePointsSnapshot,
              ROI_PADDING_PX,
              project
            );
            perfMark('cc:roi:end');
            perfMeasure('cc:roi', 'cc:roi:start', 'cc:roi:end');
          } else {
            shapeCaptureRoi = undefined;
          }

          perfMark('cc:visible-finalize:start');
          if (CC_DEBUG.on) {
            debugTime('cc:visible-finalize');
          }

          drawingCanvasHasContent.current = false;

          if (isColorCycleLayer && activeLayerCanvas && activeLayerId) {
            runIdle(() => {
              void (async () => {
                try {
                  await timeAsync('cc:shape:fill(linear)', async () => {
                    brushEngine.resetColorCycle(false);
                    await brushEngine.fillColorCycleShapeLinear(shapePointsSnapshot, directionSnapshot);
                  });

                  timeSync('cc:shape:texture', () => {
                    brushEngine.updateColorCycleTexture();
                  });

                  const colorCycleBrushManager = getColorCycleBrushManager();
                  const colorCycleBrush = colorCycleBrushManager.getBrush(activeLayerId) as
                    | ManagedColorCycleBrush
                    | undefined;

                  if (colorCycleBrush && activeLayerCanvas) {
                    bindBrushToCanvas(colorCycleBrush, activeLayerCanvas);
                    timeSync('cc:shape:render', () => {
                      colorCycleBrush.renderDirectToCanvas(activeLayerCanvas, activeLayerId);
                    });
                  } else if (activeLayerCanvas) {
                    timeSync('cc:shape:render(fallback)', () => {
                      const targetCtx = activeLayerCanvas.getContext('2d', { willReadFrequently: true });
                      if (targetCtx && drawingCanvasRef.current) {
                        targetCtx.save();
                        targetCtx.globalCompositeOperation = activeSettings.blendMode || 'source-over';
                        targetCtx.globalAlpha = activeSettings.opacity ?? 1;
                        targetCtx.drawImage(drawingCanvasRef.current, 0, 0);
                        targetCtx.restore();
                      }
                    });
                  }

                  try {
                    window.dispatchEvent(new CustomEvent('colorCycleFrameUpdate'));
                    ccLog('shape: frameUpdate dispatched', { mode: 'linear' });
                  } catch {}

                  if (shapeLayerIdString) {
                    perfMark('cc:state-serialize-after:start');
                    if (CC_DEBUG.on) {
                      debugTime('cc:state-serialize-after');
                    }
                    let afterColorState: ColorCycleSerializedState | null = null;
                    try {
                      afterColorState = captureColorCycleBrushState(shapeLayerIdString);
                    } finally {
                      if (CC_DEBUG.on) {
                        debugTimeEnd('cc:state-serialize-after');
                      }
                      perfMark('cc:state-serialize-after:end');
                      perfMeasure(
                        'cc:state-serialize-after',
                        'cc:state-serialize-after:start',
                        'cc:state-serialize-after:end'
                      );
                    }

                    scheduleDeferredColorCycleSave({
                      layerId: shapeLayerIdString,
                      canvas: activeLayerCanvas,
                      beforeColorState: shapeBeforeColorState,
                      afterColorState,
                      actionType: 'fill',
                      description: 'CC Shape Linear',
                      tool: tools.currentTool,
                      coalesce: undefined,
                      beforeImage: null,
                      skipBitmapDelta: true,
                      roi: shapeCaptureRoi,
                    });
                  }

                  if (drawingCtxRef.current && drawingCanvasRef.current) {
                    drawingCtxRef.current.clearRect(
                      0,
                      0,
                      drawingCanvasRef.current.width,
                      drawingCanvasRef.current.height
                    );
                  }
                } catch (error) {
                  logError('Color cycle linear shape fill failed', error);
                }
              })();
            });
          }

          if (CC_DEBUG.on) {
            debugTimeEnd('cc:visible-finalize');
          }
          perfMark('cc:visible-finalize:end');
          perfMeasure('cc:visible-finalize', 'cc:visible-finalize:start', 'cc:visible-finalize:end');
        }
        
        // Reset state
        isSelectingDirectionRef.current = false;
        directionPreviewRef.current = null;
        shapePointsRef.current = [];
        isDrawingShapeRef.current = false;
        
        ccShapePreviewPauseStartedRef.current = false;
        handledColorCycleShape = true;

        await resumeColorCycleAfterInteraction();
        if (isBusyRef) isBusyRef.current = false;
        return;
    } catch (error) {
      logError('Error during linear gradient direction selection:', error);
      } finally {
        if (isBusyRef) isBusyRef.current = false;
      }
    }
    
    try {
      // Ensure drawing canvas/context exist before we render any final content
      if (!drawingCtxRef.current || !drawingCanvasRef.current) {
        initDrawingCanvas();
      }
      if (isBusyRef) isBusyRef.current = true;
      
      // quiet
      if (isDrawingShapeRef.current && shapePointsRef.current.length >= 3) {
        const drawCtx = drawingCtxRef.current;
        if (drawCtx && brushEngine) {
          // quiet
          drawCtx.globalAlpha = 1.0;
          drawCtx.globalCompositeOperation = 'source-over';

          const beforeState = useAppStore.getState();
          const beforeLayer = beforeState.layers.find(l => l.id === beforeState.activeLayerId);
          const shapeLayerId = beforeLayer?.id ?? null;
          const shapeLayerCanvas = beforeLayer?.colorCycleData?.canvas ?? null;
          if (!shapeLayerId || !shapeLayerCanvas) {
            drawingCanvasHasContent.current = true;
            isSelectingDirectionRef.current = false;
            directionPreviewRef.current = null;
            await resumeColorCycleAfterInteraction();
            if (isBusyRef) isBusyRef.current = false;
            return;
          }
          const shapeLayerIdString: string = shapeLayerId;
          const shapeFlags = getColorCycleBrushFlags(beforeState.tools.brushSettings);
          const shouldSkipShapeBitmapClone =
            FF.CC_HISTORY_NO_BITMAP &&
            beforeLayer?.layerType === 'color-cycle' &&
            shapeFlags.isAny;
          shapeBeforeImage = shouldSkipShapeBitmapClone
            ? null
            : cloneImageData(beforeLayer?.imageData ?? null);
          const shapeBeforeColorState = beforeLayer && isColorCycleLayerWithData(beforeLayer)
            ? captureColorCycleBrushState(beforeLayer.id)
            : null;
          
          // Check if we're using a pixel brush - need crisp edges
          const isPixelBrush = tools.brushSettings.brushShape === BrushShape.PIXEL_ROUND || 
            (tools.brushSettings.brushShape === BrushShape.SQUARE && !tools.brushSettings.antialiasing);
          
          // Set ALL smoothing properties to ensure pixel-perfect shapes
          if (isPixelBrush) {
            drawCtx.imageSmoothingEnabled = false;
            drawCtx.imageSmoothingQuality = 'low';
          } else {
            drawCtx.imageSmoothingEnabled = true;
            drawCtx.imageSmoothingQuality = 'high';
          }
          
          // If drawing a Color Cycle Shape and auto-sampling is enabled, finalize gradient now
          try {
            const st = useAppStore.getState();
            const isCCShape = st.tools.brushSettings.brushShape === BrushShape.COLOR_CYCLE_SHAPE;
            if (isCCShape && st.tools.brushSettings.autoSampleGradient) {
              const finalPts = [...shapePointsRef.current];
              const maxStops = 6;
              const samplePts = equidistantPointsOnPolyline(finalPts, Math.min(maxStops, Math.max(1, finalPts.length)));
              if (samplePts.length > 0) {
                const colors = samplePts.map(p => sampleHexAt(p.x, p.y));
                const stops = colors.map((c, i) => ({ position: samplePts.length === 1 ? 0 : i / (samplePts.length - 1), color: c }));
                try {
                  setSharedColorCycleGradient(stops);
                } catch {
                  useAppStore.getState().setBrushSettings({ colorCycleGradient: stops });
                }
                try { brushEngine.updateColorCycleGradient?.(stops); } catch {}
                // One-shot: auto-disable sampling after applying for shapes
                try {
                  if (st.tools.brushSettings.autoSampleGradient) {
                    st.setBrushSettings({ autoSampleGradient: false });
                  }
                } catch {}
              }
            }
          } catch {}

          // Check if we're using a custom brush
          const isCustomBrush = tools.brushSettings.brushShape === BrushShape.CUSTOM;
          let customBrushImageData: ImageData | null = null;
          let customBrushWidth = 0;
          let customBrushHeight = 0;
          let isColorizable = false;
          
          if (isCustomBrush) {
            // Try to get custom brush from currentBrushTip first
            if (tools.brushSettings.currentBrushTip) {
              const brushTip = tools.brushSettings.currentBrushTip;
              customBrushImageData = brushTip.imageData;
              customBrushWidth = brushTip.width || brushTip.imageData.width;
              customBrushHeight = brushTip.height || brushTip.imageData.height;
              isColorizable = brushTip.isColorizable || tools.brushSettings.useSwatchColor || !!tools.brushSettings.customBrushColorCycle;
            } else if (tools.brushSettings.selectedCustomBrush) {
              // Look for custom brush in project's custom brushes from the store
              const currentState = useAppStore.getState();
              
              // First check temporary brush
              if (currentState.temporaryCustomBrush?.id === tools.brushSettings.selectedCustomBrush) {
                const tempBrush = currentState.temporaryCustomBrush;
                customBrushImageData = tempBrush.imageData;
                customBrushWidth = tempBrush.width;
                customBrushHeight = tempBrush.height;
                isColorizable = tools.brushSettings.useSwatchColor || !!tools.brushSettings.customBrushColorCycle;
              } else {
                // Then check saved custom brushes
                const customBrush = currentState.project?.customBrushes?.find(b => b.id === tools.brushSettings.selectedCustomBrush);
                if (customBrush) {
                  customBrushImageData = customBrush.imageData;
                  customBrushWidth = customBrush.width;
                  customBrushHeight = customBrush.height;
                  isColorizable = tools.brushSettings.useSwatchColor || !!tools.brushSettings.customBrushColorCycle;
                }
              }
            }
          }
          
          if (isCustomBrush && customBrushImageData) {
            try {
            // quiet
            } catch {}
            // Calculate scaled size based on brush settings, maintaining aspect ratio
            const scale = tools.brushSettings.size / 100;
            // Ensure at least 1px to avoid zero-size tiles causing artifacts
            const scaledWidth = Math.max(1, Math.round(customBrushWidth * scale));
            const scaledHeight = Math.max(1, Math.round(customBrushHeight * scale));
            
            // Create a pattern canvas at the scaled size
            const patternCanvas = document.createElement('canvas');
            patternCanvas.width = scaledWidth;
            patternCanvas.height = scaledHeight;
            const patternCtx = patternCanvas.getContext('2d');
            
            if (patternCtx) {
              // Create temp canvas for the original brush tip
              const tipCanvas = document.createElement('canvas');
              tipCanvas.width = customBrushWidth;
              tipCanvas.height = customBrushHeight;
              const tipCtx = tipCanvas.getContext('2d');
              
              if (tipCtx) {
                tipCtx.putImageData(customBrushImageData, 0, 0);
                
                // Apply color if the brush is colorizable
                if (isColorizable) {
                  tipCtx.globalCompositeOperation = 'source-atop';
                  tipCtx.fillStyle = tools.brushSettings.color;
                  tipCtx.fillRect(0, 0, tipCanvas.width, tipCanvas.height);
                }
                
                // Scale and draw to pattern canvas
                // Disable smoothing to prevent subpixel seams when the pattern repeats
                if (patternCtx) {
                  patternCtx.imageSmoothingEnabled = false;
                  try {
                    // Some browsers support this hint
                    patternCtx.imageSmoothingQuality = 'low';
                  } catch {}
                }
                // Use explicit src/dst rect signature to avoid implicit resampling differences
                patternCtx.drawImage(
                  tipCanvas,
                  0,
                  0,
                  tipCanvas.width,
                  tipCanvas.height,
                  0,
                  0,
                  scaledWidth,
                  scaledHeight
                );
                
                // Create pattern from the scaled brush
                const pattern = drawCtx.createPattern(patternCanvas, 'repeat');
                if (pattern) {
                  // Ensure no smoothing when painting the pattern fill
                  drawCtx.imageSmoothingEnabled = false;
                  drawCtx.fillStyle = pattern;
                  // quiet
                } else {
                  drawCtx.fillStyle = tools.brushSettings.color;
                  // quiet
                }
                
                // Clean up tip canvas to prevent memory leak
                tipCanvas.width = 1;
                tipCanvas.height = 1;
                tipCtx.clearRect(0, 0, 1, 1);
              } else {
                drawCtx.fillStyle = tools.brushSettings.color;
              }
              
              // Note: Do not mutate patternCanvas here; keep it intact until after fill
            } else {
              drawCtx.fillStyle = tools.brushSettings.color;
              
              // Leave patternCanvas intact; rely on GC after draw
            }
          } else {
            // Use solid color for non-custom brushes or if custom brush not found
            drawCtx.fillStyle = tools.brushSettings.color;
          }

          // Check if we're on a color cycle layer - if so, skip regular shape drawing
          const currentState = useAppStore.getState();
          const activeLayer = currentState.layers.find(l => l.id === currentState.activeLayerId);
          const isColorCycleLayer = activeLayer?.layerType === 'color-cycle';
          
          if (!isColorCycleLayer) {
            // Only draw regular shapes if NOT on a color cycle layer
            drawCtx.beginPath();
          if (isPixelBrush) {
            // For pixel brushes, snap all coordinates to integer pixels for crisp edges
            drawCtx.moveTo(Math.round(shapePointsRef.current[0].x), Math.round(shapePointsRef.current[0].y));
            for (let i = 1; i < shapePointsRef.current.length; i++) {
              drawCtx.lineTo(Math.round(shapePointsRef.current[i].x), Math.round(shapePointsRef.current[i].y));
            }
          } else {
            // Use original coordinates for smooth brushes
            drawCtx.moveTo(shapePointsRef.current[0].x, shapePointsRef.current[0].y);
            for (let i = 1; i < shapePointsRef.current.length; i++) {
              drawCtx.lineTo(shapePointsRef.current[i].x, shapePointsRef.current[i].y);
            }
          }
          drawCtx.closePath();
          drawCtx.fill();
          
          // Apply risograph effect if enabled (matching monolithic implementation)
          const risographIntensity = tools.brushSettings.risographIntensity || 0;
          if (risographIntensity > 0) {
            // Use GPU-accelerated risograph effect with cached pattern
            const pattern = getRisographPattern(drawCtx);
            
            if (pattern) {
              // Save current state
              drawCtx.save();
              
              // Add misregistration offset
              const effectStrength = risographIntensity / 100;
              const misregX = (Math.random() - 0.5) * effectStrength * 2;
              const misregY = (Math.random() - 0.5) * effectStrength * 2;
              drawCtx.translate(misregX, misregY);
              
              // Create clipping path for the polygon (with optional roughness)
              drawCtx.beginPath();
              if (isPixelBrush) {
                // For pixel brushes, use pixel-aligned coordinates
                drawCtx.moveTo(Math.round(shapePointsRef.current[0].x), Math.round(shapePointsRef.current[0].y));
                for (let i = 1; i < shapePointsRef.current.length; i++) {
                  if (tools.brushSettings.risographOutline) {
                    // Add slight roughness to edges only if outline is enabled
                    const roughX = Math.round(shapePointsRef.current[i].x + (Math.random() - 0.5) * effectStrength);
                    const roughY = Math.round(shapePointsRef.current[i].y + (Math.random() - 0.5) * effectStrength);
                    drawCtx.lineTo(roughX, roughY);
                  } else {
                    // Clean edges without roughness, pixel-aligned
                    drawCtx.lineTo(Math.round(shapePointsRef.current[i].x), Math.round(shapePointsRef.current[i].y));
                  }
                }
              } else {
                // For smooth brushes, use original coordinates
                drawCtx.moveTo(shapePointsRef.current[0].x, shapePointsRef.current[0].y);
                for (let i = 1; i < shapePointsRef.current.length; i++) {
                  if (tools.brushSettings.risographOutline) {
                    // Add slight roughness to edges only if outline is enabled
                    const roughX = shapePointsRef.current[i].x + (Math.random() - 0.5) * effectStrength;
                    const roughY = shapePointsRef.current[i].y + (Math.random() - 0.5) * effectStrength;
                    drawCtx.lineTo(roughX, roughY);
                  } else {
                    // Clean edges without roughness
                    drawCtx.lineTo(shapePointsRef.current[i].x, shapePointsRef.current[i].y);
                  }
                }
              }
              drawCtx.closePath();
              drawCtx.clip();
              
              // Apply texture with appropriate alpha based on brush type
              // Shape fills need stronger effect since they don't have overlapping stamps like strokes
              // Use higher multiplier to match visual strength of strokes
              const risoAlpha = isPixelBrush ? 0.8 : 0.5;
              
              drawCtx.globalCompositeOperation = 'multiply';
              drawCtx.globalAlpha = effectStrength * risoAlpha;
              drawCtx.fillStyle = pattern;
              drawCtx.fillRect(0, 0, drawCtx.canvas.width, drawCtx.canvas.height);
              
              // Restore state
              drawCtx.restore();
            }
          }
          } // End of !isColorCycleLayer block
          
          // Don't need to check again - we already have isColorCycleLayer from above
          
          // For color cycle layer, we need to fill the shape and render it
          if (isColorCycleLayer && drawCtx) {
            // Don't stop the animation - let it continue if it's playing
            // We'll just add the shape to the color cycle layers
            
            // Reset and fill the shape with color cycle gradient
            // Pass false to keep existing shapes (we already saved state above)
            brushEngine.resetColorCycle(false);
            
            // Check fill mode and fill accordingly
            if (shapePointsRef.current.length >= 3) {
              const fillMode = tools.brushSettings.colorCycleFillMode || 'concentric';
              // quiet
              
              const activeSettings = tools.brushSettings;

              if (fillMode === 'linear') {
                const points = shapePointsRef.current.filter((pt): pt is { x: number; y: number } => Boolean(pt));
                const firstPoint = points[0];
                let minX = firstPoint.x;
                let maxX = firstPoint.x;
                let minY = firstPoint.y;
                let maxY = firstPoint.y;
                for (let i = 1; i < points.length; i++) {
                  const pt = points[i];
                  if (pt.x < minX) minX = pt.x;
                  if (pt.x > maxX) maxX = pt.x;
                  if (pt.y < minY) minY = pt.y;
                  if (pt.y > maxY) maxY = pt.y;
                }
                const width = Math.max(1e-3, maxX - minX);
                const height = Math.max(1e-3, maxY - minY);
                const primaryHorizontal = width >= height;
                const fallback = primaryHorizontal
                  ? { x: width / 2, y: 0 }
                  : { x: 0, y: height / 2 };
                const direction = (Number.isFinite(fallback.x) && Number.isFinite(fallback.y))
                  ? fallback
                  : { x: 1, y: 0 };

                const shapePointsSnapshot = [...points];
                const directionSnapshot = { ...direction };
                const activeLayerCanvasLinear = activeLayer?.colorCycleData?.canvas ?? null;
                const overlayCtx = drawCtx;
                const overlayCanvas = drawingCanvasRef.current;
                const fallbackBlendMode = activeSettings?.blendMode || 'source-over';
                const fallbackOpacity = activeSettings?.opacity ?? 1;

                let shapeCaptureRoi: CaptureRegion | undefined;
                if (FF.CC_CAPTURE_ROI) {
                  perfMark('cc:roi:start');
                  shapeCaptureRoi = captureRegionFromPoints(
                    shapePointsSnapshot,
                    ROI_PADDING_PX,
                    project
                  );
                  perfMark('cc:roi:end');
                  perfMeasure('cc:roi', 'cc:roi:start', 'cc:roi:end');
                } else {
                  shapeCaptureRoi = undefined;
                }

                perfMark('cc:visible-finalize:start');
                if (CC_DEBUG.on) {
                  debugTime('cc:visible-finalize');
                }

                drawingCanvasHasContent.current = false;

                if (activeLayerId && activeLayerCanvasLinear) {
                  runIdle(() => {
                    void (async () => {
                      try {
                        await timeAsync('cc:shape:fill(linear)', async () => {
                          brushEngine.resetColorCycle(false);
                          await brushEngine.fillColorCycleShapeLinear(shapePointsSnapshot, directionSnapshot);
                        });

                        timeSync('cc:shape:texture', () => {
                          brushEngine.updateColorCycleTexture();
                        });

                        const colorCycleBrushManager = getColorCycleBrushManager();
                        const colorCycleBrush = colorCycleBrushManager.getBrush(activeLayerId) as
                          | ManagedColorCycleBrush
                          | undefined;

                        if (colorCycleBrush) {
                          bindBrushToCanvas(colorCycleBrush, activeLayerCanvasLinear);
                          timeSync('cc:shape:render', () => {
                            colorCycleBrush.renderDirectToCanvas(activeLayerCanvasLinear, activeLayerId);
                          });
                        } else {
                          timeSync('cc:shape:render(fallback)', () => {
                            const targetCtx = activeLayerCanvasLinear.getContext('2d', { willReadFrequently: true });
                            if (targetCtx && overlayCanvas) {
                              targetCtx.save();
                              targetCtx.globalCompositeOperation = fallbackBlendMode;
                              targetCtx.globalAlpha = fallbackOpacity;
                              targetCtx.drawImage(overlayCanvas, 0, 0);
                              targetCtx.restore();
                            }
                          });
                        }

                        try {
                          window.dispatchEvent(new CustomEvent('colorCycleFrameUpdate'));
                          ccLog('shape: frameUpdate dispatched', { mode: 'linear' });
                        } catch {}

                        if (shapeLayerId) {
                          ccLog('shape: wrote CC canvas', { mode: 'linear', layerId: shapeLayerIdString.slice(-6) });
                          perfMark('cc:state-serialize-after:start');
                          if (CC_DEBUG.on) {
                            debugTime('cc:state-serialize-after');
                          }
                          let afterColorState: ColorCycleSerializedState | null = null;
                          try {
                            afterColorState = captureColorCycleBrushState(shapeLayerIdString);
                          } finally {
                            if (CC_DEBUG.on) {
                              debugTimeEnd('cc:state-serialize-after');
                            }
                            perfMark('cc:state-serialize-after:end');
                            perfMeasure(
                              'cc:state-serialize-after',
                              'cc:state-serialize-after:start',
                              'cc:state-serialize-after:end'
                            );
                          }
                          scheduleDeferredColorCycleSave({
                            layerId: shapeLayerIdString,
                            canvas: activeLayerCanvasLinear,
                            beforeColorState: shapeBeforeColorState,
                            afterColorState,
                            actionType: 'fill',
                            description: 'CC Shape Linear',
                            tool: tools.currentTool,
                            coalesce: undefined,
                            beforeImage: null,
                            skipBitmapDelta: true,
                            roi: shapeCaptureRoi,
                          });
                        }

                        if (overlayCtx && overlayCanvas) {
                          overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
                        }
                      } catch (error) {
                        logError('Color cycle linear shape fill failed', error);
                      }
                    })();
                  });
                }

                if (CC_DEBUG.on) {
                  debugTimeEnd('cc:visible-finalize');
                }
                perfMark('cc:visible-finalize:end');
                perfMeasure('cc:visible-finalize', 'cc:visible-finalize:start', 'cc:visible-finalize:end');

                handledColorCycleShape = handledColorCycleShape || Boolean(activeLayerId && activeLayer?.colorCycleData?.canvas);
                isSelectingDirectionRef.current = false;
                directionPreviewRef.current = null;
              } else {
                const shapePointsSnapshot = [...shapePointsRef.current];
                const activeLayerCanvasConcentric = activeLayer?.colorCycleData?.canvas ?? null;
                const overlayCtx = drawCtx;
                const overlayCanvas = drawingCanvasRef.current;
                const fallbackBlendMode = tools.brushSettings?.blendMode || 'source-over';
                const fallbackOpacity = tools.brushSettings?.opacity ?? 1;

                let shapeCaptureRoi: CaptureRegion | undefined;
                if (FF.CC_CAPTURE_ROI) {
                  perfMark('cc:roi:start');
                  shapeCaptureRoi = captureRegionFromPoints(
                    shapePointsSnapshot,
                    ROI_PADDING_PX,
                    project
                  );
                  perfMark('cc:roi:end');
                  perfMeasure('cc:roi', 'cc:roi:start', 'cc:roi:end');
                } else {
                  shapeCaptureRoi = undefined;
                }

                perfMark('cc:visible-finalize:start');
                if (CC_DEBUG.on) {
                  debugTime('cc:visible-finalize');
                }

                drawingCanvasHasContent.current = false;

                if (activeLayerId && activeLayerCanvasConcentric) {
                  runIdle(() => {
                    void (async () => {
                      try {
                        await timeAsync('cc:shape:fill(concentric)', async () => {
                          brushEngine.resetColorCycle(false);
                          await brushEngine.fillColorCycleShape(shapePointsSnapshot);
                        });

                        timeSync('cc:shape:texture', () => {
                          brushEngine.updateColorCycleTexture();
                        });

                        const colorCycleBrushManager = getColorCycleBrushManager();
                        const colorCycleBrush = colorCycleBrushManager.getBrush(activeLayerId) as
                          | ManagedColorCycleBrush
                          | undefined;

                        if (colorCycleBrush) {
                          bindBrushToCanvas(colorCycleBrush, activeLayerCanvasConcentric);
                          timeSync('cc:shape:render', () => {
                            colorCycleBrush.renderDirectToCanvas(activeLayerCanvasConcentric, activeLayerId);
                          });
                        }

                        try {
                          window.dispatchEvent(new CustomEvent('colorCycleFrameUpdate'));
                          ccLog('shape: frameUpdate dispatched', { mode: 'concentric' });
                        } catch {}

                        if (shapeLayerId) {
                          ccLog('shape: wrote CC canvas', { mode: 'concentric', layerId: shapeLayerIdString.slice(-6) });
                          perfMark('cc:state-serialize-after:start');
                          if (CC_DEBUG.on) {
                            debugTime('cc:state-serialize-after');
                          }
                          let afterColorState: ColorCycleSerializedState | null = null;
                          try {
                            afterColorState = captureColorCycleBrushState(shapeLayerIdString);
                          } finally {
                            if (CC_DEBUG.on) {
                              debugTimeEnd('cc:state-serialize-after');
                            }
                            perfMark('cc:state-serialize-after:end');
                            perfMeasure(
                              'cc:state-serialize-after',
                              'cc:state-serialize-after:start',
                              'cc:state-serialize-after:end'
                            );
                          }
                          scheduleDeferredColorCycleSave({
                            layerId: shapeLayerIdString,
                            canvas: activeLayerCanvasConcentric,
                            beforeColorState: shapeBeforeColorState,
                            afterColorState,
                            actionType: 'fill',
                            description: 'CC Shape',
                            tool: tools.currentTool,
                            coalesce: undefined,
                            beforeImage: null,
                            skipBitmapDelta: true,
                            roi: shapeCaptureRoi,
                          });
                        }

                        if (overlayCtx && overlayCanvas && activeLayerCanvasConcentric) {
                          timeSync('cc:shape:renderOverlay', () => {
                            overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
                            overlayCtx.globalAlpha = fallbackOpacity;
                            overlayCtx.globalCompositeOperation = fallbackBlendMode;
                            overlayCtx.drawImage(activeLayerCanvasConcentric, 0, 0);
                          });
                        }
                      } catch (error) {
                        logError('Color cycle concentric shape fill failed', error);
                      }
                    })();
                  });
                }

                if (CC_DEBUG.on) {
                  debugTimeEnd('cc:visible-finalize');
                }
                perfMark('cc:visible-finalize:end');
                perfMeasure('cc:visible-finalize', 'cc:visible-finalize:start', 'cc:visible-finalize:end');

                handledColorCycleShape = handledColorCycleShape || Boolean(activeLayerId && activeLayer?.colorCycleData?.canvas);
              }
            }
          }
          
          drawingCanvasHasContent.current = false;
        }
        
        // Only clear shape points if we're NOT in direction selection mode
        // Linear mode needs to keep the points for when direction is selected
        // quiet
        if (!isSelectingDirectionRef.current) {
          // quiet
          shapePointsRef.current = [];
          isDrawingShapeRef.current = false;
        } else {
          // quiet
        }
        
        // FIXED: For CC shapes on CC layers, handle finalization directly without calling finalizeDrawing
        // which would clear the drawing canvas and make the shape disappear
        const currentState = useAppStore.getState();
        const activeLayer = currentState.layers.find(l => l.id === currentState.activeLayerId);
        const isColorCycleLayer = activeLayer?.layerType === 'color-cycle';
        
        if (isColorCycleLayer && handledColorCycleShape) {
          // For CC layers, the save already happened after drawing the shape
          // No need to save again here

          // Reset auto-sample state after shape ends
          autoSamplePointsRef.current = [];
          autoSampleLastUpdateRef.current = 0;
          // Allow the next CC shape preview to restart animation helpers
          ccShapePreviewPauseStartedRef.current = false;
          await resumeColorCycleAfterInteraction();
          resetPolygonState();
          if (isBusyRef) isBusyRef.current = false;
          finalizeTriggered = true;
          return;
        }

        const currentLayer = useAppStore.getState().layers.find(l => l.id === useAppStore.getState().activeLayerId);
        const drawingCanvas = drawingCanvasRef.current;
        if (drawingCanvas && currentLayer && currentLayer.layerType !== 'color-cycle') {
          const historyDescription = `Shape Fill: ${tools.brushSettings?.shapeFillMode ?? 'default'}`;
          await withTiming('cc:capture', () => captureCanvasToActiveLayer(drawingCanvas));
          await withTiming('cc:commit', () =>
            commitLayerHistory({
              layerId: currentLayer.id,
              beforeImage: shapeBeforeImage,
              beforeColorState: shapeBeforeColorState,
              actionType: 'fill',
              description: historyDescription,
              tool: tools.currentTool,
              bitmapRoi:
                project
                  ? boundingBoxToCaptureRegion(
                      strokeBoundingBoxRef.current,
                      ROI_PADDING_PX + strokeCapturePaddingRef.current,
                      project
                    )
                  : undefined,
            })
          );
          drawingCanvasHasContent.current = false;
          if (drawingCtxRef.current) {
            drawingCtxRef.current.clearRect(0, 0, drawingCanvas.width, drawingCanvas.height);
          }
          resetPolygonState();
          finalizeTriggered = true;
          ccShapePreviewPauseStartedRef.current = false;
          await resumeColorCycleAfterInteraction();
          if (isBusyRef) isBusyRef.current = false;
          return;
        }

        if (isBusyRef) isBusyRef.current = false;
        await finalizeDrawing();
        finalizeTriggered = true;
        ccShapePreviewPauseStartedRef.current = false;
        await resumeColorCycleAfterInteraction();
        return;
      } else if (isDrawingShapeRef.current) {
        shapePointsRef.current = [];
        isDrawingShapeRef.current = false;
      }

      if (!finalizeTriggered) {
        if (isBusyRef) {
          isBusyRef.current = false;
        }
        await finalizeDrawing();
        finalizeTriggered = true;
        resetPolygonState();
      }
    } catch (error) {
      logError('Error during shape finalization:', error);
    } finally {
      if (isBusyRef) isBusyRef.current = false;
    }
    }); // End of FinalizeQueue.enqueue
    return;
  }, [
    tools.shapeMode,
    tools.brushSettings,
    tools.currentTool,
    brushEngine,
    finalizeDrawing,
    isBusyRef,
    activeLayerId,
    initDrawingCanvas,
    equidistantPointsOnPolyline,
    sampleHexAt,
    resumeColorCycleAfterInteraction,
    resetPolygonState,
    captureCanvasToActiveLayer,
    project,
    scheduleDeferredColorCycleSave,
    runIdle
  ]);
  
  // Helper function to render all visible color cycle layers
  const renderAllColorCycleLayers = useCallback((targetCtx?: CanvasRenderingContext2D, onlyActiveLayer: boolean = false) => {
    const currentState = useAppStore.getState();
    let hasRendered = false;

    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    if (now - renderAllCCLogTSRef.current > 1000) {
      const ccLayersSnapshot = currentState.layers.filter(layer => layer.layerType === 'color-cycle');
          const animatingCount = ccLayersSnapshot.filter(layer => layer.colorCycleData?.isAnimating).length;
      ccLog('renderAllCC', {
        onlyActiveLayer,
        ccLayers: ccLayersSnapshot.length,
        animating: animatingCount
      });
      renderAllCCLogTSRef.current = now;
    }
    
    // Iterate through all layers and render color cycles
    currentState.layers.forEach(layer => {
      // Skip if we only want active layer and this isn't it
      if (onlyActiveLayer && layer.id !== currentState.activeLayerId) {
        return;
      }
      
      // Check if layer has color cycle and is visible
      if (layer.visible && layer.layerType === 'color-cycle' && 
          layer.colorCycleData?.canvas) {
        
        const colorCycleBrushManager = getColorCycleBrushManager();
        const colorCycleBrush = colorCycleBrushManager.getBrush(layer.id);
        if (!colorCycleBrush) return;

        const liveCanvas = refreshLayerCCSurface(colorCycleBrush, layer.id);
        if (!liveCanvas) {
          return;
        }

        let animatorUpdated = false;
        if (layer.colorCycleData.isAnimating) {
          colorCycleBrush.updateAnimation();
          animatorUpdated = true;
        }

        if (liveCanvas.isConnected) {
          bindBrushToCanvas(colorCycleBrush, liveCanvas);
        }
        if (!animatorUpdated) {
          colorCycleBrush.renderDirectToCanvas(liveCanvas, layer.id);
        }
        const maskCtx = liveCanvas.getContext('2d', { willReadFrequently: true });
        if (maskCtx) {
          maskManager.applyMaskToCanvas(layer.id, maskCtx);
        }
        hasRendered = true;

        if (
          targetCtx &&
          (layer.id === currentState.activeLayerId || !onlyActiveLayer)
        ) {
          targetCtx.globalAlpha = layer.opacity;
          targetCtx.globalCompositeOperation = layer.blendMode || 'source-over';
          targetCtx.drawImage(liveCanvas, 0, 0);
          hasRendered = true;
        }
      }
    });
    
    return hasRendered;
  }, [maskManager]);

  // Start continuous color cycle animation (for when play button is pressed)
  const startContinuousColorCycleAnimationCore = useCallback((reason = 'unknown') => {
    if (continuousColorCycleAnimationActiveRef.current && !continuousColorCycleAnimationRef.current) {
      ccLog('CC RAF stuck: activeRef=true but no RAF id -> resetting');
      continuousColorCycleAnimationActiveRef.current = false;
    }

    const rafAlive =
      typeof window !== 'undefined' && window.__ccRafAlive === true;

    let ccLayers: Layer[] = [];
    try {
      const st = useAppStore.getState();
      ccLayers = st.layers.filter(
        (layer) => layer.layerType === 'color-cycle' && layer.colorCycleData?.mode !== 'recolor'
      );
    } catch {}

    const ensureLayersAnimating = () => {
      try {
        const st = useAppStore.getState();
        ccLayers.forEach((layer) => {
          if (!layer.colorCycleData) {
            return;
          }
          if (layer.colorCycleData.isAnimating) {
            return;
          }
          st.updateLayer(layer.id, {
            colorCycleData: {
              ...layer.colorCycleData,
              isAnimating: true,
            },
          });
          ccLog('ensure isAnimating=true (noop start)', { id: layer.id.slice(-6), reason });
        });
      } catch {}
    };

    if (
      rafAlive ||
      continuousColorCycleAnimationActiveRef.current ||
      startingColorCycleAnimationRef.current
    ) {
      ccLog('startContinuousColorCycleAnimation noop (already running)', { reason, rafAlive });
      ensureLayersAnimating();
      return;
    }

    const allAnimating =
      ccLayers.length > 0 &&
      ccLayers.every((layer) => Boolean(layer.colorCycleData?.isAnimating));
    if (allAnimating) {
      ccLog('startContinuousColorCycleAnimation noop (all animating)', { reason });
      return;
    }

    const now =
      typeof performance !== 'undefined' && typeof performance.now === 'function'
        ? performance.now()
        : Date.now();
    if (now - lastStartAtRef.current < START_CC_COOLDOWN_MS) {
      ccLog('startContinuousColorCycleAnimation throttled', { reason });
      return;
    }
    lastStartAtRef.current = now;

    startingColorCycleAnimationRef.current = true;

    try {
      const state = useAppStore.getState();
      // Consider ALL brush-based color-cycle layers, regardless of active selection
      const ccLayers = state.layers.filter(l => l.layerType === 'color-cycle' && l.colorCycleData?.mode !== 'recolor');
      ccGroup('startContinuousColorCycleAnimation()', { reason, ccLayers: ccLayers.length });
      dumpLayerFlags();
      if (ccLayers.length === 0) {
        ccLog('abort: no brush CC layers');
        ccGroupEnd();
        return;
      }

      // Stop any existing continuous animation
      if (continuousColorCycleAnimationRef.current) {
        cancelAnimationFrame(continuousColorCycleAnimationRef.current);
        continuousColorCycleAnimationRef.current = null;
        ccLog('cancel prior RAF');
        if (typeof window !== 'undefined') {
          window.__ccRafAlive = false;
        }
      }

      // Ensure drawing canvas/context are ready
      let overlayReady = ensureOverlayInitialized();
      ccLog('overlay status', {
        reason,
        overlayReady,
        hasCanvas: !!drawingCanvasRef.current,
        hasCtx: !!drawingCtxRef.current
      });

      // Ensure CC brushes exist for all CC layers (idempotent)
      try {
        const mgr = getColorCycleBrushManager();
        const projW = state.project?.width || 1024;
        const projH = state.project?.height || 1024;
        ccLayers.forEach(l => {
          const hasBrush = !!mgr.getBrush(l.id);
          if (!hasBrush) {
            // Delegate to store action to create and wire layer canvas/metadata
            try { state.initColorCycleForLayer(l.id, projW, projH); ccLog('initColorCycleForLayer()', { id: l.id.slice(-6), reason }); } catch {}
          }
        });
      } catch {}

      if (!overlayReady && !getEffectiveColorCyclePlaying()) {
        overlayReady = ensureOverlayInitialized();
        ccLog('overlay retry', {
          reason,
          overlayReady,
          hasCanvas: !!drawingCanvasRef.current,
          hasCtx: !!drawingCtxRef.current
        });
      }

      // Mark ALL brush-based CC layers as animating so render loop advances them
      try {
        const st = useAppStore.getState();
        ccLayers.forEach(layer => {
          const updatedData: Layer['colorCycleData'] = {
            ...(layer.colorCycleData ?? {}),
            isAnimating: true,
          };
          st.updateLayer(layer.id, { colorCycleData: updatedData });
          ccLog('mark isAnimating=true', { id: layer.id.slice(-6), reason });
        });
      } catch {}

      // IMPORTANT: Do an initial render into layer canvases so the main canvas can refresh
      renderAllColorCycleLayers(undefined, false);
      try {
        window.dispatchEvent(new CustomEvent('colorCycleFrameUpdate'));
        ccLog('dispatched colorCycleFrameUpdate', { reason });
      } catch {}

      if (!overlayReady) {
        debugWarn('[DrawingHandlers] Overlay canvas not ready; animation will start once initialized');
        ccLog('overlay missing; defer animation', { reason });
      }

      // Resume the color cycle brush animation explicitly (avoid toggle side-effects) for active brush engine
      try {
        if (brushEngine) {
          brushEngine.ensureColorCycleAnimation?.(true);
          ccLog('ensureColorCycleAnimation(true)', { reason });
        }
      } catch {}

      // Overlay is idle during continuous playback; clear any stale flag
      drawingCanvasHasContent.current = false;
      firstPaintRef.current = true;
      lastRendererLogTS.current = 0;
      
      let lastRenderTime = 0;
      const targetFPS = 30; // Increased for smoother animation
      const frameInterval = 1000 / targetFPS;
      
      // Store the animation state on the ref so stop can access it
      continuousColorCycleAnimationActiveRef.current = true;

      const animateContinuousColorCycle = (timestamp: number) => {
        // IMMEDIATELY schedule the next frame to ensure continuity
        if (continuousColorCycleAnimationActiveRef.current) {
          continuousColorCycleAnimationRef.current = requestAnimationFrame(animateContinuousColorCycle);
          if (typeof window !== 'undefined') {
            window.__ccRafAlive = true;
          }
        } else {
          continuousColorCycleAnimationRef.current = null;
          if (typeof window !== 'undefined') {
            window.__ccRafAlive = false;
          }
          return;
        }
        
        // Then do the rendering work
        if (timestamp - lastRenderTime >= frameInterval) {
          const renderedAny = renderAllColorCycleLayers(undefined, false);

          if (renderedAny) {
            drawingCanvasHasContent.current = false;
          } else if (drawingCtxRef.current && drawingCanvasRef.current) {
            // Fallback: legacy renderer for compatibility (used when layer canvases unavailable)
            drawingCtxRef.current.clearRect(
              0,
              0,
              drawingCanvasRef.current.width,
              drawingCanvasRef.current.height
            );
            let shouldAdvance = false;
            try {
              shouldAdvance = !!(brushEngine.isColorCycleAnimating && brushEngine.isColorCycleAnimating());
              if (!shouldAdvance) {
                const st = useAppStore.getState();
                shouldAdvance = st.layers.some(
                  (layer) => layer.layerType === 'color-cycle' && !!layer.colorCycleData?.isAnimating
                );
              }
            } catch {}
            if (shouldAdvance) {
              brushEngine.updateColorCycleAnimation?.();
            }
            brushEngine.renderColorCycle(drawingCtxRef.current, true);
            drawingCanvasHasContent.current = true;
          }

          if (firstPaintRef.current) {
            ccLog('RAF first paint', { hadContent: renderedAny, reason });
            firstPaintRef.current = false;
          }

          const logNow = typeof performance !== 'undefined' ? performance.now() : Date.now();
          if (logNow - lastRendererLogTS.current > 1000) {
            const snapshot = useAppStore.getState();
            const animatingLayers = snapshot.layers.filter(
              (layer) => layer.layerType === 'color-cycle' && layer.colorCycleData?.isAnimating
            ).length;
            ccLog('RAF tick', { animatingLayers, reason });
            lastRendererLogTS.current = logNow;
          }

          try {
            window.dispatchEvent(new CustomEvent('colorCycleFrameUpdate'));
          } catch {}

          lastRenderTime = timestamp;
        }
      };
    
      // Start the animation
      continuousColorCycleAnimationRef.current = requestAnimationFrame(animateContinuousColorCycle);
      if (typeof window !== 'undefined') {
        window.__ccRafAlive = true;
      }

      ccGroupEnd();
    } finally {
      startingColorCycleAnimationRef.current = false;
    }
  }, [brushEngine, ensureOverlayInitialized, renderAllColorCycleLayers]);

  // DEBUG ONLY - throttle noisy trace logs to avoid console spam while retaining stack samples
  const startContinuousColorCycleAnimation = useCallback((reason = 'unknown') => {
    try {
      const rafAlive =
        typeof window !== 'undefined' && window.__ccRafAlive === true;
      if (
        rafAlive ||
        continuousColorCycleAnimationActiveRef.current ||
        startingColorCycleAnimationRef.current
      ) {
        return;
      }
    } catch {}

    const now =
      typeof performance !== 'undefined' && typeof performance.now === 'function'
        ? performance.now()
        : Date.now();
    const traceState = startContinuousColorCycleTraceStateRef.current;
    const lastLoggedAt = traceState.lastByReason[reason];
    const elapsed = lastLoggedAt === undefined ? Number.POSITIVE_INFINITY : now - lastLoggedAt;
    const shouldAttemptLog = elapsed >= START_CC_TRACE_THROTTLE_MS;

    if (CC_DEBUG.on && shouldAttemptLog) {
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
    } else if (CC_DEBUG.on && !shouldAttemptLog) {
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
  }, [startContinuousColorCycleAnimation]);

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
  }, [project, ensureOverlayInitialized, startContinuousColorCycleAnimation]);
  
  useEffect(() => {
    let previous = getEffectiveColorCyclePlaying();

    const syncPlayback = (playing: boolean, reason: CCReason) => {
      if (playing) {
        const rafAlive = typeof window !== 'undefined' && window.__ccRafAlive === true;
        let allAnimating = false;
        try {
          const st = useAppStore.getState();
          const ccLayers = st.layers.filter((layer) => layer.layerType === 'color-cycle');
          allAnimating =
            ccLayers.length > 0 &&
            ccLayers.every((layer) => !!layer.colorCycleData?.isAnimating);
        } catch {}
        if (!rafAlive && !continuousColorCycleAnimationActiveRef.current && !startingColorCycleAnimationRef.current) {
          try {
            const st = useAppStore.getState();
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
              rafAlive,
              allAnimating
            });
          }
        }
      } else {
        const rafAlive = typeof window !== 'undefined' && window.__ccRafAlive === true;
        let anyAnimating = false;
        try {
          const st = useAppStore.getState();
          anyAnimating = st.layers.some(
            (layer) => layer.layerType === 'color-cycle' && !!layer.colorCycleData?.isAnimating
          );
        } catch {}

        if (
          rafAlive ||
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
              rafAlive,
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
  }, [startContinuousColorCycleAnimation, stopContinuousColorCycleAnimation]);

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
    type AppState = ReturnType<typeof useAppStore.getState>;

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

    let previousSnapshots = buildSnapshot(useAppStore.getState().layers);

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
  }, []);
  
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
    commitRasterOverlay
  };
}

export type DrawingHandlers = ReturnType<typeof useDrawingHandlers>;

type CustomBrushStoreState = {
  tools: {
    brushSettings: BrushSettings;
  };
  temporaryCustomBrush?: CustomBrush | null;
  project?: {
    customBrushes?: CustomBrush[];
  } | null;
};

function resolveActiveCustomBrushData(state: CustomBrushStoreState): CustomBrushStrokeData | undefined {
  const settings = state.tools.brushSettings;

  if (settings.currentBrushTip) {
    const brushTip = settings.currentBrushTip;
    return {
      imageData: brushTip.imageData,
      width: brushTip.width || brushTip.imageData.width,
      height: brushTip.height || brushTip.imageData.height,
      isColorizable:
        brushTip.isColorizable || settings.useSwatchColor || !!settings.customBrushColorCycle,
      cacheKey: `tip:${brushTip.brushId ?? 'anon'}`
    };
  }

  if (settings.selectedCustomBrush) {
    if (state.temporaryCustomBrush?.id === settings.selectedCustomBrush) {
      const tempBrush = state.temporaryCustomBrush;
      return {
        imageData: tempBrush.imageData,
        width: tempBrush.width,
        height: tempBrush.height,
        isColorizable: settings.useSwatchColor || !!settings.customBrushColorCycle,
        cacheKey: `temp:${tempBrush.id ?? 'anon'}`
      };
    }

    const saved = state.project?.customBrushes?.find(
      brush => brush.id === settings.selectedCustomBrush
    );
    if (saved) {
      return {
        imageData: saved.imageData,
        width: saved.width,
        height: saved.height,
        isColorizable: settings.useSwatchColor || !!settings.customBrushColorCycle,
        cacheKey: `project:${saved.id ?? 'anon'}`
      };
    }
  }

  return undefined;
}

function getColorCycleBrushFlags(settings: BrushSettings) {
  const shape = settings.brushShape;
  const isStandard = shape === BrushShape.COLOR_CYCLE || shape === BrushShape.COLOR_CYCLE_TRIANGLE;
  const isShapeVariant = shape === BrushShape.COLOR_CYCLE_SHAPE;
  const isCustom = shape === BrushShape.CUSTOM && settings.customBrushColorCycle === true;
  return {
    isStandard,
    isShapeVariant,
    isCustom,
    isAny: isStandard || isShapeVariant || isCustom
  };
}

export const __TESTING__ = {
  computeStrokeCapturePadding,
  resolveActiveCustomBrushData
};
