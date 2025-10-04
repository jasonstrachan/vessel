import type React from 'react';
import { useAppStore } from '../../../../stores/useAppStore';
import type { EventHandlerDependencies } from '../../utils/types';
import { BrushShape, type BrushSettings } from '@/types';
import { snapPointToAngle } from '@/utils/angleSnap';
import {
  computeLines2Defaults,
  generateContourLines,
  generateLines2Paths,
  MAX_LINE_SPACING,
  MIN_LINE_SPACING,
  prepareContourLinesBasis,
} from '@/utils/contourLines';
import { computeDragScaledValue } from '@/utils/dragScale';
import { withTemporaryBrushSettings } from '@/utils/withTemporaryBrushSettings';
import { ShapeAdjustHelper, type ShapeAdjustHelperUpdate } from '@/lib/shapeFill/ShapeAdjustHelper';
import { getShapeFillScheduler } from '@/lib/shapeFill/runtime';
import { computeFlowGpuJobId } from '@/brushes/shapes/fills/flow';

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

  const restartColorCycleAnimation = context.deps.restartColorCycleAnimation;

  let shapeAdjustHelper: ShapeAdjustHelper | null = null;

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
    drawFlowPreview(update.spacing, { isPreview: true });
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
    drawFlowPreview(update.spacing, { isPreview: false });
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
    if (shapeAdjustHelper) {
      shapeAdjustHelper.destroy();
      shapeAdjustHelper = null;
    }
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

  const contourFillSpacingClickArmedRef = { current: false };
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

  const drawCrosshatchPreview = (rotation: number, spacing: number) => {
    const currentState = useAppStore.getState();
    const { polygonGradientState } = currentState;
    const vertices = polygonGradientState.vertices;
    if (!vertices || vertices.length < 3 || !brushEngine) return;

    const drawCtx = drawingHandlers.drawingCanvasRef.current?.getContext('2d', { willReadFrequently: true });
    if (!drawCtx) return;

    drawCtx.clearRect(0, 0, drawCtx.canvas.width, drawCtx.canvas.height);

    const brushSettings = currentState.tools.brushSettings;
    const lineWidthOverride = brushSettings.shapeFillLineWidth
      ?? brushSettings.crossHatchLineWidth;

    const patch: Partial<BrushSettings> = {
      crossHatchRotation: rotation,
      crossHatchSpacing: spacing,
    };

    if (lineWidthOverride !== undefined) {
      patch.crossHatchLineWidth = lineWidthOverride;
      patch.shapeFillLineWidth = lineWidthOverride;
    }

    withTemporaryBrushSettings(
      currentState.tools.brushSettings,
      patch,
      (tempSettings) => {
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
      }
    );

    drawingHandlers.drawingCanvasHasContent.current = true;
  };

  const drawFlowPreview = (seedSpacing: number, options?: { isPreview?: boolean }) => {
    const currentState = useAppStore.getState();
    const { polygonGradientState } = currentState;
    const vertices = polygonGradientState.vertices;

    if (!vertices || vertices.length < 3 || !brushEngine) {
      return;
    }

    const drawCtx = drawingHandlers.drawingCanvasRef.current?.getContext('2d', { willReadFrequently: true });
    if (!drawCtx) {
      return;
    }

    drawCtx.clearRect(0, 0, drawCtx.canvas.width, drawCtx.canvas.height);

    const strokeColorOverride = shapeFillUsesSampledColor() && polygonGradientState.fillColor
      ? polygonGradientState.fillColor
      : undefined;

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

    if (strokeColorOverride) {
      patch.color = strokeColorOverride;
    }

    const lineOptions = {
      randomSeed: polygonGradientState.flowRandomSeed,
      strokeColorOverride,
    };

    const isPreview = options?.isPreview ?? false;

    withTemporaryBrushSettings(
      currentState.tools.brushSettings,
      patch,
      () => {
        brushEngine.drawContourPolygon(
          drawCtx,
          {
            vertices,
            fillColor: polygonGradientState.fillColor,
          },
          isPreview,
          lineOptions
        );
      }
    );

    drawingHandlers.drawingCanvasHasContent.current = true;
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

  const shapeFillUsesSampledColor = () => {
    const { brushSettings } = useAppStore.getState().tools;
    return !!brushSettings.shapeFillUseSampledColor;
  };

  const resolvePolygonPointColor = (worldPos: { x: number; y: number }) => {
    const { tools: toolsState } = useAppStore.getState();
    const { brushSettings } = toolsState;
    if (brushSettings.shapeFillUseSampledColor) {
      return sampleColorAtPosition(worldPos.x, worldPos.y);
    }
    return brushSettings.color;
  };

  const isPolygonGradientBrush = () => tools.brushSettings.brushShape === BrushShape.POLYGON_GRADIENT;
  const isColorCycleShapeBrush = () => tools.brushSettings.brushShape === BrushShape.COLOR_CYCLE_SHAPE;
  const isContourPolygonBrush = () => {
    const shape = tools.brushSettings.brushShape;
    return shape === BrushShape.CONTOUR_POLYGON || shape === BrushShape.CONTOUR_LINES2;
  };

  const resolveShapeFillColor = (points?: Array<{ color?: string }>) => {
    const { tools: toolsState } = useAppStore.getState();
    if (toolsState.brushSettings.shapeFillUseSampledColor) {
      if (points && points.length > 0) {
        for (const point of points) {
          const candidate = point.color;
          if (candidate) return candidate;
        }
      }
    }
    return toolsState.brushSettings.color;
  };

  const clearOverlayCanvas = () => {
    const overlayCanvas = overlayCanvasRef.current;
    if (!overlayCanvas) return;
    const overlayCtx = overlayCanvas.getContext('2d');
    overlayCtx?.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
  };

  const drawContourLinesPreview = (
    spacingStart: number,
    spacingEnd?: number,
    override?: {
      shapePoints: Array<{ x: number; y: number }>;
      basis: ReturnType<typeof prepareContourLinesBasis> | null;
      stage?: string;
    }
  ) => {
    const overlayCanvas = overlayCanvasRef.current;
    const overlayCtx = overlayCanvas?.getContext('2d');
    if (!overlayCanvas || !overlayCtx) return;

    const contourState = override
      ? { ...useAppStore.getState().contourLinesState, ...override }
      : useAppStore.getState().contourLinesState;

    const { basis, shapePoints } = contourState;
    if (!basis || !shapePoints || shapePoints.length < 3) return;

    overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);

    overlayCtx.save();
    overlayCtx.translate(viewTransformRef.current.offsetX, viewTransformRef.current.offsetY);
    overlayCtx.scale(viewTransformRef.current.scale, viewTransformRef.current.scale);
    const safeScale = Math.max(viewTransformRef.current.scale, 0.001);
    const strokeColorOverride = tools.brushSettings.shapeFillUseSampledColor && contourState.fillColor
      ? contourState.fillColor
      : tools.brushSettings.color;
    overlayCtx.lineWidth = Math.max(0.2, 0.45 / safeScale);
    overlayCtx.strokeStyle = strokeColorOverride;
    overlayCtx.imageSmoothingEnabled = !(tools.brushSettings.shapeFillPixelMode ?? true);

    const maxDistance = Math.max(0.001, basis.maxDistance || spacingStart);
    const constrainedStart = Math.min(Math.max(MIN_LINE_SPACING, spacingStart), maxDistance);
    const constrainedEnd = spacingEnd == null
      ? undefined
      : Math.min(Math.max(MIN_LINE_SPACING, spacingEnd), maxDistance);

    const shapeMode = tools.brushSettings.shapeGradientMode || 'contour';

    if (shapeMode === 'contour') {
      if (!brushEngine) {
        overlayCtx.restore();
        overlayCtx.restore();
        return;
      }

      withTemporaryBrushSettings(
        useAppStore.getState().tools.brushSettings,
        {
          contourSpacing: constrainedEnd ?? constrainedStart,
          color: strokeColorOverride,
        },
        () => {
          brushEngine.drawContourPolygon(
            overlayCtx,
            {
              vertices: shapePoints,
              fillColor: undefined,
            },
            true,
            {
              contourSpacingOverride: constrainedEnd ?? constrainedStart,
              randomSeed: contourState.randomSeed ?? undefined,
              strokeColorOverride,
              previewDetail: 'full',
            }
          );
        }
      );

      overlayCtx.restore();
      overlayCtx.restore();
      return;
    }

    const paths = generateContourLines(shapePoints, basis, constrainedStart, constrainedEnd);

    overlayCtx.save();
    const first = shapePoints[0];
    if (first) {
      overlayCtx.beginPath();
      overlayCtx.moveTo(first.x, first.y);
      for (let i = 1; i < shapePoints.length; i++) {
        overlayCtx.lineTo(shapePoints[i].x, shapePoints[i].y);
      }
      overlayCtx.closePath();
      overlayCtx.clip();
    }

    for (const path of paths) {
      if (!path.points || path.points.length < 2) continue;
      overlayCtx.beginPath();
      overlayCtx.moveTo(path.points[0].x, path.points[0].y);
      for (let i = 1; i < path.points.length; i++) {
        overlayCtx.lineTo(path.points[i].x, path.points[i].y);
      }
      overlayCtx.stroke();
    }

    overlayCtx.restore();
    overlayCtx.restore();
  };

  const drawLines2Preview = (
    angle: number,
    convergenceA: { x: number; y: number },
    convergenceB: { x: number; y: number }
  ) => {
    const overlayCanvas = overlayCanvasRef.current;
    const overlayCtx = overlayCanvas?.getContext('2d');
    if (!overlayCanvas || !overlayCtx) return;

    const { contourLinesState } = useAppStore.getState();
    const { shapePoints } = contourLinesState;
    if (!shapePoints || shapePoints.length < 3) return;

    overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
    overlayCtx.save();
    overlayCtx.translate(viewTransformRef.current.offsetX, viewTransformRef.current.offsetY);
    overlayCtx.scale(viewTransformRef.current.scale, viewTransformRef.current.scale);

    const safeScale = Math.max(viewTransformRef.current.scale, 0.001);
    overlayCtx.lineWidth = Math.max(0.2, 0.45 / safeScale);
    overlayCtx.strokeStyle = tools.brushSettings.color;
    overlayCtx.imageSmoothingEnabled = !(tools.brushSettings.shapeFillPixelMode ?? true);

    const spacingSetting = tools.brushSettings.contourLines2Spacing ?? 8;
    const densitySetting = tools.brushSettings.contourLines2Density ?? 5;
    const alternateSetting = tools.brushSettings.contourLines2Alternate ?? true;

    const paths = generateLines2Paths(
      shapePoints,
      {
        angle,
        convergenceA,
        convergenceB,
        spacing: spacingSetting,
        density: densitySetting,
        alternate: alternateSetting,
      },
      contourLinesState.centroid ?? undefined
    );

    const first = shapePoints[0];
    if (first) {
      overlayCtx.save();
      overlayCtx.beginPath();
      overlayCtx.moveTo(first.x, first.y);
      for (let i = 1; i < shapePoints.length; i++) {
        overlayCtx.lineTo(shapePoints[i].x, shapePoints[i].y);
      }
      overlayCtx.closePath();
      overlayCtx.clip();

      for (const path of paths) {
        if (!path.points || path.points.length < 2) continue;
        overlayCtx.beginPath();
        overlayCtx.moveTo(path.points[0].x, path.points[0].y);
        for (let i = 1; i < path.points.length; i++) {
          overlayCtx.lineTo(path.points[i].x, path.points[i].y);
        }
        overlayCtx.stroke();
      }

      overlayCtx.restore();
    }

    overlayCtx.restore();
  };

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

            drawCrosshatchPreview(newRotation, spacingForPreview);
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
      drawCrosshatchPreview(newRotation, spacingForPreview);
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
            drawCrosshatchPreview(rotationForPreview, newSpacing);
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
      drawCrosshatchPreview(rotationForPreview, newSpacing);
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

      drawCrosshatchPreview(nextRotation, finalSpacing);
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

      drawCrosshatchPreview(finalRotation, finalSpacing);
      context.deps.compositeCanvasDirtyRef.current = true;

      drawingHandlers.finalizeShapeDrawing().then(() => {
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

    drawingHandlers.finalizeShapeDrawing().then(() => {
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
    });

    resetPolygonAdjustmentState();
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

    const isPolygonGradient = isPolygonGradientBrush();
    const isContourPolygon = isContourPolygonBrush();
    const isCCShape = isColorCycleShapeBrush();

    if (!isPolygonGradient && !isContourPolygon && !isCCShape) {
      return false;
    }

    const polygonState = useAppStore.getState().polygonGradientState;
    if (
      polygonState.drawingState === 'adjustingSize' ||
      polygonState.drawingState === 'adjustingRotation' ||
      polygonState.drawingState === 'adjustingSpacing'
    ) {
      return false;
    }

    const worldPos = computeWorldPointer(event);
    const pressure = computePointerPressure(event);

    const activeLayer = layers.find(layer => layer.id === activeLayerId);
    const isColorCycleLayer = activeLayer?.layerType === 'color-cycle';
    if ((isColorCycleLayer && !isCCShape) || (!isColorCycleLayer && isCCShape)) {
      const message = isColorCycleLayer
        ? "Can't use regular polygon/contour on a Color Cycle layer. Select a Color Cycle shape, or switch layers."
        : "Can't use Color Cycle shape on a normal layer. Create/select a Color Cycle layer.";
      feedback?.(message);
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
    const isShapePreviewActive =
      tools.shapeMode &&
      drawingHandlers.isDrawingShapeRef.current &&
      drawingHandlers.shapePointsRef.current.length > 0;

    if (!isPolygonGradient && !isContourPolygon && !isCCShape && !isShapePreviewActive) {
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
            overlayCtx.imageSmoothingEnabled = !(tools.brushSettings.shapeFillPixelMode ?? true);
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

                const useSampledFill = shapeFillUsesSampledColor();
                const previewColors = polygonStateForPreview.points.length > 0
                  ? polygonStateForPreview.points.map(point => point.color ?? tools.brushSettings.color)
                  : [];
                const previewColor = useSampledFill
                  ? sampleColorAtPosition(previewPoint.x, previewPoint.y)
                  : resolveShapeFillColor();
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

    if (!isPolygonGradient && !isContourPolygon) {
      return false;
    }

    const polygonState = getPolygonState();
    const points = polygonState.points;
    if (!points || points.length === 0) {
      return true;
    }

    const pointerWorld = computeWorldPointer(event);
    const normalizedShapeMode = tools.brushSettings.shapeGradientMode === 'mesh'
      ? 'lines'
      : (tools.brushSettings.shapeGradientMode || 'contour');
    const brushShape = tools.brushSettings.brushShape;

    if (points.length < 3) {
      return true;
    }

    const vertices = points.map((p: { x: number; y: number }) => ({ x: p.x, y: p.y }));
    const fillColor = resolveShapeFillColor(points);
    const isLines2Mode = isContourPolygon && (normalizedShapeMode === 'lines2' || brushShape === BrushShape.CONTOUR_LINES2);
    const isContourFillMode = isContourPolygon && normalizedShapeMode === 'contour' && !isLines2Mode;

    if (isLines2Mode) {
      const basis = prepareContourLinesBasis(vertices);
      const defaults = computeLines2Defaults(vertices, basis);

        const contourSeed = Math.floor(Math.random() * 0xffffffff);
        useAppStore.getState().setContourLinesState({
          stage: 'awaitingAngle',
          variant: 'lines2',
          shapePoints: vertices,
          fillColor: undefined,
          basis: defaults.basis ?? basis ?? undefined,
          spacingA: null,
          spacingB: null,
          previewSpacing: null,
          lineAngle: defaults.defaultAngle,
          convergenceA: defaults.convergenceA,
          convergenceB: defaults.convergenceB,
          centroid: defaults.centroid,
          spacingReferenceDistance: null,
          spacingReferenceSpacing: null,
          randomSeed: contourSeed,
        });

      drawLines2Preview(defaults.defaultAngle, defaults.convergenceA, defaults.convergenceB);

      resetPolygonAdjustmentState();
      interaction.dispatch({ type: 'DRAWING_END' });
      return true;
    }

    if (isContourFillMode) {
      const basis = prepareContourLinesBasis(vertices);

      if (basis) {
        const defaultSpacingSetting = (tools.brushSettings.contourSpacing || 5) * 2;
        const initialSpacing = Math.min(
          MAX_LINE_SPACING,
          Math.max(MIN_LINE_SPACING, defaultSpacingSetting)
        );

        const contourSeed = Math.floor(Math.random() * 0xffffffff);
        useAppStore.getState().setContourLinesState({
          stage: 'awaitingAnchorA',
          variant: 'legacy',
          shapePoints: vertices,
          fillColor,
          basis,
          spacingA: null,
          spacingB: null,
          previewSpacing: initialSpacing,
          spacingReferenceDistance: null,
          spacingReferenceSpacing: initialSpacing,
          randomSeed: contourSeed,
        });

        contourFillSpacingClickArmedRef.current = false;
        drawContourLinesPreview(initialSpacing, initialSpacing, {
          shapePoints: vertices,
          basis,
          stage: 'awaitingAnchorA',
        });

        resetPolygonAdjustmentState();
        interaction.dispatch({ type: 'DRAWING_END' });
        return true;
      }
    }

    drawingHandlers.initDrawingCanvas();
    const drawCtx = drawingHandlers.drawingCanvasRef.current?.getContext('2d', { willReadFrequently: true });

    if (drawCtx && brushEngine) {
      if (isContourPolygon) {
        const shapeMode = tools.brushSettings.shapeGradientMode || 'contour';

        const strokeColorOverride = shapeFillUsesSampledColor() && fillColor ? fillColor : undefined;

        if (shapeMode === 'crosshatch') {
          useAppStore.getState().resetContourLinesState();
          clearOverlayCanvas();

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
          useAppStore.getState().resetContourLinesState();
          clearOverlayCanvas();

          const initialSpacing = clampFlowSeedSpacing(tools.brushSettings.flowSeedSpacing ?? 18);
          const initialMaxSteps = tools.brushSettings.flowMaxSteps ?? 120;
          const initialOrientation = normalizeOrientation(tools.brushSettings.flowOrientationAngle ?? 0);
          const initialNoise = Math.max(0, Math.min(1, tools.brushSettings.flowSeedJitter ?? 0.6));
          const randomSeed = Math.floor(Math.random() * 0xffffffff);
          const centroid = computePolygonCentroid(vertices);
          const fieldResolution = tools.brushSettings.flowFieldResolution ?? 8;
          const pixelMode = tools.brushSettings.shapeFillPixelMode ?? true;
          const gpuJobId = computeFlowGpuJobId(vertices, randomSeed, fieldResolution, pixelMode);

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

          drawFlowPreview(initialSpacing, { isPreview: true });

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
              brushEngine.drawContourPolygon(
                drawCtx,
                {
                  vertices,
                  fillColor,
                },
                false,
                strokeColorOverride ? { strokeColorOverride } : undefined
              );
            }
          );

          drawingHandlers.drawingCanvasHasContent.current = true;

          return true;
        }

        brushEngine.drawContourPolygon(
          drawCtx,
          {
            vertices,
            fillColor,
          },
          false,
          strokeColorOverride ? { strokeColorOverride } : undefined
        );
      } else {
        const useSampledFill = shapeFillUsesSampledColor();
        const polygonColors = useSampledFill
          ? points.map(point => point.color ?? fillColor)
          : points.map(() => fillColor);

        brushEngine.drawPolygonGradient(
          drawCtx,
          {
            vertices,
            colors: polygonColors,
          },
          false
        );
      }

      drawingHandlers.drawingCanvasHasContent.current = true;
    }

    compositeCanvasDirtyRef.current = true;

    drawingHandlers.finalizeShapeDrawing().then(() => {
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

      const strokeColorOverride = shapeFillUsesSampledColor() && polygonState.fillColor
        ? polygonState.fillColor
        : undefined;

      const patch: Partial<BrushSettings> = { triangleFillSize: finalSize };
      if (strokeColorOverride) {
        patch.color = strokeColorOverride;
      }

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
            strokeColorOverride ? { strokeColorOverride } : undefined
          );
        }
      );

      drawingHandlers.drawingCanvasHasContent.current = true;
    }

    compositeCanvasDirtyRef.current = true;

    drawingHandlers.finalizeShapeDrawing().then(() => {
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

      const strokeColorOverride = shapeFillUsesSampledColor() && polygonState.fillColor
        ? polygonState.fillColor
        : undefined;

      const patch: Partial<BrushSettings> = { triangleFillRotation: finalRotation };
      if (strokeColorOverride) {
        patch.color = strokeColorOverride;
      }

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
            strokeColorOverride ? { strokeColorOverride } : undefined
          );
        }
      );

      drawingHandlers.drawingCanvasHasContent.current = true;
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

      const strokeColorOverride = shapeFillUsesSampledColor() && polygonState.fillColor
        ? polygonState.fillColor
        : undefined;

      const patch: Partial<BrushSettings> = { triangleFillSize: newSize };
      if (strokeColorOverride) {
        patch.color = strokeColorOverride;
      }

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
            strokeColorOverride ? { strokeColorOverride } : undefined
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
      if (handleFlowPointerMove(event)) {
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
