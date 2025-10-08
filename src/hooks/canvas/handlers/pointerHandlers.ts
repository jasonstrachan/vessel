import React from 'react';
import { useAppStore } from '../../../stores/useAppStore';
import { RecolorManager } from '../../../lib/colorCycle/RecolorManager';
import type { EventHandlerDependencies, PointerHandlers } from '../utils/types';
import { BrushShape } from '../../../types';
import type { ContourLinesStage, ContourLinesBasis, ContourLinesState } from '../../../types';
import { snapPointToAngle } from '../../../utils/angleSnap';
import { floodFill } from '../../../utils/floodFill';
import { detectWacomIssues, testWacomPressure } from '../../../utils/detectWacom';
import {
  generateContourLines,
  generateLines2Paths,
  computeLines2Defaults,
  computeLines2ProjectionStats,
  getLines2SideMidpoint,
  projectPointOntoLines2Side,
  prepareContourLinesBasis,
  MIN_LINE_SPACING,
  MAX_LINE_SPACING,
} from '@/utils/contourLines';
import { computeNewShapeFillCenter } from '@/brushes/shapes/fills/newShapeFill';
import { getPresetStops } from '../../../utils/gradientPresets';
import { debugLog } from '@/utils/debug';
import { createShapeToolHandler } from './shapes/ShapeToolHandler';

export const createPointerHandlers = (deps: EventHandlerDependencies): PointerHandlers => {
  // Cap overlay previews to 30 FPS to reduce main-thread load during drag
  const OVERLAY_PREVIEW_FRAME_MS = 1000 / 30;
  let lastOverlayPreviewTs = 0;
  const {
    canvasRef,
    overlayCanvasRef,
    compositeCanvasRef,
    isBusyRef,
    isMouseDownRef,
    isSpacePressedRef,
    drawAnimationFrameRef,
    project,
    canvas,
    tools,
    layers,
    activeLayerId,
    selectionStart,
    selectionEnd,
    floatingPaste,
    setSelectionBounds,
    clearSelection,
    setCurrentOffscreenCanvas,
    compositeLayersToCanvas,
    saveCanvasState,
    updateLayer,
    setIsDraggingFloatingPaste,
    floatingPasteDragStart,
    floatingPasteOriginalPos,
    setCursorStyle,
    setShowBrushCursor,
    setMousePosition,
    updateFloatingPastePosition,
    setFloatingPaste,
    commitFloatingPaste,
    cancelFloatingPaste,
    interaction,
    stateMachine,
    pan,
    toolStateMachine,
    drawingHandlers,
    brushEngine,
    sampleColorsAlongLine,
    getMousePos,
    compositeCanvasDirtyRef,
    setNeedsRedraw,
    pauseAnimationForPan,
    resumeAnimationAfterPan
  } = deps;

  type Point = { x: number; y: number };

  const ensurePointRef = (
    ref: React.MutableRefObject<Point | null> | undefined
  ): React.MutableRefObject<Point | null> => {
    if (ref) return ref;
    const fallback: React.MutableRefObject<Point | null> = { current: null };
    return fallback;
  };

  const strokeStartWorldPosRef = ensurePointRef(deps.snapStrokeStartRef);
  const shiftAnchorWorldPosRef = ensurePointRef(deps.snapShiftAnchorRef);
  const lastBrushSampleWorldPosRef = ensurePointRef(deps.snapLastBrushSampleRef);

  const computePolygonCentroid = (points: Array<{ x: number; y: number }>): Point => {
    if (!points.length) {
      return { x: 0, y: 0 };
    }

    let sumX = 0;
    let sumY = 0;
    for (const point of points) {
      sumX += point.x;
      sumY += point.y;
    }

    return {
      x: sumX / points.length,
      y: sumY / points.length,
    };
  };

  const computeMaxRadialDistance = (points: Array<{ x: number; y: number }>, center: Point): number => {
    if (!points.length) {
      return 0;
    }
    let maxDistance = 0;
    for (const point of points) {
      const distance = Math.hypot(point.x - center.x, point.y - center.y);
      if (distance > maxDistance) {
        maxDistance = distance;
      }
    }
    return maxDistance;
  };

  const clampContourSpacing = (value: number) => Math.min(MAX_LINE_SPACING, Math.max(MIN_LINE_SPACING, value));
  const MAX_NEW_SHAPE_FILL_SPACING = 96;
  const clampNewShapeFillSpacing = (value: number) => Math.min(MAX_NEW_SHAPE_FILL_SPACING, Math.max(MIN_LINE_SPACING, value));

  const CONTOUR_DISTANCE_TO_SPACING_SCALE = 18;

  const resolveContourSpacing = (
    _basis: ContourLinesBasis,
    pointer: Point,
    state: ContourLinesState,
    defaultSpacing: number
  ) => {
    const points = state.shapePoints;
    if (!points || points.length === 0) {
      return {
        spacing: defaultSpacing,
        pointerDistance: 0,
        referenceDistance: 0,
        referenceSpacing: defaultSpacing,
      };
    }

    const brushShape = tools.brushSettings.brushShape;

    if (brushShape === BrushShape.NEW_SHAPE_FILL) {
      const center = computeNewShapeFillCenter(points, state.randomSeed ?? undefined);
      const pointerDistance = Math.hypot(pointer.x - center.x, pointer.y - center.y);
      const outerRadius = computeMaxRadialDistance(points, center);
      const outerReferenceDistance = outerRadius + 200;
      const normalized = outerReferenceDistance > 0
        ? Math.min(Math.max(pointerDistance / outerReferenceDistance, 0), 1)
        : 0;
      const spacing = MIN_LINE_SPACING + normalized * (MAX_NEW_SHAPE_FILL_SPACING - MIN_LINE_SPACING);
      const clampedSpacing = clampNewShapeFillSpacing(spacing);

      return {
        spacing: clampedSpacing,
        pointerDistance,
        referenceDistance: outerReferenceDistance,
        referenceSpacing: clampedSpacing,
      };
    }

    const centroid = state.centroid ?? computePolygonCentroid(points);
    let minY = points[0].y;
    let maxY = points[0].y;
    for (let i = 1; i < points.length; i += 1) {
      const y = points[i].y;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }

    const halfHeight = Math.max(1, (maxY - minY) * 0.5);
    const pointerDistance = Math.abs(pointer.y - centroid.y);
    const overshoot = Math.max(0, pointerDistance - halfHeight);
    const normalizedDistance = overshoot / halfHeight;
    const baseSpacing = clampContourSpacing(defaultSpacing);
    const spacing = clampContourSpacing(baseSpacing + normalizedDistance * CONTOUR_DISTANCE_TO_SPACING_SCALE);

    return {
      spacing,
      pointerDistance,
      referenceDistance: pointerDistance,
      referenceSpacing: spacing,
    };
  };

  const { setContourLinesState, resetContourLinesState } = useAppStore.getState();

  type ContourBasis = NonNullable<ReturnType<typeof prepareContourLinesBasis>>;

  const logContourFillDebug = (message: string, data?: Record<string, unknown>) => {
    const ENABLE_CONTOUR_DEBUG_LOGS = false;
    if (!ENABLE_CONTOUR_DEBUG_LOGS) return;
    const store = useAppStore.getState();
    const mode = store.tools.brushSettings.shapeGradientMode || 'contour';
    const brushShape = store.tools.brushSettings.brushShape;
    const isContourFill =
      mode === 'contour' &&
      (brushShape === BrushShape.CONTOUR_POLYGON || brushShape === BrushShape.NEW_SHAPE_FILL);

    if (!isContourFill) return;

    const contextData = {
      fillMode: mode,
      brushShape,
      ...data,
    };

    debugLog('[ContourFill]', message, contextData);
  };

  const extractSelectionAsFloatingPaste = (): { imageData: ImageData; position: Point; width: number; height: number; layerId: string } | null => {
    if (!selectionStart || !selectionEnd || !project || !activeLayerId) {
      return null;
    }

    const activeLayer = layers.find((layer) => layer.id === activeLayerId);
    if (!activeLayer) {
      return null;
    }

    let layerImageData = activeLayer.imageData || null;
    if (!layerImageData && activeLayer.framebuffer) {
      try {
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = activeLayer.framebuffer.width;
        tempCanvas.height = activeLayer.framebuffer.height;
        const tempCtx = tempCanvas.getContext('2d', { willReadFrequently: true });
        if (tempCtx) {
          tempCtx.drawImage(activeLayer.framebuffer, 0, 0);
          layerImageData = tempCtx.getImageData(0, 0, tempCanvas.width, tempCanvas.height);
        }
      } catch {
        layerImageData = null;
      }
    }

    if (!layerImageData) {
      return null;
    }

    const rawMinX = Math.min(selectionStart.x, selectionEnd.x);
    const rawMinY = Math.min(selectionStart.y, selectionEnd.y);
    const rawMaxX = Math.max(selectionStart.x, selectionEnd.x);
    const rawMaxY = Math.max(selectionStart.y, selectionEnd.y);

    const clampedMinX = Math.max(0, Math.min(project.width, Math.floor(rawMinX)));
    const clampedMinY = Math.max(0, Math.min(project.height, Math.floor(rawMinY)));
    const clampedMaxX = Math.max(0, Math.min(project.width, Math.ceil(rawMaxX)));
    const clampedMaxY = Math.max(0, Math.min(project.height, Math.ceil(rawMaxY)));

    const width = clampedMaxX - clampedMinX;
    const height = clampedMaxY - clampedMinY;

    if (width <= 0 || height <= 0) {
      return null;
    }

    const safeWidth = Math.min(width, layerImageData.width - clampedMinX);
    const safeHeight = Math.min(height, layerImageData.height - clampedMinY);

    if (safeWidth <= 0 || safeHeight <= 0) {
      return null;
    }

    const selectionBuffer = new Uint8ClampedArray(safeWidth * safeHeight * 4);
    const updatedLayerBuffer = new Uint8ClampedArray(layerImageData.data);

    for (let y = 0; y < safeHeight; y++) {
      const sourceY = clampedMinY + y;
      if (sourceY < 0 || sourceY >= layerImageData.height) continue;

      for (let x = 0; x < safeWidth; x++) {
        const sourceX = clampedMinX + x;
        if (sourceX < 0 || sourceX >= layerImageData.width) continue;

        const sourceIndex = (sourceY * layerImageData.width + sourceX) * 4;
        const destIndex = (y * safeWidth + x) * 4;

        selectionBuffer[destIndex] = layerImageData.data[sourceIndex];
        selectionBuffer[destIndex + 1] = layerImageData.data[sourceIndex + 1];
        selectionBuffer[destIndex + 2] = layerImageData.data[sourceIndex + 2];
        selectionBuffer[destIndex + 3] = layerImageData.data[sourceIndex + 3];

        updatedLayerBuffer[sourceIndex] = 0;
        updatedLayerBuffer[sourceIndex + 1] = 0;
        updatedLayerBuffer[sourceIndex + 2] = 0;
        updatedLayerBuffer[sourceIndex + 3] = 0;
      }
    }

    const selectionImageData = new ImageData(selectionBuffer, safeWidth, safeHeight);
    const updatedLayerImageData = new ImageData(updatedLayerBuffer, layerImageData.width, layerImageData.height);

    updateLayer(activeLayerId, { imageData: updatedLayerImageData });

    return {
      imageData: selectionImageData,
      position: { x: clampedMinX, y: clampedMinY },
      width: safeWidth,
      height: safeHeight,
      layerId: activeLayerId
    };
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
      basis: ContourBasis;
      stage?: ContourLinesStage;
    }
  ) => {
    const overlayCanvas = overlayCanvasRef.current;
    const overlayCtx = overlayCanvas?.getContext('2d');
    if (!overlayCanvas || !overlayCtx) return;

    const contourState = override
      ? { ...useAppStore.getState().contourLinesState, ...override }
      : useAppStore.getState().contourLinesState;

    const { basis, shapePoints } = contourState;
    if (!basis || shapePoints.length < 3) return;

    overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);

    overlayCtx.save();
    overlayCtx.translate(deps.viewTransformRef.current.offsetX, deps.viewTransformRef.current.offsetY);
    overlayCtx.scale(deps.viewTransformRef.current.scale, deps.viewTransformRef.current.scale);
    const safeScale = Math.max(deps.viewTransformRef.current.scale, 0.001);

    const currentTools = useAppStore.getState().tools;
    const sampledStrokeColor = currentTools.brushSettings.shapeFillUseSampledColor && contourState.fillColor
      ? contourState.fillColor
      : currentTools.brushSettings.color;
    overlayCtx.lineWidth = Math.max(0.2, 0.45 / safeScale);
    overlayCtx.strokeStyle = sampledStrokeColor;
    overlayCtx.imageSmoothingEnabled = false;

    const brushShape = currentTools.brushSettings.brushShape;
    const isNewShapeFill = brushShape === BrushShape.NEW_SHAPE_FILL;
    const center = isNewShapeFill
      ? computeNewShapeFillCenter(shapePoints, contourState.randomSeed ?? undefined)
      : (contourState.centroid ?? computePolygonCentroid(shapePoints));
    const radialMaxDistance = isNewShapeFill
      ? Math.max(MIN_LINE_SPACING, computeMaxRadialDistance(shapePoints, center) + 200)
      : 0;
    const basisMaxDistance = basis?.maxDistance ?? 0;
    const maxDistance = Math.max(
      0.001,
      isNewShapeFill ? radialMaxDistance : basisMaxDistance || spacingStart,
    );
    const constrainedStart = Math.min(Math.max(MIN_LINE_SPACING, spacingStart), maxDistance);
    const constrainedEnd = spacingEnd == null
      ? undefined
      : Math.min(Math.max(MIN_LINE_SPACING, spacingEnd), maxDistance);

    if (contourState.centroid == null) {
      setContourLinesState({ centroid: center });
    }

    const activeMode = currentTools.brushSettings.shapeGradientMode || 'contour';

    if (activeMode === 'contour') {
      if (brushEngine) {
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
            strokeColorOverride: sampledStrokeColor,
            previewDetail: 'full',
          }
        );
      }

      overlayCtx.restore();
      overlayCtx.restore();
      return;
    }

    const paths = generateContourLines(shapePoints, basis, constrainedStart, constrainedEnd);

    logContourFillDebug('spacing-preview-render', {
      stage: contourState.stage,
      spacingStart: constrainedStart,
      spacingEnd: constrainedEnd ?? constrainedStart,
      pathCount: paths.length,
      basisMaxDistance: basis.maxDistance,
    });

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
    overlayCtx.translate(deps.viewTransformRef.current.offsetX, deps.viewTransformRef.current.offsetY);
    overlayCtx.scale(deps.viewTransformRef.current.scale, deps.viewTransformRef.current.scale);

    const safeScale = Math.max(deps.viewTransformRef.current.scale, 0.001);
    overlayCtx.lineWidth = Math.max(0.2, 0.45 / safeScale);
    overlayCtx.strokeStyle = tools.brushSettings.color;
    overlayCtx.imageSmoothingEnabled = false;

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

  const finalizeContourLinesStroke = (spacingStart: number, spacingEnd: number) => {
    const state = useAppStore.getState();
    const { contourLinesState } = state;
    const { shapePoints, fillColor, basis } = contourLinesState;

    if (!brushEngine || !basis || shapePoints.length < 3) {
      resetContourLinesState();
      clearOverlayCanvas();
      return;
    }

    logContourFillDebug('finalizing-contour-fill', {
      spacingA: spacingStart,
      spacingB: spacingEnd,
      vertexCount: shapePoints.length,
    });

    drawingHandlers.initDrawingCanvas();
    const drawCtx = drawingHandlers.drawingCanvasRef.current?.getContext('2d', { willReadFrequently: true });
    if (!drawCtx) {
      resetContourLinesState();
      clearOverlayCanvas();
      return;
    }

    const strokeColorOverride = state.tools.brushSettings.shapeFillUseSampledColor
      ? (fillColor ?? contourLinesState.fillColor ?? state.tools.brushSettings.color)
      : undefined;

    brushEngine.drawContourPolygon(
      drawCtx,
      {
        vertices: shapePoints,
        fillColor,
      },
      false,
      {
        lineSpacingA: spacingStart,
        lineSpacingB: spacingEnd,
        lineBasis: basis,
        contourSpacingOverride: spacingEnd ?? spacingStart,
        randomSeed: contourLinesState.randomSeed ?? undefined,
        strokeColorOverride,
      }
    );

    drawingHandlers.drawingCanvasHasContent.current = true;
    compositeCanvasDirtyRef.current = true;

    drawingHandlers.finalizeDrawing(false).then(() => {
      stateMachine.finalizationComplete();
      requestAnimationFrame(() => {
        if (compositeCanvasRef.current && project) {
          compositeLayersToCanvas(compositeCanvasRef.current);
          setCurrentOffscreenCanvas(compositeCanvasRef.current);
          compositeCanvasDirtyRef.current = false;

          const canvasEl = canvasRef.current;
          const ctx = canvasEl?.getContext('2d', { willReadFrequently: true });
          if (ctx) {
            deps.draw(ctx, deps.viewTransformRef.current);
          }
        }
      });

      if (deps.restartColorCycleAnimation) {
        deps.restartColorCycleAnimation();
      }
    });

    toolStateMachine.resetPolygonGradient();
    resetContourLinesState();
    clearOverlayCanvas();
  };

  const finalizeLines2Stroke = (
    angle: number,
    convergenceA: { x: number; y: number },
    convergenceB: { x: number; y: number }
  ) => {
    const state = useAppStore.getState();
    const { contourLinesState } = state;
    const { shapePoints, fillColor, basis, centroid } = contourLinesState;

    if (!brushEngine || !shapePoints || shapePoints.length < 3) {
      resetContourLinesState();
      clearOverlayCanvas();
      return;
    }

    drawingHandlers.initDrawingCanvas();
    const drawCtx = drawingHandlers.drawingCanvasRef.current?.getContext('2d', { willReadFrequently: true });
    if (!drawCtx) {
      resetContourLinesState();
      clearOverlayCanvas();
      return;
    }

    const spacingSetting = state.tools.brushSettings.contourLines2Spacing ?? 8;
    const densitySetting = state.tools.brushSettings.contourLines2Density ?? 5;
    const alternateSetting = state.tools.brushSettings.contourLines2Alternate ?? true;

    const strokeColorOverride = state.tools.brushSettings.shapeFillUseSampledColor && fillColor
      ? fillColor
      : (state.tools.brushSettings.shapeFillUseSampledColor
        ? contourLinesState.fillColor ?? state.tools.brushSettings.color
        : undefined);

    brushEngine.drawContourPolygon(
      drawCtx,
      {
        vertices: shapePoints,
        fillColor,
      },
      false,
      {
        variant: 'lines2',
        lineBasis: basis,
        lines2Angle: angle,
        lines2ConvergenceA: convergenceA,
        lines2ConvergenceB: convergenceB,
        lines2Spacing: spacingSetting,
        lines2Density: densitySetting,
        lines2Alternate: alternateSetting,
        centroid,
        strokeColorOverride,
      }
    );

    drawingHandlers.drawingCanvasHasContent.current = true;
    compositeCanvasDirtyRef.current = true;

    drawingHandlers.finalizeDrawing(false).then(() => {
      stateMachine.finalizationComplete();
      requestAnimationFrame(() => {
        if (compositeCanvasRef.current && project) {
          compositeLayersToCanvas(compositeCanvasRef.current);
          setCurrentOffscreenCanvas(compositeCanvasRef.current);
          compositeCanvasDirtyRef.current = false;

          const canvasEl = canvasRef.current;
          const ctx = canvasEl?.getContext('2d', { willReadFrequently: true });
          if (ctx) {
            deps.draw(ctx, deps.viewTransformRef.current);
          }
        }
      });

      if (deps.restartColorCycleAnimation) {
        deps.restartColorCycleAnimation();
      }
    });

    toolStateMachine.resetPolygonGradient();
    resetContourLinesState();
    clearOverlayCanvas();
  };

  // Track whether the pointer is currently within the canvas bounds. This stays accurate
  // even when pointer capture is active so we can hide the brush cursor once the pointer
  // drifts over the UI column.
  let pointerInsideCanvas = false;

  const isPointerWithinCanvas = (clientX: number, clientY: number) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return false;
    return clientX >= rect.left && clientX <= rect.right &&
           clientY >= rect.top && clientY <= rect.bottom;
  };

  const updateBrushCursorVisibility = (overridePointerInside?: boolean) => {
    const pointerInside = overridePointerInside ?? pointerInsideCanvas;
    const shouldHideCursor = stateMachine.isAwaitingPan ||
                             stateMachine.isPanning ||
                             tools.currentTool === 'custom' ||
                             deps.isDraggingFloatingPaste ||
                             (!!floatingPasteDragStart.current) ||
                             !pointerInside;
    const nextVisible = !shouldHideCursor;
    setShowBrushCursor(nextVisible);
  };

  // Helper: Determine if current brush and active layer are compatible
  const checkLayerBrushCompatibility = () => {
    const activeLayer = layers.find(l => l.id === activeLayerId);
    const isColorCycleLayer = activeLayer?.layerType === 'color-cycle';
    const brushShape = tools.brushSettings.brushShape;
    const isCCBrush = brushShape === BrushShape.COLOR_CYCLE ||
      brushShape === BrushShape.COLOR_CYCLE_SHAPE ||
      (brushShape === BrushShape.CUSTOM && tools.brushSettings.customBrushColorCycle === true);

    // Mismatch if CC brush on normal layer OR regular brush/tool on CC layer
    const mismatch = (isColorCycleLayer && !isCCBrush) || (!isColorCycleLayer && isCCBrush);
    if (!mismatch) return { ok: true } as const;

    // Compose a clear message
    const message = isColorCycleLayer
      ? "Can't use regular brushes on a Color Cycle layer. Switch layers or select a Color Cycle brush."
      : "Can't use Color Cycle brushes on a normal layer. Create/select a Color Cycle layer.";
    return { ok: false, message } as const;
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    // Track that pointer is down
    isMouseDownRef.current = true;
    
    // If the app is busy, ignore this pointer event completely
    if (isBusyRef.current) {
      isMouseDownRef.current = false; // Clear ref in case pointerup is missed
      return;
    }
    
    // Always prevent default to avoid browser drag behavior
    event.preventDefault();
    
    // Capture pointer for consistent events even when pointer moves outside canvas
    (event.target as HTMLCanvasElement).setPointerCapture(event.pointerId);

    pointerInsideCanvas = true;
    setMousePosition({ x: event.clientX, y: event.clientY });
    
    const rect = canvasRef.current?.getBoundingClientRect();
    const pointerPos = rect ? {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    } : { x: 0, y: 0 };
    
    // Store pressure value (0-1, with 0.5 as default for mice)
    // For testing: Simulate pressure with mouse using Shift (low) and Ctrl (high)
    let pressure = event.pressure || 0.5;
    if (event.pointerType === 'mouse' && tools.brushSettings.pressureEnabled) {
      if (event.shiftKey) {
        pressure = 0.1; // Simulate low pressure with Shift
      } else if (event.ctrlKey) {
        pressure = 0.9; // Simulate high pressure with Ctrl
      }
    }
    
    // Test Wacom functionality
    const wacomTest = testWacomPressure(event);
    if (!wacomTest.isWorking && tools.brushSettings.pressureEnabled) {
      detectWacomIssues();
      // Intentionally silent to avoid console noise
    }
    
    // SIMPLIFIED PANNING: Just check if space is pressed
    if (isSpacePressedRef.current) {
      pan.startPan(pointerPos.x, pointerPos.y);
      setCursorStyle('grabbing');
      setShowBrushCursor(false);
      pauseAnimationForPan?.();
      // Intentionally quiet: avoid console noise for common panning
      return; // Skip everything else - we're panning
    }
    
    // Middle or right click - skip
    if (event.button === 1 || event.button === 2) {
      return;
    }
    
    const scale = canvas?.zoom || 1;
    const worldPos = pan.screenToWorld(pointerPos.x, pointerPos.y, scale);
    // Intentionally quiet

    
    const contourLinesState = useAppStore.getState().contourLinesState;

    if (contourLinesState.variant === 'lines2') {
      const defaults = computeLines2Defaults(contourLinesState.shapePoints, contourLinesState.basis);

      if (contourLinesState.stage === 'awaitingAngle') {
        const centroidBase = contourLinesState.centroid ?? defaults.centroid;
        const candidate = Math.atan2(worldPos.y - centroidBase.y, worldPos.x - centroidBase.x);
        const nextAngle = Number.isFinite(candidate) ? candidate : defaults.defaultAngle;
        const stats = computeLines2ProjectionStats(
          contourLinesState.shapePoints,
          nextAngle,
          centroidBase
        );
        const midpointA = getLines2SideMidpoint(stats, 'min');
        const midpointB = getLines2SideMidpoint(stats, 'max');

        setContourLinesState({
          stage: 'awaitingConvergenceA',
          lineAngle: nextAngle,
          convergenceA: midpointA,
          convergenceB: midpointB,
          centroid: stats.centroid,
        });

        drawLines2Preview(nextAngle, midpointA, midpointB);

        isMouseDownRef.current = false;
        (event.target as HTMLCanvasElement).releasePointerCapture(event.pointerId);
        return;
      }

      if (contourLinesState.stage === 'awaitingConvergenceA') {
        const angle = contourLinesState.lineAngle ?? defaults.defaultAngle;
        const stats = computeLines2ProjectionStats(
          contourLinesState.shapePoints,
          angle,
          contourLinesState.centroid ?? defaults.centroid
        );
        const projectedA = projectPointOntoLines2Side(stats, worldPos, 'min');
        const fallbackB = contourLinesState.convergenceB ?? getLines2SideMidpoint(stats, 'max');

        setContourLinesState({
          stage: 'awaitingConvergenceB',
          lineAngle: angle,
          convergenceA: projectedA,
          convergenceB: fallbackB,
          centroid: stats.centroid,
        });

        drawLines2Preview(angle, projectedA, fallbackB);

        isMouseDownRef.current = false;
        (event.target as HTMLCanvasElement).releasePointerCapture(event.pointerId);
        return;
      }

      if (contourLinesState.stage === 'awaitingConvergenceB') {
        const angle = contourLinesState.lineAngle ?? defaults.defaultAngle;
        const stats = computeLines2ProjectionStats(
          contourLinesState.shapePoints,
          angle,
          contourLinesState.centroid ?? defaults.centroid
        );
        const fallbackA = contourLinesState.convergenceA ?? getLines2SideMidpoint(stats, 'min');
        const projectedB = projectPointOntoLines2Side(stats, worldPos, 'max');

        setContourLinesState({
          lineAngle: angle,
          convergenceA: fallbackA,
          convergenceB: projectedB,
          centroid: stats.centroid,
        });

        finalizeLines2Stroke(angle, fallbackA, projectedB);

        isMouseDownRef.current = false;
        (event.target as HTMLCanvasElement).releasePointerCapture(event.pointerId);
        return;
      }
    }

    if (contourLinesState.stage === 'awaitingAnchorA') {
      const { basis } = contourLinesState;
      if (!basis) {
        resetContourLinesState();
        clearOverlayCanvas();
        logContourFillDebug('spacing-reset-missing-basis');
        return;
      }

      const brushDefaultSpacing = tools.brushSettings.brushShape === BrushShape.NEW_SHAPE_FILL
        ? clampNewShapeFillSpacing((tools.brushSettings.contourSpacing || 5) * 2)
        : clampContourSpacing((tools.brushSettings.contourSpacing || 5) * 2);
      const { spacing, pointerDistance } = resolveContourSpacing(
        basis,
        worldPos,
        contourLinesState,
        brushDefaultSpacing
      );
      const spacingValue = tools.brushSettings.brushShape === BrushShape.NEW_SHAPE_FILL
        ? clampNewShapeFillSpacing(spacing)
        : clampContourSpacing(spacing);

      const centroid = tools.brushSettings.brushShape === BrushShape.NEW_SHAPE_FILL
        ? computeNewShapeFillCenter(contourLinesState.shapePoints, contourLinesState.randomSeed ?? undefined)
        : (contourLinesState.centroid ?? computePolygonCentroid(contourLinesState.shapePoints));

      setContourLinesState({
        previewSpacing: spacingValue,
        spacingReferenceDistance: pointerDistance,
        spacingReferenceSpacing: spacingValue,
        centroid,
      });

      drawContourLinesPreview(spacingValue, spacingValue, {
        shapePoints: contourLinesState.shapePoints,
        basis: basis as ContourBasis,
        stage: 'awaitingAnchorA',
      });

      logContourFillDebug('spacing-preview', {
        mode: tools.brushSettings.shapeGradientMode || 'contour',
        spacing: spacingValue,
      });

      return;
    }

    // Recolor/Brush sampling finalize (on second click as a fallback)
    const rsUp = useAppStore.getState().recolorSampling;
    if (rsUp.active && rsUp.start) {
      const start = rsUp.start;
      const end = { x: worldPos.x, y: worldPos.y };
      const samples = Math.max(2, Math.min(32, rsUp.samples || 12));
      const colors = sampleColorsAlongLine(start.x, start.y, end.x, end.y, samples);
      const stops = colors.map((c, i) => ({ position: samples === 1 ? 0 : i / (samples - 1), color: cssColorToHex(c) }));
      // Determine target (recolor layer vs brush settings)
      const target = rsUp.target || 'recolor';

      if (target === 'recolor') {
        const layer = layers.find(l => l.id === activeLayerId);
        if (layer) {
          const manager = RecolorManager.getInstance();
          (async () => {
            try {
              if (!layer.colorCycleData?.recolorSettings) {
                const ok = await manager.processLayer(layer, {
                  quantizationMode: 'rgb332',
                  ditherMode: 'off',
                  cycleColors: 16,
                  gradientPreset: 'custom',
                  customGradient: stops
                });
                if (!ok) throw new Error('processLayer failed');
              } else {
                manager.updateGradient(layer, stops);
              }
              // Remap palette index sequence to flow along sampled direction without changing pixel structure
              const dx = end.x - start.x;
              const dy = end.y - start.y;
              const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
              try { manager.setPaletteDirectionalOrder(layer.id, angle); } catch {}
              try { manager.autoSetAnimationDirection(layer.id, angle); } catch {}
              } catch (e) {
                console.warn('Failed to apply sampled gradient', e);
              }
          })();
        }
      } else {
        // target === 'brush' -> update brush gradient settings directly
        try {
          useAppStore.getState().setBrushSettings({ colorCycleGradient: stops });
        } catch {}
      }

      const overlayCanvas = overlayCanvasRef.current;
      if (overlayCanvas) {
        const overlayCtx = overlayCanvas.getContext('2d');
        overlayCtx?.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
      }
      useAppStore.getState().stopRecolorSampling();
      return;
    }

    // Recolor sampling: start point
    const rs1 = useAppStore.getState().recolorSampling;
    if (rs1.active) {
      useAppStore.getState().updateRecolorSampling({ start: { x: worldPos.x, y: worldPos.y }, end: null });
      // Clear overlay
      const overlayCanvas = overlayCanvasRef.current;
      if (overlayCanvas) {
        const overlayCtx = overlayCanvas.getContext('2d');
        overlayCtx?.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
      }
      return;
    }
    
    // PRIORITY: If a floating paste exists and the click is within its bounds,
    // start dragging it BEFORE any other interactions (drawing, selection, etc.).
    if (event.button === 0 && floatingPaste) {
      const pasteX = floatingPaste.position.x;
      const pasteY = floatingPaste.position.y;
      const pasteWidth = floatingPaste.width;
      const pasteHeight = floatingPaste.height;

      if (worldPos.x >= pasteX && worldPos.x <= pasteX + pasteWidth &&
          worldPos.y >= pasteY && worldPos.y <= pasteY + pasteHeight) {
        setIsDraggingFloatingPaste(true);
        floatingPasteDragStart.current = worldPos;
        floatingPasteOriginalPos.current = { ...floatingPaste.position };
        setCursorStyle('move');
        return; // Do not start drawing/selection when dragging paste
      }

      const clickInsidePaste =
        worldPos.x >= pasteX && worldPos.x <= pasteX + pasteWidth &&
        worldPos.y >= pasteY && worldPos.y <= pasteY + pasteHeight;

      if (!clickInsidePaste) {
        commitFloatingPaste().then(() => {
          compositeCanvasDirtyRef.current = true;
          requestAnimationFrame(() => {
            if (compositeCanvasRef.current && project) {
              compositeLayersToCanvas(compositeCanvasRef.current);
              setCurrentOffscreenCanvas(compositeCanvasRef.current);
              compositeCanvasDirtyRef.current = false;
              const canvasEl = canvasRef.current;
              const ctx = canvasEl?.getContext('2d', { willReadFrequently: true });
              if (ctx) {
                deps.draw(ctx, deps.viewTransformRef.current);
              }
            }
          });
        }).catch(() => {
          cancelFloatingPaste();
        });
        isMouseDownRef.current = false;
        if ((event.target as HTMLCanvasElement).hasPointerCapture?.(event.pointerId)) {
          (event.target as HTMLCanvasElement).releasePointerCapture(event.pointerId);
        }
        setCursorStyle(deps.defaultCursorStyle || 'none');
        updateBrushCursorVisibility();
        return;
      }
    }

    if (
      event.button === 0 &&
      !floatingPaste &&
      tools.currentTool === 'selection' &&
      selectionStart &&
      selectionEnd
    ) {
      const minX = Math.min(selectionStart.x, selectionEnd.x);
      const maxX = Math.max(selectionStart.x, selectionEnd.x);
      const minY = Math.min(selectionStart.y, selectionEnd.y);
      const maxY = Math.max(selectionStart.y, selectionEnd.y);

      const isInsideSelection =
        worldPos.x >= minX && worldPos.x <= maxX &&
        worldPos.y >= minY && worldPos.y <= maxY;

      if (isInsideSelection) {
        const floatingData = extractSelectionAsFloatingPaste();

        if (floatingData) {
          setFloatingPaste({
            active: true,
            imageData: floatingData.imageData,
            position: floatingData.position,
            width: floatingData.width,
            height: floatingData.height,
            originalPosition: floatingData.position,
            sourceLayerId: floatingData.layerId
          });

          clearSelection();
          setIsDraggingFloatingPaste(true);
          floatingPasteDragStart.current = worldPos;
          floatingPasteOriginalPos.current = { ...floatingData.position };
          setCursorStyle('move');
          setShowBrushCursor(false);

          compositeCanvasDirtyRef.current = true;
          requestAnimationFrame(() => {
            if (compositeCanvasRef.current && project) {
              compositeLayersToCanvas(compositeCanvasRef.current);
              setCurrentOffscreenCanvas(compositeCanvasRef.current);
              compositeCanvasDirtyRef.current = false;
              const canvasEl = canvasRef.current;
              const ctx = canvasEl?.getContext('2d', { willReadFrequently: true });
              if (ctx) {
                deps.draw(ctx, deps.viewTransformRef.current);
              }
            }
          });

          setNeedsRedraw((value) => value + 1);
          return;
        }
      }
    }

    // Check the state BEFORE dispatching - this is critical!
    const currentMode = stateMachine.state.mode;

    const rewriteHandled = shapeHandler.handlePointerDown(event);
    if (rewriteHandled) {
      const polygonState = useAppStore.getState().polygonGradientState;
      if (polygonState.drawingState === 'idle') {
        isMouseDownRef.current = false;
        if ((event.target as HTMLCanvasElement).hasPointerCapture?.(event.pointerId)) {
          (event.target as HTMLCanvasElement).releasePointerCapture(event.pointerId);
        }
      }
      return;
    }

    // Dispatch to state machine with SCREEN position for normal interactions
    stateMachine.dispatch({ 
      type: 'MOUSE_DOWN', 
      button: event.button,
      position: pointerPos,  // Use screen coordinates, not world
      tool: tools.currentTool,
      pressure
    });
    
    // --- PROPER FIX: Block clicks outside canvas bounds ---
    if (project) {
      if (worldPos.x < 0 || worldPos.x > project.width || 
          worldPos.y < 0 || worldPos.y > project.height) {
        return; // Don't start any action if click is out of bounds
      }
    }

    // Shape mode should take precedence for normal brushes
    // Start shape drawing immediately to avoid interference from other branches
    const rawShapeMode = tools.brushSettings.shapeGradientMode || 'contour';
    const normalizedShapeMode = rawShapeMode === 'mesh'
      ? 'lines'
      : (rawShapeMode === 'flow' || rawShapeMode === 'inkRibbons' || rawShapeMode === 'triangle'
        ? 'contour'
        : rawShapeMode);
    const isLines2Active = (
      tools.brushSettings.brushShape === BrushShape.CONTOUR_LINES2 ||
      ((tools.brushSettings.brushShape === BrushShape.CONTOUR_POLYGON ||
        tools.brushSettings.brushShape === BrushShape.NEW_SHAPE_FILL) &&
        normalizedShapeMode === 'lines2')
    );

    if (
      event.button === 0 &&
      (tools.currentTool === 'brush' || tools.currentTool === 'eraser') &&
      tools.shapeMode &&
      tools.brushSettings.brushShape !== BrushShape.RECTANGLE_GRADIENT &&
      tools.brushSettings.brushShape !== BrushShape.POLYGON_GRADIENT &&
      tools.brushSettings.brushShape !== BrushShape.CONTOUR_POLYGON &&
      tools.brushSettings.brushShape !== BrushShape.NEW_SHAPE_FILL &&
      !isLines2Active &&
      tools.brushSettings.brushShape !== BrushShape.COLOR_CYCLE_SHAPE
    ) {
      // quiet
      // Strictly block incompatible brush/layer combinations (but allow eraser on any layer)
      if (tools.currentTool !== 'eraser') {
        const compat = checkLayerBrushCompatibility();
        if (!compat.ok) {
          deps.feedback?.(compat.message);
          return;
        }
      }

      // Initialize snapping anchors for this stroke
      strokeStartWorldPosRef.current = worldPos;
      lastBrushSampleWorldPosRef.current = worldPos;
      shiftAnchorWorldPosRef.current = event.shiftKey ? worldPos : null;
      // quiet

      interaction.dispatch({ type: 'DRAWING_START', pressure });
      drawingHandlers.startShapeDrawing(worldPos, pressure);
      return;
    }
    
    // For simple drawing mode, use the existing drawing handlers
    // Use the currentMode captured BEFORE dispatch!
    if (currentMode === 'IDLE' && 
        (tools.currentTool === 'brush' || tools.currentTool === 'eraser') &&
        !tools.shapeMode &&
        tools.brushSettings.brushShape !== BrushShape.RECTANGLE_GRADIENT &&
        tools.brushSettings.brushShape !== BrushShape.POLYGON_GRADIENT &&
        tools.brushSettings.brushShape !== BrushShape.CONTOUR_POLYGON &&
        tools.brushSettings.brushShape !== BrushShape.NEW_SHAPE_FILL &&
        !isLines2Active &&
        tools.brushSettings.brushShape !== BrushShape.COLOR_CYCLE_SHAPE) {
      // Strictly block incompatible brush/layer combinations (but allow eraser on any layer)
      if (tools.currentTool !== 'eraser') {
        const compat = checkLayerBrushCompatibility();
        if (!compat.ok) {
          deps.feedback?.(compat.message);
          return;
        }
      }
      
      // Initialize snapping anchors for this stroke
      strokeStartWorldPosRef.current = worldPos;
      lastBrushSampleWorldPosRef.current = worldPos;
      shiftAnchorWorldPosRef.current = event.shiftKey ? worldPos : null;
      // quiet

      // Use the existing drawing system with brush engine
      interaction.dispatch({ type: 'DRAWING_START', pressure });
      drawingHandlers.startDrawing(worldPos, pressure);
      return;
    }
    
    // Handle left click
    if (event.button === 0) {
      // Handle fill tool
      if (tools.currentTool === 'fill') {
        // Block fill on CC layers
        const compat = checkLayerBrushCompatibility();
        if (!compat.ok) {
          deps.feedback?.(compat.message);
          return;
        }
        // Get the active layer
        const activeLayer = layers.find(l => l.id === activeLayerId);
        if (!activeLayer) return;
        
        // Get the proper canvas dimensions from the project
        const canvasWidth = project?.width || 1920;
        const canvasHeight = project?.height || 1080;
        
        // Get or create properly-sized image data
        let currentImageData: ImageData | null = null;
        
        if (activeLayer.framebuffer) {
          const fb = activeLayer.framebuffer;
          
          // Check if framebuffer needs resizing (it might be a 1x1 placeholder)
          if (fb.width !== canvasWidth || fb.height !== canvasHeight) {
            // Resize the framebuffer to match project dimensions
            fb.width = canvasWidth;
            fb.height = canvasHeight;
          }
          
          const ctx = fb.getContext('2d', { willReadFrequently: true });
          if (ctx && 'getImageData' in ctx) {
            currentImageData = ctx.getImageData(0, 0, canvasWidth, canvasHeight);
          }
        }
        
        // Fall back to imageData if available
        if (!currentImageData && activeLayer.imageData) {
          currentImageData = activeLayer.imageData;
        }
        
        // If still no image data, create a new blank one
        if (!currentImageData) {
          const tempCanvas = document.createElement('canvas');
          tempCanvas.width = canvasWidth;
          tempCanvas.height = canvasHeight;
          const tempCtx = tempCanvas.getContext('2d', { willReadFrequently: true });
          if (tempCtx) {
            currentImageData = tempCtx.createImageData(canvasWidth, canvasHeight);
          } else {
            return;
          }
        }
        
        // Parse fill color - handle both hex and rgb formats
        const fillColor = tools.brushSettings.color;
        let r = 0, g = 0, b = 0;
        
        if (fillColor.startsWith('#')) {
          // Handle hex color
          const hex = fillColor.slice(1);
          r = parseInt(hex.substring(0, 2), 16);
          g = parseInt(hex.substring(2, 4), 16);
          b = parseInt(hex.substring(4, 6), 16);
        } else if (fillColor.startsWith('rgb')) {
          // Handle rgb/rgba color
          const matches = fillColor.match(/\d+/g);
          if (matches) {
            [r, g, b] = matches.map(Number);
          }
        }
        
        // Perform flood fill on the current image data
        const filledImageData = floodFill(
          currentImageData,
          Math.floor(worldPos.x),
          Math.floor(worldPos.y),
          { r, g, b, a: 255 },
          {
            threshold: tools.fillSettings.threshold,
            contiguous: tools.fillSettings.contiguous
          }
        );
        
        // Update the layer's framebuffer with the filled image data
        if (activeLayer.framebuffer) {
          const fb = activeLayer.framebuffer;
          const ctx = fb.getContext('2d', { willReadFrequently: true });
          if (ctx && 'putImageData' in ctx) {
            ctx.putImageData(filledImageData, 0, 0);
          }
        }
        
        // Also update the imageData if it exists
        if (activeLayerId) {
          updateLayer(activeLayerId, { imageData: filledImageData });
        }
        
        // Trigger canvas composite update
        compositeCanvasDirtyRef.current = true;
        requestAnimationFrame(() => {
          if (compositeCanvasRef.current && project) {
            compositeLayersToCanvas(compositeCanvasRef.current);
            setCurrentOffscreenCanvas(compositeCanvasRef.current);
            compositeCanvasDirtyRef.current = false;
            
            const canvasEl = canvasRef.current;
            const ctx = canvasEl?.getContext('2d', { willReadFrequently: true });
            if (ctx) {
              deps.draw(ctx, deps.viewTransformRef.current);
            }
          }
        });
        
        // Save state for undo
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = canvasWidth;
        tempCanvas.height = canvasHeight;
        const tempCtx = tempCanvas.getContext('2d', { willReadFrequently: true });
        if (tempCtx) {
          tempCtx.putImageData(filledImageData, 0, 0);
          saveCanvasState(tempCanvas, 'fill', 'Flood fill');
        }
        
        return;
      }
      
      // Handle selection tool
      // If using custom tool BUT shape mode is ON, treat as shape drawing with current brush
      if (tools.currentTool === 'custom' && tools.shapeMode) {
        // quiet
        // Start shape drawing with the selected custom brush
        interaction.dispatch({ type: 'DRAWING_START', pressure });
        drawingHandlers.startShapeDrawing(worldPos, pressure);
        return;
      }

      if (tools.currentTool === 'selection' || (tools.currentTool === 'custom' && !tools.shapeMode)) {
        interaction.dispatch({ type: 'SELECTION_START' });
        interaction.refs.selectionStart.current = worldPos;
        setSelectionBounds(worldPos, worldPos);
        if (tools.currentTool === 'custom') {
          setShowBrushCursor(false); // Hide brush cursor when making custom brush selection
        }
        return;
      }
      
      // Handle direction selection click for linear gradient fill
      if (drawingHandlers.isSelectingDirectionRef?.current) {
        // quiet
        // Pass the click position to finalize the direction
        drawingHandlers.startShapeDrawing(worldPos, pressure);
        // quiet
        // Now finalize with the direction set
        drawingHandlers.finalizeShapeDrawing();
        // quiet
        return;
      }
      
      // Clear selection when clicking outside of selected area (for any other tool)
      if (selectionStart && selectionEnd) {
        const minX = Math.min(selectionStart.x, selectionEnd.x);
        const maxX = Math.max(selectionStart.x, selectionEnd.x);
        const minY = Math.min(selectionStart.y, selectionEnd.y);
        const maxY = Math.max(selectionStart.y, selectionEnd.y);
        
        // Check if click is outside selection bounds
        if (worldPos.x < minX || worldPos.x > maxX || worldPos.y < minY || worldPos.y > maxY) {
          clearSelection();
        }
      }
      
      // Handle rectangle gradient
      if (toolStateMachine.isRectangleGradient) {
        // Block rectangle gradient on CC layers
        const compat = checkLayerBrushCompatibility();
        if (!compat.ok) {
          deps.feedback?.(compat.message);
          return;
        }
        const result = toolStateMachine.handleRectangleGradientMouseDown(worldPos);
        if (result === 'finalize') {
          // This click finalizes the width - draw the rectangle
          const currentRectState = toolStateMachine.rectangleBrushState;
          
          drawingHandlers.initDrawingCanvas();
          const drawCtx = drawingHandlers.drawingCanvasRef.current?.getContext('2d', { willReadFrequently: true });
          
          if (drawCtx && brushEngine) {
            const dx = currentRectState.endPos.x - currentRectState.startPos.x;
            const dy = currentRectState.endPos.y - currentRectState.startPos.y;
            const length = Math.hypot(dx, dy);
            
            if (length > 0) {
              // Calculate perpendicular distance from mouse to line
              const lineVecX = dx / length;
              const lineVecY = dy / length;
              const toMouseX = worldPos.x - currentRectState.startPos.x;
              const toMouseY = worldPos.y - currentRectState.startPos.y;
              const perpDist = Math.abs(-lineVecY * toMouseX + lineVecX * toMouseY);
              const width = perpDist * 2;
              
              // Determine colors: preset (resampled) or sampled from canvas
              const numColors = Math.max(2, Math.min(64, tools.brushSettings.colors || 2));
              let colorsForGradient: string[] = [];
              const presetId = tools.brushSettings.rectGradientPresetId || 'none';
              if (presetId !== 'none') {
                const stops = getPresetStops(presetId) || [];
                colorsForGradient = resampleStopsToColors(stops, numColors);
              } else {
                colorsForGradient = sampleColorsAlongLine(
                  currentRectState.startPos.x,
                  currentRectState.startPos.y,
                  currentRectState.endPos.x,
                  currentRectState.endPos.y,
                  numColors
                );
              }
              
              // Draw the rectangle gradient (this is final, not preview)
              brushEngine.drawRectangleGradient(
                drawCtx,
                currentRectState.startPos.x,
                currentRectState.startPos.y,
                currentRectState.endPos.x,
                currentRectState.endPos.y,
                width,  // Use the calculated width, not currentRectState.width
                colorsForGradient.length > 0 ? colorsForGradient : [tools.brushSettings.color],
                false  // false = not preview, this is the final draw
              );
              
              drawingHandlers.drawingCanvasHasContent.current = true;
              
              // Mark composite as dirty BEFORE finalization
              compositeCanvasDirtyRef.current = true;
              
              // Finalize the drawing (rectangles are not CC shapes, so don't skip save)
              drawingHandlers.finalizeDrawing(false).then(() => {
                // Signal that finalization is complete
                stateMachine.finalizationComplete();
                
                // Force immediate composite regeneration after layer update
                if (compositeCanvasRef.current && project) {
                  compositeLayersToCanvas(compositeCanvasRef.current);
                  setCurrentOffscreenCanvas(compositeCanvasRef.current);
                  compositeCanvasDirtyRef.current = false;
                }
                
                // Trigger redraw after finalization
                setNeedsRedraw(prev => prev + 1);
              });
            }
          }
          
          // Clear the overlay canvas
          const overlayCanvas = overlayCanvasRef.current;
          if (overlayCanvas) {
            const overlayCtx = overlayCanvas.getContext('2d');
            if (overlayCtx) {
              overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
            }
          }
          
          toolStateMachine.resetRectangleGradient();
          interaction.dispatch({ type: 'DRAWING_END' });
        } else if (result === true) {
          interaction.dispatch({ type: 'DRAWING_START', mode: 'definingLength' });
        }
        return;
      }
      
      // Normal brush or shape mode
      // BUT ONLY if we're not in pan mode, NOT using gradient/contour tools,
      // AND the active tool actually supports painting (brush/eraser).
      // This prevents painting while the 'recolor' tool is selected.
      if (
        currentMode === 'IDLE' &&
        (tools.currentTool === 'brush' || tools.currentTool === 'eraser') &&
        !toolStateMachine.isRectangleGradient &&
        !toolStateMachine.isPolygonGradient &&
        !toolStateMachine.isColorCycleShape &&
        !toolStateMachine.isContourPolygon
      ) {
        interaction.dispatch({ type: 'DRAWING_START', pressure });
        if (tools.shapeMode) {
          drawingHandlers.startShapeDrawing(worldPos, pressure);
        } else {
          drawingHandlers.startDrawing(worldPos, pressure);
        }
      }
    }
};

// --- Helper functions for preset gradient resampling ---
function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return m ? {
    r: parseInt(m[1], 16),
    g: parseInt(m[2], 16),
    b: parseInt(m[3], 16)
  } : { r: 0, g: 0, b: 0 };
}

function rgbToHex(r: number, g: number, b: number): string {
  const toHex = (x: number) => x.toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

type Stop = { position: number; color: string };

function interpolateStopColorAt(pos: number, stops: Stop[]): string {
  if (!stops.length) return '#ffffff';
  if (stops.length === 1) return stops[0].color;
  let before = stops[0];
  let after = stops[stops.length - 1];
  for (let i = 0; i < stops.length - 1; i++) {
    if (pos >= stops[i].position && pos <= stops[i + 1].position) {
      before = stops[i];
      after = stops[i + 1];
      break;
    }
  }
  const range = after.position - before.position;
  const t = range > 0 ? (pos - before.position) / range : 0;
  const a = hexToRgb(before.color);
  const b = hexToRgb(after.color);
  const r = Math.round(a.r + (b.r - a.r) * t);
  const g = Math.round(a.g + (b.g - a.g) * t);
  const bl = Math.round(a.b + (b.b - a.b) * t);
  return rgbToHex(r, g, bl);
}

function resampleStopsToColors(stops: Stop[], count: number): string[] {
  const n = Math.max(2, count | 0);
  const arr: string[] = [];
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 0 : i / (n - 1);
    arr.push(interpolateStopColorAt(t, stops));
  }
  return arr;
}

// Convert rgb(...) to #rrggbb
function cssColorToHex(color: string): string {
  if (color.startsWith('#')) return color;
  const m = /rgb\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/i.exec(color);
  if (!m) return '#ffffff';
  const r = Number(m[1]).toString(16).padStart(2, '0');
  const g = Number(m[2]).toString(16).padStart(2, '0');
  const b = Number(m[3]).toString(16).padStart(2, '0');
  return `#${r}${g}${b}`;
}
  const shapeHandler = createShapeToolHandler(
    {
      deps,
      overlayPreviewFrameMs: OVERLAY_PREVIEW_FRAME_MS,
      getLastOverlayPreviewTs: () => lastOverlayPreviewTs,
      setLastOverlayPreviewTs: (value: number) => {
        lastOverlayPreviewTs = value;
      },
    },
    {}
  );

  // RAF aggregator for pointermove to ensure at most one heavy processing per frame
  let scheduledMoveRAF: number | null = null;
  let lastMoveEvent: React.PointerEvent<HTMLCanvasElement> | null = null;

  const processPointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    const currentPointerPos = rect ? {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    } : { x: 0, y: 0 };
    const scale = canvas?.zoom || 1;

    pointerInsideCanvas = isPointerWithinCanvas(event.clientX, event.clientY);
    const worldPos = pan.screenToWorld(currentPointerPos.x, currentPointerPos.y, scale);

    // Always update cursor position immediately for responsive feel
    setMousePosition({ x: event.clientX, y: event.clientY });

    // If space is held and mouse is down, but pan hasn't started yet, start it now and exit early.
    if (isSpacePressedRef.current && isMouseDownRef.current && !pan.panState.isPanning) {
      pan.startPan(currentPointerPos.x, currentPointerPos.y);
      setCursorStyle('grabbing');
      setShowBrushCursor(false);
      pauseAnimationForPan?.();
      return; // Important: skip shape/brush updates on the same frame
    }

    // Check if we're in hatch adjustment mode
    if (shapeHandler.handlePointerMove(event)) {
      return;
    }

    // PANNING TAKES PRECEDENCE: if actively panning, update pan and skip other handling
    if (pan.panState.isPanning) {
      pan.updatePan(currentPointerPos.x, currentPointerPos.y);

      // Update view transform for immediate feedback
      deps.viewTransformRef.current.offsetX = pan.panState.offsetX;
      deps.viewTransformRef.current.offsetY = pan.panState.offsetY;

      // Throttle redraws with RAF
      if (!drawAnimationFrameRef.current) {
        drawAnimationFrameRef.current = requestAnimationFrame(() => {
          const ctx = canvasRef.current?.getContext('2d', { willReadFrequently: true });
          if (ctx) {
            deps.draw(ctx, deps.viewTransformRef.current);
          }
          drawAnimationFrameRef.current = null;
        });
      }

      return; // Skip all other pointer move logic while panning
    }

    // Quick visibility: show when Shift is held during drawing
    if (interaction.state.isDrawing && event.shiftKey) {
      // quiet
    }

    // Unified coalesced handling below covers both brush and shape drawing (with snapping)

    // Recolor sampling preview line
    const rsMove = useAppStore.getState().recolorSampling;
    if (rsMove.active && isMouseDownRef.current && rsMove.start) {
      const overlayCanvas = overlayCanvasRef.current;
      const overlayCtx = overlayCanvas?.getContext('2d');
      if (overlayCtx && overlayCanvas) {
        overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
        overlayCtx.save();
        overlayCtx.translate(deps.viewTransformRef.current.offsetX, deps.viewTransformRef.current.offsetY);
        overlayCtx.scale(deps.viewTransformRef.current.scale, deps.viewTransformRef.current.scale);
        overlayCtx.strokeStyle = '#00d1b2';
        overlayCtx.lineWidth = 2 / deps.viewTransformRef.current.scale;
        overlayCtx.beginPath();
        overlayCtx.moveTo(rsMove.start.x, rsMove.start.y);
        overlayCtx.lineTo(worldPos.x, worldPos.y);
        overlayCtx.stroke();
        overlayCtx.restore();
      }
      return;
    }
    
    // Store pressure value (0-1, with 0.5 as default for mice)
    // For testing: Simulate pressure with mouse using Shift (low) and Ctrl (high)
    let pressure = event.pressure || 0.5;
    if (event.pointerType === 'mouse' && tools.brushSettings.pressureEnabled) {
      if (event.shiftKey) {
        pressure = 0.1; // Simulate low pressure with Shift
      } else if (event.ctrlKey) {
        pressure = 0.9; // Simulate high pressure with Ctrl
      }
    }

   
    // If Shift is currently not held, allow re-anchoring the next time it's pressed during this stroke
    if (!event.shiftKey && interaction.state.isDrawing) {
      shiftAnchorWorldPosRef.current = null;
    }

    // Process coalesced events for smoother drawing (if available)
    // This gives us all the intermediate pointer positions between events
    // Skip for gradient/contour tools as they don't need continuous drawing
    if (interaction.state.isDrawing && event.nativeEvent.getCoalescedEvents && 
        !toolStateMachine.isRectangleGradient && !toolStateMachine.isPolygonGradient && !toolStateMachine.isColorCycleShape && !toolStateMachine.isContourPolygon) {
      const coalescedEvents = event.nativeEvent.getCoalescedEvents();
      if (coalescedEvents.length > 1) {
        // Process intermediate events (skip the last one as it's the current event)
        for (let i = 0; i < coalescedEvents.length - 1; i++) {
          const coalescedEvent = coalescedEvents[i];
          const coalescedPos = rect ? {
            x: coalescedEvent.clientX - rect.left,
            y: coalescedEvent.clientY - rect.top,
          } : { x: 0, y: 0 };
          let coalescedWorldPos = pan.screenToWorld(coalescedPos.x, coalescedPos.y, scale);
          // Apply Shift-based angle snapping for coalesced events
          if (coalescedEvent.shiftKey) {
            // If Shift was pressed mid-stroke, anchor to the last sampled point
            if (!shiftAnchorWorldPosRef.current) {
              shiftAnchorWorldPosRef.current = lastBrushSampleWorldPosRef.current || coalescedWorldPos;
            }
            if (tools.shapeMode && drawingHandlers.isDrawingShapeRef.current) {
              const pts = drawingHandlers.shapePointsRef?.current || [];
              if (pts.length >= 1) {
                const anchor = pts[pts.length - 1];
                coalescedWorldPos = snapPointToAngle(anchor, coalescedWorldPos, 45);
                // quiet
              }
            } else if (!tools.shapeMode) {
              const anchor = shiftAnchorWorldPosRef.current || strokeStartWorldPosRef.current;
              if (anchor) {
                coalescedWorldPos = snapPointToAngle(anchor, coalescedWorldPos, 45);
                // quiet
              }
            }
          }
          const coalescedPressure = coalescedEvent.pressure || 0.5;
          
          // Draw with the intermediate position and pressure
          if (tools.shapeMode && drawingHandlers.isDrawingShapeRef.current) {
            drawingHandlers.continueShapeDrawing(coalescedWorldPos);
          } else {
            drawingHandlers.continueDrawing(coalescedWorldPos, coalescedPressure);
            // Track last sampled point for mid-stroke Shift anchoring
            lastBrushSampleWorldPosRef.current = coalescedWorldPos;
          }
        }
      }
    }
    
    // Only dispatch to state machine if not panning (to avoid unnecessary updates)
    if (!pan.panState.isPanning) {
      stateMachine.dispatch({ 
        type: 'MOUSE_MOVE',
        position: currentPointerPos,
        pressure
      });
    }
    
    
    // Show brush cursor logic:
    // Hide cursor when: panning, custom tool, dragging paste, or pointer outside canvas bounds
    // NOTE: Keep cursor visible while erasing so users can see eraser size
    updateBrushCursorVisibility();
    
    // Handle dragging floating paste
    // Use refs to avoid render timing issues; begin drag sets these synchronously
    if (floatingPasteDragStart.current && floatingPasteOriginalPos.current) {
      const deltaX = worldPos.x - floatingPasteDragStart.current.x;
      const deltaY = worldPos.y - floatingPasteDragStart.current.y;

      const newX = floatingPasteOriginalPos.current.x + deltaX;
      const newY = floatingPasteOriginalPos.current.y + deltaY;

      updateFloatingPastePosition(newX, newY);

      // Redraw
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext('2d', { willReadFrequently: true });
      if (ctx) {
        deps.draw(ctx, deps.viewTransformRef.current);
      }
      return;
    }
    
    // Handle selection
    if (interaction.state.isSelecting) {
      if (interaction.refs.selectionStart.current) {
        setSelectionBounds(interaction.refs.selectionStart.current, worldPos);
      }
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext('2d', { willReadFrequently: true });
      if (ctx) {
        deps.draw(ctx, deps.viewTransformRef.current);
      }
      return;
    }
    
    // Handle direction selection for linear gradient fill (after shape completion)
    if (drawingHandlers.isSelectingDirectionRef?.current && !interaction.state.isDrawing) {
      // Continue shape drawing to show direction arrow preview (throttled)
      // If Shift is pressed, snap preview direction to 45° increments relative to shape center
      let dirWorld = worldPos;
      if (event.shiftKey) {
        const pts = drawingHandlers.shapePointsRef.current;
        if (pts.length >= 3) {
          const center = pts.reduce<Point>(
            (acc, point) => ({ x: acc.x + point.x, y: acc.y + point.y }),
            { x: 0, y: 0 }
          );
          center.x /= pts.length;
          center.y /= pts.length;
          dirWorld = snapPointToAngle(center, dirWorld, 45);
        }
      }

      if (deps.previewAnimationFrameRef && !deps.previewAnimationFrameRef.current) {
        const nowTs = performance.now();
        // Reuse overlay FPS cap for direction preview too
        if (nowTs - lastOverlayPreviewTs < OVERLAY_PREVIEW_FRAME_MS) {
          return;
        }
        deps.previewAnimationFrameRef.current = requestAnimationFrame(() => {
          lastOverlayPreviewTs = performance.now();
          drawingHandlers.continueShapeDrawing(dirWorld);
          const canvas = canvasRef.current;
          const ctx = canvas?.getContext('2d', { willReadFrequently: true });
          if (ctx) {
            deps.draw(ctx, deps.viewTransformRef.current);
          }
          if (deps.previewAnimationFrameRef) deps.previewAnimationFrameRef.current = null;
        });
      }
      return;
    }
    
    // Check for rectangle gradient width preview mode (special case - works without mouse down)
    if (toolStateMachine.isRectangleGradient && 
        toolStateMachine.rectangleBrushState.drawingState === 'definingWidth' &&
        !interaction.state.isDrawing && deps.previewAnimationFrameRef) {
      
      // Throttle rectangle gradient width preview with RAF + FPS cap
      if (!deps.previewAnimationFrameRef.current) {
        const nowTs = performance.now();
        if (nowTs - lastOverlayPreviewTs < OVERLAY_PREVIEW_FRAME_MS) {
          return;
        }
        deps.previewAnimationFrameRef.current = requestAnimationFrame(() => {
          lastOverlayPreviewTs = performance.now();
          const overlayCanvas = overlayCanvasRef.current;
          const overlayCtx = overlayCanvas?.getContext('2d');
          if (overlayCtx && overlayCanvas) {
            // Clear only the overlay canvas
            overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
            
            // Width definition preview - show full rectangle with gradient
            const currentRectState = toolStateMachine.rectangleBrushState;
            const startPos = currentRectState.startPos;
            const endPos = currentRectState.endPos;
            const dx = endPos.x - startPos.x;
            const dy = endPos.y - startPos.y;
            const length = Math.hypot(dx, dy);
            
            if (length > 0) {
              const lineVecX = dx / length;
              const lineVecY = dy / length;
              const toMouseX = worldPos.x - startPos.x;
              const toMouseY = worldPos.y - startPos.y;
              const perpDist = Math.abs(-lineVecY * toMouseX + lineVecX * toMouseY);
              const previewWidth = perpDist * 2;

              try {
                useAppStore.getState().setRectangleBrushState({
                  width: previewWidth,
                  currentPos: { x: worldPos.x, y: worldPos.y },
                });
              } catch {}
              
              const perpX = -dy / length * (previewWidth / 2);
              const perpY = dx / length * (previewWidth / 2);
              
              const corners = [
                { x: startPos.x + perpX, y: startPos.y + perpY },
                { x: startPos.x - perpX, y: startPos.y - perpY },
                { x: endPos.x - perpX, y: endPos.y - perpY },
                { x: endPos.x + perpX, y: endPos.y + perpY }
              ];
              
              overlayCtx.save();
              overlayCtx.translate(deps.viewTransformRef.current.offsetX, deps.viewTransformRef.current.offsetY);
              overlayCtx.scale(deps.viewTransformRef.current.scale, deps.viewTransformRef.current.scale);
              
              overlayCtx.globalAlpha = tools.currentTool === 'eraser' 
                ? (tools.eraserSettings?.opacity || 1)
                : (tools.brushSettings.opacity || 1);
              overlayCtx.globalCompositeOperation = 'source-over';
              
              // Sample colors for preview
              const numColors = tools.brushSettings.colors || 2;
              const sampledColors = sampleColorsAlongLine(
                startPos.x,
                startPos.y,
                endPos.x,
                endPos.y,
                numColors
              );
              
              // Create gradient for preview
              const gradient = overlayCtx.createLinearGradient(startPos.x, startPos.y, endPos.x, endPos.y);
              
              if (sampledColors.length > 0) {
                sampledColors.forEach((color, index) => {
                  const position = sampledColors.length === 1 ? 0 : index / (sampledColors.length - 1);
                  gradient.addColorStop(position, color);
                });
              } else {
                gradient.addColorStop(0, tools.brushSettings.color);
                gradient.addColorStop(1, tools.brushSettings.color);
              }
              
              overlayCtx.fillStyle = gradient;
              overlayCtx.beginPath();
              overlayCtx.moveTo(corners[0].x, corners[0].y);
              overlayCtx.lineTo(corners[1].x, corners[1].y);
              overlayCtx.lineTo(corners[2].x, corners[2].y);
              overlayCtx.lineTo(corners[3].x, corners[3].y);
              overlayCtx.closePath();
              overlayCtx.fill();
              
              overlayCtx.restore();
            }
          }
          if (deps.previewAnimationFrameRef) {
            deps.previewAnimationFrameRef.current = null;
          }
        });
      }
      return;
    }

    const contourLinesPreviewState = useAppStore.getState().contourLinesState;
    if (
      contourLinesPreviewState.variant === 'lines2' &&
      (contourLinesPreviewState.stage === 'awaitingAngle' ||
        contourLinesPreviewState.stage === 'awaitingConvergenceA' ||
        contourLinesPreviewState.stage === 'awaitingConvergenceB') &&
      deps.previewAnimationFrameRef &&
      !interaction.state.isDrawing
    ) {
      if (!deps.previewAnimationFrameRef.current) {
        const nowTs = performance.now();
        if (nowTs - lastOverlayPreviewTs < OVERLAY_PREVIEW_FRAME_MS) {
          return;
        }

        const previewWorld = { x: worldPos.x, y: worldPos.y };
        deps.previewAnimationFrameRef.current = requestAnimationFrame(() => {
          lastOverlayPreviewTs = performance.now();

          const currentState = useAppStore.getState().contourLinesState;
          const defaults = computeLines2Defaults(currentState.shapePoints, currentState.basis);

          if (!currentState.shapePoints || currentState.shapePoints.length < 3) {
            if (deps.previewAnimationFrameRef) deps.previewAnimationFrameRef.current = null;
            return;
          }

          if (currentState.stage === 'awaitingAngle') {
            const centroidBase = currentState.centroid ?? defaults.centroid;
            const candidate = Math.atan2(previewWorld.y - centroidBase.y, previewWorld.x - centroidBase.x);
            const nextAngle = Number.isFinite(candidate) ? candidate : defaults.defaultAngle;
            const stats = computeLines2ProjectionStats(currentState.shapePoints, nextAngle, centroidBase);
            const midpointA = getLines2SideMidpoint(stats, 'min');
            const midpointB = getLines2SideMidpoint(stats, 'max');

            setContourLinesState({
              lineAngle: nextAngle,
              convergenceA: midpointA,
              convergenceB: midpointB,
              centroid: stats.centroid,
            });

            drawLines2Preview(nextAngle, midpointA, midpointB);
          } else if (currentState.stage === 'awaitingConvergenceA') {
            const baseAngle = currentState.lineAngle ?? defaults.defaultAngle;
            const stats = computeLines2ProjectionStats(
              currentState.shapePoints,
              baseAngle,
              currentState.centroid ?? defaults.centroid
            );
            const projectedA = projectPointOntoLines2Side(stats, previewWorld, 'min');
            const fallbackB = currentState.convergenceB ?? getLines2SideMidpoint(stats, 'max');

            setContourLinesState({
              convergenceA: projectedA,
              lineAngle: baseAngle,
              centroid: stats.centroid,
              convergenceB: fallbackB,
            });

            drawLines2Preview(baseAngle, projectedA, fallbackB);
          } else if (currentState.stage === 'awaitingConvergenceB') {
            const baseAngle = currentState.lineAngle ?? defaults.defaultAngle;
            const stats = computeLines2ProjectionStats(
              currentState.shapePoints,
              baseAngle,
              currentState.centroid ?? defaults.centroid
            );
            const fallbackA = currentState.convergenceA ?? getLines2SideMidpoint(stats, 'min');
            const projectedB = projectPointOntoLines2Side(stats, previewWorld, 'max');

            setContourLinesState({
              convergenceB: projectedB,
              lineAngle: baseAngle,
              centroid: stats.centroid,
              convergenceA: fallbackA,
            });

            drawLines2Preview(baseAngle, fallbackA, projectedB);
          }

          if (deps.previewAnimationFrameRef) deps.previewAnimationFrameRef.current = null;
        });
      }

      return;
    }

    if (
      contourLinesPreviewState.stage === 'awaitingAnchorA' &&
      deps.previewAnimationFrameRef &&
      !interaction.state.isDrawing
    ) {
      if (!deps.previewAnimationFrameRef.current) {
        const nowTs = performance.now();
        if (nowTs - lastOverlayPreviewTs < OVERLAY_PREVIEW_FRAME_MS) {
          return;
        }

        deps.previewAnimationFrameRef.current = requestAnimationFrame(() => {
          lastOverlayPreviewTs = performance.now();
          const currentState = useAppStore.getState().contourLinesState;
          const { basis } = currentState;

          if (!basis) {
            resetContourLinesState();
            clearOverlayCanvas();
            if (deps.previewAnimationFrameRef) deps.previewAnimationFrameRef.current = null;
            return;
          }

          const brushDefaultSpacing = tools.brushSettings.brushShape === BrushShape.NEW_SHAPE_FILL
            ? clampNewShapeFillSpacing((tools.brushSettings.contourSpacing || 5) * 2)
            : clampContourSpacing((tools.brushSettings.contourSpacing || 5) * 2);
          const { spacing, pointerDistance } = resolveContourSpacing(
            basis,
            worldPos,
            currentState,
            brushDefaultSpacing
          );

          const spacingValue = tools.brushSettings.brushShape === BrushShape.NEW_SHAPE_FILL
            ? clampNewShapeFillSpacing(spacing)
            : clampContourSpacing(spacing);

          const centroid = tools.brushSettings.brushShape === BrushShape.NEW_SHAPE_FILL
            ? computeNewShapeFillCenter(currentState.shapePoints, currentState.randomSeed ?? undefined)
            : (currentState.centroid ?? computePolygonCentroid(currentState.shapePoints));

          setContourLinesState({
            previewSpacing: spacingValue,
            spacingReferenceDistance: pointerDistance,
            spacingReferenceSpacing: spacingValue,
            centroid,
          });

          drawContourLinesPreview(spacingValue, spacingValue, {
            shapePoints: currentState.shapePoints,
            basis: basis as ContourBasis,
            stage: 'awaitingAnchorA',
          });

          if (deps.previewAnimationFrameRef) deps.previewAnimationFrameRef.current = null;
        });
      }

      return;
    }

    if (interaction.state.isDrawing) {
      // Rectangle gradient preview
      if (toolStateMachine.isRectangleGradient) {
        // If defining length and Shift is pressed, snap to 45° relative to start
        let rgWorld = worldPos;
        if (event.shiftKey && toolStateMachine.rectangleBrushState.drawingState === 'definingLength') {
          const start = toolStateMachine.rectangleBrushState.startPos;
          if (start) {
            rgWorld = snapPointToAngle(start, worldPos, 45);
          }
        }
        const previewType = toolStateMachine.handleRectangleGradientMouseMove(rgWorld);
        if (previewType && deps.previewAnimationFrameRef) {
        // Throttle rectangle gradient preview with RAF + FPS cap
        if (!deps.previewAnimationFrameRef.current) {
          const nowTs = performance.now();
          if (nowTs - lastOverlayPreviewTs < OVERLAY_PREVIEW_FRAME_MS) {
            return;
          }
          deps.previewAnimationFrameRef.current = requestAnimationFrame(() => {
            lastOverlayPreviewTs = performance.now();
            const overlayCanvas = overlayCanvasRef.current;
            const overlayCtx = overlayCanvas?.getContext('2d');
              if (overlayCtx && overlayCanvas) {
                // Clear only the overlay canvas
                overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
                
                // Get current rectangle state
                const currentRectState = toolStateMachine.rectangleBrushState;
                
                if (previewType === 'length') {
                  // Length definition preview - show line with sampled colors
                  overlayCtx.save();
                  overlayCtx.translate(deps.viewTransformRef.current.offsetX, deps.viewTransformRef.current.offsetY);
                  overlayCtx.scale(deps.viewTransformRef.current.scale, deps.viewTransformRef.current.scale);
                  
                  // Determine colors for length preview
                  const numColorsLen = Math.max(2, Math.min(64, tools.brushSettings.colors || 2));
                  let sampledColors: string[] = [];
                  const presetIdLen = tools.brushSettings.rectGradientPresetId || 'none';
                  if (presetIdLen !== 'none') {
                    const stops = getPresetStops(presetIdLen) || [];
                    sampledColors = resampleStopsToColors(stops, numColorsLen);
                  } else {
                    sampledColors = sampleColorsAlongLine(
                      currentRectState.startPos.x,
                      currentRectState.startPos.y,
                      worldPos.x,
                      worldPos.y,
                      numColorsLen
                    );
                  }
                  
                  // Create gradient with sampled colors
                  const gradient = overlayCtx.createLinearGradient(
                    currentRectState.startPos.x,
                    currentRectState.startPos.y,
                    worldPos.x,
                    worldPos.y
                  );
                  
                  if (sampledColors.length === 1) {
                    gradient.addColorStop(0, sampledColors[0]);
                    gradient.addColorStop(1, sampledColors[0]);
                  } else {
                    sampledColors.forEach((color, i) => {
                      gradient.addColorStop(i / (sampledColors.length - 1), color);
                    });
                  }
                  
                  overlayCtx.strokeStyle = gradient;
                  overlayCtx.lineWidth = 2 / deps.viewTransformRef.current.scale;
                  overlayCtx.beginPath();
                  overlayCtx.moveTo(currentRectState.startPos.x, currentRectState.startPos.y);
                  overlayCtx.lineTo(worldPos.x, worldPos.y);
                  overlayCtx.stroke();
                  
                  overlayCtx.restore();
                } else if (previewType === 'width') {
                  // Width definition preview - show full rectangle with gradient
                  const startPos = currentRectState.startPos;
                  const endPos = currentRectState.endPos;
                  const dx = endPos.x - startPos.x;
                  const dy = endPos.y - startPos.y;
                  const length = Math.hypot(dx, dy);
                  
                  if (length > 0) {
                    const lineVecX = dx / length;
                    const lineVecY = dy / length;
                    const toMouseX = worldPos.x - startPos.x;
                    const toMouseY = worldPos.y - startPos.y;
                    const perpDist = Math.abs(-lineVecY * toMouseX + lineVecX * toMouseY);
                    const previewWidth = perpDist * 2;
                    
                    const perpX = -dy / length * (previewWidth / 2);
                    const perpY = dx / length * (previewWidth / 2);
                    
                    const corners = [
                      { x: startPos.x + perpX, y: startPos.y + perpY },
                      { x: startPos.x - perpX, y: startPos.y - perpY },
                      { x: endPos.x - perpX, y: endPos.y - perpY },
                      { x: endPos.x + perpX, y: endPos.y + perpY }
                    ];
                    
                    overlayCtx.save();
                    overlayCtx.translate(deps.viewTransformRef.current.offsetX, deps.viewTransformRef.current.offsetY);
                    overlayCtx.scale(deps.viewTransformRef.current.scale, deps.viewTransformRef.current.scale);
                    
                    overlayCtx.globalAlpha = tools.currentTool === 'eraser' 
                      ? (tools.eraserSettings?.opacity || 1)
                      : (tools.brushSettings.opacity || 1);
                    overlayCtx.globalCompositeOperation = 'source-over';
                    
                    // Determine colors for width preview
                    const numColorsWid = Math.max(2, Math.min(64, tools.brushSettings.colors || 2));
                    let sampledColors: string[] = [];
                    const presetIdWid = tools.brushSettings.rectGradientPresetId || 'none';
                    if (presetIdWid !== 'none') {
                      const stops = getPresetStops(presetIdWid) || [];
                      sampledColors = resampleStopsToColors(stops, numColorsWid);
                    } else {
                      sampledColors = sampleColorsAlongLine(
                        startPos.x,
                        startPos.y,
                        endPos.x,
                        endPos.y,
                        numColorsWid
                      );
                    }
                    
                    // Create gradient for preview
                    const gradient = overlayCtx.createLinearGradient(startPos.x, startPos.y, endPos.x, endPos.y);
                    
                    if (sampledColors.length > 0) {
                      sampledColors.forEach((color, index) => {
                        const position = sampledColors.length === 1 ? 0 : index / (sampledColors.length - 1);
                        gradient.addColorStop(position, color);
                      });
                    } else {
                      gradient.addColorStop(0, tools.brushSettings.color);
                      gradient.addColorStop(1, tools.brushSettings.color);
                    }
                    
                    overlayCtx.fillStyle = gradient;
                    overlayCtx.beginPath();
                    overlayCtx.moveTo(corners[0].x, corners[0].y);
                    overlayCtx.lineTo(corners[1].x, corners[1].y);
                    overlayCtx.lineTo(corners[2].x, corners[2].y);
                    overlayCtx.lineTo(corners[3].x, corners[3].y);
                    overlayCtx.closePath();
                    overlayCtx.fill();
                    
                    overlayCtx.restore();
                  }
                }
              }
              if (deps.previewAnimationFrameRef) {
                deps.previewAnimationFrameRef.current = null;
              }
            });
          }
        }
        return;
      }
      
      // Normal brush or shape mode
      if (tools.shapeMode && drawingHandlers.isDrawingShapeRef.current) {
        let shapeWorld = worldPos;
        if (event.shiftKey) {
          const pts = drawingHandlers.shapePointsRef?.current || [];
          if (pts.length >= 1) {
            const anchor = pts[pts.length - 1];
            shapeWorld = snapPointToAngle(anchor, shapeWorld, 45);
          }
        }
        drawingHandlers.continueShapeDrawing(shapeWorld);
      } else {
        // Continue drawing immediately for responsive feel
        let brushWorld = worldPos;
        if (event.shiftKey) {
          // If Shift was pressed mid-stroke, and we don't yet have an anchor, use the last sampled point
          if (!shiftAnchorWorldPosRef.current) {
            shiftAnchorWorldPosRef.current = lastBrushSampleWorldPosRef.current || brushWorld;
          }
          const anchor = shiftAnchorWorldPosRef.current || strokeStartWorldPosRef.current;
          if (anchor) {
            brushWorld = snapPointToAngle(anchor, brushWorld, 45);
          }
        }
        drawingHandlers.continueDrawing(brushWorld, pressure);
        // Update last sampled point after drawing
        lastBrushSampleWorldPosRef.current = brushWorld;

        // Throttle the expensive redraw with RAF
        if (!deps.drawingAnimationFrameRef.current) {
          deps.drawingAnimationFrameRef.current = requestAnimationFrame(() => {
            const canvas = canvasRef.current;
            if (canvas) {
              // Use the same context options as the main canvas for consistency
              const ctx = canvas.getContext('2d', { 
                willReadFrequently: true,
                alpha: true,
                desynchronized: true 
              });
              if (ctx) {
                deps.draw(ctx, deps.viewTransformRef.current);
              }
            }
            deps.drawingAnimationFrameRef.current = null;
          });
        }
      }
    }
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLCanvasElement>) => {
    // Clear pointer down state
    isMouseDownRef.current = false;
    // Reset snapping anchors at end of action
    strokeStartWorldPosRef.current = null;
    shiftAnchorWorldPosRef.current = null;
    lastBrushSampleWorldPosRef.current = null;
    // quiet
    
    // Release pointer capture
    (event.target as HTMLCanvasElement).releasePointerCapture(event.pointerId);

    pointerInsideCanvas = isPointerWithinCanvas(event.clientX, event.clientY);
    
    // Cancel any pending drawing animation frame
    if (deps.drawingAnimationFrameRef.current) {
      cancelAnimationFrame(deps.drawingAnimationFrameRef.current);
      deps.drawingAnimationFrameRef.current = null;
    }
    
    // Cancel any pending preview animation frame
    if (deps.previewAnimationFrameRef && deps.previewAnimationFrameRef.current) {
      cancelAnimationFrame(deps.previewAnimationFrameRef.current);
      deps.previewAnimationFrameRef.current = null;
    }

    // Cancel any pending move RAF batch
    if (scheduledMoveRAF != null) {
      cancelAnimationFrame(scheduledMoveRAF);
      scheduledMoveRAF = null;
      lastMoveEvent = null;
    }
    
    // Clear overlay canvas
    const linesStateOnPointerUp = useAppStore.getState().contourLinesState;
    const overlayCanvas = overlayCanvasRef.current;
    const isLines2Previewing =
      linesStateOnPointerUp.variant === 'lines2' &&
      (linesStateOnPointerUp.stage === 'awaitingAngle' ||
        linesStateOnPointerUp.stage === 'awaitingConvergenceA' ||
        linesStateOnPointerUp.stage === 'awaitingConvergenceB');

    if (
      overlayCanvas &&
      !isLines2Previewing &&
      linesStateOnPointerUp.stage !== 'awaitingAnchorA'
    ) {
      const overlayCtx = overlayCanvas.getContext('2d');
      if (overlayCtx) {
        overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
      }
    }
    
    const mousePos = getMousePos(event);
    const pointerWorldPos = pan.screenToWorld(mousePos.x, mousePos.y, canvas?.zoom || 1);

    const contourStateOnUp = useAppStore.getState().contourLinesState;
    if (contourStateOnUp.stage === 'awaitingAnchorA') {
      const { basis } = contourStateOnUp;
      if (!basis) {
        resetContourLinesState();
        clearOverlayCanvas();
        return;
      }

      const brushDefaultSpacing = tools.brushSettings.brushShape === BrushShape.NEW_SHAPE_FILL
        ? clampNewShapeFillSpacing((tools.brushSettings.contourSpacing || 5) * 2)
        : clampContourSpacing((tools.brushSettings.contourSpacing || 5) * 2);
      const { spacing, pointerDistance } = resolveContourSpacing(
        basis,
        pointerWorldPos,
        contourStateOnUp,
        brushDefaultSpacing
      );

      const spacingValue = tools.brushSettings.brushShape === BrushShape.NEW_SHAPE_FILL
        ? clampNewShapeFillSpacing(spacing)
        : clampContourSpacing(spacing);
      const centroid = tools.brushSettings.brushShape === BrushShape.NEW_SHAPE_FILL
        ? computeNewShapeFillCenter(contourStateOnUp.shapePoints, contourStateOnUp.randomSeed ?? undefined)
        : (contourStateOnUp.centroid ?? computePolygonCentroid(contourStateOnUp.shapePoints));

      setContourLinesState({
        previewSpacing: spacingValue,
        spacingReferenceDistance: pointerDistance,
        spacingReferenceSpacing: spacingValue,
        centroid,
      });

      drawContourLinesPreview(spacingValue, spacingValue, {
        shapePoints: contourStateOnUp.shapePoints,
        basis: basis as ContourBasis,
        stage: 'awaitingAnchorA',
      });
      logContourFillDebug('spacing-preview', {
        mode: tools.brushSettings.shapeGradientMode || 'contour',
        spacing: spacingValue,
      });

      finalizeContourLinesStroke(spacingValue, spacingValue);
      logContourFillDebug('spacing-finalized', {
        mode: tools.brushSettings.shapeGradientMode || 'contour',
        spacing: spacingValue,
      });
      return;
    }

    if (shapeHandler.handlePointerUp(event)) {
      return;
    }

    // Recolor/Brush sampling finalize on drag-release
    const rsFinalize = useAppStore.getState().recolorSampling;
    if (rsFinalize.active && rsFinalize.start) {
      const scaleFinalize = canvas?.zoom || 1;
      const worldPosFinalize = pan.screenToWorld(mousePos.x, mousePos.y, scaleFinalize);
      const startFinalize = rsFinalize.start;
      const endFinalize = { x: worldPosFinalize.x, y: worldPosFinalize.y };
      const samplesFinalize = Math.max(2, Math.min(32, rsFinalize.samples || 12));
      const colorsFinalize = sampleColorsAlongLine(startFinalize.x, startFinalize.y, endFinalize.x, endFinalize.y, samplesFinalize);
      const stopsFinalize = colorsFinalize.map((c, i) => ({ position: samplesFinalize === 1 ? 0 : i / (samplesFinalize - 1), color: cssColorToHex(c) }));
      // Configure directional mapping so the gradient flows along the sampled path
      const targetFinalize = rsFinalize.target || 'recolor';

      if (targetFinalize === 'recolor') {
        const layerFinalize = layers.find(l => l.id === activeLayerId);
        if (layerFinalize) {
          const managerFinalize = RecolorManager.getInstance();
          (async () => {
            try {
              if (!layerFinalize.colorCycleData?.recolorSettings) {
                const ok = await managerFinalize.processLayer(layerFinalize, {
                  quantizationMode: 'rgb332',
                  ditherMode: 'off',
                  cycleColors: 16,
                  gradientPreset: 'custom',
                  customGradient: stopsFinalize
                });
                if (!ok) throw new Error('processLayer failed');
              } else {
                managerFinalize.updateGradient(layerFinalize, stopsFinalize);
              }
              // Auto-play the recolor animation for this layer after applying gradient
              try {
                managerFinalize.playSingle(layerFinalize.id);
              } catch (e) {
                console.warn('Failed to auto-play recolor animation:', e);
              }
              // Remap palette index sequence to flow along sampled direction without changing pixel structure
              const dxFinalize = endFinalize.x - startFinalize.x;
              const dyFinalize = endFinalize.y - startFinalize.y;
              const angleFinalize = (Math.atan2(dyFinalize, dxFinalize) * 180) / Math.PI;
              try { managerFinalize.setPaletteDirectionalOrder(layerFinalize.id, angleFinalize); } catch {}
              try { managerFinalize.autoSetAnimationDirection(layerFinalize.id, angleFinalize); } catch {}
            } catch (e) {
              console.warn('Failed to apply sampled gradient', e);
            }
          })();
        }
      } else {
        try {
          useAppStore.getState().setBrushSettings({ colorCycleGradient: stopsFinalize });
        } catch {}
      }

      useAppStore.getState().stopRecolorSampling();
      return;
    }

    // SIMPLIFIED PANNING: End pan if we were panning
    if (pan.panState.isPanning) {
      pan.endPan();
      // Restore cursor based on space state
      if (isSpacePressedRef.current) {
        setCursorStyle('grab');
      } else {
        setCursorStyle(deps.defaultCursorStyle || 'none');
        updateBrushCursorVisibility();
      }
      void resumeAnimationAfterPan?.();
      return;
    }
    
    // Dispatch to state machine (only once) for normal interactions
    stateMachine.dispatch({ 
      type: 'MOUSE_UP',
      position: mousePos 
    });
    
    // Handle floating paste drag end
    if (deps.isDraggingFloatingPaste || floatingPasteDragStart.current) {
      setIsDraggingFloatingPaste(false);
      floatingPasteDragStart.current = null;
      floatingPasteOriginalPos.current = null;
      setCursorStyle(deps.defaultCursorStyle || 'none');
      updateBrushCursorVisibility();
      return;
    }
    
    // Handle selection
    if (interaction.state.isSelecting) {
      interaction.dispatch({ type: 'SELECTION_END' });
      const scale = canvas?.zoom || 1;
      let worldPos = pan.screenToWorld(mousePos.x, mousePos.y, scale);
      
      // Clamp world position to canvas bounds
      if (project) {
        worldPos = {
          x: Math.max(0, Math.min(project.width - 1, worldPos.x)),
          y: Math.max(0, Math.min(project.height - 1, worldPos.y))
        };
      }
      if (interaction.refs.selectionStart.current) {
        setSelectionBounds(interaction.refs.selectionStart.current, worldPos);
        if (tools.currentTool === 'custom') {
          deps.setCurrentTool('brush');
          clearSelection();
          updateBrushCursorVisibility(); // Show brush cursor again after custom brush selection
        }
      }
      interaction.refs.selectionStart.current = null;
      return;
    }
    
    // Handle drawing
    if (interaction.state.isDrawing) {
      // Rectangle gradient
      if (toolStateMachine.isRectangleGradient) {
        // Handle the state transition
        const shouldFinalize = toolStateMachine.handleRectangleGradientMouseUp();
        
        if (shouldFinalize) {
          // Clear the overlay canvas since we're finalizing
          const overlayCanvas = overlayCanvasRef.current;
          if (overlayCanvas) {
            const overlayCtx = overlayCanvas.getContext('2d');
            if (overlayCtx) {
              overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
            }
          }
          
          // Reset the tool state and end drawing
          toolStateMachine.resetRectangleGradient();
          interaction.dispatch({ type: 'DRAWING_END' });
        }
        // Don't end drawing state if we're still defining width
        return;
      }
      
      // Normal brush or shape mode
      interaction.dispatch({ type: 'DRAWING_END' });
      
      // Mark composite as dirty BEFORE finalization to ensure it updates
      compositeCanvasDirtyRef.current = true;
      
      if (tools.shapeMode && drawingHandlers.isDrawingShapeRef.current) {
        // Guard: require at least 3 points to finalize a polygon
        const shapePointCount = drawingHandlers.shapePointsRef.current.length;
        if (shapePointCount < 3) {
          // Keep collecting vertices with subsequent clicks
          return;
        }
        // Check if we need to enter direction selection mode for linear gradient
        const isColorCycleShape = tools.brushSettings.brushShape === BrushShape.COLOR_CYCLE_SHAPE;
        const isLinearFill = tools.brushSettings.colorCycleFillMode === 'linear';
        
        if (isColorCycleShape && isLinearFill && !drawingHandlers.isSelectingDirectionRef?.current) {
          // Don't finalize yet - enter direction selection mode
          
          // Call finalizeShapeDrawing which will set up direction selection mode
          drawingHandlers.finalizeShapeDrawing();
          // CRITICAL FIX: Check if we actually entered direction selection mode AFTER the call
          if (drawingHandlers.isSelectingDirectionRef?.current) {
            
            // Don't complete finalization yet - we're still in direction selection
            return;
          }
          
        }
        
        // Only proceed with finalization if NOT in direction selection mode
        if (!drawingHandlers.isSelectingDirectionRef?.current) {
          drawingHandlers.finalizeShapeDrawing();
          // Signal that finalization is complete
          stateMachine.finalizationComplete();
          
          // Force immediate composite regeneration after layer update
          if (compositeCanvasRef.current && project) {
            compositeLayersToCanvas(compositeCanvasRef.current);
            setCurrentOffscreenCanvas(compositeCanvasRef.current);
            compositeCanvasDirtyRef.current = false;
          }
          
          setNeedsRedraw(prev => prev + 1);
          
          // Restart color cycle animation if needed
          if (deps.restartColorCycleAnimation) {
            deps.restartColorCycleAnimation();
          }
        } else {
          
        }
      } else {
        // For regular drawing (non-shape mode), never skip save
        drawingHandlers.finalizeDrawing(false).then(() => {
          // Signal that finalization is complete
          stateMachine.finalizationComplete();
          
          // Use requestAnimationFrame to ensure the layer update has propagated
          requestAnimationFrame(() => {
            // Force immediate composite regeneration after layer update
            if (compositeCanvasRef.current && project) {
              compositeLayersToCanvas(compositeCanvasRef.current);
              setCurrentOffscreenCanvas(compositeCanvasRef.current);
              compositeCanvasDirtyRef.current = false;
              
              // Force immediate redraw
              const canvas = canvasRef.current;
              const ctx = canvas?.getContext('2d', { willReadFrequently: true });
              if (ctx) {
                deps.draw(ctx, deps.viewTransformRef.current);
              }
            }
          });
          
          // Restart color cycle animation if needed
          if (deps.restartColorCycleAnimation) {
            deps.restartColorCycleAnimation();
          }
        });
      }
    }

    updateBrushCursorVisibility();
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    // Keep handler minimal; batch work to next animation frame
    // Never drop updates while drawing shapes; RAF will still run at display rate
    // Persist the synthetic event just in case (React 17+ no-ops)
    if (isSpacePressedRef.current && isMouseDownRef.current && !pan.panState.isPanning) {
      processPointerMove(event);
      return;
    }

    event.persist();
    lastMoveEvent = event;
    if (scheduledMoveRAF == null) {
      scheduledMoveRAF = requestAnimationFrame(() => {
        const e = lastMoveEvent;
        scheduledMoveRAF = null;
        if (e) {
          processPointerMove(e);
        }
      });
    }
  };

  const handlePointerEnter = () => {
    pointerInsideCanvas = true;
    updateBrushCursorVisibility(true);
  };

  const handlePointerLeave = () => {
    pointerInsideCanvas = false;
    updateBrushCursorVisibility(false);
    if (pan.panState.isPanning) {
      pan.endPan();
      void resumeAnimationAfterPan?.();
    }
  };

  const handlePointerCancel = (event: React.PointerEvent<HTMLCanvasElement>) => {
    // Handle pointer cancel (e.g., stylus moving out of range)
    isMouseDownRef.current = false;
    (event.target as HTMLCanvasElement).releasePointerCapture(event.pointerId);

    pointerInsideCanvas = isPointerWithinCanvas(event.clientX, event.clientY);
    updateBrushCursorVisibility();

    if (pan.panState.isPanning) {
      pan.endPan();
      void resumeAnimationAfterPan?.();
    }

    // Cancel any pending move RAF batch on cancel
    if (scheduledMoveRAF != null) {
      cancelAnimationFrame(scheduledMoveRAF);
      scheduledMoveRAF = null;
      lastMoveEvent = null;
    }
  };

  return {
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
    handlePointerEnter,
    handlePointerLeave,
    handlePointerCancel
  };
};
