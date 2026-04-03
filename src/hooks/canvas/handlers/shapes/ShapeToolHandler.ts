import type React from 'react';
import { useAppStore } from '../../../../stores/useAppStore';
import type { EventHandlerDependencies } from '../../utils/types';
import { BrushShape, type BrushSettings, type Layer } from '@/types';
import { snapPointToAngle } from '@/utils/angleSnap';
import { computeDragScaledValue } from '@/utils/dragScale';
import { withTemporaryBrushSettings } from '@/utils/withTemporaryBrushSettings';
import { computeShapeFillColors, toOpaqueColorString, type ShapeFillColors } from '@/shapeFill/colorUtils';
import { OpController, CanvasManager } from '@/lib/canvas';
import { MIN_LINE_SPACING } from '@/utils/contourLines';
import { getPreviewRenderer } from '@/shapeFill/paramPreview';
import { getFillStrategy } from '@/shapeFill/strategies';
import { renderFill } from '@/shapeFill/renderers/cpuRenderer';
import { toPixelPerfectFill } from '@/shapeFill/pixelPerfect';
import { FillStage, type FillParams, type ShapeFillSession, type ShapeFillParamKey } from '@/shapeFill/types';
import { registerToolFlush } from '@/utils/toolFlushRegistry';
import { snapPointToPixel } from '@/utils/pixelSharp';
import { applyLostEdgeErosionToContext } from '@/shapeFill/lostEdgeErosion';
import { canvasPool } from '@/utils/canvasPool';
import {
  scaleOrderedAxis,
  renderDitherGradientToImageData,
  resolveDitherGradPalette,
} from '@/utils/orderedDitherGradient';
import {
  computePressureResolution,
  createPressureResolutionState,
  resolvePressureLinkedFillMaxResolution,
  type PressureResolutionState,
} from '@/utils/pressureResolution';
import {
  DEFAULT_COLOR_CYCLE_GRADIENT,
  buildForegroundDerivedGradientSpec,
  clampForegroundDerivedBands,
  deriveForegroundGradientStops,
} from '@/utils/colorCycleGradients';
import { buildCcDitherRuntimePalette, resolveCcDitherBandMode } from '@/utils/colorCycle/ccDitherRenderPalette';
import { ccLog } from '@/utils/colorCycle/ccDebug';
import { fillCcGradientDither } from '@/utils/colorCycle/ccGradientDither';
import { getActiveMarkGradientSession, getPreviewGradientForActiveMark } from '@/hooks/canvas/utils/colorCycleMarkSession';
import { parseCssColorToRgba } from '@/hooks/canvas/utils/colorCycleHelpers';
import { applyPolygonMaskToCanvasContext } from '@/hooks/canvas/handlers/shapes/shapePreviewMask';
import { hashNumbers } from '@/utils/risographTexture';

const SHAPE_PREVIEW_OPACITY = 0.6;

type ShapeAdjustHelperUpdate = {
  spacing: number;
  density?: number;
  orientation?: number;
  noiseStrength?: number;
  band?: string;
};

type ShapeFillOptions = Record<string, unknown>;

type ShapeFillScheduler = {
  dispatchJobUpdate: (update: unknown) => void;
};

type ShapeAdjustHelperConfig = {
  getOverlayCanvas?: () => HTMLCanvasElement | null | undefined;
  getViewTransform?: () => unknown;
  onUpdate: (update: ShapeAdjustHelperUpdate) => void;
  onCommit?: (update: ShapeAdjustHelperUpdate) => void;
  onCancel?: () => void;
  spacingBounds?: { min: number; max: number; exponent?: number };
  densityBounds?: { min: number; max: number; exponent?: number };
  noiseBounds?: { min: number; max: number };
  orientationSnap?: number;
};

class ShapeAdjustHelper {
  constructor(config: ShapeAdjustHelperConfig) {
    void config;
  }
  destroy(): void {}
  isActive(): boolean {
    return false;
  }
  beginSession(session: {
    centroid: { x: number; y: number };
    vertices: Array<{ x: number; y: number }>;
    initialSpacing: number;
    initialDensity: number;
    initialOrientation: number;
    initialNoise: number;
  }): void {
    void session;
  }
  beginDrag(
    point: { x: number; y: number },
    pointerId: number,
    modifiers?: { shiftKey?: boolean }
  ): void {
    void point;
    void pointerId;
    void modifiers;
  }
  updateDrag(
    point: { x: number; y: number },
    pointerId: number,
    modifiers?: { shiftKey?: boolean }
  ): void {
    void point;
    void pointerId;
    void modifiers;
  }
  endDrag(pointerId: number, commit: boolean): ShapeAdjustHelperUpdate | null {
    void pointerId;
    void commit;
    return null;
  }
  isDragging(pointerId: number): boolean {
    void pointerId;
    return false;
  }
  getCurrentValues(): ShapeAdjustHelperUpdate | null {
    return null;
  }
}

  const getShapeFillScheduler = (): ShapeFillScheduler | null => null;

  const LOST_EDGE_TILE_SIZE = 4;


const CONTOUR_DEBUG_STORAGE_KEY = 'vessel.debug.contour';

const isContourDebugEnabled = () => {
  if (typeof globalThis === 'undefined') return false;
  const globalAny = globalThis as typeof globalThis & { __CONTOUR_DEBUG?: boolean; localStorage?: Storage };
  if (typeof globalAny.__CONTOUR_DEBUG === 'boolean') {
    return globalAny.__CONTOUR_DEBUG;
  }
  try {
    const stored = globalAny.localStorage?.getItem(CONTOUR_DEBUG_STORAGE_KEY);
    if (stored != null) {
      const enabled = stored === '1';
      globalAny.__CONTOUR_DEBUG = enabled;
      return enabled;
    }
  } catch {
    // ignore storage issues
  }
  const fallback = false;
  globalAny.__CONTOUR_DEBUG = fallback;
  return fallback;
};

const ensureContourDebugBridge = () => {
  if (typeof globalThis === 'undefined') return;
  const globalAny = globalThis as typeof globalThis & { __CONTOUR_DEBUG?: boolean; __setContourDebug?: (enabled: boolean) => void; localStorage?: Storage };
  if (!globalAny.__setContourDebug) {
    globalAny.__setContourDebug = (enabled: boolean) => {
      globalAny.__CONTOUR_DEBUG = enabled;
      try {
        globalAny.localStorage?.setItem(CONTOUR_DEBUG_STORAGE_KEY, enabled ? '1' : '0');
      } catch {
        // storage may fail silently
      }
      console.info('[ContourShape]', `Contour debug ${enabled ? 'enabled' : 'disabled'}`);
    };
  }

  if (typeof globalAny.__CONTOUR_DEBUG !== 'boolean') {
    try {
      const stored = globalAny.localStorage?.getItem(CONTOUR_DEBUG_STORAGE_KEY);
      if (stored != null) {
        globalAny.__CONTOUR_DEBUG = stored === '1';
      } else {
        globalAny.__CONTOUR_DEBUG = false;
      }
    } catch {
      globalAny.__CONTOUR_DEBUG = false;
    }
  }
};

ensureContourDebugBridge();

const contourDebug = (label: string, payload?: Record<string, unknown>) => {
  if (!isContourDebugEnabled()) return;
  if (payload) {
    console.debug('[ContourShape]', label, payload);
  } else {
    console.debug('[ContourShape]', label);
  }
};

type ShapeFillBoundingBox = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
};

const SHAPE_FILL_ROI_PADDING = 2;

type DitherGradPreviewState = {
  origin: { x: number; y: number } | null;
  lastPx: number;
  resState: PressureResolutionState;
  ccJobInFlight: boolean;
  ccJobDirty: boolean;
  ccJobSeq: number;
  ccLastCanvas?: HTMLCanvasElement;
  ccLastOrigin?: { x: number; y: number };
};

const ditherGradPreviewStateByCanvas = new WeakMap<
  React.RefObject<HTMLCanvasElement>,
  DitherGradPreviewState
>();

const getDitherGradPreviewState = (
  canvasRef: React.RefObject<HTMLCanvasElement>
): DitherGradPreviewState => {
  const existing = ditherGradPreviewStateByCanvas.get(canvasRef);
  if (existing) {
    return existing;
  }
  const created: DitherGradPreviewState = {
    origin: null,
    lastPx: -1,
    resState: createPressureResolutionState(1),
    ccJobInFlight: false,
    ccJobDirty: false,
    ccJobSeq: 0,
  };
  ditherGradPreviewStateByCanvas.set(canvasRef, created);
  return created;
};

const snapshotLayerImageData = (layer: Layer | null | undefined): ImageData | null => {
  if (!layer) return null;
  if (layer.imageData) {
    return new ImageData(new Uint8ClampedArray(layer.imageData.data), layer.imageData.width, layer.imageData.height);
  }
  const framebuffer = layer.framebuffer;
  if (!framebuffer) {
    return null;
  }
  try {
    const fbCtx = framebuffer.getContext(
      '2d',
      { willReadFrequently: true } as CanvasRenderingContext2DSettings
    ) as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
    if (!fbCtx) {
      return null;
    }
    return fbCtx.getImageData(0, 0, framebuffer.width, framebuffer.height);
  } catch {
    return null;
  }
};

const applyTransparencyLockMaskToContext = (
  targetCtx: CanvasRenderingContext2D,
  layer: Layer,
  fallbackMaskImage: ImageData | null = null
): void => {
  if (layer.transparencyLocked !== true) {
    return;
  }

  const targetWidth = targetCtx.canvas.width | 0;
  const targetHeight = targetCtx.canvas.height | 0;
  if (!targetWidth || !targetHeight) {
    return;
  }

  let hasMaskSource = false;
  const maskImage = layer.imageData ?? fallbackMaskImage;

  targetCtx.save();
  targetCtx.globalCompositeOperation = 'destination-in';

  const framebuffer = layer.framebuffer;
  if (framebuffer && framebuffer.width > 0 && framebuffer.height > 0) {
    try {
      targetCtx.drawImage(framebuffer as CanvasImageSource, 0, 0, targetWidth, targetHeight);
      hasMaskSource = true;
    } catch {
      // Fallback to image-data mask below.
    }
  }

  if (!hasMaskSource && maskImage) {
    const maskCanvas = canvasPool.acquire(maskImage.width, maskImage.height);
    try {
      const maskCtx = maskCanvas.getContext(
        '2d',
        { willReadFrequently: true } as CanvasRenderingContext2DSettings
      );
      if (maskCtx) {
        maskCtx.setTransform(1, 0, 0, 1, 0, 0);
        maskCtx.clearRect(0, 0, maskCanvas.width, maskCanvas.height);
        maskCtx.putImageData(maskImage, 0, 0);
        targetCtx.drawImage(maskCanvas, 0, 0, targetWidth, targetHeight);
        hasMaskSource = true;
      }
    } finally {
      canvasPool.release(maskCanvas);
    }
  }

  targetCtx.restore();

  if (!hasMaskSource) {
    targetCtx.clearRect(0, 0, targetWidth, targetHeight);
  }
};

const computeBoundingBox = (points: Array<{ x: number; y: number }>): ShapeFillBoundingBox | null => {
  if (points.length === 0) {
    return null;
  }
  let minX = points[0].x;
  let maxX = points[0].x;
  let minY = points[0].y;
  let maxY = points[0].y;
  for (let i = 1; i < points.length; i += 1) {
    const point = points[i];
    if (point.x < minX) minX = point.x;
    if (point.x > maxX) maxX = point.x;
    if (point.y < minY) minY = point.y;
    if (point.y > maxY) maxY = point.y;
  }
  return { minX, minY, maxX, maxY };
};

const createPreviewYieldController = () => {
  let sliceStart = typeof performance !== 'undefined' ? performance.now() : Date.now();
  return async (row: number) => {
    if ((row & 0x3f) !== 0) {
      return;
    }
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    if (now - sliceStart > 8) {
      await new Promise<void>(resolve => setTimeout(resolve, 0));
      sliceStart = typeof performance !== 'undefined' ? performance.now() : Date.now();
    }
  };
};

const boundingBoxToRoi = (
  bbox: ShapeFillBoundingBox | null,
  project: { width: number; height: number } | null | undefined
): { x: number; y: number; width: number; height: number } | undefined => {
  if (!bbox || !project) {
    return undefined;
  }
  const x = Math.max(0, Math.floor(Math.min(bbox.minX, bbox.maxX)) - SHAPE_FILL_ROI_PADDING);
  const y = Math.max(0, Math.floor(Math.min(bbox.minY, bbox.maxY)) - SHAPE_FILL_ROI_PADDING);
  const right = Math.min(project.width, Math.ceil(Math.max(bbox.minX, bbox.maxX)) + SHAPE_FILL_ROI_PADDING);
  const bottom = Math.min(project.height, Math.ceil(Math.max(bbox.minY, bbox.maxY)) + SHAPE_FILL_ROI_PADDING);
  const width = Math.max(1, right - x);
  const height = Math.max(1, bottom - y);
  return { x, y, width, height };
};

type ShapeFillHistoryContext = {
  layerId?: string;
  beforeImage: ImageData | null;
  coalesceKey?: string;
  bbox: ShapeFillBoundingBox | null;
};

const shapeFillHistoryContext: ShapeFillHistoryContext = {
  layerId: undefined,
  beforeImage: null,
  coalesceKey: undefined,
  bbox: null,
};

const isShapeFillToolActive = (): boolean => {
  const state = useAppStore.getState();
  return state.tools.currentTool === 'brush' && state.tools.brushSettings.brushShape === BrushShape.SHAPE_FILL;
};

const resetShapeFillHistoryContext = () => {
  shapeFillHistoryContext.layerId = undefined;
  shapeFillHistoryContext.beforeImage = null;
  shapeFillHistoryContext.coalesceKey = undefined;
  shapeFillHistoryContext.bbox = null;
};

export interface ShapeToolHandlerContext {
  deps: EventHandlerDependencies;
  overlayPreviewFrameMs: number;
  getLastOverlayPreviewTs: () => number;
  setLastOverlayPreviewTs: (value: number) => void;
}

export interface ShapeToolHandlerDelegate {
  pointerDown?: (
    event: React.PointerEvent<HTMLCanvasElement>,
    context: ShapeToolHandlerContext
  ) => boolean;
  pointerMove?: (
    event: React.PointerEvent<HTMLCanvasElement>,
    context: ShapeToolHandlerContext
  ) => boolean;
  pointerUp?: (
    event: React.PointerEvent<HTMLCanvasElement>,
    context: ShapeToolHandlerContext
  ) => boolean;
}

export interface ShapeToolHandler {
  handlePointerDown: (event: React.PointerEvent<HTMLCanvasElement>) => boolean;
  handlePointerMove: (event: React.PointerEvent<HTMLCanvasElement>) => boolean;
  handlePointerUp: (event: React.PointerEvent<HTMLCanvasElement>) => boolean;
}

export const clampTriangleSize = (value: number) => Math.min(200, Math.max(8, value));

const TRIANGLE_SIZE_EXPONENT = 1.1;
const CROSSHATCH_SPACING_EXPONENT = 1.05;
const FLOW_SPACING_EXPONENT = 1.05;

export const createShapeToolHandler = (
  context: ShapeToolHandlerContext,
  delegate: ShapeToolHandlerDelegate
): ShapeToolHandler => {
  const safeDelegate: ShapeToolHandlerDelegate = delegate ?? {};

  // Dither gradient preview anchoring (persist across handler recreation)
  const ditherGradPreviewState = getDitherGradPreviewState(context.deps.canvasRef);
  const resetDitherGradOrigin = () => {
    ditherGradPreviewState.origin = null;
    ditherGradPreviewState.lastPx = -1;
    ditherGradPreviewState.resState = createPressureResolutionState(1);
    ditherGradPreviewState.ccJobDirty = false;
    ditherGradPreviewState.ccJobInFlight = false;
    ditherGradPreviewState.ccJobSeq += 1;
    if (ditherGradPreviewState.ccLastCanvas) {
      canvasPool.release(ditherGradPreviewState.ccLastCanvas);
    }
    ditherGradPreviewState.ccLastCanvas = undefined;
    ditherGradPreviewState.ccLastOrigin = undefined;
    if (drawingHandlers.ccShapePreviewCacheRef) {
      drawingHandlers.ccShapePreviewCacheRef.current = null;
    }
  };

  const {
    canvasRef,
    canvas,
    pan,
    drawingHandlers,
    brushEngine,
    tools,
    overlayCanvasRef,
    compositeCanvasRef,
    compositeCanvasDirtyRef,
    compositeLayersToCanvas,
    setCurrentOffscreenCanvas,
    project,
    stateMachine,
    setNeedsRedraw,
    viewTransformRef,
    sampleColorAtPosition,
    previewAnimationFrameRef,
    layers,
    activeLayerId,
    interaction,
    feedback,
  } = context.deps;

  const logShapeSnapshot = (label: string, extra: Record<string, unknown> = {}) => {
    if (!isContourDebugEnabled()) return;
    const snapshot = context.deps.dynamicDepsRef.current;
    contourDebug(label, {
      tool: snapshot.tools.currentTool,
      brushShape: snapshot.tools.brushSettings.brushShape,
      activeLayerId: snapshot.activeLayerId,
      projectSize: snapshot.project ? `${snapshot.project.width}x${snapshot.project.height}` : null,
      ...extra,
    });
  };

  const restartColorCycleAnimation = context.deps.restartColorCycleAnimation;

  // Operation tracking and canvas management
  const opController = new OpController();
  const canvasManager = new CanvasManager();

  const SHAPE_FILL_FLUSH_KEY = 'shape-tool:shape-fill-finalize';
  let pendingShapeFillFinalize: Promise<void> | null = null;
  let latestPolygonPreviewPoint: { x: number; y: number } | null = null;

  registerToolFlush(SHAPE_FILL_FLUSH_KEY, async () => {
    if (pendingShapeFillFinalize) {
      await pendingShapeFillFinalize;
    }
  });

  let shapeAdjustHelper: ShapeAdjustHelper | null = null;
  type OverlayRect = { x: number; y: number; width: number; height: number };
  let lastPreviewRect: OverlayRect | null = null;
  const PREVIEW_CLEAR_PADDING = 16;

  const inflateRect = (rect: OverlayRect, padding: number): OverlayRect => ({
    x: rect.x - padding,
    y: rect.y - padding,
    width: rect.width + padding * 2,
    height: rect.height + padding * 2,
  });

  const clearRegion = (ctx: CanvasRenderingContext2D, rect: OverlayRect | null) => {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (!rect) {
      ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
      return;
    }
    const padded = inflateRect(rect, 2);
    ctx.clearRect(padded.x, padded.y, padded.width, padded.height);
  };

  const clearCurrentPreview = () => {
    if (currentPreviewCleanup) {
      try {
        currentPreviewCleanup();
      } catch {
        // ignore cleanup errors
      }
      currentPreviewCleanup = null;
    }
    const overlayCanvas = context.deps.overlayCanvasRef.current;
    const overlayCtx = overlayCanvas?.getContext('2d');
    if (overlayCtx && overlayCanvas) {
      clearRegion(overlayCtx, lastPreviewRect);
    }
    lastPreviewRect = null;
  };
  let currentPreviewCleanup: (() => void) | null = null;

  const drawShapeFillPreview = (session: ShapeFillSession | null) => {
    const overlayCanvas = overlayCanvasRef.current;
    if (!overlayCanvas) return;
    const overlayCtx = overlayCanvas.getContext('2d');
    if (!overlayCtx) return;

    const { scale, offsetX, offsetY } = viewTransformRef.current;

    const isParamPreview = !!session && session.stage === FillStage.AdjustingParam && !!session.currentParam;

    if (!session || !session.shape) {
      clearRegion(overlayCtx, null);
      lastPreviewRect = null;
      return;
    }

    // Param previews (spacing ring / rotation arm) can extend well outside the polygon bounds,
    // so clear the entire overlay to avoid leaving stray strokes.
    if (isParamPreview) {
      clearRegion(overlayCtx, null);
    } else if (lastPreviewRect) {
      clearRegion(overlayCtx, lastPreviewRect);
    }

    const bounds = session.shape.bounds;
    const scaledWidth = (bounds.maxX - bounds.minX) * scale;
    const scaledHeight = (bounds.maxY - bounds.minY) * scale;
    const rect: OverlayRect = isParamPreview
      ? {
          x: 0,
          y: 0,
          width: overlayCanvas.width,
          height: overlayCanvas.height,
        }
      : {
          x: Math.floor(offsetX + bounds.minX * scale) - PREVIEW_CLEAR_PADDING,
          y: Math.floor(offsetY + bounds.minY * scale) - PREVIEW_CLEAR_PADDING,
          width: Math.ceil(Math.max(1, scaledWidth)) + PREVIEW_CLEAR_PADDING * 2,
          height: Math.ceil(Math.max(1, scaledHeight)) + PREVIEW_CLEAR_PADDING * 2,
        };

    overlayCtx.setTransform(1, 0, 0, 1, 0, 0);
    overlayCtx.clearRect(rect.x, rect.y, rect.width, rect.height);

    const isAdjusting = session.stage === FillStage.AdjustingParam && !!session.currentParam;
    if (isAdjusting && session.currentParam) {
      const previewColors = resolveShapeFillColors(session.shape.points);
      const previewPrimary = getPrimaryColor(previewColors);
      overlayCtx.strokeStyle = previewPrimary;
      overlayCtx.fillStyle = previewPrimary;

      const store = useAppStore.getState();
      const fillId = store.shapeFill.activeFillId;
      const renderer = getPreviewRenderer(fillId);
      const strategy = getFillStrategy(fillId);
      const param = session.currentParam as ShapeFillParamKey;

      if (LIVE_ADJUSTABLE_PARAMS.has(param)) {
        const paramValue = session.params[param];
        const defaultValue =
          typeof strategy.defaults[param] === 'number' ? (strategy.defaults[param] as number) : 0;

        const value =
          typeof paramValue === 'number'
            ? paramValue
            : (store.shapeFill.paramsByFill[fillId]?.[param] as number | undefined) ?? defaultValue;

        overlayCtx.save();
        overlayCtx.translate(offsetX, offsetY);
        overlayCtx.scale(scale, scale);
        renderer(overlayCtx, session.shape, param, value, session.params, strategy.defaults);
        overlayCtx.restore();
        lastPreviewRect = rect;
        return;
      }
    }

    const previewColors = resolveShapeFillColors(session.shape.points);
    const previewPrimary = getPrimaryColor(previewColors) ?? '#ffffff';

    overlayCtx.save();
    overlayCtx.translate(offsetX, offsetY);
    overlayCtx.scale(scale, scale);
    overlayCtx.globalAlpha = 0.35;
    overlayCtx.fillStyle = previewPrimary;
    overlayCtx.beginPath();
    overlayCtx.moveTo(session.shape.points[0].x, session.shape.points[0].y);
    for (let i = 1; i < session.shape.points.length; i += 1) {
      const pt = session.shape.points[i];
      overlayCtx.lineTo(pt.x, pt.y);
    }
    overlayCtx.closePath();
    overlayCtx.fill();
    overlayCtx.restore();
    lastPreviewRect = rect;
  };

  const renderShapeFillLiveResult = (session: ShapeFillSession | null) => {
    if (!session || !session.shape) {
      return;
    }

    if (!drawingHandlers.drawingCanvasRef.current) {
      drawingHandlers.initDrawingCanvas();
    }

    const drawingCanvas = drawingHandlers.drawingCanvasRef.current;
    const drawCtx = drawingCanvas?.getContext('2d');
    if (!drawingCanvas || !drawCtx) {
      return;
    }

    const store = useAppStore.getState();
    const fillId = store.shapeFill.activeFillId;
    const strategy = getFillStrategy(fillId);
    const storedParams = { ...(store.shapeFill.paramsByFill[fillId] ?? {}) };

    if (session.stage === FillStage.AdjustingParam) {
      for (const key of Object.keys(storedParams)) {
        const paramKey = key as ShapeFillParamKey;
        if (!LIVE_ADJUSTABLE_PARAMS.has(paramKey)) {
          delete (storedParams as Record<string, unknown>)[paramKey];
        }
      }
    }

    const mergedParams: FillParams = {
      ...strategy.defaults,
      ...(storedParams as Partial<FillParams>),
      ...session.params,
    } as FillParams;

    const colors = resolveShapeFillColors(session.shape.points);
    const primaryColor = getPrimaryColor(colors);
    const secondaryColor = getSecondaryColor(colors);
    const paramsWithColor: FillParams = {
      ...mergedParams,
      fillColor: primaryColor,
    };
    if (secondaryColor) {
      paramsWithColor.backgroundColor = secondaryColor;
    }
    const pixelPerfect = store.shapeFill.pixelPerfectMode;
    const polygonPoints = getPolygonForMode(session.shape.points, pixelPerfect);
    const previewResult = strategy.apply(session.shape, paramsWithColor);
    const renderedResult = pixelPerfect ? toPixelPerfectFill(previewResult) : previewResult;
    drawCtx.save();
    drawCtx.clearRect(0, 0, drawingCanvas.width, drawingCanvas.height);
    drawCtx.globalAlpha = store.tools.brushSettings.opacity ?? 1;
    drawCtx.globalCompositeOperation = 'source-over';
    if (secondaryColor && polygonPoints.length >= 3) {
      fillShapeArea(drawCtx, polygonPoints, secondaryColor);
    }
    drawCtx.lineWidth = pixelPerfect ? 1 : paramsWithColor.thickness ?? 1;
    drawCtx.strokeStyle = primaryColor;
    drawCtx.fillStyle = primaryColor;
    renderFill(drawCtx, renderedResult);
    if (store.shapeFill.showOutline && polygonPoints.length >= 3) {
      drawCtx.strokeStyle = 'rgba(0,0,0,0.35)';
      drawCtx.beginPath();
      drawCtx.moveTo(polygonPoints[0].x, polygonPoints[0].y);
      for (let i = 1; i < polygonPoints.length; i += 1) {
        const pt = polygonPoints[i];
        drawCtx.lineTo(pt.x, pt.y);
      }
      drawCtx.closePath();
      drawCtx.stroke();
    }
    const activeLayer = store.layers.find(layer => layer.id === store.activeLayerId);
    if (activeLayer && activeLayer.layerType !== 'color-cycle') {
      applyTransparencyLockMaskToContext(drawCtx, activeLayer, activeLayer.imageData ?? null);
    }
    drawCtx.restore();
    drawingHandlers.drawingCanvasHasContent.current = true;
  };

  // Shape Fill rendering/finalization overview (non color-cycle):
  //  - During preview we paint strategy output onto drawingHandlers.drawingCanvas (overlay).
  //  - On finalize we composite that overlay with the active raster layer snapshot here,
  //    persist via captureCanvasToActiveLayer, and write explicit history so undo works.
  //  - Color-cycle layers (or other brushes) fall back to drawingHandlers.finalizeDrawing().
  const trackPendingShapeFillFinalize = <T>(promise: Promise<T>): Promise<T> => {
    const tracker = promise
      .then(() => undefined)
      .catch(() => undefined)
      .finally(() => {
        if (pendingShapeFillFinalize === tracker) {
          pendingShapeFillFinalize = null;
        }
      });
    pendingShapeFillFinalize = tracker;
    return promise;
  };

  const runShapeFillFinalize = async (): Promise<boolean> => {
    const store = useAppStore.getState();
    const payload = store.finalizeShapeFillSession();
    if (!payload) {
      return false;
    }

    if (!drawingHandlers.drawingCanvasRef.current) {
      drawingHandlers.initDrawingCanvas();
    }

    const drawingCanvas = drawingHandlers.drawingCanvasRef.current;
    const drawCtx = drawingCanvas?.getContext('2d');
    if (!drawingCanvas || !drawCtx) {
      return false;
    }

    const colors = resolveShapeFillColors(payload.shape.points);
    const primaryColor = getPrimaryColor(colors);
    const secondaryColor = getSecondaryColor(colors);
    const paramsWithColor: FillParams = {
      ...payload.params,
      fillColor: primaryColor,
    };
    if (secondaryColor) {
      paramsWithColor.backgroundColor = secondaryColor;
    }
    const pixelPerfect = store.shapeFill.pixelPerfectMode;
    const polygonPoints = getPolygonForMode(payload.shape.points, pixelPerfect);
    const renderBounds = (() => {
      if (!polygonPoints.length) {
        return payload.shape.bounds;
      }
      if (!pixelPerfect) {
        return payload.shape.bounds;
      }
      let minX = polygonPoints[0].x;
      let maxX = polygonPoints[0].x;
      let minY = polygonPoints[0].y;
      let maxY = polygonPoints[0].y;
      for (let i = 1; i < polygonPoints.length; i += 1) {
        const pt = polygonPoints[i];
        if (pt.x < minX) minX = pt.x;
        if (pt.x > maxX) maxX = pt.x;
        if (pt.y < minY) minY = pt.y;
        if (pt.y > maxY) maxY = pt.y;
      }
      return { minX, maxX, minY, maxY };
    })();
    const finalResult = payload.strategy.apply(payload.shape, paramsWithColor);
    const renderedResult = pixelPerfect ? toPixelPerfectFill(finalResult) : finalResult;
    payload.params = paramsWithColor;
    payload.result = renderedResult;

    const storeSnapshot = useAppStore.getState();
    const byFill = (storeSnapshot.shapeFill.paramsByFill as Record<string, Partial<FillParams>>)[
      payload.fillId
    ] ?? {};
    const sessionParams = storeSnapshot.shapeFill.session?.params ?? {};
    const uiLostEdge = sessionParams.lostEdge ?? byFill.lostEdge;
    const perFillEdge = byFill.lostEdge;
    const payloadEdge = payload.params.lostEdge;
    const rawLostEdge = uiLostEdge ?? perFillEdge ?? payloadEdge ?? 0;
    const lostEdge = Math.max(0, Math.min(100, rawLostEdge));

    // lostEdge is used for both shape fill and polygon gradient paths below

    const drawFillToContext = (
      targetCtx: CanvasRenderingContext2D,
      offset: { x: number; y: number }
    ) => {
      targetCtx.save();
      targetCtx.translate(offset.x, offset.y);
      targetCtx.globalAlpha = store.tools.brushSettings.opacity ?? 1;
      targetCtx.globalCompositeOperation = 'source-over';
      if (secondaryColor && polygonPoints.length >= 3) {
        fillShapeArea(targetCtx, polygonPoints, secondaryColor);
      }
      targetCtx.lineWidth = pixelPerfect ? 1 : paramsWithColor.thickness ?? 1;
      targetCtx.strokeStyle = primaryColor;
      targetCtx.fillStyle = primaryColor;
      renderFill(targetCtx, renderedResult);
      if (store.shapeFill.showOutline && polygonPoints.length >= 3) {
        targetCtx.strokeStyle = 'rgba(0,0,0,0.35)';
        targetCtx.beginPath();
        targetCtx.moveTo(polygonPoints[0].x, polygonPoints[0].y);
        for (let i = 1; i < polygonPoints.length; i += 1) {
          const pt = polygonPoints[i];
          targetCtx.lineTo(pt.x, pt.y);
        }
        targetCtx.closePath();
        targetCtx.stroke();
      }
      targetCtx.restore();
    };
    // Always draw clean fill first
    drawCtx.save();
    drawCtx.clearRect(0, 0, drawingCanvas.width, drawingCanvas.height);
    drawCtx.imageSmoothingEnabled = !pixelPerfect;
    drawFillToContext(drawCtx, { x: 0, y: 0 });
    drawCtx.restore();

    if (lostEdge > 0) {
      const bounds = renderBounds;
      const padding = Math.max(
        4,
        Math.ceil((paramsWithColor.thickness ?? 1) * 2 + (paramsWithColor.spacing ?? 0))
      );

      applyLostEdgeErosionToContext(drawCtx, polygonPoints, bounds, padding, lostEdge, LOST_EDGE_TILE_SIZE);
    }
    drawingHandlers.drawingCanvasHasContent.current = true;

    const activeSnapshot = useAppStore.getState();
    const activeLayer = activeSnapshot.layers.find(layer => layer.id === activeSnapshot.activeLayerId);
    const projectSnapshot = activeSnapshot.project ?? project ?? null;
    const historyDescription = `Shape Fill: ${payload.strategy.label ?? payload.fillId}`;

    const fallbackFinalize = async () => {
      // Close the shape session now so its history transaction completes before layer history begins.
      store.cancelShapeFillSession();
      await drawingHandlers.finalizeDrawing({ historyActionType: 'fill', historyDescription });
      resetShapeFillHistoryContext();
      return true;
    };

    if (!activeLayer || activeLayer.layerType === 'color-cycle') {
      // Color-cycle layers or missing active layer: defer to the generic finalizeDrawing path,
      // which already knows how to persist CC content and guard redo/undo semantics.
      const result = await fallbackFinalize();
      stateMachine.finalizationComplete();
      if (project) {
        try {
          useAppStore.getState().setLayersNeedRecomposition(true);
        } catch {
          // quiet
        }
        compositeCanvasDirtyRef.current = true;
      }
      clearCurrentPreview();
      interaction.dispatch({ type: 'DRAWING_END' });
      setNeedsRedraw(prev => prev + 1);
      return result;
    }

    const effectiveBoundingBox = computeBoundingBox(payload.shape.points);
    if (effectiveBoundingBox) {
      shapeFillHistoryContext.bbox = effectiveBoundingBox;
    }

    const liveLayerSnapshot = snapshotLayerImageData(activeLayer);
    applyTransparencyLockMaskToContext(drawCtx, activeLayer, liveLayerSnapshot);
    const beforeImage =
      shapeFillHistoryContext.layerId === activeLayer.id
        ? shapeFillHistoryContext.beforeImage ?? liveLayerSnapshot
        : liveLayerSnapshot;

    const canvasWidth =
      projectSnapshot?.width ??
      activeLayer.imageData?.width ??
      drawingCanvas.width;
    const canvasHeight =
      projectSnapshot?.height ??
      activeLayer.imageData?.height ??
      drawingCanvas.height;

    if (canvasWidth <= 0 || canvasHeight <= 0) {
      const result = await fallbackFinalize();
      stateMachine.finalizationComplete();
      if (project) {
        try {
          useAppStore.getState().setLayersNeedRecomposition(true);
        } catch {
          // quiet
        }
        compositeCanvasDirtyRef.current = true;
      }
      clearCurrentPreview();
      interaction.dispatch({ type: 'DRAWING_END' });
      setNeedsRedraw(prev => prev + 1);
      return result;
    }

    // Close the shape session now so its history transaction completes before layer history begins.
    store.cancelShapeFillSession();

    const postCancelState = useAppStore.getState();
    const roiProject =
      projectSnapshot ?? { width: drawingCanvas.width, height: drawingCanvas.height };
    const roi = boundingBoxToRoi(shapeFillHistoryContext.bbox ?? effectiveBoundingBox, roiProject);

    const coalesce =
      shapeFillHistoryContext.layerId === activeLayer.id && shapeFillHistoryContext.coalesceKey
        ? { key: shapeFillHistoryContext.coalesceKey, maxIntervalMs: 300 }
        : undefined;

    await drawingHandlers.commitRasterOverlay({
      layer: activeLayer,
      overlayCanvas: drawingCanvas,
      beforeImage,
      beforeColorState: null,
      historyAction: 'fill',
      historyDescription,
      tool: postCancelState.tools.currentTool,
      coalesce,
      bitmapRoi: roi ?? undefined,
    });

    resetShapeFillHistoryContext();

    drawCtx.clearRect(0, 0, drawingCanvas.width, drawingCanvas.height);
    drawingHandlers.drawingCanvasHasContent.current = false;

    stateMachine.finalizationComplete();

    if (project) {
      try {
        useAppStore.getState().setLayersNeedRecomposition(true);
      } catch {
        // quiet
      }
      compositeCanvasDirtyRef.current = true;
    }

    clearCurrentPreview();
    interaction.dispatch({ type: 'DRAWING_END' });
    setNeedsRedraw(prev => prev + 1);
    return true;
  };

  const finalizeShapeFillResult = (): Promise<boolean> => {
    return trackPendingShapeFillFinalize(runShapeFillFinalize());
  };

  const logShapeFillEvent = (label: string, extra: Record<string, unknown> = {}) => {
    const store = useAppStore.getState();
    const polygonState = store.polygonGradientState;
    const toolsState = store.tools;
    const payload = {
      label,
      mode: polygonState.mode,
      drawingState: polygonState.drawingState,
      vertexCount: polygonState.vertices?.length ?? 0,
      shapePointCount: drawingHandlers.shapePointsRef.current.length,
      isDrawingShape: drawingHandlers.isDrawingShapeRef.current,
      shapeModeEnabled: toolsState.shapeMode,
      currentTool: toolsState.currentTool,
      brushShape: toolsState.brushSettings.brushShape,
      previewOpId: opController.latestPreviewId,
      previewHasContent: canvasManager.hasPreviewContent(),
      finalHasContent: canvasManager.hasFinalContent(),
      hasPreviewCleanup: Boolean(currentPreviewCleanup),
      ...extra,
    };
    contourDebug(label, payload);
  };

  const logShapeModeGuard = (source: string) => {
    const store = useAppStore.getState();
    if (!store.tools.shapeMode) {
      logShapeFillEvent('shape-fill-shape-mode-disabled', {
        source,
        currentTool: store.tools.currentTool,
        brushShape: store.tools.brushSettings.brushShape,
      });
    }
  };

  const normalizeOrientation = (value: number): number => ((value % 360) + 360) % 360;
  const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

  const dispatchFlowJobUpdate = (update: ShapeAdjustHelperUpdate, finalize: boolean) => {
    if (typeof window === 'undefined') {
      return;
    }

    const store = useAppStore.getState();
    const jobId = store.polygonGradientState.gpuJobId;
    if (!jobId) {
      return;
    }

    const scheduler = getShapeFillScheduler();
    if (!scheduler) {
      return;
    }
    const currentBrush = store.tools.brushSettings;

    const maxSteps = update.density ?? store.polygonGradientState.tempMaxSteps ?? currentBrush.flowMaxSteps ?? 120;
    const orientation = normalizeOrientation(update.orientation ?? store.polygonGradientState.tempOrientation ?? currentBrush.flowOrientationAngle ?? 0);
    const noiseStrength = clamp01(update.noiseStrength ?? store.polygonGradientState.tempNoiseStrength ?? currentBrush.flowSeedJitter ?? 0.6);

    scheduler.dispatchJobUpdate({
      jobId,
      brushSettingsPatch: {
        flowSeedSpacing: Math.round(update.spacing),
        flowMaxSteps: Math.round(maxSteps),
        flowOrientationAngle: orientation,
        flowSeedJitter: noiseStrength,
      },
      params: {
        spacing: update.spacing,
        maxSteps,
        orientationDeg: orientation,
        seedJitter: noiseStrength,
        pendingGizmo: finalize ? 0 : 1,
      },
    });
  };

  const applyShapeAdjustPreview = (update: ShapeAdjustHelperUpdate) => {
    const store = useAppStore.getState();
    store.setPolygonGradientState({
      tempSpacing: update.spacing,
      tempMaxSteps: update.density != null ? Math.round(update.density) : update.density,
      tempOrientation: update.orientation != null ? normalizeOrientation(update.orientation) : update.orientation,
      tempNoiseStrength: update.noiseStrength,
    });
    // Clean up any previous preview before starting new one
    if (currentPreviewCleanup) {
      currentPreviewCleanup();
    }
    currentPreviewCleanup = drawFlowPreview(update.spacing, { isPreview: true });
    dispatchFlowJobUpdate(update, false);
  };

  const commitShapeAdjustUpdate = (update: ShapeAdjustHelperUpdate) => {
    const clampNoise = (value: number | undefined) => {
      if (value == null) return undefined;
      return Math.max(0, Math.min(1, value));
    };

    const patch: Partial<BrushSettings> = {
      flowSeedSpacing: Math.round(update.spacing),
    };

    if (update.density != null) {
      patch.flowMaxSteps = Math.round(update.density);
    }
    if (update.orientation != null) {
      patch.flowOrientationAngle = normalizeOrientation(update.orientation);
    }
    if (update.noiseStrength != null) {
      patch.flowSeedJitter = clampNoise(update.noiseStrength);
    }

    useAppStore.getState().setBrushSettings(patch);
    dispatchFlowJobUpdate(update, true);
    // Clean up any previous preview before starting new one
    if (currentPreviewCleanup) {
      currentPreviewCleanup();
    }
    currentPreviewCleanup = drawFlowPreview(update.spacing, { isPreview: false });
  };

  const computeWorldPointer = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    const pointerPos = rect
      ? {
          x: event.clientX - rect.left,
          y: event.clientY - rect.top,
        }
      : { x: 0, y: 0 };
    const scale = canvas?.zoom || 1;
    return pan.screenToWorld(pointerPos.x, pointerPos.y, scale);
  };

  const resetPolygonAdjustmentState = () => {
    // Clean up any active preview
    if (currentPreviewCleanup) {
      currentPreviewCleanup();
      currentPreviewCleanup = null;
    }

    if (shapeAdjustHelper) {
      shapeAdjustHelper.destroy();
      shapeAdjustHelper = null;
    }

    // Reset operation tracking
    opController.reset();
    canvasManager.reset();

    useAppStore.getState().setPolygonGradientState({
      drawingState: 'idle',
      points: [],
      vertices: undefined,
      fillColor: undefined,
      adjustmentStartPos: undefined,
      tempRotation: undefined,
      tempSpacing: undefined,
      tempMaxSteps: undefined,
      tempOrientation: undefined,
      tempNoiseStrength: undefined,
      tempSize: undefined,
      mode: undefined,
      rotationReferenceAngle: undefined,
      rotationInitialRotation: undefined,
      sizeReferenceDistance: undefined,
      sizeInitialSize: undefined,
      spacingReferenceDistance: undefined,
      spacingReferenceSpacing: undefined,
      flowRandomSeed: undefined,
      gpuJobId: undefined,
    });
  };

  const clampCrosshatchSpacing = (value: number) => Math.max(2, Math.min(50, value));
  const clampFlowSeedSpacing = (value: number) => Math.max(4, Math.min(80, value));

  const MIN_POLYGON_POINT_SPACING = 5;

  const computePolygonCentroid = (vertices: Array<{ x: number; y: number }>) => {
    if (!vertices.length) {
      return { x: 0, y: 0 };
    }

    const sum = vertices.reduce(
      (acc, point) => ({ x: acc.x + point.x, y: acc.y + point.y }),
      { x: 0, y: 0 }
    );

    return {
      x: sum.x / vertices.length,
      y: sum.y / vertices.length,
    };
  };

  const getPolygonState = () => useAppStore.getState().polygonGradientState;

  const startPolygonGradientDrawing = (worldPos: { x: number; y: number }) => {
    const color = resolvePolygonPointColor(worldPos);
    resetPolygonAdjustmentState();
    useAppStore.getState().setPolygonGradientState({
      drawingState: 'drawing',
      points: [{ x: worldPos.x, y: worldPos.y, color }],
      previewPath: undefined,
      vertices: undefined,
      fillColor: color,
      adjustmentStartPos: undefined,
      tempRotation: undefined,
      tempSpacing: undefined,
      tempSize: undefined,
      mode: undefined,
      rotationReferenceAngle: undefined,
      rotationInitialRotation: undefined,
      sizeReferenceDistance: undefined,
      sizeInitialSize: undefined,
      spacingReferenceDistance: undefined,
      spacingReferenceSpacing: undefined,
      flowRandomSeed: undefined,
    });
    drawingHandlers.updateDitherGradSamples?.([{ x: worldPos.x, y: worldPos.y }]);
  };

  const appendPolygonGradientPoint = (worldPos: { x: number; y: number }) => {
    const state = useAppStore.getState();
    const polygonState = state.polygonGradientState;
    if (polygonState.drawingState !== 'drawing') {
      return false;
    }

    const points = polygonState.points;
    const lastPoint = points[points.length - 1];
    if (lastPoint) {
      const distance = Math.hypot(worldPos.x - lastPoint.x, worldPos.y - lastPoint.y);
      if (distance < MIN_POLYGON_POINT_SPACING) {
        return true;
      }
    }

    const color = resolvePolygonPointColor(worldPos);
    const nextPoints = [...points, { x: worldPos.x, y: worldPos.y, color }];
    state.setPolygonGradientState({
      points: nextPoints,
    });
    drawingHandlers.updateDitherGradSamples?.(nextPoints);
    return true;
  };

  const drawContourPreview = (spacing: number, strokeColorOverride?: string): (() => void) => {
    const currentState = useAppStore.getState();
    const { polygonGradientState } = currentState;
    const vertices = polygonGradientState.vertices;

    const drawCanvas = drawingHandlers.drawingCanvasRef.current;
    if (!vertices || vertices.length < 3 || !brushEngine || !drawCanvas) {
      return () => {}; // No-op cleanup
    }

    const drawCtx = drawCanvas.getContext('2d', { willReadFrequently: true });
    if (!drawCtx) {
      return () => {}; // No-op cleanup
    }

    // Get operation ID and start preview
    const { id, token } = opController.newPreview();
    canvasManager.startPreview(id, drawCanvas);
    logShapeFillEvent('shape-fill-preview-start', {
      previewId: id,
      previewKind: 'contour',
      spacing,
      strokeColorOverride,
    });

    // Compute transforms once (for future use in async operations)
    // const spaces = getCurrentSpaces(viewTransformRef);

    // Run async preview (in this case it's actually sync, but structure for future async)
    const runPreview = () => {
      if (token.cancelled || !opController.isCurrentPreview(id)) {
        return;
      }

      brushEngine.drawContourPolygon(
        drawCtx,
        {
          vertices,
          fillColor: polygonGradientState.fillColor,
        },
        false,
        {
          spacingOverride: spacing,
          strokeColorOverride,
        }
      );

      if (token.cancelled || !opController.isCurrentPreview(id)) {
        return;
      }

      const committed = canvasManager.commitPreview(id);
      logShapeFillEvent('shape-fill-preview-commit', {
        previewId: id,
        previewKind: 'contour',
        committed,
      });
      if (committed) {
        drawingHandlers.drawingCanvasHasContent.current = true;
      }
    };

    runPreview();

    // Return cleanup function
    return () => {
      token.cancelled = true;
      const isCurrent = opController.isCurrentPreview(id);
      if (isCurrent) {
        canvasManager.clearPreview(drawCanvas);
      }
      logShapeFillEvent('shape-fill-preview-clear', {
        previewId: id,
        previewKind: 'contour',
        cleared: isCurrent,
      });
    };
  };

  const drawCrosshatchPreview = (rotation: number, spacing: number): (() => void) => {
    const currentState = useAppStore.getState();
    const { polygonGradientState } = currentState;
    const vertices = polygonGradientState.vertices;

    const drawCanvas = drawingHandlers.drawingCanvasRef.current;
    if (!vertices || vertices.length < 3 || !brushEngine || !drawCanvas) {
      return () => {}; // No-op cleanup
    }

    const drawCtx = drawCanvas.getContext('2d', { willReadFrequently: true });
    if (!drawCtx) {
      return () => {}; // No-op cleanup
    }

    // Get operation ID and start preview
    const { id, token } = opController.newPreview();
    canvasManager.startPreview(id, drawCanvas);
    logShapeFillEvent('shape-fill-preview-start', {
      previewId: id,
      previewKind: 'crosshatch',
      rotation,
      spacing,
    });

    const brushSettings = currentState.tools.brushSettings;
    const lineWidthOverride = brushSettings.crossHatchLineWidth;

    const patch: Partial<BrushSettings> = {
      crossHatchRotation: rotation,
      crossHatchSpacing: spacing,
    };

    if (lineWidthOverride !== undefined) {
      patch.crossHatchLineWidth = lineWidthOverride;
    }

    withTemporaryBrushSettings(
      currentState.tools.brushSettings,
      patch,
      (tempSettings) => {
        if (token.cancelled || !opController.isCurrentPreview(id)) {
          return;
        }

        brushEngine.drawCrossHatchPolygon(
          drawCtx,
          {
            vertices,
            fillColor: polygonGradientState.fillColor,
            rotationOverride: tempSettings.crossHatchRotation,
            spacingOverride: tempSettings.crossHatchSpacing,
            lineWidthOverride: tempSettings.crossHatchLineWidth,
          },
          false
        );

        if (!token.cancelled && opController.isCurrentPreview(id)) {
          const committed = canvasManager.commitPreview(id);
          logShapeFillEvent('shape-fill-preview-commit', {
            previewId: id,
            previewKind: 'crosshatch',
            committed,
            rotation,
            spacing,
          });
          if (committed) {
            drawingHandlers.drawingCanvasHasContent.current = true;
          }
        }
      }
    );

    // Return cleanup function
    return () => {
      token.cancelled = true;
      const isCurrent = opController.isCurrentPreview(id);
      if (isCurrent) {
        canvasManager.clearPreview(drawCanvas);
      }
      logShapeFillEvent('shape-fill-preview-clear', {
        previewId: id,
        previewKind: 'crosshatch',
        cleared: isCurrent,
      });
    };
  };

  const drawFlowPreview = (seedSpacing: number, options?: { isPreview?: boolean }): (() => void) => {
    const currentState = useAppStore.getState();
    const { polygonGradientState } = currentState;
    const vertices = polygonGradientState.vertices;

    const drawCanvas = drawingHandlers.drawingCanvasRef.current;
    if (!vertices || vertices.length < 3 || !brushEngine || !drawCanvas) {
      return () => {}; // No-op cleanup
    }

    const drawCtx = drawCanvas.getContext('2d', { willReadFrequently: true });
    if (!drawCtx) {
      return () => {}; // No-op cleanup
    }

    // Get operation ID and start preview
    const { id, token } = opController.newPreview();
    canvasManager.startPreview(id, drawCanvas);

    const patch: Partial<BrushSettings> = {
      flowSeedSpacing: seedSpacing,
    };

    const tempMaxSteps = polygonGradientState.tempMaxSteps;
    if (tempMaxSteps != null) {
      patch.flowMaxSteps = tempMaxSteps;
    }

    const tempOrientation = polygonGradientState.tempOrientation;
    if (tempOrientation != null) {
      patch.flowOrientationAngle = normalizeOrientation(tempOrientation);
    }

    const tempNoise = polygonGradientState.tempNoiseStrength;
    if (tempNoise != null) {
      patch.flowSeedJitter = Math.max(0, Math.min(1, tempNoise));
    }

    const lineOptions = withRuntimeLineOptions({
      randomSeed: polygonGradientState.flowRandomSeed,
      strokeColorOverride: undefined,
    });

    const isPreview = options?.isPreview ?? false;
    logShapeFillEvent('shape-fill-preview-start', {
      previewId: id,
      previewKind: 'flow',
      seedSpacing,
      isPreview,
    });

    withTemporaryBrushSettings(
      currentState.tools.brushSettings,
      patch,
      () => {
        if (token.cancelled || !opController.isCurrentPreview(id)) {
          return;
        }

        brushEngine.drawContourPolygon(
          drawCtx,
          {
            vertices,
            fillColor: polygonGradientState.fillColor,
          },
          isPreview,
          lineOptions
        );

        if (!token.cancelled && opController.isCurrentPreview(id)) {
          const committed = canvasManager.commitPreview(id);
          logShapeFillEvent('shape-fill-preview-commit', {
            previewId: id,
            previewKind: 'flow',
            committed,
            seedSpacing,
            isPreview,
          });
          if (committed) {
            drawingHandlers.drawingCanvasHasContent.current = true;
          }
        }
      }
    );

    // Return cleanup function
    return () => {
      token.cancelled = true;
      const isCurrent = opController.isCurrentPreview(id);
      if (isCurrent) {
        canvasManager.clearPreview(drawCanvas);
      }
      logShapeFillEvent('shape-fill-preview-clear', {
        previewId: id,
        previewKind: 'flow',
        cleared: isCurrent,
      });
    };
  };

  type PreviewStrokePalette = {
    inner: string;
    outer: string;
  };

  const getPreviewStrokePalette = (color?: string): PreviewStrokePalette => {
    let r = 255;
    let g = 255;
    let b = 255;

    if (color) {
      const hex = color.trim().toLowerCase();
      const hexMatch = hex.match(/^#([0-9a-f]{3})$/i);
      const hexMatch6 = hex.match(/^#([0-9a-f]{6})$/i);

      if (hexMatch6) {
        const value = hexMatch6[1];
        r = parseInt(value.slice(0, 2), 16);
        g = parseInt(value.slice(2, 4), 16);
        b = parseInt(value.slice(4, 6), 16);
      } else if (hexMatch) {
        const value = hexMatch[1];
        r = parseInt(value[0] + value[0], 16);
        g = parseInt(value[1] + value[1], 16);
        b = parseInt(value[2] + value[2], 16);
      }
    }

    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;

    if (luminance > 0.55) {
      return {
        inner: 'rgba(25, 25, 25, 0.95)',
        outer: 'rgba(250, 250, 250, 0.9)',
      };
    }

    return {
      inner: 'rgba(245, 245, 245, 0.95)',
      outer: 'rgba(0, 0, 0, 0.85)',
    };
  };

  const drawHighContrastStroke = (
    ctx: CanvasRenderingContext2D,
    drawPath: (ctx: CanvasRenderingContext2D) => void,
    scale: number,
    palette: PreviewStrokePalette,
    alpha = 1
  ) => {
    const safeScale = Math.max(scale, 0.001);
    const lineWidth = Math.max(0.25, 0.7 / safeScale);

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.globalCompositeOperation = 'source-over';

    ctx.strokeStyle = palette.outer;
    ctx.lineWidth = lineWidth * 1.25;
    drawPath(ctx);
    ctx.stroke();

    ctx.strokeStyle = palette.inner;
    ctx.lineWidth = lineWidth;
    drawPath(ctx);
    ctx.stroke();

    ctx.restore();
  };

  const drawHighContrastDot = (
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    scale: number,
    palette: PreviewStrokePalette,
    alpha = 1,
    radiusMultiplier = 1
  ) => {
    const safeScale = Math.max(scale, 0.001);
    const baseRadius = Math.max(0.65, 0.9 / safeScale);
    const radius = baseRadius * Math.max(1, radiusMultiplier);

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.globalCompositeOperation = 'source-over';

    ctx.fillStyle = palette.outer;
    ctx.beginPath();
    ctx.arc(x, y, radius * 1.25, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = palette.inner;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  };

  const drawHighContrastAnchors = (
    ctx: CanvasRenderingContext2D,
    points: Array<{ x: number; y: number }> | null | undefined,
    scale: number,
    palette: PreviewStrokePalette,
    alpha = 1
  ) => {
    if (!points || points.length === 0) return;
    for (const point of points) {
      if (!point) continue;
      drawHighContrastDot(ctx, point.x, point.y, scale, palette, alpha, 1.0);
    }
  };

  const fillShapeArea = (
    ctx: CanvasRenderingContext2D,
    points: Array<{ x: number; y: number }>,
    color: string
  ) => {
    if (points.length < 3) {
      return;
    }
    const previousFill = ctx.fillStyle;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i += 1) {
      const pt = points[i];
      ctx.lineTo(pt.x, pt.y);
    }
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = previousFill;
  };

  const getPolygonForMode = (
    points: Array<{ x: number; y: number }>,
    pixelPerfect: boolean
  ): Array<{ x: number; y: number }> => {
    if (!pixelPerfect) {
      return points;
    }
    return points.map(point => {
      const snapped = snapPointToPixel(point, { strategy: 'nearest' });
      return { x: snapped.x, y: snapped.y };
    });
  };

  const getPrimaryColor = (colors: ShapeFillColors): string => {
    if (colors.primary === 'background' && colors.background) {
      return colors.background;
    }
    return colors.foreground;
  };

  const getSecondaryColor = (colors: ShapeFillColors): string | undefined => {
    if (colors.primary === 'background') {
      return colors.foreground;
    }
    return colors.background;
  };

  const computeAxisOpposingEnds = (verts: Array<{ x: number; y: number }>): {
    start: { x: number; y: number };
    end: { x: number; y: number };
    dir: { x: number; y: number };
    length: number;
  } => {
    const n = verts.length;
    if (n === 0) {
      return { start: { x: 0, y: 0 }, end: { x: 1, y: 0 }, dir: { x: 1, y: 0 }, length: 1 };
    }
    if (n === 1) {
      return { start: verts[0], end: { x: verts[0].x + 1, y: verts[0].y }, dir: { x: 1, y: 0 }, length: 1 };
    }

    // 1) pick direction from farthest pair (O(n^2), acceptable for small vertex counts)
    let a = verts[0];
    let b = verts[1];
    let bestD2 = -1;
    for (let i = 0; i < n; i += 1) {
      for (let j = i + 1; j < n; j += 1) {
        const dx = verts[j].x - verts[i].x;
        const dy = verts[j].y - verts[i].y;
        const d2 = dx * dx + dy * dy;
        if (d2 > bestD2) {
          bestD2 = d2;
          a = verts[i];
          b = verts[j];
        }
      }
    }

    let dx = b.x - a.x;
    let dy = b.y - a.y;
    let len = Math.hypot(dx, dy);
    if (len < 1e-6) {
      dx = 1;
      dy = 0;
      len = 1;
    }
    dx /= len;
    dy /= len;

    // 2) choose opposing endpoints along that direction by projection
    let minT = Infinity;
    let maxT = -Infinity;
    let minP = verts[0];
    let maxP = verts[0];
    for (const v of verts) {
      const t = v.x * dx + v.y * dy;
      if (t < minT) {
        minT = t;
        minP = v;
      }
      if (t > maxT) {
        maxT = t;
        maxP = v;
      }
    }

    const length = Math.max(1e-6, maxT - minT);
    return { start: minP, end: maxP, dir: { x: dx, y: dy }, length };
  };

  const resolvePolygonPointColor = (worldPos: { x: number; y: number }) => {
    const store = useAppStore.getState();
    const { brushSettings } = store.tools;
    const brushShape = brushSettings.brushShape;
    const samplingEnabled = brushSettings.polygonSampleColors !== false;

    if (brushShape === BrushShape.POLYGON_GRADIENT) {
      if (samplingEnabled) {
        const sampled = sampleColorAtPosition(worldPos.x, worldPos.y);
        return toOpaqueColorString(sampled);
      }

      const palette = store.palette;
      const existingPoints = store.polygonGradientState.points?.length ?? 0;
      const useForeground = existingPoints % 2 === 0;
      const fallback = brushSettings.color;
      const fg = palette?.foregroundColor || fallback;
      const bg = palette?.backgroundColor || fg;
      const target = useForeground ? fg : bg;
      return toOpaqueColorString(target);
    }

    if (brushShape === BrushShape.DITHER_GRADIENT) {
      const palette = store.palette;
      const fg = palette?.foregroundColor || brushSettings.color || '#000';
      return toOpaqueColorString(fg);
    }

    return brushSettings.color;
  };

  const isPolygonGradientBrush = () => {
    const shape = useAppStore.getState().tools.brushSettings.brushShape;
    return shape === BrushShape.POLYGON_GRADIENT || shape === BrushShape.DITHER_GRADIENT;
  };
  const isColorCycleShapeBrush = () =>
    useAppStore.getState().tools.brushSettings.brushShape === BrushShape.COLOR_CYCLE_SHAPE;
  const isShapeFillBrush = () => isShapeFillToolActive();
  const isContourPolygonBrush = () => {
    const shape = tools.brushSettings.brushShape;
    return (
      shape === BrushShape.CONTOUR_POLYGON ||
      shape === BrushShape.CONTOUR_LINES2
    );
  };

  const resolveShapeFillColors = (
    points?: Array<{ x: number; y: number; color?: string }>
  ) => {
    const store = useAppStore.getState();
    const { brushSettings } = store.tools;
    const brushShape = brushSettings.brushShape;

    if (brushShape === BrushShape.POLYGON_GRADIENT) {
      const candidatePoints =
        points ?? store.polygonGradientState.points;

      if (candidatePoints && candidatePoints.length > 0) {
        for (const point of candidatePoints) {
          const candidate = point?.color;
          if (candidate) {
            return {
              foreground: toOpaqueColorString(candidate),
              background: undefined,
              sampledForeground: true,
              sampledBackground: false,
              primary: 'foreground' as const,
            };
          }
        }
      }

      if (store.polygonGradientState.fillColor) {
        return {
          foreground: toOpaqueColorString(store.polygonGradientState.fillColor),
          background: undefined,
          sampledForeground: false,
          sampledBackground: false,
          primary: 'foreground' as const,
        };
      }

      return {
        foreground: toOpaqueColorString(brushSettings.color),
        background: undefined,
        sampledForeground: false,
        sampledBackground: false,
        primary: 'foreground' as const,
      };
    }

    if (brushShape === BrushShape.DITHER_GRADIENT) {
      const palette = store.palette;
      const foreground = toOpaqueColorString(palette?.foregroundColor || brushSettings.color);
      const background = palette?.backgroundColor
        ? toOpaqueColorString(palette.backgroundColor)
        : undefined;
      return {
        foreground,
        background,
        sampledForeground: false,
        sampledBackground: false,
        primary: 'foreground' as const,
      };
    }

    if (brushShape === BrushShape.SHAPE_FILL) {
      const candidatePoints =
        points ??
        store.shapeFill.session?.shape?.points ??
        store.shapeFill.lastFinalize?.shape.points ??
        [];

      return computeShapeFillColors({
        points: candidatePoints,
        palette: store.palette,
        brushColor: brushSettings.color,
        sampleUnderShape: store.shapeFill.sampleUnderShape,
        useBackgroundColor: store.shapeFill.useBackgroundColor,
        sampleColorAtPosition,
        fallbackBackground: store.project?.backgroundColor,
      });
    }

    return {
      foreground: toOpaqueColorString(brushSettings.color),
      background: undefined,
      sampledForeground: false,
      sampledBackground: false,
      primary: 'foreground' as const,
    };
  };

  const clearOverlayCanvas = () => {
    const overlayCanvas = overlayCanvasRef.current;
    if (!overlayCanvas) return;
    const overlayCtx = overlayCanvas.getContext('2d');
    overlayCtx?.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
  };

  const withRuntimeLineOptions = (_options?: ShapeFillOptions): ShapeFillOptions | undefined => {
    if (!_options) {
      return undefined;
    }
    return { ..._options };
  };

;

;

  const handleCrosshatchPointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (event.button !== 0) return false;

    const polygonState = useAppStore.getState().polygonGradientState;
    if (polygonState.mode !== 'crosshatch') {
      return false;
    }

    if (polygonState.drawingState === 'adjustingRotation' || polygonState.drawingState === 'adjustingSpacing') {
      // Consume the event so other handlers don't interfere while adjusting crosshatch parameters
      return true;
    }

    return false;
  };

  const handleContourPointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const polygonState = useAppStore.getState().polygonGradientState;
    if (
      polygonState.mode !== 'contour' ||
      !polygonState.vertices ||
      polygonState.vertices.length < 3
    ) {
      return false;
    }

    const worldPos = computeWorldPointer(event);
    const previewRef = context.deps.previewAnimationFrameRef;

    if (polygonState.drawingState === 'adjustingSpacing') {
      if (previewRef) {
        const previewWorld = { x: worldPos.x, y: worldPos.y };
        if (!previewRef.current) {
          const nowTs = performance.now();
          if (nowTs - context.getLastOverlayPreviewTs() < context.overlayPreviewFrameMs) {
            return true;
          }

          previewRef.current = requestAnimationFrame(() => {
            context.setLastOverlayPreviewTs(performance.now());
            const currentState = useAppStore.getState().polygonGradientState;
            if (
              currentState.mode !== 'contour' ||
              currentState.drawingState !== 'adjustingSpacing' ||
              !currentState.vertices
            ) {
              previewRef.current = null;
              return;
            }

            const centroid = computePolygonCentroid(currentState.vertices);
            const pointerDistance = Math.hypot(previewWorld.x - centroid.x, previewWorld.y - centroid.y);
            const referenceDistance = currentState.spacingReferenceDistance ?? Math.max(pointerDistance, 1);
            const referenceSpacing = currentState.spacingReferenceSpacing ??
              currentState.tempSpacing ??
              tools.brushSettings.contourSpacing ??
              6;
            const newSpacing = Math.max(2, Math.min(96,
              computeDragScaledValue({
                startDistance: Math.max(referenceDistance, 1e-3),
                currentDistance: Math.max(pointerDistance, 1e-3),
                startValue: referenceSpacing,
                min: 2,
                max: 96,
                exponent: 1.06,
              })
            ));

            useAppStore.getState().setPolygonGradientState({ tempSpacing: newSpacing });
            // Clean up any previous preview before starting new one
            if (currentPreviewCleanup) {
              currentPreviewCleanup();
            }
            currentPreviewCleanup = drawContourPreview(newSpacing, currentState.fillColor);
            previewRef.current = null;
          });
        }
        return true;
      }

      const centroid = computePolygonCentroid(polygonState.vertices);
      const pointerDistance = Math.hypot(worldPos.x - centroid.x, worldPos.y - centroid.y);
      const referenceDistance = polygonState.spacingReferenceDistance ?? Math.max(pointerDistance, 1);
      const referenceSpacing = polygonState.spacingReferenceSpacing ??
        polygonState.tempSpacing ??
        tools.brushSettings.contourSpacing ??
        6;
      const newSpacing = Math.max(2, Math.min(96,
        computeDragScaledValue({
          startDistance: Math.max(referenceDistance, 1e-3),
          currentDistance: Math.max(pointerDistance, 1e-3),
          startValue: referenceSpacing,
          min: 2,
          max: 96,
          exponent: 1.06,
        })
      ));

      useAppStore.getState().setPolygonGradientState({ tempSpacing: newSpacing });
      // Clean up any previous preview before starting new one
      if (currentPreviewCleanup) {
        currentPreviewCleanup();
      }
      currentPreviewCleanup = drawContourPreview(newSpacing, polygonState.fillColor);
      return true;
    }

    return false;
  };

  const handleCrosshatchPointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const polygonState = useAppStore.getState().polygonGradientState;
    if (
      polygonState.mode !== 'crosshatch' ||
      !polygonState.vertices ||
      polygonState.vertices.length < 3
    ) {
      return false;
    }

    const worldPos = computeWorldPointer(event);
    const previewRef = context.deps.previewAnimationFrameRef;

    if (polygonState.drawingState === 'adjustingRotation') {
      if (previewRef) {
        const previewWorld = { x: worldPos.x, y: worldPos.y };
        if (!previewRef.current) {
          const nowTs = performance.now();
          if (nowTs - context.getLastOverlayPreviewTs() < context.overlayPreviewFrameMs) {
            return true;
          }

          previewRef.current = requestAnimationFrame(() => {
            context.setLastOverlayPreviewTs(performance.now());
            const currentState = useAppStore.getState().polygonGradientState;
            if (
              currentState.mode !== 'crosshatch' ||
              currentState.drawingState !== 'adjustingRotation' ||
              !currentState.vertices
            ) {
              previewRef.current = null;
              return;
            }

            const centroid = computePolygonCentroid(currentState.vertices);
            const angleRad = Math.atan2(previewWorld.y - centroid.y, previewWorld.x - centroid.x);
            const newRotation = ((angleRad * 180) / Math.PI + 360) % 360;

            useAppStore.getState().setPolygonGradientState({ tempRotation: newRotation });

            const spacingForPreview = clampCrosshatchSpacing(
              currentState.tempSpacing ?? tools.brushSettings.crossHatchSpacing ?? 10
            );

            // Clean up any previous preview before starting new one
            if (currentPreviewCleanup) {
              currentPreviewCleanup();
            }
            currentPreviewCleanup = drawCrosshatchPreview(newRotation, spacingForPreview);
            previewRef.current = null;
          });
        }
        return true;
      }

      const centroid = computePolygonCentroid(polygonState.vertices);
      const angleRad = Math.atan2(worldPos.y - centroid.y, worldPos.x - centroid.x);
      const newRotation = ((angleRad * 180) / Math.PI + 360) % 360;
      useAppStore.getState().setPolygonGradientState({ tempRotation: newRotation });
      const spacingForPreview = clampCrosshatchSpacing(
        polygonState.tempSpacing ?? tools.brushSettings.crossHatchSpacing ?? 10
      );
      // Clean up any previous preview before starting new one
      if (currentPreviewCleanup) {
        currentPreviewCleanup();
      }
      currentPreviewCleanup = drawCrosshatchPreview(newRotation, spacingForPreview);
      return true;
    }

    if (polygonState.drawingState === 'adjustingSpacing') {
      if (previewRef) {
        const previewWorld = { x: worldPos.x, y: worldPos.y };
        if (!previewRef.current) {
          const nowTs = performance.now();
          if (nowTs - context.getLastOverlayPreviewTs() < context.overlayPreviewFrameMs) {
            return true;
          }

          previewRef.current = requestAnimationFrame(() => {
            context.setLastOverlayPreviewTs(performance.now());
            const currentState = useAppStore.getState().polygonGradientState;
            if (
              currentState.mode !== 'crosshatch' ||
              currentState.drawingState !== 'adjustingSpacing' ||
              !currentState.vertices
            ) {
              previewRef.current = null;
              return;
            }

            const centroid = computePolygonCentroid(currentState.vertices);
            const pointerDistance = Math.hypot(previewWorld.x - centroid.x, previewWorld.y - centroid.y);
            const referenceDistance = currentState.spacingReferenceDistance ?? Math.max(pointerDistance, 1);
            const referenceSpacing = clampCrosshatchSpacing(
              currentState.spacingReferenceSpacing ??
                currentState.tempSpacing ??
                tools.brushSettings.crossHatchSpacing ??
                10
            );
            const newSpacing = clampCrosshatchSpacing(
              computeDragScaledValue({
                startDistance: Math.max(referenceDistance, 1e-3),
                currentDistance: Math.max(pointerDistance, 1e-3),
                startValue: referenceSpacing,
                min: 2,
                max: 50,
                exponent: CROSSHATCH_SPACING_EXPONENT,
              })
            );

            useAppStore.getState().setPolygonGradientState({ tempSpacing: newSpacing });

            const rotationForPreview = currentState.tempRotation ?? tools.brushSettings.crossHatchRotation ?? 45;
            // Clean up any previous preview before starting new one
            clearCurrentPreview();
            currentPreviewCleanup = drawCrosshatchPreview(rotationForPreview, newSpacing);
            previewRef.current = null;
          });
        }
        return true;
      }

      const centroid = computePolygonCentroid(polygonState.vertices);
      const pointerDistance = Math.hypot(worldPos.x - centroid.x, worldPos.y - centroid.y);
      const referenceDistance = polygonState.spacingReferenceDistance ?? Math.max(pointerDistance, 1);
      const referenceSpacing = clampCrosshatchSpacing(
        polygonState.spacingReferenceSpacing ??
          polygonState.tempSpacing ??
          tools.brushSettings.crossHatchSpacing ??
          10
      );
      const newSpacing = clampCrosshatchSpacing(
        computeDragScaledValue({
          startDistance: Math.max(referenceDistance, 1e-3),
          currentDistance: Math.max(pointerDistance, 1e-3),
          startValue: referenceSpacing,
          min: 2,
          max: 50,
          exponent: CROSSHATCH_SPACING_EXPONENT,
        })
      );

      useAppStore.getState().setPolygonGradientState({ tempSpacing: newSpacing });

      const rotationForPreview = polygonState.tempRotation ?? tools.brushSettings.crossHatchRotation ?? 45;
      // Clean up any previous preview before starting new one
      clearCurrentPreview();
      currentPreviewCleanup = drawCrosshatchPreview(rotationForPreview, newSpacing);
      return true;
    }

    return false;
  };

  const handleContourPointerUp = () => {
    const polygonState = useAppStore.getState().polygonGradientState;
    if (
      polygonState.mode !== 'contour' ||
      !polygonState.vertices ||
      polygonState.vertices.length < 3
    ) {
      return false;
    }

    if (polygonState.drawingState === 'adjustingSpacing') {
      const setBrushSettings = useAppStore.getState().setBrushSettings;
      const finalSpacing = Math.max(2, Math.min(96,
        polygonState.tempSpacing ?? tools.brushSettings.contourSpacing ?? 6
      ));

      contourDebug('pointer-up-commit-spacing', {
        finalSpacing,
        tempSpacing: polygonState.tempSpacing,
        storedSpacing: tools.brushSettings.contourSpacing ?? 6,
        vertexCount: polygonState.vertices.length,
      });

      setBrushSettings({ contourSpacing: finalSpacing });

      // The last preview has the final content on drawing canvas
      // Commit it and mark composite as dirty for finalization
      const previewId = opController.latestPreviewId;
      const previewCommitted = canvasManager.commitPreview(previewId);
      logShapeFillEvent('shape-fill-preview-finalize', {
        previewId,
        committed: previewCommitted,
        source: 'contour-spacing-pointer-up',
      });
      if (previewCommitted) {
        drawingHandlers.drawingCanvasHasContent.current = true;
      }
      context.deps.compositeCanvasDirtyRef.current = true;

      logShapeModeGuard('contour-adjust-spacing');
      const finalizePromise = drawingHandlers.finalizeShapeDrawing();
      logShapeFillEvent('shape-fill-finalize-request', {
        source: 'contour-adjust-spacing',
      });
      finalizePromise.then(() => {
        logShapeFillEvent('shape-fill-finalize-success', {
          source: 'contour-adjust-spacing',
        });
        contourDebug('finalize-shape-drawing-complete', {
          vertexCount: polygonState.vertices?.length ?? 0,
        });

        if (compositeCanvasRef.current && project) {
          compositeLayersToCanvas(compositeCanvasRef.current);
          setCurrentOffscreenCanvas(compositeCanvasRef.current);
          compositeCanvasDirtyRef.current = false;
        }

        setNeedsRedraw(prev => prev + 1);

        if (restartColorCycleAnimation) {
          restartColorCycleAnimation();
        }

        resetPolygonAdjustmentState();
        contourDebug('reset-polygon-adjustment-state');
        interaction.dispatch({ type: 'DRAWING_END' });
      }).catch(error => {
        logShapeFillEvent('shape-fill-finalize-error', {
          source: 'contour-adjust-spacing',
          error: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }).finally(() => {
        stateMachine.finalizationComplete();
      });
      return true;
    }

    return false;
  };

  const handleCrosshatchPointerUp = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const polygonState = useAppStore.getState().polygonGradientState;
    if (
      polygonState.mode !== 'crosshatch' ||
      !polygonState.vertices ||
      polygonState.vertices.length < 3
    ) {
      return false;
    }

    const pointerWorldPos = computeWorldPointer(event);

    if (polygonState.drawingState === 'adjustingSpacing') {
      const setBrushSettings = useAppStore.getState().setBrushSettings;
      const finalSpacing = clampCrosshatchSpacing(
        polygonState.tempSpacing ?? tools.brushSettings.crossHatchSpacing ?? 10
      );
      const rotationSeed = polygonState.tempRotation ?? tools.brushSettings.crossHatchRotation ?? 45;

      setBrushSettings({ crossHatchSpacing: finalSpacing });

      const vertices = polygonState.vertices;
      let nextRotation = rotationSeed;
      if (vertices && vertices.length) {
        const centroid = computePolygonCentroid(vertices);
        const angleRad = Math.atan2(pointerWorldPos.y - centroid.y, pointerWorldPos.x - centroid.x);
        nextRotation = ((angleRad * 180) / Math.PI + 360) % 360;
      }

      useAppStore.getState().setPolygonGradientState({
        drawingState: 'adjustingRotation',
        tempRotation: nextRotation,
        tempSpacing: finalSpacing,
        rotationInitialRotation: nextRotation,
        rotationReferenceAngle: undefined,
        spacingReferenceDistance: polygonState.spacingReferenceDistance,
        spacingReferenceSpacing: finalSpacing,
      });

      // Clean up any previous preview before starting new one
      if (currentPreviewCleanup) {
        currentPreviewCleanup();
      }
      currentPreviewCleanup = drawCrosshatchPreview(nextRotation, finalSpacing);
      context.deps.compositeCanvasDirtyRef.current = true;
      return true;
    }

    if (polygonState.drawingState === 'adjustingRotation') {
      const setBrushSettings = useAppStore.getState().setBrushSettings;
      const finalSpacing = clampCrosshatchSpacing(
        polygonState.tempSpacing ?? tools.brushSettings.crossHatchSpacing ?? 10
      );
      const finalRotation = polygonState.tempRotation ?? tools.brushSettings.crossHatchRotation ?? 45;

      setBrushSettings({ crossHatchSpacing: finalSpacing, crossHatchRotation: finalRotation });

      // Clean up any previous preview before starting new one
      if (currentPreviewCleanup) {
        currentPreviewCleanup();
      }
      currentPreviewCleanup = drawCrosshatchPreview(finalRotation, finalSpacing);
      context.deps.compositeCanvasDirtyRef.current = true;

      logShapeModeGuard('crosshatch-adjust-rotation');
      const finalizePromise = drawingHandlers.finalizeShapeDrawing();
      logShapeFillEvent('shape-fill-finalize-request', {
        source: 'crosshatch-adjust-rotation',
        previewId: opController.latestPreviewId,
      });
      finalizePromise.then(() => {
        logShapeFillEvent('shape-fill-finalize-success', {
          source: 'crosshatch-adjust-rotation',
        });

        if (compositeCanvasRef.current && project) {
          compositeLayersToCanvas(compositeCanvasRef.current);
          setCurrentOffscreenCanvas(compositeCanvasRef.current);
          compositeCanvasDirtyRef.current = false;
        }

        setNeedsRedraw(prev => prev + 1);

        if (restartColorCycleAnimation) {
          restartColorCycleAnimation();
        }
      }).catch(error => {
        logShapeFillEvent('shape-fill-finalize-error', {
          source: 'crosshatch-adjust-rotation',
          error: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }).finally(() => {
        stateMachine.finalizationComplete();
      });

      resetPolygonAdjustmentState();
      interaction.dispatch({ type: 'DRAWING_END' });
      return true;
    }

    return false;
  };

  const handleFlowPointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (event.button !== 0) {
      return false;
    }

    const polygonState = useAppStore.getState().polygonGradientState;
    if (
      polygonState.mode !== 'flow' ||
      polygonState.drawingState !== 'adjustingSpacing' ||
      !polygonState.vertices ||
      polygonState.vertices.length < 3
    ) {
      return false;
    }

    if (!shapeAdjustHelper || !shapeAdjustHelper.isActive()) {
      return false;
    }

    const worldPos = computeWorldPointer(event);
    shapeAdjustHelper.beginDrag(worldPos, event.pointerId, { shiftKey: event.shiftKey });
    return true;
  };

  const handleFlowPointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const polygonState = useAppStore.getState().polygonGradientState;
    if (
      polygonState.mode !== 'flow' ||
      polygonState.drawingState !== 'adjustingSpacing' ||
      !polygonState.vertices ||
      polygonState.vertices.length < 3
    ) {
      return false;
    }

    if (!shapeAdjustHelper || !shapeAdjustHelper.isActive()) {
      return false;
    }

    const previewRef = context.deps.previewAnimationFrameRef;
    const pointerId = event.pointerId;
    const worldPos = computeWorldPointer(event);
    const modifiers = { shiftKey: event.shiftKey } as const;

    const runUpdate = () => {
      const latestState = useAppStore.getState().polygonGradientState;
      if (
        latestState.mode !== 'flow' ||
        latestState.drawingState !== 'adjustingSpacing' ||
        !latestState.vertices ||
        latestState.vertices.length < 3
      ) {
        return;
      }
      shapeAdjustHelper?.updateDrag({ x: worldPos.x, y: worldPos.y }, pointerId, modifiers);
    };

    if (previewRef) {
      if (!previewRef.current) {
        const nowTs = performance.now();
        if (nowTs - context.getLastOverlayPreviewTs() < context.overlayPreviewFrameMs) {
          return true;
        }
        previewRef.current = requestAnimationFrame(() => {
          context.setLastOverlayPreviewTs(performance.now());
          runUpdate();
          previewRef.current = null;
        });
      }
      return true;
    }

    runUpdate();
    return true;
  };

  const handleFlowPointerUp = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const polygonState = useAppStore.getState().polygonGradientState;
    if (
      polygonState.mode !== 'flow' ||
      polygonState.drawingState !== 'adjustingSpacing' ||
      !polygonState.vertices ||
      polygonState.vertices.length < 3
    ) {
      return false;
    }

    if (!shapeAdjustHelper || !shapeAdjustHelper.isActive()) {
      return false;
    }

    const pointerId = event.pointerId;
    const pointerWorld = computeWorldPointer(event);

    if (shapeAdjustHelper.isDragging(pointerId)) {
      shapeAdjustHelper.updateDrag(pointerWorld, pointerId, { shiftKey: event.shiftKey });
      const committed = shapeAdjustHelper.endDrag(pointerId, true);
      if (committed) {
        commitShapeAdjustUpdate(committed);
      }
    } else {
      const current = shapeAdjustHelper.getCurrentValues();
      if (current) {
        commitShapeAdjustUpdate(current);
      }
    }

    shapeAdjustHelper.destroy();
    shapeAdjustHelper = null;
    context.deps.compositeCanvasDirtyRef.current = true;

    logShapeModeGuard('flow-adjust-spacing');
    const finalizePromise = drawingHandlers.finalizeShapeDrawing();
    logShapeFillEvent('shape-fill-finalize-request', {
      source: 'flow-adjust-spacing',
      previewId: opController.latestPreviewId,
    });
    finalizePromise.then(() => {
      logShapeFillEvent('shape-fill-finalize-success', {
        source: 'flow-adjust-spacing',
      });

      if (compositeCanvasRef.current && project) {
        compositeLayersToCanvas(compositeCanvasRef.current);
        setCurrentOffscreenCanvas(compositeCanvasRef.current);
        compositeCanvasDirtyRef.current = false;
      }

      setNeedsRedraw(prev => prev + 1);

      if (restartColorCycleAnimation) {
        restartColorCycleAnimation();
      }
    }).catch(error => {
      logShapeFillEvent('shape-fill-finalize-error', {
        source: 'flow-adjust-spacing',
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }).finally(() => {
      stateMachine.finalizationComplete();
    });

    resetPolygonAdjustmentState();
    clearCurrentPreview();
    interaction.dispatch({ type: 'DRAWING_END' });
    return true;
  };

  const computePointerPressure = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const raw = typeof event.pressure === 'number' ? event.pressure : 0.5;
    const hasRealPressure = raw !== 0.5 && raw !== 0; // treat non-defaults as real

    if (hasRealPressure) {
      return raw;
    }

    let pressure = raw;
    if (event.pointerType === 'mouse') {
      if (tools.brushSettings.pressureEnabled) {
        if (event.shiftKey) {
          pressure = 0.1;
        } else if (event.ctrlKey) {
          pressure = 0.9;
        } else {
          pressure = 1;
        }
      } else {
        pressure = 0.5;
      }
    }
    return pressure;
  };

  const polygonShapePointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (event.button !== 0) return false;

    logShapeSnapshot('shape-pointer-down', {
      pointerX: event.clientX,
      pointerY: event.clientY,
    });

    const isPolygonGradient = isPolygonGradientBrush();
    const isContourPolygon = isContourPolygonBrush();
    const isCCShape = isColorCycleShapeBrush();
    const isShapeFill = isShapeFillBrush();
    const liveBrush = useAppStore.getState().tools.brushSettings;
    const isDitherGradient = liveBrush.brushShape === BrushShape.DITHER_GRADIENT;

    if (isDitherGradient) {
      resetDitherGradOrigin();
      const pressure = computePointerPressure(event);
      const nowTs =
        typeof performance !== 'undefined' && typeof performance.now === 'function'
          ? performance.now()
          : Date.now();
      drawingHandlers.resetShapePressureState?.();
      drawingHandlers.updateShapePressure?.(pressure, nowTs, event.pressure);
    }

    if (isShapeFill) {
      const store = useAppStore.getState();
      const session = store.shapeFill.session;
      if (session && session.stage !== FillStage.Drawing) {
        const fallbackWorldPos = computeWorldPointer(event);
        const fallbackPressure = computePointerPressure(event);
        event.preventDefault();
        event.stopPropagation();

        const handleFinalizationResult = (didFinalize: boolean) => {
          if (didFinalize) {
            return;
          }
          const retryStore = useAppStore.getState();
          retryStore.cancelShapeFillSession();
          resetShapeFillHistoryContext();
          clearCurrentPreview();
          interaction.dispatch({ type: 'DRAWING_START' });
          drawingHandlers.startShapeDrawing(
            fallbackWorldPos,
            fallbackPressure,
            undefined,
            undefined,
            { renderPreview: false }
          );
        };

        if (session.stage === FillStage.AdjustingParam) {
          store.commitShapeFillParameter();
          const updated = useAppStore.getState().shapeFill.session;
          renderShapeFillLiveResult(updated ?? null);
          drawShapeFillPreview(updated ?? null);
          if (!updated || updated.stage === FillStage.Finalized) {
            void finalizeShapeFillResult().then(handleFinalizationResult);
          }
        } else if (session.stage === FillStage.Finalized) {
          void finalizeShapeFillResult().then(handleFinalizationResult);
        }
        return true;
      }
    }

    if (!isPolygonGradient && !isContourPolygon && !isCCShape && !isShapeFill) {
      return false;
    }

    const polygonState = useAppStore.getState().polygonGradientState;
    if (
      polygonState.drawingState === 'adjustingSize' ||
      polygonState.drawingState === 'adjustingRotation' ||
      polygonState.drawingState === 'adjustingSpacing'
    ) {
      contourDebug('skip-pointer-down-during-adjustment', {
        drawingState: polygonState.drawingState,
        mode: polygonState.mode,
      });
      return false;
    }

    const worldPos = computeWorldPointer(event);
    const pressure = computePointerPressure(event);

    const activeLayer = layers.find(layer => layer.id === activeLayerId);
    const isColorCycleLayer = activeLayer?.layerType === 'color-cycle';
    if (!isShapeFill && ((isColorCycleLayer && !isCCShape) || (!isColorCycleLayer && isCCShape))) {
      const message = isColorCycleLayer
        ? "Can't use regular polygon/contour on a Color Cycle layer. Select a Color Cycle shape, or switch layers."
        : "Can't use Color Cycle shape on a normal layer. Create/select a Color Cycle layer.";
      feedback?.(message);
      return true;
    }

    if (isShapeFill) {
      useAppStore.getState().cancelShapeFillSession();
      clearCurrentPreview();
      interaction.dispatch({ type: 'DRAWING_START' });
      drawingHandlers.startShapeDrawing(
        worldPos,
        pressure,
        undefined,
        undefined,
        { renderPreview: false }
      );
      return true;
    }

    if (isCCShape) {
      resetDitherGradOrigin();
      drawingHandlers.stopContinuousColorCycleAnimation?.('shape-tool-start');
      interaction.dispatch({ type: 'DRAWING_START' });
      const storeNow = useAppStore.getState();
      const brushNow = storeNow.tools.brushSettings;
      const isCCLinear = brushNow.colorCycleFillMode === 'linear';
      const presetId = context.deps.dynamicDepsRef.current.currentBrushPresetId;
      const isCCGradientPreset = presetId === 'color-cycle-gradient';
      const shouldDitherPreview =
        brushNow.brushShape === BrushShape.COLOR_CYCLE_SHAPE &&
        (isCCLinear || isCCGradientPreset) &&
        Boolean(brushNow.ditherEnabled);
      const suppressCCPreview = shouldDitherPreview && tools.shapeMode;
      drawingHandlers.startShapeDrawing(worldPos, pressure, undefined, undefined, {
        renderPreview: !suppressCCPreview,
      });
      return true;
    }

    startPolygonGradientDrawing(worldPos);
    interaction.dispatch({ type: 'DRAWING_START' });

    return true;
  };

  const polygonShapePointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const isPolygonGradient = isPolygonGradientBrush();
    const isContourPolygon = isContourPolygonBrush();
    const isCCShape = isColorCycleShapeBrush();
    const isShapeFill = isShapeFillBrush();
    const isShapePreviewActive =
      tools.shapeMode &&
      drawingHandlers.isDrawingShapeRef.current &&
      drawingHandlers.shapePointsRef.current.length > 0;

    if (!isPolygonGradient && !isContourPolygon && !isCCShape && !isShapeFill && !isShapePreviewActive) {
      return false;
    }

    const mouseDown = (event.buttons & 1) === 1;
    const penDown = event.pointerType === 'pen' && (event.pressure ?? 0) > 0;
    const isActivelyDrawing = mouseDown || penDown;

    // Hard guard: CC shapes should never update preview on hover after mouse up.
    if (isCCShape && !isActivelyDrawing) {
      return true;
    }

    const worldPos = computeWorldPointer(event);
    let previewWorld = worldPos;

    const liveBrushForMove = useAppStore.getState().tools.brushSettings;
    if (liveBrushForMove.brushShape === BrushShape.DITHER_GRADIENT) {
      const pressure = computePointerPressure(event);
      const nowTs =
        typeof performance !== 'undefined' && typeof performance.now === 'function'
          ? performance.now()
          : Date.now();
      const penActive = event.pointerType === 'pen' && (event.pressure ?? 0) > 0;
      const mouseDown = (event.buttons & 1) === 1;
      if (penActive || mouseDown) {
        drawingHandlers.updateShapePressure?.(pressure, nowTs, event.pressure);
      }
    }

    if (event.shiftKey) {
      const polygonState = getPolygonState();
      const points = (isPolygonGradient || isContourPolygon)
        ? polygonState.points
        : drawingHandlers.shapePointsRef.current;
      if (points && points.length >= 1) {
        const anchor = points[points.length - 1];
        previewWorld = snapPointToAngle(anchor, previewWorld, 45);
      }
    }

    if (isShapeFill) {
      if ((event.buttons & 1) === 1 && drawingHandlers.isDrawingShapeRef.current) {
        const pressure = computePointerPressure(event);
        const nowTs =
          typeof performance !== 'undefined' && typeof performance.now === 'function'
            ? performance.now()
            : Date.now();
        drawingHandlers.continueShapeDrawing(
          previewWorld,
          pressure,
          nowTs,
          event.pressure,
          { renderPreview: false }
        );
      }

      const store = useAppStore.getState();
      const session = store.shapeFill.session;
      if (session && session.stage === FillStage.AdjustingParam) {
        store.updateShapeFillCursor(previewWorld);
        const updatedSession = useAppStore.getState().shapeFill.session;
        renderShapeFillLiveResult(updatedSession ?? null);
        drawShapeFillPreview(updatedSession ?? null);
        return true;
      }
      // Continue to shared preview logic so shape outline renders while drawing.
    }

    let shouldShowPreview: boolean;
    if (isCCShape) {
      // Pause only while the user is actively drawing, not mere hover/preview.
      if (isActivelyDrawing) {
        drawingHandlers.stopContinuousColorCycleAnimation?.('shape-tool-drag');
      } else {
        // Keep animation running during hover (no drawing) for CC shapes.
        restartColorCycleAnimation?.();
      }

      if (isActivelyDrawing) {
        const pressure = computePointerPressure(event);
        const nowTs =
          typeof performance !== 'undefined' && typeof performance.now === 'function'
            ? performance.now()
            : Date.now();
        const storeNow = useAppStore.getState();
        const brushNow = storeNow.tools.brushSettings;
        const isCCLinear = brushNow.colorCycleFillMode === 'linear';
        const presetId = context.deps.dynamicDepsRef.current.currentBrushPresetId;
        const isCCGradientPreset = presetId === 'color-cycle-gradient';
        const shouldDitherPreview =
          brushNow.brushShape === BrushShape.COLOR_CYCLE_SHAPE &&
          (isCCLinear || isCCGradientPreset) &&
          Boolean(brushNow.ditherEnabled);
        const suppressCCPreview =
          shouldDitherPreview &&
          tools.shapeMode &&
          drawingHandlers.isDrawingShapeRef.current;
        drawingHandlers.continueShapeDrawing(previewWorld, pressure, nowTs, event.pressure, {
          renderPreview: !suppressCCPreview,
        });
      }

      // Only show/advance preview while actively drawing to avoid hover-follow after mouse up.
      shouldShowPreview =
        tools.shapeMode &&
        drawingHandlers.isDrawingShapeRef.current &&
        isActivelyDrawing;
    } else if (isPolygonGradient || isContourPolygon) {
      shouldShowPreview = appendPolygonGradientPoint(previewWorld);
    } else {
      shouldShowPreview = tools.shapeMode && drawingHandlers.isDrawingShapeRef.current;
    }

    if (tools.brushSettings.brushShape === BrushShape.DITHER_GRADIENT && !drawingHandlers.isDrawingShapeRef.current) {
      resetDitherGradOrigin();
    }

    const renderPolygonShapePreviewFrame = async (previewPoint: { x: number; y: number }) => {
      const overlayCanvas = overlayCanvasRef.current;
      const overlayCtx = overlayCanvas?.getContext('2d');
      const polygonStateForPreview = getPolygonState();
      const points = (isPolygonGradient || isContourPolygon)
        ? polygonStateForPreview.points
        : drawingHandlers.shapePointsRef.current;

      if (!(overlayCtx && overlayCanvas && points && points.length > 0)) {
        return;
      }

      overlayCtx.save();
      overlayCtx.imageSmoothingEnabled = false;
      overlayCtx.translate(viewTransformRef.current.offsetX, viewTransformRef.current.offsetY);
      overlayCtx.scale(viewTransformRef.current.scale, viewTransformRef.current.scale);

      const pts = points as Array<{ x: number; y: number }>;
      const vertexCount = pts.length + 1;
      let didCustomFill = false;

      if (vertexCount >= 3) {
        const previewStrokePalette = getPreviewStrokePalette(tools.brushSettings.color);
        const storeNow = useAppStore.getState();
        const brushNow = storeNow.tools.brushSettings;
        const dynamicPresetId = context.deps.dynamicDepsRef.current.currentBrushPresetId;
        const presetId = dynamicPresetId ?? context.deps.currentBrushPresetId;
        const isCCShape = brushNow.brushShape === BrushShape.COLOR_CYCLE_SHAPE;
        const isCCLinear = brushNow.colorCycleFillMode === 'linear';
        const isColorCycleGradientPreset = presetId === 'color-cycle-gradient';
        const isColorCycleGradientPreview = isCCShape && isCCLinear;
        const isDitherShapePreview = presetId === 'dither-shape' && tools.shapeMode;
        const shouldDitherPreview =
          isCCShape && (isCCLinear || isColorCycleGradientPreset) && Boolean(brushNow.ditherEnabled);

        if (shouldDitherPreview && ditherGradPreviewState.ccLastCanvas && ditherGradPreviewState.ccLastOrigin) {
          overlayCtx.save();
          overlayCtx.setTransform(1, 0, 0, 1, 0, 0);
          overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
          overlayCtx.restore();
          overlayCtx.save();
          overlayCtx.globalAlpha = SHAPE_PREVIEW_OPACITY;
          overlayCtx.drawImage(
            ditherGradPreviewState.ccLastCanvas,
            ditherGradPreviewState.ccLastOrigin.x,
            ditherGradPreviewState.ccLastOrigin.y
          );
          overlayCtx.restore();
        } else if (!shouldDitherPreview) {
          const cachedPreview = drawingHandlers.ccShapePreviewCacheRef?.current;
          if (cachedPreview) {
            overlayCtx.save();
            overlayCtx.setTransform(1, 0, 0, 1, 0, 0);
            overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
            overlayCtx.restore();
            overlayCtx.save();
            overlayCtx.globalAlpha = SHAPE_PREVIEW_OPACITY;
            overlayCtx.drawImage(
              cachedPreview.canvas,
              cachedPreview.origin.x,
              cachedPreview.origin.y
            );
            overlayCtx.restore();
            didCustomFill = true;
          } else {
            overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
          }
        }
        const strokePreviewOutline = () => {
          drawHighContrastStroke(
            overlayCtx,
            ctx => {
              ctx.beginPath();
              ctx.moveTo(pts[0].x, pts[0].y);
              for (let i = 1; i < pts.length; i++) {
                ctx.lineTo(pts[i].x, pts[i].y);
              }
              ctx.lineTo(previewPoint.x, previewPoint.y);
              ctx.closePath();
            },
            viewTransformRef.current.scale,
            previewStrokePalette,
            0.95
          );
        };

        if (isContourPolygon) {
          overlayCtx.strokeStyle = tools.brushSettings.color;
          overlayCtx.lineWidth = 2 / viewTransformRef.current.scale;
          overlayCtx.globalAlpha = 0.8;
        } else if (tools.brushSettings.brushShape === BrushShape.COLOR_CYCLE_SHAPE) {
          if (isColorCycleGradientPreset || isColorCycleGradientPreview) {
            const useForegroundDerived = Boolean(brushNow.colorCycleUseForegroundGradient);
            const isSampledPreviewMode = brushNow.ccGradientSource === 'sampled';
            const livePreviewPoints = [...pts, previewPoint];
            if (
              isSampledPreviewMode &&
              storeNow.activeLayerId &&
              typeof drawingHandlers.updateCcSampledGradient === 'function'
            ) {
              drawingHandlers.updateCcSampledGradient(livePreviewPoints, {
                layerId: storeNow.activeLayerId,
                markKind: 'shape',
              });
            }
            const ccPreview = storeNow.activeLayerId
              ? getPreviewGradientForActiveMark(storeNow.activeLayerId)
              : null;
            const ccStopsOverride =
              ccPreview?.source === 'sampled' &&
              ccPreview?.stopsStored &&
              ccPreview.stopsStored.length >= 2
                ? ccPreview.stopsStored
                : null;
            const fgBaseColor =
              context.deps.palette?.foregroundColor ??
              brushNow.color ??
              '#000';
            const derivedSpec = useForegroundDerived
              ? buildForegroundDerivedGradientSpec({
                  baseColor: fgBaseColor,
                  lightness: brushNow.colorCycleFgLightness,
                  variance: brushNow.colorCycleFgVariance,
                  hueShift: brushNow.colorCycleFgHueShift,
                  saturationShift: brushNow.colorCycleFgSaturationShift,
                  opacity: brushNow.colorCycleFgOpacity,
                  bands: clampForegroundDerivedBands(
                    brushNow.colorCycleFgStops
                  ),
                })
              : null;
            const derivedStops = derivedSpec
              ? deriveForegroundGradientStops(derivedSpec)
              : null;
            const stops = isSampledPreviewMode
              ? ccStopsOverride
              : (
                ccStopsOverride ??
                (derivedStops && derivedStops.length >= 2
                  ? derivedStops
                  : brushNow.colorCycleGradient?.length
                    ? brushNow.colorCycleGradient
                    : DEFAULT_COLOR_CYCLE_GRADIENT)
              );
            const effectiveStops = stops ?? [];
            const ditherRenderStops = shouldDitherPreview
              ? buildCcDitherRuntimePalette({
                  baseStops: effectiveStops,
                  bands: resolveCcDitherBandMode(brushNow.gradientBands ?? 16).pairBandCount,
                  spread: brushNow.ditherPaletteSpread,
                  algorithm: brushNow.ditherAlgorithm,
                  preserveSourceStops:
                    ccPreview?.source === 'sampled' &&
                    resolveCcDitherBandMode(brushNow.gradientBands ?? 16).pairBandCount <= 0 &&
                    (brushNow.ditherAlgorithm ?? 'sierra-lite') === 'sierra-lite',
                  debugContext: 'preview-fill-linear',
                }).renderStops
              : stops;
            ccLog('shape tool preview spread source', {
              source: ccPreview?.source ?? null,
              sampledMode: isSampledPreviewMode,
              brushNowSpread: brushNow.ditherPaletteSpread ?? null,
              gradientBands: brushNow.gradientBands ?? null,
              pairBandCount: resolveCcDitherBandMode(brushNow.gradientBands ?? 16).pairBandCount,
              algorithm: brushNow.ditherAlgorithm ?? null,
            });
            if (isSampledPreviewMode && effectiveStops.length < 2) {
              strokePreviewOutline();
              didCustomFill = true;
              return;
            }
            if (shouldDitherPreview) {
              if (ditherGradPreviewState.ccLastCanvas && ditherGradPreviewState.ccLastOrigin) {
                const { scale, offsetX, offsetY } = viewTransformRef.current;
                overlayCtx.save();
                overlayCtx.setTransform(1, 0, 0, 1, 0, 0);
                overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
                overlayCtx.restore();
                overlayCtx.save();
                overlayCtx.translate(offsetX, offsetY);
                overlayCtx.scale(scale, scale);
                overlayCtx.globalAlpha = SHAPE_PREVIEW_OPACITY;
                overlayCtx.imageSmoothingEnabled = false;
                overlayCtx.drawImage(
                  ditherGradPreviewState.ccLastCanvas,
                  ditherGradPreviewState.ccLastOrigin.x,
                  ditherGradPreviewState.ccLastOrigin.y
                );
                overlayCtx.restore();
                didCustomFill = true;
              } else {
                didCustomFill = true;
              }
              if (ditherGradPreviewState.ccJobInFlight) {
                ditherGradPreviewState.ccJobDirty = true;
              } else {
                ditherGradPreviewState.ccJobInFlight = true;
                ditherGradPreviewState.ccJobDirty = false;
                const mySeq = ++ditherGradPreviewState.ccJobSeq;
                const allPoints = [...pts, previewPoint];
                let roiMinX = allPoints[0].x;
                let roiMinY = allPoints[0].y;
                let roiMaxX = allPoints[0].x;
                let roiMaxY = allPoints[0].y;
                for (let i = 1; i < allPoints.length; i++) {
                  const p = allPoints[i];
                  if (p.x < roiMinX) roiMinX = p.x;
                  if (p.y < roiMinY) roiMinY = p.y;
                  if (p.x > roiMaxX) roiMaxX = p.x;
                  if (p.y > roiMaxY) roiMaxY = p.y;
                }
                const PAD = 1;
                const origin = { x: Math.floor(roiMinX) - PAD, y: Math.floor(roiMinY) - PAD };
                const maxXInt = Math.ceil(roiMaxX) + PAD;
                const maxYInt = Math.ceil(roiMaxY) + PAD;
                const w = Math.max(1, maxXInt - origin.x + 1);
                const h = Math.max(1, maxYInt - origin.y + 1);
                const localVertices = allPoints.map(pt => ({
                  x: pt.x - origin.x,
                  y: pt.y - origin.y,
                }));
                const axis = computeAxisOpposingEnds(localVertices);
                let minProj = Infinity;
                let maxProj = -Infinity;
                for (const v of localVertices) {
                  const proj = v.x * axis.dir.x + v.y * axis.dir.y;
                  if (proj < minProj) minProj = proj;
                  if (proj > maxProj) maxProj = proj;
                }
                const projRange = Math.max(1e-6, maxProj - minProj);
                const sortedStops = Array.from(ditherRenderStops ?? [])
                  .map(stop => ({
                    position: Math.max(0, Math.min(1, Number.isFinite(stop.position) ? stop.position : 0)),
                    rgba: parseCssColorToRgba(stop.color),
                  }))
                  .sort((a, b) => a.position - b.position);
                if (sortedStops.length === 0) {
                  sortedStops.push({ position: 0, rgba: [0, 0, 0, 255] });
                  sortedStops.push({ position: 1, rgba: [255, 255, 255, 255] });
                } else if (sortedStops.length === 1) {
                  sortedStops.push({ position: 1, rgba: sortedStops[0].rgba });
                }
                const sampleGradient = (t: number): [number, number, number, number] => {
                  const tt = Math.max(0, Math.min(1, t));
                  let idx = 0;
                  for (let i = 0; i < sortedStops.length - 1; i++) {
                    if (tt >= sortedStops[i].position && tt <= sortedStops[i + 1].position) {
                      idx = i;
                      break;
                    }
                    if (tt > sortedStops[i + 1].position) idx = i + 1;
                  }
                  const a = sortedStops[Math.max(0, Math.min(sortedStops.length - 2, idx))];
                  const b = sortedStops[Math.max(1, Math.min(sortedStops.length - 1, idx + 1))];
                  const span = Math.max(1e-6, b.position - a.position);
                  const localT = Math.max(0, Math.min(1, (tt - a.position) / span));
                  const lerp = (v0: number, v1: number) => v0 + (v1 - v0) * localT;
                  return [
                    lerp(a.rgba[0], b.rgba[0]),
                    lerp(a.rgba[1], b.rgba[1]),
                    lerp(a.rgba[2], b.rgba[2]),
                    lerp(a.rgba[3], b.rgba[3]),
                  ];
                };
                const basePixelSize = Math.max(1, Math.round(brushNow.fillResolution ?? 1));
                const usePressure =
                  Boolean(brushNow.pressureLinkedFillResolution) &&
                  Boolean(drawingHandlers.hadValidShapePressureRef?.current);
                const pressurePixelSize = usePressure
                  ? (drawingHandlers.latestShapePixelSizeRef?.current ??
                    drawingHandlers.computeShapePixelSize?.(
                      drawingHandlers.lastStablePressureRef?.current ?? 0.5
                    ) ??
                    basePixelSize)
                  : basePixelSize;
                const pixelSize = Math.max(1, Math.round(pressurePixelSize || basePixelSize));
                const levels = Math.max(1, Math.min(16, Math.round(brushNow.gradientBands ?? 16)));
                const fillAlgorithm = brushNow.ditherAlgorithm ?? 'sierra-lite';
                const fillPatternStyle = brushNow.patternStyle ?? 'dots';
                const fillBackground = (brushNow.ditherGradBgFill ?? brushNow.ditherBackgroundFill) !== false;
                const flatSeedValues = [w, h, pixelSize, levels, minProj, maxProj];
                for (let i = 0; i < localVertices.length; i += 1) {
                  flatSeedValues.push(localVertices[i].x, localVertices[i].y);
                }
                const flatSeed = hashNumbers(...flatSeedValues);
                const tempCanvas = canvasPool.acquire(w, h);
                const tempCtx = tempCanvas.getContext(
                  '2d',
                  { willReadFrequently: true } as CanvasRenderingContext2DSettings
                );
                if (!tempCtx) {
                  canvasPool.release(tempCanvas);
                  ditherGradPreviewState.ccJobInFlight = false;
                } else {
                  tempCtx.setTransform(1, 0, 0, 1, 0, 0);
                  tempCtx.globalCompositeOperation = 'source-over';
                  tempCtx.globalAlpha = 1;
                  tempCtx.imageSmoothingEnabled = false;
                  tempCtx.clearRect(0, 0, w, h);
                  const imageData = tempCtx.createImageData(w, h);
                  const data = imageData.data;
                  const yieldIfNeeded = createPreviewYieldController();
                  (async () => {
                    try {
                      const liveState = useAppStore.getState();
                      const liveLayerId = liveState.activeLayerId;
                      const liveSession = liveLayerId ? getActiveMarkGradientSession(liveLayerId) : null;
                      const shouldSkipSampledPreviewReplay =
                        liveState.tools.ccGradientSource === 'sampled' &&
                        !drawingHandlers.isDrawingShapeRef.current &&
                        !liveSession;
                      if (shouldSkipSampledPreviewReplay) {
                        canvasPool.release(tempCanvas);
                        return;
                      }
                      await fillCcGradientDither({
                        vertices: localVertices,
                        minX: 0,
                        minY: 0,
                        maxX: w - 1,
                        maxY: h - 1,
                        pixelSize,
                        levels,
                        baseOffset: 0,
                        flatPairSpread: brushNow.ditherPaletteSpread,
                        flatSeed,
                        algorithm: fillAlgorithm,
                        patternStyle: fillPatternStyle,
                        sampledFlatTraceId: liveSession?.markId
                          ? `${liveSession.markId}:preview`
                          : undefined,
                        sampledFlatTraceStage: 'preview',
                        fillBackground,
                        yieldIfNeeded,
                        sampleNormalized: (x, y) => {
                          const proj = x * axis.dir.x + y * axis.dir.y;
                          return (proj - minProj) / projRange;
                        },
                        writeIndex: (x, y, index) => {
                          if (index <= 0) return;
                          const t = (index - 1) / 254;
                          const [r, g, b, a] = sampleGradient(t);
                          const px = (y * w + x) * 4;
                          data[px] = Math.round(r);
                          data[px + 1] = Math.round(g);
                          data[px + 2] = Math.round(b);
                          data[px + 3] = Math.round(a);
                        },
                      });
                      if (mySeq !== ditherGradPreviewState.ccJobSeq) return;
                      tempCtx.putImageData(imageData, 0, 0);
                      if (ditherGradPreviewState.ccLastCanvas) {
                        canvasPool.release(ditherGradPreviewState.ccLastCanvas);
                      }
                      ditherGradPreviewState.ccLastCanvas = tempCanvas;
                      ditherGradPreviewState.ccLastOrigin = { ...origin };
                      if (drawingHandlers.ccShapePreviewCacheRef) {
                        drawingHandlers.ccShapePreviewCacheRef.current = {
                          canvas: tempCanvas,
                          origin: { ...origin },
                        };
                      }
                      const { scale, offsetX, offsetY } = viewTransformRef.current;
                      overlayCtx.save();
                      overlayCtx.setTransform(1, 0, 0, 1, 0, 0);
                      overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
                      overlayCtx.restore();
                      overlayCtx.save();
                      overlayCtx.translate(offsetX, offsetY);
                      overlayCtx.scale(scale, scale);
                      overlayCtx.globalAlpha = SHAPE_PREVIEW_OPACITY;
                      overlayCtx.imageSmoothingEnabled = false;
                      overlayCtx.drawImage(tempCanvas, origin.x, origin.y);
                      overlayCtx.restore();
                    } catch {
                      canvasPool.release(tempCanvas);
                    } finally {
                      ditherGradPreviewState.ccJobInFlight = false;
                      if (ditherGradPreviewState.ccJobDirty) {
                        ditherGradPreviewState.ccJobDirty = false;
                        const rerenderPoint = latestPolygonPreviewPoint
                          ? { ...latestPolygonPreviewPoint }
                          : null;
                        const canReplayPreview =
                          Boolean(rerenderPoint) &&
                          tools.shapeMode &&
                          drawingHandlers.isDrawingShapeRef.current &&
                          drawingHandlers.shapePointsRef.current.length > 0;
                        if (canReplayPreview) {
                          schedulePolygonShapePreviewFrame(() =>
                            latestPolygonPreviewPoint
                              ? { ...latestPolygonPreviewPoint }
                              : rerenderPoint
                          );
                        }
                      }
                    }
                  })();
                }
              }
            } else {
              const axis = computeAxisOpposingEnds([...pts, previewPoint]);
              const gradient = overlayCtx.createLinearGradient(
                axis.start.x,
                axis.start.y,
                axis.end.x,
                axis.end.y
              );
              effectiveStops.forEach((stop) => {
                const pos = Number.isFinite(stop.position) ? stop.position : 0;
                gradient.addColorStop(Math.max(0, Math.min(1, pos)), stop.color);
              });
              overlayCtx.fillStyle = gradient;
              overlayCtx.globalAlpha = SHAPE_PREVIEW_OPACITY;
            }
          } else {
            overlayCtx.fillStyle = 'rgba(0, 0, 0, 0.3)';
            overlayCtx.globalAlpha = SHAPE_PREVIEW_OPACITY;
          }
        } else if (isShapeFill) {
          overlayCtx.fillStyle = tools.brushSettings.color ?? 'rgba(255,255,255,1)';
          overlayCtx.globalAlpha = 0.35;
        } else if (isDitherShapePreview) {
          overlayCtx.fillStyle = tools.brushSettings.color;
          overlayCtx.globalAlpha = SHAPE_PREVIEW_OPACITY;
        } else if (tools.shapeMode && !isPolygonGradient && !isShapeFill) {
          overlayCtx.fillStyle = tools.brushSettings.color;
          overlayCtx.globalAlpha = 0.4;
        } else {
          let minX = pts[0].x;
          let minY = pts[0].y;
          let maxX = pts[0].x;
          let maxY = pts[0].y;
          for (let i = 1; i < pts.length; i++) {
            const p = pts[i];
            if (p.x < minX) minX = p.x;
            if (p.y < minY) minY = p.y;
            if (p.x > maxX) maxX = p.x;
            if (p.y > maxY) maxY = p.y;
          }
          const baseMinX = minX;
          const baseMinY = minY;
          const baseMaxX = maxX;
          const baseMaxY = maxY;
          if (previewPoint.x < minX) minX = previewPoint.x;
          if (previewPoint.y < minY) minY = previewPoint.y;
          if (previewPoint.x > maxX) maxX = previewPoint.x;
          if (previewPoint.y > maxY) maxY = previewPoint.y;
          const width = maxX - minX;
          const height = maxY - minY;

          if (tools.brushSettings.brushShape === BrushShape.DITHER_GRADIENT) {
            const fallbackPressure = drawingHandlers.lastStablePressureRef?.current ?? 0.5;
            const pixelSize =
              drawingHandlers.latestShapePixelSizeRef?.current ??
              drawingHandlers.computeShapePixelSize?.(fallbackPressure) ??
              computePressureResolution(
                Math.max(1, Math.round(tools.brushSettings.fillResolution ?? 1)),
                fallbackPressure,
                Boolean(
                  tools.brushSettings.pressureLinkedFillResolution &&
                    drawingHandlers.hadValidShapePressureRef?.current
                ),
                ditherGradPreviewState.resState,
                undefined,
                resolvePressureLinkedFillMaxResolution({
                  fillResolution: tools.brushSettings.fillResolution,
                  pressureLinkedFillMaxResolution: tools.brushSettings.pressureLinkedFillMaxResolution,
                })
              );

            if (!ditherGradPreviewState.origin) {
              ditherGradPreviewState.origin = { x: Math.floor(baseMinX), y: Math.floor(baseMinY) };
            }
            ditherGradPreviewState.lastPx = pixelSize;
            const origin = ditherGradPreviewState.origin ?? { x: Math.floor(baseMinX), y: Math.floor(baseMinY) };

            const localVertices = [...pts, previewPoint].map(pt => ({
              x: pt.x - origin.x,
              y: pt.y - origin.y,
            }));
            const axisBase = computeAxisOpposingEnds(localVertices);
            const w = Math.max(1, Math.ceil(Math.max(baseMaxX, previewPoint.x) - origin.x));
            const h = Math.max(1, Math.ceil(Math.max(baseMaxY, previewPoint.y) - origin.y));
            const corners = [
              { x: 0, y: 0 },
              { x: w, y: 0 },
              { x: 0, y: h },
              { x: w, y: h },
            ];
            let minT = Infinity;
            let maxT = -Infinity;
            for (const v of localVertices) {
              const t = v.x * axisBase.dir.x + v.y * axisBase.dir.y;
              if (t < minT) minT = t;
              if (t > maxT) maxT = t;
            }
            for (const c of corners) {
              const t = c.x * axisBase.dir.x + c.y * axisBase.dir.y;
              if (t < minT) minT = t;
              if (t > maxT) maxT = t;
            }
            const axisLength = Math.max(1e-6, maxT - minT);
            const axis = {
              start: { x: axisBase.dir.x * minT, y: axisBase.dir.y * minT },
              end: { x: axisBase.dir.x * maxT, y: axisBase.dir.y * maxT },
              dir: axisBase.dir,
              length: axisLength,
            };
            const dot = (p: { x: number; y: number }, d: { x: number; y: number }) => p.x * d.x + p.y * d.y;
            const cornersForT = [
              { x: 0, y: 0 },
              { x: w, y: 0 },
              { x: 0, y: h },
              { x: w, y: h },
            ];
            let minProj = Infinity;
            let maxProj = -Infinity;
            for (const p of [...localVertices, ...cornersForT]) {
              const proj = dot(p, axis.dir);
              if (proj < minProj) minProj = proj;
              if (proj > maxProj) maxProj = proj;
            }
            const startProj = dot(axis.start, axis.dir);
            const shift = minProj - startProj;
            const axisNorm = {
              ...axis,
              start: { x: axis.start.x + axis.dir.x * shift, y: axis.start.y + axis.dir.y * shift },
              length: Math.max(1e-6, maxProj - minProj),
            };
            const lengthFactor = Math.max(
              0.05,
              Math.min(2, ((tools.brushSettings.gradientLength ?? 100) / 100) * 1.3)
            );
            const axisScaled = scaleOrderedAxis(axisNorm, lengthFactor);

            const palette = useAppStore.getState().palette;
            const fg = parseCssColorToRgba(
              palette?.foregroundColor ?? tools.brushSettings.color ?? '#000'
            );
            const bg = parseCssColorToRgba(palette?.backgroundColor ?? '#fff');
            const paletteRGBA = resolveDitherGradPalette(
              fg,
              bg,
              tools.brushSettings.ditherGradBgFill,
              tools.brushSettings.ditherGradStops,
              tools.brushSettings.trans
            );
            const tempCanvas = canvasPool.acquire(w, h);
            const tempCtx = tempCanvas.getContext('2d', { willReadFrequently: true } as CanvasRenderingContext2DSettings);
            if (tempCtx) {
              tempCtx.setTransform(1, 0, 0, 1, 0, 0);
              tempCtx.globalCompositeOperation = 'source-over';
              tempCtx.globalAlpha = 1;
              tempCtx.imageSmoothingEnabled = false;
              tempCtx.clearRect(0, 0, w, h);
              const imageData = renderDitherGradientToImageData({
                width: w,
                height: h,
                axis: axisScaled,
                paletteRGBA,
                tileSize: 8,
                pixelSize,
                origin,
                algorithm: tools.brushSettings.ditherAlgorithm,
                patternStyle: tools.brushSettings.patternStyle,
              });
              tempCtx.clearRect(0, 0, w, h);
              tempCtx.putImageData(imageData, 0, 0);
              applyPolygonMaskToCanvasContext(tempCtx, localVertices);

              overlayCtx.save();
              overlayCtx.globalAlpha = SHAPE_PREVIEW_OPACITY;
              overlayCtx.drawImage(tempCanvas, origin.x, origin.y);
              overlayCtx.restore();
            }
            canvasPool.release(tempCanvas);
            didCustomFill = true;
          } else {
            let gradient: CanvasGradient;
            if (width > height) {
              gradient = overlayCtx.createLinearGradient(minX, (minY + maxY) / 2, maxX, (minY + maxY) / 2);
            } else {
              gradient = overlayCtx.createLinearGradient((minX + maxX) / 2, minY, (minX + maxX) / 2, maxY);
            }

            const useSampledFill = false;
            const previewColors = polygonStateForPreview.points.length > 0
              ? polygonStateForPreview.points.map(point => point.color ?? tools.brushSettings.color)
              : [];
            const previewColor = useSampledFill
              ? sampleColorAtPosition(previewPoint.x, previewPoint.y)
              : getPrimaryColor(resolveShapeFillColors(polygonStateForPreview.points));
            previewColors.push(previewColor);

            if (previewColors.length >= 3) {
              gradient.addColorStop(0, previewColors[0]);
              gradient.addColorStop(0.5, previewColors[Math.floor(previewColors.length / 2)]);
              gradient.addColorStop(1, previewColors[previewColors.length - 1]);
            } else if (previewColors.length === 2) {
              gradient.addColorStop(0, previewColors[0]);
              gradient.addColorStop(1, previewColors[1]);
            } else if (previewColors.length === 1) {
              gradient.addColorStop(0, previewColors[0]);
              gradient.addColorStop(1, previewColors[0]);
            }

            overlayCtx.fillStyle = gradient;
          }
        }

        overlayCtx.globalCompositeOperation = 'source-over';
        overlayCtx.beginPath();
        overlayCtx.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < pts.length; i++) {
          overlayCtx.lineTo(pts[i].x, pts[i].y);
        }
        overlayCtx.lineTo(previewPoint.x, previewPoint.y);
        overlayCtx.closePath();

        if (isContourPolygon) {
          overlayCtx.stroke();
          strokePreviewOutline();
        } else if (isShapeFill) {
          if (!didCustomFill) {
            overlayCtx.fill();
          }
        } else {
          if (!didCustomFill) {
            overlayCtx.fill();
          }
          strokePreviewOutline();
        }

        const anchorPoints = [...pts, previewPoint];
        drawHighContrastAnchors(
          overlayCtx,
          anchorPoints,
          viewTransformRef.current.scale,
          previewStrokePalette,
          0.95
        );
      } else if (pts.length === 1 && tools.shapeMode && drawingHandlers.isDrawingShapeRef.current) {
        const palette = getPreviewStrokePalette(tools.brushSettings.color);
        drawHighContrastStroke(
          overlayCtx,
          ctx => {
            ctx.beginPath();
            ctx.moveTo(pts[0].x, pts[0].y);
            ctx.lineTo(previewPoint.x, previewPoint.y);
          },
          viewTransformRef.current.scale,
          palette,
          0.95
        );
        drawHighContrastAnchors(
          overlayCtx,
          [pts[0], previewPoint],
          viewTransformRef.current.scale,
          palette,
          0.95
        );
      } else if (pts.length === 0 && tools.shapeMode && drawingHandlers.isDrawingShapeRef.current) {
        const palette = getPreviewStrokePalette(tools.brushSettings.color);
        drawHighContrastDot(
          overlayCtx,
          previewPoint.x,
          previewPoint.y,
          viewTransformRef.current.scale,
          palette,
          0.95,
          1.0
        );
      }

      overlayCtx.restore();
    };

    const schedulePolygonShapePreviewFrame = (
      resolvePreviewPoint: () => { x: number; y: number } | null
    ) => {
      if (!previewAnimationFrameRef || previewAnimationFrameRef.current) {
        return;
      }

      previewAnimationFrameRef.current = requestAnimationFrame(() => {
        const point = resolvePreviewPoint();
        if (!point) {
          if (previewAnimationFrameRef) {
            previewAnimationFrameRef.current = null;
          }
          return;
        }

        void renderPolygonShapePreviewFrame(point).finally(() => {
          if (previewAnimationFrameRef) {
            previewAnimationFrameRef.current = null;
          }
        });
      });
    };

    const requestPolygonShapePreviewFrame = () => {
      if (!latestPolygonPreviewPoint) {
        return;
      }
      schedulePolygonShapePreviewFrame(() =>
        latestPolygonPreviewPoint ? { ...latestPolygonPreviewPoint } : null
      );
    };

    if (shouldShowPreview && previewAnimationFrameRef) {
      latestPolygonPreviewPoint = { ...previewWorld };
      if (!previewAnimationFrameRef.current) {
        const nowTs = performance.now();
        if (nowTs - context.getLastOverlayPreviewTs() < context.overlayPreviewFrameMs) {
          return true;
        }

        context.setLastOverlayPreviewTs(performance.now());
        requestPolygonShapePreviewFrame();
      }
      return true;
    }

    return shouldShowPreview;
  };

  const polygonShapePointerUp = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const isPolygonGradient = isPolygonGradientBrush();
    const isContourPolygon = isContourPolygonBrush();
    const isShapeFill = isShapeFillBrush();
    const liveBrushForUp = useAppStore.getState().tools.brushSettings;
    if (liveBrushForUp.brushShape === BrushShape.DITHER_GRADIENT) {
      const nowTs =
        typeof performance !== 'undefined' && typeof performance.now === 'function'
          ? performance.now()
          : Date.now();
      drawingHandlers.updateShapePressure?.(0, nowTs, event.pressure);
      resetDitherGradOrigin();
    }

    if (isShapeFill) {
      if (drawingHandlers.isDrawingShapeRef.current && drawingHandlers.shapePointsRef.current.length >= 3) {
        const points = drawingHandlers.shapePointsRef.current.map(point => ({ x: point.x, y: point.y }));
        const store = useAppStore.getState();
        const activeLayer = store.layers.find(layer => layer.id === store.activeLayerId);
        if (activeLayer && activeLayer.layerType !== 'color-cycle') {
          shapeFillHistoryContext.layerId = activeLayer.id;
          shapeFillHistoryContext.beforeImage = snapshotLayerImageData(activeLayer);
          shapeFillHistoryContext.coalesceKey = `shape-fill:${activeLayer.id}:${store.shapeFill.activeFillId ?? 'unknown'}:${Date.now().toString(36)}`;
          shapeFillHistoryContext.bbox = computeBoundingBox(points);
        } else {
          resetShapeFillHistoryContext();
        }
        store.beginShapeFillSession(points);
        drawingHandlers.isDrawingShapeRef.current = false;
        drawingHandlers.shapePointsRef.current = [];
        const session = useAppStore.getState().shapeFill.session;
        if (session?.stage === FillStage.AdjustingParam) {
          renderShapeFillLiveResult(session);
        }
        drawShapeFillPreview(session ?? null);
        if (!session || session.stage === FillStage.Finalized) {
          void finalizeShapeFillResult();
        }
      }
      return true;
    }

    if (!isPolygonGradient && !isContourPolygon) {
      return false;
    }

    const polygonState = getPolygonState();
    const points = polygonState.points;
    if (!points || points.length === 0) {
      return true;
    }

    const pointerWorld = computeWorldPointer(event);

    if (points.length < 3) {
      return true;
    }

    const vertices = points.map((p: { x: number; y: number }) => ({ x: p.x, y: p.y }));
    const resolvedColors = resolveShapeFillColors(points);
    const fillColor = getPrimaryColor(resolvedColors);
    drawingHandlers.initDrawingCanvas();
    const drawCtx = drawingHandlers.drawingCanvasRef.current?.getContext('2d', { willReadFrequently: true });

    if (drawCtx && brushEngine) {
      if (isContourPolygon) {
        const shapeMode = tools.brushSettings.shapeGradientMode || 'contour';

        if (shapeMode === 'crosshatch') {
          clearOverlayCanvas();

          // Don't clear drawing canvas - let canvasManager handle preview lifecycle
          // Manually clearing here can destroy content that's being finalized

          useAppStore.getState().setPolygonGradientState({
            drawingState: 'adjustingSpacing',
            mode: 'crosshatch',
            vertices,
            fillColor,
            tempRotation: tools.brushSettings.crossHatchRotation || 45,
            tempSpacing: tools.brushSettings.crossHatchSpacing || 10,
            adjustmentStartPos: undefined,
            rotationReferenceAngle: undefined,
            rotationInitialRotation: undefined,
            tempSize: undefined,
            sizeReferenceDistance: undefined,
            sizeInitialSize: undefined,
            spacingReferenceDistance: undefined,
            spacingReferenceSpacing: tools.brushSettings.crossHatchSpacing || 10,
          });

          brushEngine.drawCrossHatchPolygon(
            drawCtx,
            {
              vertices,
              fillColor,
            },
            false
          );

          return true;
        }

        if (shapeMode === 'flow') {
          clearOverlayCanvas();

          // Don't clear drawing canvas - let canvasManager handle preview lifecycle
          // Manually clearing here can destroy content that's being finalized

          const initialSpacing = clampFlowSeedSpacing(tools.brushSettings.flowSeedSpacing ?? 18);
          const initialMaxSteps = tools.brushSettings.flowMaxSteps ?? 120;
          const initialOrientation = normalizeOrientation(tools.brushSettings.flowOrientationAngle ?? 0);
          const initialNoise = Math.max(0, Math.min(1, tools.brushSettings.flowSeedJitter ?? 0.6));
          const randomSeed = Math.floor(Math.random() * 0xffffffff);
          const centroid = computePolygonCentroid(vertices);
          const gpuJobId: string | undefined = undefined;

          useAppStore.getState().setPolygonGradientState({
            drawingState: 'adjustingSpacing',
            mode: 'flow',
            vertices,
            fillColor,
            tempSpacing: initialSpacing,
            tempMaxSteps: initialMaxSteps,
            tempOrientation: initialOrientation,
            tempNoiseStrength: initialNoise,
            spacingReferenceDistance: undefined,
            spacingReferenceSpacing: initialSpacing,
            flowRandomSeed: randomSeed,
            gpuJobId,
          });

          dispatchFlowJobUpdate({
            spacing: initialSpacing,
            density: initialMaxSteps,
            orientation: initialOrientation,
            noiseStrength: initialNoise,
            band: 'spacing',
          }, false);

          // Clean up any previous preview before starting new one
          if (currentPreviewCleanup) {
            currentPreviewCleanup();
          }
          currentPreviewCleanup = drawFlowPreview(initialSpacing, { isPreview: true });

          shapeAdjustHelper?.destroy();
          shapeAdjustHelper = new ShapeAdjustHelper({
            getOverlayCanvas: () => overlayCanvasRef.current,
            getViewTransform: () => viewTransformRef.current,
            onUpdate: applyShapeAdjustPreview,
            onCommit: commitShapeAdjustUpdate,
            onCancel: () => {
              clearOverlayCanvas();
            },
            spacingBounds: { min: 4, max: 80, exponent: FLOW_SPACING_EXPONENT },
            densityBounds: { min: 32, max: 320, exponent: 1.08 },
            noiseBounds: { min: 0, max: 1 },
            orientationSnap: 5,
          });

          shapeAdjustHelper.beginSession({
            centroid,
            vertices,
            initialSpacing,
            initialDensity: initialMaxSteps,
            initialOrientation,
            initialNoise,
          });

          return true;
        }

        if (shapeMode === 'triangle') {
          const vertexCount = vertices.length;
          const centroid = vertexCount > 0
            ? vertices.reduce((acc: { x: number; y: number }, v: { x: number; y: number }) => ({ x: acc.x + v.x, y: acc.y + v.y }), { x: 0, y: 0 })
            : { x: pointerWorld.x, y: pointerWorld.y };
          if (vertexCount > 0) {
            centroid.x /= vertexCount;
            centroid.y /= vertexCount;
          }
          const referenceDistance = Math.max(1, Math.hypot(pointerWorld.x - centroid.x, pointerWorld.y - centroid.y));
          const initialSize = clampTriangleSize(tools.brushSettings.triangleFillSize ?? 36);

          useAppStore.getState().setPolygonGradientState({
            drawingState: 'adjustingSize',
            mode: 'triangle',
            vertices,
            fillColor,
            tempSize: initialSize,
            tempRotation: tools.brushSettings.triangleFillRotation ?? 0,
            sizeReferenceDistance: referenceDistance,
            sizeInitialSize: initialSize,
          });

          withTemporaryBrushSettings(
            useAppStore.getState().tools.brushSettings,
            { triangleFillSize: initialSize },
            () => {
              brushEngine.drawDelaunayPolygon(
                drawCtx,
                {
                  vertices,
                  fillColor,
                },
                false,
                withRuntimeLineOptions()
              );
            }
          );

          return true;
        }

        // Default contour mode - enter spacing adjustment state
        clearOverlayCanvas();

        // Clear drawing canvas to prevent stale content from previous shapes
        if (drawCtx) {
          drawCtx.clearRect(0, 0, drawCtx.canvas.width, drawCtx.canvas.height);
        }

        const EDGE_EPS = 0.5;
        const centroid = vertices.reduce(
          (acc, v) => ({ x: acc.x + v.x, y: acc.y + v.y }),
          { x: 0, y: 0 }
        );
        centroid.x /= vertices.length;
        centroid.y /= vertices.length;

        const hardMax = Math.max(...vertices.map(v => Math.hypot(v.x - centroid.x, v.y - centroid.y)));

        let initialSpacing = tools.brushSettings.contourSpacing ?? 6;
        initialSpacing = Math.max(
          MIN_LINE_SPACING,
          Math.min(initialSpacing, Math.max(hardMax - EDGE_EPS, MIN_LINE_SPACING))
        );

        useAppStore.getState().setPolygonGradientState({
          drawingState: 'adjustingSpacing',
          mode: 'contour',
          vertices,
          fillColor,
          tempSpacing: initialSpacing,
          // Use a stable non-zero reference so drag always shrinks from a valid spacing.
          spacingReferenceDistance: 1,
          spacingReferenceSpacing: initialSpacing,
        });

        try {
          useAppStore.getState().setShapeMode(true);
        } catch {
          // Ignore store errors; pointer guards prevent brush engine takeover.
        }

        contourDebug('enter-adjusting-spacing', {
          vertexCount: vertices.length,
          initialSpacing,
          fillColor,
        });

        // Clean up any previous preview before starting new one
        if (currentPreviewCleanup) {
          currentPreviewCleanup();
        }
        currentPreviewCleanup = drawContourPreview(initialSpacing, fillColor);
        return true;
      } else {
        const polygonColors = points.map(point => point?.color ?? fillColor);

        drawCtx.save();
        drawCtx.setTransform(1, 0, 0, 1, 0, 0);
        drawCtx.globalCompositeOperation = 'source-over';
        drawCtx.globalAlpha = 1;
        drawCtx.imageSmoothingEnabled = false;
        brushEngine.drawPolygonGradient(
          drawCtx,
          {
            vertices,
            colors: polygonColors,
          },
          false
        );
        drawCtx.restore();

        drawingHandlers.drawingCanvasHasContent.current = true;
      }
    }

    compositeCanvasDirtyRef.current = true;

    logShapeModeGuard('polygon-complete');
    const finalizePromise = drawingHandlers.finalizeShapeDrawing();
    logShapeFillEvent('shape-fill-finalize-request', {
      source: 'polygon-complete',
      previewId: opController.latestPreviewId,
    });
    const isCCPreview =
      tools.brushSettings.brushShape === BrushShape.COLOR_CYCLE_SHAPE &&
      Boolean(tools.brushSettings.ditherEnabled);
    finalizePromise.then(() => {
      logShapeFillEvent('shape-fill-finalize-success', {
        source: 'polygon-complete',
      });

      if (compositeCanvasRef.current && project) {
        compositeLayersToCanvas(compositeCanvasRef.current);
        setCurrentOffscreenCanvas(compositeCanvasRef.current);
        compositeCanvasDirtyRef.current = false;
      }

      setNeedsRedraw(prev => prev + 1);

      if (restartColorCycleAnimation) {
        restartColorCycleAnimation();
      }
      if (isCCPreview) {
        requestAnimationFrame(() => {
          clearCurrentPreview();
          clearOverlayCanvas();
          if (drawingHandlers.ccShapePreviewCacheRef) {
            drawingHandlers.ccShapePreviewCacheRef.current = null;
          }
        });
      }
      }).catch(error => {
      logShapeFillEvent('shape-fill-finalize-error', {
        source: 'polygon-complete',
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }).finally(() => {
      stateMachine.finalizationComplete();
      if (!isCCPreview) {
        clearCurrentPreview();
        clearOverlayCanvas();
      }
    });

    resetPolygonAdjustmentState();
    interaction.dispatch({ type: 'DRAWING_END' });
    return true;
  };

  const commitTriangleSize = (
    polygonState: ReturnType<typeof useAppStore.getState>['polygonGradientState'],
    finalSize: number
  ) => {
    const setBrushSettings = useAppStore.getState().setBrushSettings;
    setBrushSettings({ triangleFillSize: Math.round(finalSize) });

    const drawCtx = drawingHandlers.drawingCanvasRef.current?.getContext('2d', { willReadFrequently: true });
    if (drawCtx && brushEngine && polygonState.vertices) {
      const vertices = polygonState.vertices;
      drawCtx.clearRect(0, 0, drawCtx.canvas.width, drawCtx.canvas.height);

      const patch: Partial<BrushSettings> = { triangleFillSize: finalSize };

      withTemporaryBrushSettings(
        useAppStore.getState().tools.brushSettings,
        patch,
        () => {
          brushEngine.drawContourPolygon(
            drawCtx,
            {
              vertices,
              fillColor: polygonState.fillColor,
            },
            false,
            withRuntimeLineOptions()
          );
        }
      );
    }

    compositeCanvasDirtyRef.current = true;

    logShapeModeGuard('triangle-size');
    const finalizePromise = drawingHandlers.finalizeShapeDrawing();
    logShapeFillEvent('shape-fill-finalize-request', {
      source: 'triangle-size',
      previewId: opController.latestPreviewId,
      finalSize,
    });
    const isCCPreview =
      tools.brushSettings.brushShape === BrushShape.COLOR_CYCLE_SHAPE &&
      Boolean(tools.brushSettings.ditherEnabled);
    finalizePromise.then(() => {
      logShapeFillEvent('shape-fill-finalize-success', {
        source: 'triangle-size',
        finalSize,
      });

      if (compositeCanvasRef.current && project) {
        compositeLayersToCanvas(compositeCanvasRef.current);
        setCurrentOffscreenCanvas(compositeCanvasRef.current);
        compositeCanvasDirtyRef.current = false;
      }

      setNeedsRedraw(prev => prev + 1);

      if (restartColorCycleAnimation) {
        restartColorCycleAnimation();
      }
      if (isCCPreview) {
        requestAnimationFrame(() => {
          clearCurrentPreview();
          clearOverlayCanvas();
          if (drawingHandlers.ccShapePreviewCacheRef) {
            drawingHandlers.ccShapePreviewCacheRef.current = null;
          }
        });
      }
    }).catch(error => {
      logShapeFillEvent('shape-fill-finalize-error', {
        source: 'triangle-size',
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }).finally(() => {
      stateMachine.finalizationComplete();
      if (!isCCPreview) {
        clearCurrentPreview();
        clearOverlayCanvas();
      }
    });

    interaction.dispatch({ type: 'DRAWING_END' });

    resetPolygonAdjustmentState();
  };

  const commitTriangleRotation = (
    polygonState: ReturnType<typeof useAppStore.getState>['polygonGradientState'],
    finalRotation: number
  ) => {
    const setBrushSettings = useAppStore.getState().setBrushSettings;
    setBrushSettings({ triangleFillRotation: finalRotation });

    const drawCtx = drawingHandlers.drawingCanvasRef.current?.getContext('2d', { willReadFrequently: true });
    if (drawCtx && brushEngine && polygonState.vertices) {
      const vertices = polygonState.vertices;
      drawCtx.clearRect(0, 0, drawCtx.canvas.width, drawCtx.canvas.height);

      const patch: Partial<BrushSettings> = { triangleFillRotation: finalRotation };

      withTemporaryBrushSettings(
        useAppStore.getState().tools.brushSettings,
        patch,
        () => {
          brushEngine.drawDelaunayPolygon(
            drawCtx,
            {
              vertices,
              fillColor: polygonState.fillColor,
            },
            false,
            withRuntimeLineOptions()
          );
        }
      );

      drawingHandlers.finalizeStroke();
    }

    resetPolygonAdjustmentState();
  };

  const handleTrianglePointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (event.button !== 0) return false;

    const polygonState = useAppStore.getState().polygonGradientState;
    if (polygonState.drawingState !== 'adjustingSize' || polygonState.mode !== 'triangle') {
      return false;
    }

    const fallbackSize = tools.brushSettings.triangleFillSize ?? 36;
    const finalSize = clampTriangleSize(polygonState.tempSize ?? fallbackSize);
    commitTriangleSize(polygonState, finalSize);
    return true;
  };

  const handleTrianglePointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const polygonState = useAppStore.getState().polygonGradientState;
    const vertices = polygonState.vertices;
    if (
      polygonState.drawingState !== 'adjustingSize' ||
      polygonState.mode !== 'triangle' ||
      !vertices ||
      vertices.length === 0
    ) {
      return false;
    }

    const worldPos = computeWorldPointer(event);
    const sumX = vertices.reduce((sum: number, vertex) => sum + vertex.x, 0);
    const sumY = vertices.reduce((sum: number, vertex) => sum + vertex.y, 0);
    const centerX = sumX / vertices.length;
    const centerY = sumY / vertices.length;

    const pointerDistance = Math.hypot(worldPos.x - centerX, worldPos.y - centerY);
    const referenceDistance = polygonState.sizeReferenceDistance ?? Math.max(pointerDistance, 1);
    const initialSize = polygonState.sizeInitialSize ?? (tools.brushSettings.triangleFillSize ?? 36);

    const newSize = clampTriangleSize(
      computeDragScaledValue({
        startDistance: Math.max(referenceDistance, 1e-3),
        currentDistance: Math.max(pointerDistance, 1e-3),
        startValue: initialSize,
        min: 8,
        max: 200,
        exponent: TRIANGLE_SIZE_EXPONENT,
      })
    );

    useAppStore.getState().setPolygonGradientState({ tempSize: newSize });

    const drawCtx = drawingHandlers.drawingCanvasRef.current?.getContext('2d', { willReadFrequently: true });
    if (drawCtx && brushEngine) {
      drawCtx.clearRect(0, 0, drawCtx.canvas.width, drawCtx.canvas.height);

      const patch: Partial<BrushSettings> = { triangleFillSize: newSize };

      withTemporaryBrushSettings(
        useAppStore.getState().tools.brushSettings,
        patch,
        () => {
          brushEngine.drawDelaunayPolygon(
            drawCtx,
            {
              vertices,
              fillColor: polygonState.fillColor,
            },
            false,
            withRuntimeLineOptions()
          );
        }
      );
    }

    return true;
  };

  const handleTrianglePointerUp = () => {
    const polygonState = useAppStore.getState().polygonGradientState;
    if (polygonState.mode !== 'triangle') {
      return false;
    }

    if (polygonState.drawingState === 'adjustingSize') {
      const fallbackSize = tools.brushSettings.triangleFillSize ?? 36;
      const finalSize = clampTriangleSize(polygonState.tempSize ?? fallbackSize);
      commitTriangleSize(polygonState, finalSize);
      return true;
    }

    if (polygonState.drawingState === 'adjustingRotation') {
      const finalRotation = polygonState.tempRotation ?? tools.brushSettings.triangleFillRotation ?? 0;
      commitTriangleRotation(polygonState, finalRotation);
      return true;
    }

    return false;
  };

  return {
    handlePointerDown(event) {
      if (handleFlowPointerDown(event)) {
        return true;
      }
      if (handleCrosshatchPointerDown(event)) {
        return true;
      }
      if (polygonShapePointerDown(event)) {
        return true;
      }
      if (handleTrianglePointerDown(event)) {
        return true;
      }
      return safeDelegate.pointerDown?.(event, context) ?? false;
    },
    handlePointerMove(event) {
      // Don't interfere with custom brush area selection
      if (interaction?.state?.isSelecting) {
        return false;
      }
      if (handleFlowPointerMove(event)) {
        return true;
      }
      if (handleContourPointerMove(event)) {
        return true;
      }
      if (handleCrosshatchPointerMove(event)) {
        return true;
      }
      if (polygonShapePointerMove(event)) {
        return true;
      }
      if (handleTrianglePointerMove(event)) {
        return true;
      }
      return safeDelegate.pointerMove?.(event, context) ?? false;
    },
    handlePointerUp(event) {
      if (handleFlowPointerUp(event)) {
        return true;
      }
      if (handleContourPointerUp()) {
        return true;
      }
      if (handleCrosshatchPointerUp(event)) {
        return true;
      }
      if (polygonShapePointerUp(event)) {
        return true;
      }
      if (handleTrianglePointerUp()) {
        return true;
      }
      const handled = safeDelegate.pointerUp?.(event, context) ?? false;
      // Ensure color cycle animation resumes after CC shape interactions.
      if (context.deps.tools?.brushSettings?.brushShape === BrushShape.COLOR_CYCLE_SHAPE) {
        restartColorCycleAnimation?.();
      }
      return handled;
    },
  };
};

export const __shapeToolTestUtils = {
  isShapeFillToolActive,
  applyTransparencyLockMaskToContext,
  applyPolygonMaskToCanvasContext,
};
const LIVE_ADJUSTABLE_PARAMS = new Set<ShapeFillParamKey>(['spacing']);
