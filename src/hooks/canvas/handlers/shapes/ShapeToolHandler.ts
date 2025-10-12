import type React from 'react';
import { useAppStore } from '../../../../stores/useAppStore';
import type { EventHandlerDependencies } from '../../utils/types';
import { BrushShape, type BrushSettings } from '@/types';
import { snapPointToAngle } from '@/utils/angleSnap';
import { computeDragScaledValue } from '@/utils/dragScale';
import { withTemporaryBrushSettings } from '@/utils/withTemporaryBrushSettings';
import { OpController, CanvasManager } from '@/lib/canvas';
import { MIN_LINE_SPACING } from '@/utils/contourLines';
import { getPreviewRenderer } from '@/shapeFill/paramPreview';
import { renderFill } from '@/shapeFill/renderers/cpuRenderer';
import { getFillStrategy } from '@/shapeFill/strategies';
import { FillStage, type FillParams, type ShapeFillSession } from '@/shapeFill/types';

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
  const fallback = process.env.NODE_ENV !== 'production';
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
        globalAny.__CONTOUR_DEBUG = process.env.NODE_ENV !== 'production';
      }
    } catch {
      globalAny.__CONTOUR_DEBUG = process.env.NODE_ENV !== 'production';
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

  let shapeAdjustHelper: ShapeAdjustHelper | null = null;
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
      overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
    }
  };
  let currentPreviewCleanup: (() => void) | null = null;

  const drawShapeFillPreview = (session: ShapeFillSession | null) => {
    const overlayCanvas = overlayCanvasRef.current;
    if (!overlayCanvas) return;
    const overlayCtx = overlayCanvas.getContext('2d');
    if (!overlayCtx) return;

    const { scale, offsetX, offsetY } = viewTransformRef.current;

    overlayCtx.setTransform(1, 0, 0, 1, 0, 0);
    overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);

    if (!session || !session.shape || !session.currentParam) {
      return;
    }

    const previewFillColor = resolveShapeFillColor(session.shape.points);
    overlayCtx.strokeStyle = previewFillColor;
    overlayCtx.fillStyle = previewFillColor;

    const store = useAppStore.getState();
    const fillId = store.shapeFill.activeFillId;
    const renderer = getPreviewRenderer(fillId);
    const strategy = getFillStrategy(fillId);
    const param = session.currentParam;
    const paramValue = session.params[param];
    const defaultValue =
      typeof strategy.defaults[param] === 'number' ? (strategy.defaults[param] as number) : 0;

    if (param === 'spacing' || param === 'rotation') {
      return;
    }

    const value =
      typeof paramValue === 'number'
        ? paramValue
        : (store.shapeFill.paramsByFill[fillId]?.[param] as number | undefined) ?? defaultValue;

    overlayCtx.save();
    overlayCtx.translate(offsetX, offsetY);
    overlayCtx.scale(scale, scale);
    renderer(overlayCtx, session.shape, param, value);
    overlayCtx.restore();
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
    const mergedParams: FillParams = {
      ...strategy.defaults,
      ...(store.shapeFill.paramsByFill[fillId] ?? {}),
      ...session.params,
    } as FillParams;

    const previewResult = strategy.apply(session.shape, mergedParams);
    drawCtx.save();
    drawCtx.clearRect(0, 0, drawingCanvas.width, drawingCanvas.height);
    drawCtx.lineWidth = mergedParams.thickness ?? 1;
    const fillColor = resolveShapeFillColor(session.shape.points);
    drawCtx.strokeStyle = fillColor;
    drawCtx.fillStyle = fillColor;
    renderFill(drawCtx, previewResult);
    if (store.shapeFill.showOutline && session.shape.points.length >= 3) {
      drawCtx.strokeStyle = 'rgba(0,0,0,0.35)';
      drawCtx.beginPath();
      drawCtx.moveTo(session.shape.points[0].x, session.shape.points[0].y);
      for (let i = 1; i < session.shape.points.length; i += 1) {
        const pt = session.shape.points[i];
        drawCtx.lineTo(pt.x, pt.y);
      }
      drawCtx.closePath();
      drawCtx.stroke();
    }
    drawCtx.restore();
    drawingHandlers.drawingCanvasHasContent.current = true;
  };

  const finalizeShapeFillResult = async (): Promise<boolean> => {
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

    drawCtx.save();
    drawCtx.clearRect(0, 0, drawingCanvas.width, drawingCanvas.height);
    drawCtx.lineWidth = payload.params.thickness ?? 1;
    const fillColor = resolveShapeFillColor(payload.shape.points);
    drawCtx.strokeStyle = fillColor;
    drawCtx.fillStyle = fillColor;
    renderFill(drawCtx, payload.result);
    if (store.shapeFill.showOutline && payload.shape.points.length >= 3) {
      drawCtx.strokeStyle = 'rgba(0,0,0,0.35)';
      drawCtx.beginPath();
      drawCtx.moveTo(payload.shape.points[0].x, payload.shape.points[0].y);
      for (let i = 1; i < payload.shape.points.length; i += 1) {
        const pt = payload.shape.points[i];
        drawCtx.lineTo(pt.x, pt.y);
      }
      drawCtx.closePath();
      drawCtx.stroke();
    }
    drawCtx.restore();

    drawingHandlers.drawingCanvasHasContent.current = true;
    await drawingHandlers.finalizeDrawing({ historyActionType: 'fill' });

    stateMachine.finalizationComplete();

    if (compositeCanvasRef.current && project) {
      compositeLayersToCanvas(compositeCanvasRef.current);
      setCurrentOffscreenCanvas(compositeCanvasRef.current);
      compositeCanvasDirtyRef.current = false;
    }

    clearCurrentPreview();
    store.cancelShapeFillSession();
    interaction.dispatch({ type: 'DRAWING_END' });
    setNeedsRedraw(prev => prev + 1);
    return true;
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
    state.setPolygonGradientState({
      points: [...points, { x: worldPos.x, y: worldPos.y, color }],
    });
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

  const resolvePolygonPointColor = (worldPos: { x: number; y: number }) => {
    const { brushSettings } = useAppStore.getState().tools;
    const shouldSample = brushSettings.brushShape === BrushShape.POLYGON_GRADIENT;
    if (shouldSample) {
      return sampleColorAtPosition(worldPos.x, worldPos.y);
    }
    return brushSettings.color;
  };

  const isPolygonGradientBrush = () => tools.brushSettings.brushShape === BrushShape.POLYGON_GRADIENT;
  const isColorCycleShapeBrush = () => tools.brushSettings.brushShape === BrushShape.COLOR_CYCLE_SHAPE;
  const isShapeFillBrush = () => tools.brushSettings.brushShape === BrushShape.SHAPE_FILL;
  const isContourPolygonBrush = () => {
    const shape = tools.brushSettings.brushShape;
    return (
      shape === BrushShape.CONTOUR_POLYGON ||
      shape === BrushShape.CONTOUR_LINES2
    );
  };

  const resolveShapeFillColor = (points?: Array<{ x: number; y: number; color?: string }>) => {
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
            return candidate;
          }
        }
      }

      if (store.polygonGradientState.fillColor) {
        return store.polygonGradientState.fillColor;
      }

      return brushSettings.color;
    }

    if (brushShape === BrushShape.SHAPE_FILL) {
      if (store.shapeFill.sampleUnderShape) {
        const candidatePoints =
          points ??
          store.shapeFill.session?.shape?.points ??
          store.shapeFill.lastFinalize?.shape.points ??
          [];

        if (candidatePoints.length > 0) {
          const coords = candidatePoints.map(point => ({
            x: point.x,
            y: point.y,
          }));
          const centroid = computePolygonCentroid(coords);
          const sampled = sampleColorAtPosition(centroid.x, centroid.y);
          if (sampled) {
            return sampled;
          }
        }
      }
      return brushSettings.color;
    }

    return brushSettings.color;
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
        stateMachine.finalizationComplete();

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
        stateMachine.finalizationComplete();

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
      stateMachine.finalizationComplete();

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
    });

    resetPolygonAdjustmentState();
    clearCurrentPreview();
    interaction.dispatch({ type: 'DRAWING_END' });
    return true;
  };

  const computePointerPressure = (event: React.PointerEvent<HTMLCanvasElement>) => {
    let pressure = event.pressure || 0.5;
    if (event.pointerType === 'mouse' && tools.brushSettings.pressureEnabled) {
      if (event.shiftKey) {
        pressure = 0.1;
      } else if (event.ctrlKey) {
        pressure = 0.9;
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

    if (isShapeFill) {
      const store = useAppStore.getState();
      const session = store.shapeFill.session;
      if (session && session.stage !== FillStage.Drawing) {
        event.preventDefault();
        event.stopPropagation();

        if (session.stage === FillStage.AdjustingParam) {
          store.commitShapeFillParameter();
          const updated = useAppStore.getState().shapeFill.session;
          renderShapeFillLiveResult(updated ?? null);
          drawShapeFillPreview(updated ?? null);
          if (!updated || updated.stage === FillStage.Finalized) {
            void finalizeShapeFillResult();
          }
        } else if (session.stage === FillStage.Finalized) {
          void finalizeShapeFillResult();
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
      drawingHandlers.startShapeDrawing(worldPos, pressure);
      return true;
    }

    if (isCCShape) {
      drawingHandlers.stopContinuousColorCycleAnimation?.();
      interaction.dispatch({ type: 'DRAWING_START' });
      drawingHandlers.startShapeDrawing(worldPos, pressure);
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

    const worldPos = computeWorldPointer(event);
    let previewWorld = worldPos;
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
        drawingHandlers.continueShapeDrawing(previewWorld);
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
      const isActivelyDrawing =
        drawingHandlers.isDrawingShapeRef.current || (event.buttons & 1) === 1;
      if (isActivelyDrawing) {
        drawingHandlers.stopContinuousColorCycleAnimation?.();
      } else {
        // Keep animation running during hover previews for CC shapes.
        restartColorCycleAnimation?.();
      }
      drawingHandlers.continueShapeDrawing(previewWorld);
      shouldShowPreview = tools.shapeMode && drawingHandlers.isDrawingShapeRef.current;
    } else if (isPolygonGradient || isContourPolygon) {
      shouldShowPreview = appendPolygonGradientPoint(previewWorld);
    } else {
      shouldShowPreview = tools.shapeMode && drawingHandlers.isDrawingShapeRef.current;
    }

    if (shouldShowPreview && previewAnimationFrameRef) {
      if (!previewAnimationFrameRef.current) {
        const nowTs = performance.now();
        if (nowTs - context.getLastOverlayPreviewTs() < context.overlayPreviewFrameMs) {
          return true;
        }

        const previewPoint = { ...previewWorld };
        previewAnimationFrameRef.current = requestAnimationFrame(() => {
          context.setLastOverlayPreviewTs(performance.now());
          const overlayCanvas = overlayCanvasRef.current;
          const overlayCtx = overlayCanvas?.getContext('2d');
          const polygonStateForPreview = getPolygonState();
          const points = (isPolygonGradient || isContourPolygon)
            ? polygonStateForPreview.points
            : drawingHandlers.shapePointsRef.current;

          if (overlayCtx && overlayCanvas && points && points.length > 0) {
            overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);

            overlayCtx.save();
            overlayCtx.imageSmoothingEnabled = false;
            overlayCtx.translate(viewTransformRef.current.offsetX, viewTransformRef.current.offsetY);
            overlayCtx.scale(viewTransformRef.current.scale, viewTransformRef.current.scale);

            const pts = points as Array<{ x: number; y: number }>;
            const vertexCount = pts.length + 1;

            if (vertexCount >= 3) {
              const previewStrokePalette = getPreviewStrokePalette(tools.brushSettings.color);
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
                overlayCtx.fillStyle = 'rgba(0, 0, 0, 0.3)';
                overlayCtx.globalAlpha = 1.0;
              } else if (tools.shapeMode && !isPolygonGradient) {
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
                if (previewPoint.x < minX) minX = previewPoint.x;
                if (previewPoint.y < minY) minY = previewPoint.y;
                if (previewPoint.x > maxX) maxX = previewPoint.x;
                if (previewPoint.y > maxY) maxY = previewPoint.y;
                const width = maxX - minX;
                const height = maxY - minY;

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
                  : resolveShapeFillColor(polygonStateForPreview.points);
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
              } else {
                overlayCtx.fill();
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
          }

          if (previewAnimationFrameRef) {
            previewAnimationFrameRef.current = null;
          }
        });
      }
      return true;
    }

    return shouldShowPreview;
  };

  const polygonShapePointerUp = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const isPolygonGradient = isPolygonGradientBrush();
    const isContourPolygon = isContourPolygonBrush();
    const isShapeFill = isShapeFillBrush();

    if (isShapeFill) {
      if (drawingHandlers.isDrawingShapeRef.current && drawingHandlers.shapePointsRef.current.length >= 3) {
        const points = drawingHandlers.shapePointsRef.current.map(point => ({ x: point.x, y: point.y }));
        useAppStore.getState().beginShapeFillSession(points);
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
    const fillColor = resolveShapeFillColor(points);
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

        brushEngine.drawPolygonGradient(
          drawCtx,
          {
            vertices,
            colors: polygonColors,
          },
          false
        );

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
    finalizePromise.then(() => {
      logShapeFillEvent('shape-fill-finalize-success', {
        source: 'polygon-complete',
      });
      stateMachine.finalizationComplete();

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
        source: 'polygon-complete',
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }).finally(() => {
      clearCurrentPreview();
      clearOverlayCanvas();
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
    finalizePromise.then(() => {
      logShapeFillEvent('shape-fill-finalize-success', {
        source: 'triangle-size',
        finalSize,
      });
      stateMachine.finalizationComplete();

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
        source: 'triangle-size',
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }).finally(() => {
      clearCurrentPreview();
      clearOverlayCanvas();
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
      if (interaction.state.isSelecting) {
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
