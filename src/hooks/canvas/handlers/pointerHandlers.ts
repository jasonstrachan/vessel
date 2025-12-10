'use client';

import React from 'react';
import { useAppStore } from '@/stores/useAppStore';
import { clearColorCycleRegion } from '@/stores/helpers/colorCycleSelection';
// ---- ContourLines DEBUG ----------------------------------
const CL_DEBUG_STORAGE_KEY = 'vessel.debug.cl';

const invalidateCompositeAfterSelectionMutation = ({
  compositeCanvasDirtyRef,
  setLayersNeedRecomposition,
  setNeedsRedraw,
  canvasRef,
  viewTransformRef,
  draw,
}: {
  compositeCanvasDirtyRef: React.MutableRefObject<boolean>;
  setLayersNeedRecomposition?: (value: boolean) => void;
  setNeedsRedraw: React.Dispatch<React.SetStateAction<number>>;
  canvasRef: React.RefObject<HTMLCanvasElement>;
  viewTransformRef: React.MutableRefObject<{ scale: number; offsetX: number; offsetY: number }>;
  draw: (ctx: CanvasRenderingContext2D, transform: { scale: number; offsetX: number; offsetY: number }) => void;
}) => {
  const store = useAppStore.getState();
  if (store.currentCompositeBitmap) {
    store.setCurrentCompositeBitmap(null);
  }

  setLayersNeedRecomposition?.(true);
  compositeCanvasDirtyRef.current = true;

  setNeedsRedraw((prev) => prev + 1);

  const canvas = canvasRef.current;
  const ctx = canvas?.getContext('2d', { willReadFrequently: true });
  if (ctx) {
    draw(ctx, viewTransformRef.current);
  }
};

const shouldEnableContourDebug = (): boolean => {
  if (typeof globalThis === 'undefined') return false;
  const globalAny = globalThis as { __CL_DEBUG?: unknown; localStorage?: Storage };
  const flag = globalAny.__CL_DEBUG;
  if (typeof flag === 'boolean') return flag;
  try {
    const stored = globalAny.localStorage?.getItem(CL_DEBUG_STORAGE_KEY);
    if (stored != null) {
      const enabled = stored === '1';
      globalAny.__CL_DEBUG = enabled;
      return enabled;
    }
  } catch {
    // ignore storage access issues
  }
  const fallback = process.env.NODE_ENV !== 'production';
  globalAny.__CL_DEBUG = fallback;
  return fallback;
};
type CLLogEntry = {
  kind: 'log' | 'warn' | 'group';
  label?: string;
  payload?: unknown;
  args?: unknown[];
  timestamp: number;
};

const MAX_LOGS = 2000;

const getLogBuffer = (): CLLogEntry[] | null => {
  if (typeof globalThis === 'undefined') return null;
  const globalAny = globalThis as { __CL_LOGS?: CLLogEntry[] };
  if (!Array.isArray(globalAny.__CL_LOGS)) {
    globalAny.__CL_LOGS = [];
    const buf: CLLogEntry[] = globalAny.__CL_LOGS;
    const push = buf.push.bind(buf);
    globalAny.__CL_LOGS.push = (...entries: CLLogEntry[]): number => {
      const n = push(...entries);
      if (buf.length > MAX_LOGS) buf.splice(0, buf.length - MAX_LOGS);
      return n;
    };
  }
  return globalAny.__CL_LOGS ?? null;
};

const logBuffer = getLogBuffer();

const rawLog = typeof console !== 'undefined' && typeof console.log === 'function'
  ? console.log.bind(console)
  : (..._args: unknown[]) => {
    void _args;
  };
const rawWarn = typeof console !== 'undefined' && typeof console.warn === 'function'
  ? console.warn.bind(console)
  : (..._args: unknown[]) => {
    void _args;
  };
const rawGroupCollapsed = typeof console !== 'undefined' && typeof console.groupCollapsed === 'function'
  ? console.groupCollapsed.bind(console)
  : (..._args: unknown[]) => {
    void _args;
  };
const rawGroupEnd = typeof console !== 'undefined' && typeof console.groupEnd === 'function'
  ? console.groupEnd.bind(console)
  : () => {};

const ensureCLDebugBridge = () => {
  if (typeof globalThis === 'undefined') return;
  const globalAny = globalThis as { __CL_DEBUG?: boolean; __setCLDebug?: (enabled: boolean) => void; localStorage?: Storage };
  if (!globalAny.__setCLDebug) {
    globalAny.__setCLDebug = (enabled: boolean) => {
      globalAny.__CL_DEBUG = enabled;
      try {
        globalAny.localStorage?.setItem(CL_DEBUG_STORAGE_KEY, enabled ? '1' : '0');
      } catch {
        // storage may be unavailable (e.g., private mode)
      }
      rawLog('[ContourDebug]', 'CL debug flag updated', enabled);
    };
  }

  if (typeof globalAny.__CL_DEBUG !== 'boolean') {
    try {
      const stored = globalAny.localStorage?.getItem(CL_DEBUG_STORAGE_KEY);
      if (stored != null) {
        globalAny.__CL_DEBUG = stored === '1';
      } else {
        globalAny.__CL_DEBUG = process.env.NODE_ENV !== 'production';
      }
    } catch {
      globalAny.__CL_DEBUG = process.env.NODE_ENV !== 'production';
    }
  }
};

ensureCLDebugBridge();

const cl = {
  log: (...a: unknown[]) => {
    if (!shouldEnableContourDebug()) return;
    logBuffer?.push({ kind: 'log', args: a, timestamp: Date.now() });
    rawLog('%c[CL]', 'color:#6cf', ...a);
  },
  warn: (...a: unknown[]) => {
    if (!shouldEnableContourDebug()) return;
    logBuffer?.push({ kind: 'warn', args: a, timestamp: Date.now() });
    rawWarn('%c[CL]', 'color:#fc6', ...a);
  },
  grp: (label: string, data?: unknown) => {
    if (!shouldEnableContourDebug()) return () => {};
    logBuffer?.push({ kind: 'group', label, payload: data, timestamp: Date.now() });
    rawLog('%c[CL]%c ' + label, 'color:#6cf', 'color:inherit', data ?? '');
    rawGroupCollapsed('%c[CL]%c ' + label, 'color:#6cf', 'color:inherit');
    if (data) rawLog('%c[CL]', 'color:#6cf', data);
    return () => rawGroupEnd();
  },
};
// -----------------------------------------------------------
import { flushAndSetCurrentTool } from '@/utils/toolSwitch';
import { isStrokeBrush, isShapeFillBrush } from '@/utils/brushCategories';
import { isColorCycleBrush } from '@/utils/colorCycleGradients';
import { RecolorManager } from '../../../lib/colorCycle/RecolorManager';
import type {
  ContourLinesBasis,
  ContourLinesStage,
  ContourLinesState,
  EventHandlerDependencies,
  PointerHandlers,
} from '../utils/types';
import { BrushShape, type BrushSettings } from '../../../types';
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
import { getPresetStops } from '../../../utils/gradientPresets';
import { createShapeToolHandler } from './shapes/ShapeToolHandler';
import { logContourFillDebug } from './utils/logContourFillDebug';
import { captureColorCycleBrushState } from '@/history/helpers/colorCycle';
import { commitLayerHistory, cloneLayerImageData } from '@/history/helpers/layerHistory';
import {
  captureSelectionSnapshot,
  commitSelectionHistory,
  cloneSelectionSnapshot,
} from '@/history/helpers/selectionHistory';
import { captureSelectionBitmap } from '@/stores/helpers/selectionCapture';
import type { SelectionSnapshot } from '@/history/selectionState';

type VerticalSpacingMapperConfig = {
  centroid: { x: number; y: number };
  referenceDistance: number;
  referenceValue: number;
  bounds: { min: number; max: number; exponent?: number };
  distanceScale?: number;
};

type VerticalSpacingMapperResult = {
  value: number;
  distance: number;
};

const createVerticalSpacingMapper = (config: VerticalSpacingMapperConfig) => {
  const baseDistance = Math.max(config.referenceDistance, 1e-3);
  const clampValue = (value: number) => Math.min(
    Math.max(value, config.bounds.min),
    config.bounds.max
  );
  return (point: { x: number; y: number }): VerticalSpacingMapperResult => {
    const deltaY = Math.abs(point.y - config.centroid.y) * (config.distanceScale ?? 1);
    const distance = Math.max(deltaY, 1e-3);
    const ratio = distance / baseDistance;
    const value = clampValue(config.referenceValue * ratio);
    return { value, distance };
  };
};

export const createDefaultContourLinesState = (): ContourLinesState => ({
  stage: 'idle',
  shapePoints: [],
  fillColor: undefined,
  basis: null,
  spacingA: null,
  spacingB: null,
  previewSpacing: null,
  variant: 'legacy',
  lineAngle: null,
  convergenceA: null,
  convergenceB: null,
  centroid: null,
  spacingReferenceDistance: null,
  spacingReferenceSpacing: null,
  randomSeed: null,
});

const isAdvancedShapeBrush = (brushShape?: BrushShape | null): boolean =>
  brushShape === BrushShape.CONTOUR_POLYGON ||
  brushShape === BrushShape.CONTOUR_LINES2 ||
  brushShape === BrushShape.RECTANGLE_GRADIENT ||
  brushShape === BrushShape.POLYGON_GRADIENT ||
  brushShape === BrushShape.COLOR_CYCLE_SHAPE ||
  brushShape === BrushShape.SHAPE_FILL;

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
    setSelectionBounds,
    clearSelection,
    setCurrentOffscreenCanvas,
    compositeLayersToCanvas,
    updateLayer,
    setIsDraggingFloatingPaste,
    floatingPasteDragStart,
    floatingPasteOriginalPos,
    setCursorStyle,
    setShowBrushCursor,
    setCursorPosition,
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
    sampleColorAtPosition,
    sampleColorsAlongLine,
    getMousePos,
    compositeCanvasDirtyRef,
    setNeedsRedraw,
    viewTransformRef,
    draw,
    setLayersNeedRecomposition,
    pauseAnimationForPan,
    resumeAnimationAfterPan,
    restartColorCycleAnimation,
    dynamicDepsRef,
    contourLinesStateRef,
    contourLinesDefaultsCacheRef,
    contourLinesFinalizingRef,
    setCustomBrushFreehandPath,
  } = deps;

  type Point = { x: number; y: number };
  type CaptureRegion = { x: number; y: number; width: number; height: number };
  type FreehandBounds = { minX: number; minY: number; maxX: number; maxY: number } | null;
  type FreehandCaptureState = {
    active: boolean;
    pointerId: number | null;
    points: Point[];
    bounds: FreehandBounds;
  };

  const freehandCaptureState: FreehandCaptureState = {
    active: false,
    pointerId: null,
    points: [],
    bounds: null,
  };

  const CAPTURE_PADDING_PX = 2;
  const PREVIEW_WORLD_PADDING = 2;
  const PREVIEW_DITHER_PADDING_SCREEN = 3;
  // Allow larger previews before we have to downscale (prevents dither holes collapsing on big shapes)
  const PREVIEW_DITHER_BUFFER_SIZE = 2048;

  const ensurePointRef = (
    ref: React.MutableRefObject<Point | null> | undefined
  ): React.MutableRefObject<Point | null> => {
    if (ref) return ref;
    const fallback: React.MutableRefObject<Point | null> = { current: null };
    return fallback;
  };

  const computeCaptureRegionFromPoints = (
    points: Array<Point> | null | undefined,
    padding: number,
    project: { width: number; height: number } | null
  ): CaptureRegion | undefined => {
    if (!project || !points || points.length === 0) {
      return undefined;
    }
    let minX = points[0].x;
    let maxX = points[0].x;
    let minY = points[0].y;
    let maxY = points[0].y;
    for (let i = 1; i < points.length; i += 1) {
      const pt = points[i];
      if (!pt) continue;
      if (pt.x < minX) minX = pt.x;
      if (pt.x > maxX) maxX = pt.x;
      if (pt.y < minY) minY = pt.y;
      if (pt.y > maxY) maxY = pt.y;
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

  const resetFreehandCaptureState = () => {
    freehandCaptureState.active = false;
    freehandCaptureState.pointerId = null;
    freehandCaptureState.points = [];
    freehandCaptureState.bounds = null;
  };

  const drawFreehandCapturePreview = () => {
    const overlayCanvas = overlayCanvasRef.current;
    const overlayCtx = overlayCanvas?.getContext('2d');
    if (!overlayCanvas || !overlayCtx) {
      return;
    }

    overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);

    if (!freehandCaptureState.active || freehandCaptureState.points.length < 2) {
      return;
    }

    const transform = deps.viewTransformRef.current;
    overlayCtx.save();
    overlayCtx.translate(transform.offsetX, transform.offsetY);
    overlayCtx.scale(transform.scale, transform.scale);

    const safeScale = Math.max(transform.scale, 0.001);
    const points = freehandCaptureState.points;
    overlayCtx.beginPath();
    overlayCtx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i += 1) {
      overlayCtx.lineTo(points[i].x, points[i].y);
    }
    overlayCtx.closePath();
    overlayCtx.fillStyle = 'rgba(255, 255, 255, 0.08)';
    overlayCtx.strokeStyle = '#8fd3ff';
    overlayCtx.lineWidth = Math.max(0.75, 1.5 / safeScale);
    overlayCtx.fill();
    overlayCtx.stroke();
    overlayCtx.restore();
  };

  const startFreehandCapture = (pointerId: number, start: Point) => {
    freehandCaptureState.active = true;
    freehandCaptureState.pointerId = pointerId;
    freehandCaptureState.points = [start];
    freehandCaptureState.bounds = {
      minX: start.x,
      minY: start.y,
      maxX: start.x,
      maxY: start.y,
    };
    setCustomBrushFreehandPath(null);
    drawFreehandCapturePreview();
  };

  const appendFreehandPoint = (point: Point) => {
    if (!freehandCaptureState.active) {
      return;
    }
    const points = freehandCaptureState.points;
    const last = points[points.length - 1];
    if (last) {
      const dx = point.x - last.x;
      const dy = point.y - last.y;
      if (dx * dx + dy * dy < 0.25) {
        return;
      }
    }
    points.push(point);
    const bounds = freehandCaptureState.bounds;
    if (bounds) {
      bounds.minX = Math.min(bounds.minX, point.x);
      bounds.minY = Math.min(bounds.minY, point.y);
      bounds.maxX = Math.max(bounds.maxX, point.x);
      bounds.maxY = Math.max(bounds.maxY, point.y);
    } else {
      freehandCaptureState.bounds = {
        minX: point.x,
        minY: point.y,
        maxX: point.x,
        maxY: point.y,
      };
    }
    drawFreehandCapturePreview();
  };

  const completeFreehandCapture = () => {
    if (!freehandCaptureState.active) {
      return false;
    }

    const overlayCanvas = overlayCanvasRef.current;
    overlayCanvas?.getContext('2d')?.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);

    const points = freehandCaptureState.points.slice();
    const bounds = freehandCaptureState.bounds;
    resetFreehandCaptureState();

    if (!bounds || points.length < 3) {
      setCustomBrushFreehandPath(null);
      return false;
    }

    const startX = Math.max(0, Math.floor(bounds.minX));
    const startY = Math.max(0, Math.floor(bounds.minY));
    const endX = Math.ceil(bounds.maxX);
    const endY = Math.ceil(bounds.maxY);
    const width = Math.max(1, endX - startX);
    const height = Math.max(1, endY - startY);

    if (width <= 1 || height <= 1) {
      setCustomBrushFreehandPath(null);
      return false;
    }

    setCustomBrushFreehandPath({
      points,
      bounds: { x: startX, y: startY, width, height },
    });
    return true;
  };

  const cancelFreehandCapture = () => {
    const overlayCanvas = overlayCanvasRef.current;
    overlayCanvas?.getContext('2d')?.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
    resetFreehandCaptureState();
    setCustomBrushFreehandPath(null);
  };

  const strokeStartWorldPosRef = ensurePointRef(deps.snapStrokeStartRef);
  const shiftAnchorWorldPosRef = ensurePointRef(deps.snapShiftAnchorRef);
  const lastBrushSampleWorldPosRef = ensurePointRef(deps.snapLastBrushSampleRef);
  let pendingSelectionHistory:
    | {
        before: SelectionSnapshot;
        description: string;
        meta?: Record<string, unknown>;
      }
    | null = null;

  if (!contourLinesStateRef || !contourLinesDefaultsCacheRef || !contourLinesFinalizingRef || !dynamicDepsRef) {
    throw new Error('Missing contour lines refs in pointer handler dependencies');
  }

  const getDynamicDeps = () => dynamicDepsRef.current;

  const customBrushPreviewCache: {
    key: string | null;
    canvas: HTMLCanvasElement | null;
  } = {
    key: null,
    canvas: null,
  };

  const previewDitherBufferRef = {
    canvas: typeof document !== 'undefined' ? document.createElement('canvas') : null,
    ctx: null as CanvasRenderingContext2D | null,
  };

  if (previewDitherBufferRef.canvas) {
    previewDitherBufferRef.canvas.width = PREVIEW_DITHER_BUFFER_SIZE;
    previewDitherBufferRef.canvas.height = PREVIEW_DITHER_BUFFER_SIZE;
    previewDitherBufferRef.ctx = previewDitherBufferRef.canvas.getContext('2d', { willReadFrequently: true });
  }

  const getCustomBrushPreviewCanvas = (settings: BrushSettings): HTMLCanvasElement | null => {
    const tip = settings.currentBrushTip;
    if (typeof document === 'undefined' || !tip || !tip.imageData) {
      return null;
    }

    const baseWidth = tip.naturalWidth ?? tip.width ?? tip.imageData.width;
    const baseHeight = tip.naturalHeight ?? tip.height ?? tip.imageData.height;
    const maxDimension = (tip.maxDimension ?? Math.max(baseWidth, baseHeight)) || 1;
    const targetSize = Math.max(1, settings.size ?? maxDimension);
    const scale = targetSize / maxDimension;
    const scaledWidth = Math.max(1, Math.round(baseWidth * scale));
    const scaledHeight = Math.max(1, Math.round(baseHeight * scale));
    const tintable = Boolean(tip.isColorizable || settings.useSwatchColor || settings.customBrushColorCycle);
    const colorKey = tintable ? settings.color : 'native';
    const cacheKey = `${tip.brushId ?? 'custom-tip'}:${scaledWidth}x${scaledHeight}:${colorKey}:${tintable ? 'tint' : 'raw'}`;

    if (customBrushPreviewCache.key === cacheKey && customBrushPreviewCache.canvas) {
      return customBrushPreviewCache.canvas;
    }

    const tipCanvas = document.createElement('canvas');
    tipCanvas.width = tip.imageData.width;
    tipCanvas.height = tip.imageData.height;
    const tipCtx = tipCanvas.getContext('2d');
    if (!tipCtx) {
      return null;
    }
    tipCtx.putImageData(tip.imageData, 0, 0);

    if (tintable) {
      tipCtx.globalCompositeOperation = 'source-atop';
      tipCtx.fillStyle = settings.color || '#ffffff';
      tipCtx.fillRect(0, 0, tipCanvas.width, tipCanvas.height);
      tipCtx.globalCompositeOperation = 'source-over';
    }

    const patternCanvas = document.createElement('canvas');
    patternCanvas.width = scaledWidth;
    patternCanvas.height = scaledHeight;
    const patternCtx = patternCanvas.getContext('2d');
    if (!patternCtx) {
      return null;
    }
    patternCtx.imageSmoothingEnabled = false;
    try {
      patternCtx.imageSmoothingQuality = 'low';
    } catch {}
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

    customBrushPreviewCache.key = cacheKey;
    customBrushPreviewCache.canvas = patternCanvas;
    return patternCanvas;
  };

  const computeOverlayDitherRegion = (
    points: Point[],
    overlay: HTMLCanvasElement
  ): CaptureRegion | null => {
    if (!points.length) {
      return null;
    }

    const scale = Math.max(0.001, viewTransformRef.current.scale || 1);

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    for (let i = 0; i < points.length; i += 1) {
      const pt = points[i];
      if (!pt) continue;
      const screenPos = pan.worldToScreen(pt.x, pt.y, scale);
      if (!Number.isFinite(screenPos.x) || !Number.isFinite(screenPos.y)) {
        continue;
      }
      minX = Math.min(minX, screenPos.x);
      maxX = Math.max(maxX, screenPos.x);
      minY = Math.min(minY, screenPos.y);
      maxY = Math.max(maxY, screenPos.y);
    }

    if (
      !Number.isFinite(minX) ||
      !Number.isFinite(maxX) ||
      !Number.isFinite(minY) ||
      !Number.isFinite(maxY)
    ) {
      return null;
    }

    const pad = Math.max(
      PREVIEW_DITHER_PADDING_SCREEN,
      Math.ceil(PREVIEW_WORLD_PADDING * scale)
    );

    const x = Math.max(0, Math.floor(minX) - pad);
    const y = Math.max(0, Math.floor(minY) - pad);
    const right = Math.min(overlay.width, Math.ceil(maxX) + pad);
    const bottom = Math.min(overlay.height, Math.ceil(maxY) + pad);

    if (right <= x || bottom <= y) {
      return null;
    }

    return {
      x,
      y,
      width: Math.max(1, right - x),
      height: Math.max(1, bottom - y),
    };
  };

  const drawSimpleShapePreviewOnOverlay = () => {
    const overlay = overlayCanvasRef.current;
    if (!overlay) {
      return;
    }
    const ctx = overlay.getContext('2d');
    if (!ctx) {
      return;
    }

    const points = drawingHandlers.shapePointsRef?.current ?? [];
    if (!points || points.length < 2) {
      ctx.clearRect(0, 0, overlay.width, overlay.height);
      return;
    }

    const { tools, layers, activeLayerId } = getDynamicDeps();
    const brushSettings = tools.brushSettings;
    const isPixelBrush =
      brushSettings.brushShape === BrushShape.PIXEL_ROUND ||
      (brushSettings.brushShape === BrushShape.SQUARE && brushSettings.antialiasing === false);
    const activeLayer = layers.find((layer) => layer.id === activeLayerId);
    const isColorCycleLayer = activeLayer?.layerType === 'color-cycle';

    ctx.clearRect(0, 0, overlay.width, overlay.height);

    const strokeColor = brushSettings.color || '#ffffff';
    const strokeWidth = Math.max(1, brushSettings.size ?? 1);
    const activeBrushShape = brushSettings.brushShape ?? BrushShape.ROUND;
    const isColorCycleShapePreview = activeBrushShape === BrushShape.COLOR_CYCLE_SHAPE;
    const skipOutline =
      isColorCycleShapePreview ||
      isShapeFillBrush(activeBrushShape) ||
      (isStrokeBrush(activeBrushShape) && !isColorCycleBrush(activeBrushShape));
    const isCustomBrushPreview = brushSettings.brushShape === BrushShape.CUSTOM;

    const overlayCtx = ctx;
    const transform = deps.viewTransformRef.current;
    const scale = Math.max(0.001, transform.scale || 1);

    const bufferCanvas = previewDitherBufferRef.canvas;
    const bufferCtx = previewDitherBufferRef.ctx;

    const overlayRegion = computeOverlayDitherRegion(points, overlay);
    if (!bufferCtx || !bufferCanvas || !overlayRegion) {
      overlayCtx.save();
      overlayCtx.translate(transform.offsetX, transform.offsetY);
      overlayCtx.scale(transform.scale, transform.scale);
      overlayCtx.lineJoin = 'round';
      overlayCtx.lineCap = 'round';
      overlayCtx.imageSmoothingEnabled = !isPixelBrush;
      overlayCtx.beginPath();
      const moveToPoint = (point: Point) => {
        if (isPixelBrush) {
          overlayCtx.moveTo(Math.round(point.x), Math.round(point.y));
        } else {
          overlayCtx.moveTo(point.x, point.y);
        }
      };
      const lineToPoint = (point: Point) => {
        if (isPixelBrush) {
          overlayCtx.lineTo(Math.round(point.x), Math.round(point.y));
        } else {
          overlayCtx.lineTo(point.x, point.y);
        }
      };
      moveToPoint(points[0]);
      for (let i = 1; i < points.length; i += 1) {
        lineToPoint(points[i]);
      }
      overlayCtx.closePath();
      if (!skipOutline) {
        overlayCtx.strokeStyle = strokeColor;
        overlayCtx.lineWidth = strokeWidth;
        overlayCtx.globalAlpha = 1;
        overlayCtx.stroke();
      }
      overlayCtx.globalAlpha = 1;
      overlayCtx.fillStyle = strokeColor;
      overlayCtx.fill();
      overlayCtx.restore();
      return;
    }

    const worldWidth = overlayRegion.width / scale;
    const worldHeight = overlayRegion.height / scale;
    const worldMinX = (overlayRegion.x - transform.offsetX) / scale;
    const worldMinY = (overlayRegion.y - transform.offsetY) / scale;

    // Resize buffer to match *world* size (not screen size) so dithering stays stable at any zoom
    const targetW = Math.max(1, Math.min(PREVIEW_DITHER_BUFFER_SIZE, Math.ceil(worldWidth)));
    const targetH = Math.max(1, Math.min(PREVIEW_DITHER_BUFFER_SIZE, Math.ceil(worldHeight)));
    if (bufferCanvas.width !== targetW || bufferCanvas.height !== targetH) {
      bufferCanvas.width = targetW;
      bufferCanvas.height = targetH;
    }

    const scaleX = bufferCanvas.width / Math.max(worldWidth, 1e-3);
    const scaleY = bufferCanvas.height / Math.max(worldHeight, 1e-3);

    bufferCtx.save();
    bufferCtx.setTransform(1, 0, 0, 1, 0, 0);
    bufferCtx.clearRect(0, 0, bufferCanvas.width, bufferCanvas.height);
    bufferCtx.lineJoin = 'round';
    bufferCtx.lineCap = 'round';
    bufferCtx.imageSmoothingEnabled = !isPixelBrush;

    bufferCtx.translate(-worldMinX * scaleX, -worldMinY * scaleY);
    bufferCtx.scale(scaleX, scaleY);

    const moveToPoint = (point: Point) => {
      bufferCtx.moveTo(point.x, point.y);
    };
    const lineToPoint = (point: Point) => {
      bufferCtx.lineTo(point.x, point.y);
    };

    bufferCtx.beginPath();
    moveToPoint(points[0]);
    for (let i = 1; i < points.length; i += 1) {
      lineToPoint(points[i]);
    }
    bufferCtx.closePath();

    if (!skipOutline) {
      bufferCtx.strokeStyle = strokeColor;
      bufferCtx.lineWidth = strokeWidth;
      bufferCtx.globalAlpha = 1;
      bufferCtx.stroke();
    }

    if (isCustomBrushPreview) {
      const patternCanvas = getCustomBrushPreviewCanvas(brushSettings);
      if (patternCanvas) {
        const pattern = bufferCtx.createPattern(patternCanvas, 'repeat');
        if (pattern) {
          bufferCtx.imageSmoothingEnabled = false;
          bufferCtx.fillStyle = pattern;
        } else {
          bufferCtx.fillStyle = strokeColor;
        }
      } else {
        bufferCtx.fillStyle = strokeColor;
      }
    } else {
      bufferCtx.fillStyle = strokeColor;
    }

    bufferCtx.globalAlpha = 1;
    bufferCtx.fill();
    bufferCtx.restore();

    if (!isColorCycleLayer && bufferCtx) {
      // Re-read live settings so BG fill toggles apply to the preview too
      const liveDeps = getDynamicDeps();
      const liveBrushSettings = liveDeps.tools.brushSettings;
      const latestShapePressureRef = drawingHandlers.latestShapePressureRef;
      const lastNonZeroShapePressureRef = drawingHandlers.lastNonZeroShapePressureRef;
      const latestShapePixelSizeRef = drawingHandlers.latestShapePixelSizeRef;
      const maxShapePressureRef = drawingHandlers.maxShapePressureRef;
      const hadValidShapePressureRef = drawingHandlers.hadValidShapePressureRef;
      const liveDitherEnabled = Boolean(liveBrushSettings.ditherEnabled);
      const liveBgFillOn = liveBrushSettings.ditherBackgroundFill !== false;
      const effectivePressure =
        (lastNonZeroShapePressureRef?.current ?? 0) > 0.0001
          ? lastNonZeroShapePressureRef?.current ?? 0
          : maxShapePressureRef?.current ?? 0;
      const effectivePixelSize = hadValidShapePressureRef?.current
        ? latestShapePixelSizeRef?.current ?? undefined
        : undefined;

      if (liveDitherEnabled) {
        try {
        brushEngine?.applyStrokeDither(bufferCtx, {
          x: 0,
          y: 0,
          width: bufferCanvas.width,
          height: bufferCanvas.height,
        }, undefined, {
          // When BG fill is off, do not merge with the freshly painted fill
          mergeExisting: liveBgFillOn,
          overridePressure: effectivePressure,
          overridePixelSize: effectivePixelSize
        });
        } catch (error) {
        if (process.env.NODE_ENV !== 'production') {
          console.warn('[Vessel] Preview dithering failed', error);
        }
      }
      }
    }

    overlayCtx.save();
    overlayCtx.imageSmoothingEnabled = false;
    overlayCtx.drawImage(
      bufferCanvas,
      0,
      0,
      bufferCanvas.width,
      bufferCanvas.height,
      overlayRegion.x,
      overlayRegion.y,
      overlayRegion.width,
      overlayRegion.height
    );
    overlayCtx.restore();
  };

  drawingHandlers.setSimpleShapePreviewRenderer?.(drawSimpleShapePreviewOnOverlay);

  const logDynamicSnapshot = (label: string, extra: Record<string, unknown> = {}) => {
    if (!shouldEnableContourDebug()) return;
    const snapshot = getDynamicDeps();
    cl.log(label, {
      tool: snapshot.tools.currentTool,
      brushShape: snapshot.tools.brushSettings.brushShape,
      layer: snapshot.activeLayerId,
      projectSize: snapshot.project ? `${snapshot.project.width}x${snapshot.project.height}` : null,
      ...extra,
    });
  };

  const shouldPixelAlignCursor = (
    settings: { brushShape?: BrushShape; antialiasing?: boolean } | null | undefined
  ): boolean => {
    if (!settings) return false;
    if (settings.brushShape === BrushShape.PIXEL_ROUND) return true;
    return settings.brushShape === BrushShape.SQUARE && settings.antialiasing === false;
  };

  const alignPointToPixel = <T extends Point>(point: T, shouldAlign: boolean): T => {
    if (!shouldAlign) {
      return point;
    }
    const alignedX = Math.round(point.x);
    const alignedY = Math.round(point.y);
    if (alignedX === point.x && alignedY === point.y) {
      return point;
    }
    return { ...point, x: alignedX, y: alignedY };
  };

  const updateAlignedMousePosition = (
    worldPos: Point,
    rect: DOMRect | undefined | null,
    scale: number,
    alignToPixel: boolean
  ) => {
    const displayWorld = alignToPixel
      ? { x: worldPos.x + 0.5, y: worldPos.y + 0.5 }
      : worldPos;

    if (!rect) {
      setCursorPosition(displayWorld.x * scale, displayWorld.y * scale);
      return;
    }
    const screenPos = pan.worldToScreen(displayWorld.x, displayWorld.y, scale);
    setCursorPosition(rect.left + screenPos.x, rect.top + screenPos.y);
  };

  const setContourLinesState = (partialState: Partial<ContourLinesState>) => {
    contourLinesStateRef.current = {
      ...contourLinesStateRef.current,
      ...partialState,
      shapePoints: partialState.shapePoints
        ? [...partialState.shapePoints]
        : contourLinesStateRef.current.shapePoints,
    };
  };

  const resetContourLinesState = () => {
    contourLinesStateRef.current = createDefaultContourLinesState();
    contourLinesDefaultsCacheRef.current = null;
  };

  const keyForPoints = (pts: Array<{ x: number; y: number }>): string => {
    const first = pts[0];
    const last = pts[pts.length - 1];
    return pts.length + ':' + (first?.x|0) + ',' + (first?.y|0) + ':' + (last?.x|0) + ',' + (last?.y|0);
  };

  const resolveDistance = (centroid: Point, p: Point, angleRad?: number | null): number => {
    if (angleRad == null || !Number.isFinite(angleRad)) {
      return Math.abs(p.y - centroid.y);
    }
    const dx = p.x - centroid.x;
    const dy = p.y - centroid.y;
    // Distance along normal to line direction
    const nx = -Math.sin(angleRad);
    const ny = Math.cos(angleRad);
    return Math.abs(dx * nx + dy * ny);
  };

  const getLines2DefaultsCached = (
    pts: Array<{ x: number; y: number }>,
    basis: ContourLinesBasis | null | undefined
  ): ReturnType<typeof computeLines2Defaults> => {
    const key = keyForPoints(pts);
    let cache = contourLinesDefaultsCacheRef.current;
    if (!cache || cache.key !== key) {
      cache = { key, defaults: computeLines2Defaults(pts, basis ?? null) };
      contourLinesDefaultsCacheRef.current = cache;
    }
    return cache.defaults;
  };

  const initializeContourLinesState = (
    points: Array<{ x: number; y: number }>,
    opts: {
      variant: ContourLinesState['variant'];
      fillColor?: string;
      initialSpacing: number;
      randomSeed?: number;
    }
  ): boolean => {
    if (points.length < 3) {
      return false;
    }

    const preparedBasis = prepareContourLinesBasis(points);
    if (!preparedBasis) {
      return false;
    }

    let centroid = computePolygonCentroid(points);
    const randomSeed = typeof opts.randomSeed === 'number'
      ? opts.randomSeed
      : Math.floor(Math.random() * 0xffffffff);

    let stage: ContourLinesStage = 'awaitingAnchorA';
    let lineAngle: number | null = null;
    let convergenceA: { x: number; y: number } | null = null;
    let convergenceB: { x: number; y: number } | null = null;
    let basis: ContourLinesBasis = preparedBasis;

    if (opts.variant === 'lines2') {
      const defaults = computeLines2Defaults(points, preparedBasis);
      centroid = defaults.centroid;
      lineAngle = defaults.defaultAngle;
      convergenceA = defaults.convergenceA;
      convergenceB = defaults.convergenceB;
      basis = defaults.basis ?? preparedBasis;
      stage = 'awaitingAngle';
    }

    setContourLinesState({
      stage,
      variant: opts.variant ?? 'legacy',
      shapePoints: points,
      basis,
      centroid,
      fillColor: opts.fillColor,
      previewSpacing: opts.initialSpacing,
      spacingReferenceDistance: null,
      spacingReferenceSpacing: opts.initialSpacing,
      randomSeed,
      lineAngle,
      convergenceA,
      convergenceB,
    });

    logDynamicSnapshot('contour-init', {
      stage,
      variant: opts.variant,
      vertexCount: points.length,
      initialSpacing: opts.initialSpacing,
    });

    const endInitLog = cl.grp('init spacing mode', {
      stage,
      points: points.length,
      initialSpacing: opts.initialSpacing,
      centroid,
      variant: opts.variant,
    });
    endInitLog();

    drawContourLinesPreview(opts.initialSpacing, opts.initialSpacing, {
      shapePoints: points,
      basis: basis as ContourBasis,
      stage,
    });
    return true;
  };

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

  const clampContourSpacing = (value: number) => Math.min(MAX_LINE_SPACING, Math.max(MIN_LINE_SPACING, value));

  const VERTICAL_SPACING_BOUNDS = { min: MIN_LINE_SPACING, max: MAX_LINE_SPACING, exponent: 1.06 } as const;

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

    const centroid = state.centroid ?? computePolygonCentroid(points);
    const pointerVec = { x: pointer.x, y: pointer.y };
    const angleRad = state.lineAngle ?? undefined;
    const referenceDistance = state.spacingReferenceDistance ?? Math.max(
      resolveDistance(centroid, pointer, angleRad),
      1e-3
    );
    const referenceSpacing = state.spacingReferenceSpacing ?? clampContourSpacing(defaultSpacing);
    const mapper = createVerticalSpacingMapper({
      centroid,
      referenceDistance,
      referenceValue: referenceSpacing,
      bounds: VERTICAL_SPACING_BOUNDS,
    });

    const { value, distance } = mapper(pointerVec);

    return {
      spacing: clampContourSpacing(value),
      pointerDistance: distance,
      referenceDistance,
      referenceSpacing,
    };
  };

  type ContourBasis = NonNullable<ReturnType<typeof prepareContourLinesBasis>>;

  const extractSelectionAsFloatingPaste = (): {
    imageData: ImageData;
    position: Point;
    width: number;
    height: number;
    displayWidth: number;
    displayHeight: number;
    layerId: string;
    colorCycleIndices?: Uint8Array | null;
  } | null => {
    const { project, layers, activeLayerId, selectionStart, selectionEnd } = getDynamicDeps();

    if (!selectionStart || !selectionEnd || !project || !activeLayerId) {
      return null;
    }

    const activeLayer = layers.find((layer) => layer.id === activeLayerId) ?? null;
    const captureResult = captureSelectionBitmap({
      selectionStart,
      selectionEnd,
      project,
      layer: activeLayer,
      clearSource: true,
    });

    if (!captureResult || !captureResult.updatedLayerImageData) {
      return null;
    }

    const store = useAppStore.getState();
    if (activeLayer?.layerType === 'color-cycle') {
      clearColorCycleRegion(store, activeLayer, project, {
        x: captureResult.bounds.x,
        y: captureResult.bounds.y,
        width: captureResult.bounds.width,
        height: captureResult.bounds.height,
      });
      const eraseMask = activeLayer.colorCycleData?.eraseMask;
      const eraseMaskCtx = eraseMask?.getContext('2d', { willReadFrequently: true });
      eraseMaskCtx?.clearRect(
        captureResult.bounds.x,
        captureResult.bounds.y,
        captureResult.bounds.width,
        captureResult.bounds.height
      );
  } else if (activeLayer?.framebuffer) {
    const fbCtx = activeLayer.framebuffer.getContext('2d', { willReadFrequently: true });
    const canvasCtx = fbCtx as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
    if (canvasCtx && 'clearRect' in canvasCtx && 'getImageData' in canvasCtx) {
      const { x, y, width, height } = captureResult.bounds;
      canvasCtx.clearRect(x, y, width, height);
      const refreshed = canvasCtx.getImageData(
        0,
        0,
        activeLayer.framebuffer.width,
        activeLayer.framebuffer.height
      );
        updateLayer(activeLayerId, { imageData: refreshed });
      } else {
        updateLayer(activeLayerId, { imageData: captureResult.updatedLayerImageData });
      }
    } else {
      updateLayer(activeLayerId, { imageData: captureResult.updatedLayerImageData });
    }

    invalidateCompositeAfterSelectionMutation({
      compositeCanvasDirtyRef,
      setLayersNeedRecomposition,
      setNeedsRedraw,
      canvasRef,
      viewTransformRef,
      draw,
    });

    return {
      imageData: captureResult.selectionImageData,
      position: { x: captureResult.bounds.x, y: captureResult.bounds.y },
      width: captureResult.bounds.width,
      height: captureResult.bounds.height,
      displayWidth: captureResult.bounds.width,
      displayHeight: captureResult.bounds.height,
      layerId: activeLayerId,
      colorCycleIndices: captureResult.colorCycleIndices ?? null,
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
      ? { ...contourLinesStateRef.current, ...override }
      : contourLinesStateRef.current;

    const { basis, shapePoints } = contourState;
    if (!basis || shapePoints.length < 3) return;

    overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);

    overlayCtx.save();
    overlayCtx.translate(deps.viewTransformRef.current.offsetX, deps.viewTransformRef.current.offsetY);
    overlayCtx.scale(deps.viewTransformRef.current.scale, deps.viewTransformRef.current.scale);
    const safeScale = Math.max(deps.viewTransformRef.current.scale, 0.001);

    const { tools: currentTools } = getDynamicDeps();
    const shapeFillSession = useAppStore.getState().shapeFill.session;
    if (
      currentTools.brushSettings.brushShape === BrushShape.SHAPE_FILL ||
      !!shapeFillSession
    ) {
      overlayCtx.restore();
      return;
    }
    const sampledStrokeColor = currentTools.brushSettings.color;
    overlayCtx.lineWidth = Math.max(0.2, 0.45 / safeScale);
    overlayCtx.strokeStyle = sampledStrokeColor;
    overlayCtx.imageSmoothingEnabled = false;

    const center = contourState.centroid ?? computePolygonCentroid(shapePoints);

    const hardMax = basis?.maxDistance ?? 0;

    const maxDistance = Math.max(0.001, hardMax);
    const EDGE_EPS = 0.5; // keep at least one loop inside the polygon

    const constrainedStart = Math.min(Math.max(MIN_LINE_SPACING, spacingStart), maxDistance - EDGE_EPS);
    const constrainedEnd = spacingEnd == null
      ? undefined
      : Math.min(Math.max(MIN_LINE_SPACING, spacingEnd), maxDistance - EDGE_EPS);

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
            spacingOverride: constrainedEnd ?? constrainedStart,
            randomSeed: contourState.randomSeed ?? undefined,
            strokeColorOverride: sampledStrokeColor,
            previewDetail: 'full',
          }
        );
      }

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
  };

  const drawLines2Preview = (
    angle: number,
    convergenceA: { x: number; y: number },
    convergenceB: { x: number; y: number }
  ) => {
    const { tools } = getDynamicDeps();
    const overlayCanvas = overlayCanvasRef.current;
    const overlayCtx = overlayCanvas?.getContext('2d');
    if (!overlayCanvas || !overlayCtx) {
      return;
    }

    const contourState = contourLinesStateRef.current;
    const shapePoints = contourState.shapePoints;
    if (!shapePoints || shapePoints.length < 3) {
      return;
    }

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
      contourState.centroid ?? undefined
    );

    const first = shapePoints[0];
    if (first) {
      overlayCtx.save();
      overlayCtx.beginPath();
      overlayCtx.moveTo(first.x, first.y);
      for (let i = 1; i < shapePoints.length; i += 1) {
        overlayCtx.lineTo(shapePoints[i].x, shapePoints[i].y);
      }
      overlayCtx.closePath();
      overlayCtx.clip();

      for (const path of paths) {
        if (!path.points || path.points.length < 2) {
          continue;
        }
        overlayCtx.beginPath();
        overlayCtx.moveTo(path.points[0].x, path.points[0].y);
        for (let i = 1; i < path.points.length; i += 1) {
          overlayCtx.lineTo(path.points[i].x, path.points[i].y);
        }
        overlayCtx.stroke();
      }

      overlayCtx.restore();
    }

    overlayCtx.restore();
  };

  const finalizeContourLinesStroke = (spacingStart: number, spacingEnd: number) => {
    const { project } = getDynamicDeps();
    logDynamicSnapshot('contour-finalize-request', {
      spacingStart,
      spacingEnd,
      stage: contourLinesStateRef.current.stage,
      vertexCount: contourLinesStateRef.current.shapePoints.length,
    });
    if (contourLinesFinalizingRef.current) return;
    contourLinesFinalizingRef.current = true;

    const contourState = contourLinesStateRef.current;
    const shapePoints = contourState.shapePoints;
    const basis = contourState.basis;

    if (!brushEngine || !basis || !shapePoints || shapePoints.length < 3) {
      logDynamicSnapshot('contour-finalize-abort', {
        reason: !brushEngine
          ? 'missing-brush-engine'
          : !basis
            ? 'missing-basis'
            : 'insufficient-points',
        spacingStart,
        spacingEnd,
      });
      resetContourLinesState();
      clearOverlayCanvas();
      contourLinesFinalizingRef.current = false;
      return;
    }

    const EDGE_EPS = 0.5;
    const hardMax = Math.max(0.001, basis.maxDistance || spacingStart);
    const clampedSpacing = Math.min(Math.max(MIN_LINE_SPACING, spacingEnd ?? spacingStart), hardMax - EDGE_EPS);

    logContourFillDebug('finalizing-contour-fill', {
      spacingA: spacingStart,
      spacingB: spacingEnd,
      clampedSpacing,
      vertexCount: shapePoints.length,
    });

    drawingHandlers.initDrawingCanvas();
    const drawCtx = drawingHandlers.drawingCanvasRef.current?.getContext('2d', { willReadFrequently: true });
    if (!drawCtx) {
      logDynamicSnapshot('contour-finalize-abort', {
        reason: 'no-drawing-context',
      });
      resetContourLinesState();
      clearOverlayCanvas();
      return;
    }

    // Ensure context matches brush settings (opacity/composite) like other final paths
    const { tools } = getDynamicDeps();

    // propagate alpha/composite for parity with normal strokes
    drawCtx.save();
    try {
      drawCtx.globalAlpha = tools.brushSettings.opacity ?? 1;
      drawCtx.globalCompositeOperation = 'source-over';
      drawCtx.imageSmoothingEnabled = false;

      // Defensive reset of CTM before drawing
      drawCtx.setTransform(1, 0, 0, 1, 0, 0);

      brushEngine.drawContourPolygon(
        drawCtx,
        { vertices: shapePoints, fillColor: contourState.fillColor ?? undefined },
        /*preview*/ false,
        {
          spacingOverride: clampedSpacing,
          randomSeed: contourState.randomSeed ?? undefined,
        }
      );

      drawingHandlers.drawingCanvasHasContent.current = true;
      compositeCanvasDirtyRef.current = true;

      drawingHandlers.seedManualStrokeBoundingBox(shapePoints, 0);
    const contourCaptureRoi = computeCaptureRegionFromPoints(shapePoints, CAPTURE_PADDING_PX, project);
    const finalizeArgument = contourCaptureRoi
      ? { captureRegionOverride: contourCaptureRoi }
      : false;

      // IMPORTANT: perform all resets AFTER finalize resolves
      return drawingHandlers.finalizeDrawing(finalizeArgument).then(() => {
        stateMachine.finalizationComplete();
        logDynamicSnapshot('contour-finalize-complete', {
          spacing: clampedSpacing,
        });

        // Force composite + redraw immediately
        requestAnimationFrame(() => {
          if (compositeCanvasRef.current && project) {
            compositeLayersToCanvas(compositeCanvasRef.current);
            setCurrentOffscreenCanvas(compositeCanvasRef.current);
            compositeCanvasDirtyRef.current = false;

            const canvasEl = canvasRef.current;
            const ctx = canvasEl?.getContext('2d', { willReadFrequently: true });
            if (ctx) deps.draw(ctx, deps.viewTransformRef.current);
          }
        });

        restartColorCycleAnimation?.();
      }).finally(() => {
        // Now it's safe to clear/tear down
        toolStateMachine.resetPolygonGradient();
        resetContourLinesState();
        clearOverlayCanvas();
        drawCtx.restore();
        contourLinesFinalizingRef.current = false;
      });
    } catch (e) {
      logDynamicSnapshot('contour-finalize-error', {
        error: e instanceof Error ? e.message : String(e),
      });
      try { drawCtx.restore(); } catch {}
      // Defensive cleanup if finalize never ran
      toolStateMachine.resetPolygonGradient();
      resetContourLinesState();
      clearOverlayCanvas();
      contourLinesFinalizingRef.current = false;
      throw e;
    }
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
    const { isDraggingFloatingPaste, tools } = getDynamicDeps();
    const shouldHideCursor = stateMachine.isAwaitingPan ||
                             stateMachine.isPanning ||
                             tools.currentTool === 'custom' ||
                             tools.currentTool === 'color-picker' ||
                             isDraggingFloatingPaste ||
                             (!!floatingPasteDragStart.current) ||
                             !pointerInside;
    const nextVisible = !shouldHideCursor;
    setShowBrushCursor(nextVisible);
  };

  // Helper: Determine if current brush and active layer are compatible
  const checkLayerBrushCompatibility = () => {
    const { layers, activeLayerId, tools } = getDynamicDeps();

    if (tools.currentTool === 'fill') {
      // Flood fill does not interact with brush pipelines, so skip CC mismatch checks entirely.
      return { ok: true } as const;
    }

    const activeLayer = layers.find(l => l.id === activeLayerId);
    const isColorCycleLayer = activeLayer?.layerType === 'color-cycle';
    const brushShape = tools.brushSettings.brushShape;
    const isCCBrush = brushShape === BrushShape.COLOR_CYCLE ||
      brushShape === BrushShape.COLOR_CYCLE_TRIANGLE ||
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

  const applyColorPickerSample = (worldPos: Point) => {
    const sampledHex = cssColorToHex(sampleColorAtPosition(worldPos.x, worldPos.y));
    const { palette } = getDynamicDeps();
    const activeSlot = palette.activeSlot ?? 'foreground';
    const currentColor = activeSlot === 'background'
      ? palette.backgroundColor
      : palette.foregroundColor;

    if (currentColor && currentColor.toLowerCase() === sampledHex.toLowerCase()) {
      return;
    }

    deps.setActiveColor(sampledHex);
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const polygonGradientStateGuard = getDynamicDeps().polygonGradientState;
    const adjustSessionActive =
      polygonGradientStateGuard != null &&
      (polygonGradientStateGuard.drawingState === 'adjustingSpacing' ||
        polygonGradientStateGuard.drawingState === 'adjustingRotation' ||
        polygonGradientStateGuard.drawingState === 'adjustingSize');

    if (adjustSessionActive) {
      const adjustShouldRoute = isAdvancedShapeBrush(getDynamicDeps().tools.brushSettings.brushShape);
      isMouseDownRef.current = true;
      pointerInsideCanvas = true;
      const { canvas, tools } = getDynamicDeps();
      const rect = canvasRef.current?.getBoundingClientRect();
      const pointerPos = rect
        ? {
            x: event.clientX - rect.left,
            y: event.clientY - rect.top,
          }
        : { x: 0, y: 0 };
      const scale = canvas?.zoom || 1;
      const worldPosAligned = alignPointToPixel(
        pan.screenToWorld(pointerPos.x, pointerPos.y, scale),
        shouldPixelAlignCursor(tools.brushSettings)
      );
      updateAlignedMousePosition(worldPosAligned, rect, scale, shouldPixelAlignCursor(tools.brushSettings));
      event.preventDefault();
      (event.target as HTMLCanvasElement).setPointerCapture(event.pointerId);
      if (adjustShouldRoute && shapeHandler.handlePointerDown(event)) {
        return;
      }
      return;
    }

    const {
      project,
      canvas,
      tools,
      layers,
      activeLayerId,
      selectionStart,
      selectionEnd,
      selectionMask,
      selectionMaskBounds,
      floatingPaste,
      isDraggingFloatingPaste,
    } = getDynamicDeps();
    void project;
    void layers;
    void activeLayerId;
    void selectionStart;
    void selectionEnd;
    void isDraggingFloatingPaste;

    const contourLinesStateForBusyCheck = contourLinesStateRef.current;
    const allowAdjustmentWhileBusy =
      contourLinesStateForBusyCheck.stage === 'awaitingAnchorA' ||
        contourLinesStateForBusyCheck.stage === 'awaitingAngle';

    // If the app is busy, ignore pointer events unless we're adjusting contour spacing
    if (isBusyRef.current && !allowAdjustmentWhileBusy) {
      isMouseDownRef.current = false; // Clear ref in case pointerup is missed
      return;
    }
    
    // Always prevent default to avoid browser drag behavior
    event.preventDefault();
    
    // Capture pointer for consistent events even when pointer moves outside canvas.
    // On synthesized starts (e.g., when we trigger from pointermove after entering),
    // setPointerCapture may throw because no prior pointerdown occurred; guard it.
    try {
      (event.target as HTMLCanvasElement).setPointerCapture(event.pointerId);
    } catch {
      // best effort; continue without capture
    }

    pointerInsideCanvas = true;
    const shouldAlignCursor = shouldPixelAlignCursor(tools.brushSettings);
    
    const rect = canvasRef.current?.getBoundingClientRect();
    const pointerPos = rect ? {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    } : { x: 0, y: 0 };
    
    // Store pressure value (0-1, with reasonable defaults for mice)
    // For testing: Simulate pressure with mouse using Shift (low) and Ctrl (high)
    let pressure = event.pressure ?? 0.5;
    if (event.pointerType === 'mouse') {
      if (tools.brushSettings.pressureEnabled) {
        if (event.shiftKey) {
          pressure = 0.1; // Simulate low pressure with Shift
        } else if (event.ctrlKey) {
          pressure = 0.9; // Simulate high pressure with Ctrl
        } else {
          pressure = 1; // Treat mouse as full pressure to avoid shrinking/enlarging brushes
        }
      } else {
        pressure = 0.5;
      }
    }
    
    // Test Wacom functionality
    const wacomTest = testWacomPressure(event);
    if (!wacomTest.isWorking && tools.brushSettings.pressureEnabled) {
      detectWacomIssues();
      // Intentionally silent to avoid console noise
    }
    
    const canPan = tools.currentTool !== 'crop' || isSpacePressedRef.current;

    // SIMPLIFIED PANNING: Just check if space is pressed
    if (isSpacePressedRef.current && canPan) {
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
    const worldPos = alignPointToPixel(
      pan.screenToWorld(pointerPos.x, pointerPos.y, scale),
      shouldAlignCursor
    );
    updateAlignedMousePosition(worldPos, rect, scale, shouldAlignCursor);

    const hasSelection = Boolean(selectionMask || (selectionStart && selectionEnd));
    if (event.button === 0 && hasSelection && !floatingPaste) {
      let hit = false;
      if (selectionMask && selectionMaskBounds) {
        const localX = worldPos.x - selectionMaskBounds.x;
        const localY = worldPos.y - selectionMaskBounds.y;
        if (localX >= 0 && localY >= 0 && localX < selectionMask.width && localY < selectionMask.height) {
          const idx = (Math.floor(localY) * selectionMask.width + Math.floor(localX)) * 4 + 3;
          hit = selectionMask.data[idx] > 0;
        }
      } else if (selectionStart && selectionEnd) {
        hit = worldPos.x >= Math.min(selectionStart.x, selectionEnd.x) &&
          worldPos.x <= Math.max(selectionStart.x, selectionEnd.x) &&
          worldPos.y >= Math.min(selectionStart.y, selectionEnd.y) &&
          worldPos.y <= Math.max(selectionStart.y, selectionEnd.y);
      }

      if (!hit) {
        clearSelection();
        isMouseDownRef.current = false;
        return;
      }
    }

    // If press starts outside the project, leave mouse-down false so move can bootstrap later.
    if (
      project &&
      (worldPos.x < 0 || worldPos.x > project.width ||
       worldPos.y < 0 || worldPos.y > project.height)
    ) {
      isMouseDownRef.current = false;
      return;
    }

    // Track that pointer is down only after passing bounds checks
    isMouseDownRef.current = true;

    if (tools.currentTool === 'color-picker') {
      applyColorPickerSample(worldPos);
      setCursorStyle('crosshair');
      setShowBrushCursor(false);
      return;
    }

    const contourLinesState = contourLinesStateRef.current;



    if (contourLinesState.stage === 'awaitingAnchorA') {
      logDynamicSnapshot('contour-pointerdown-awaiting-anchor', {
        stage: contourLinesState.stage,
        pointerX: worldPos.x,
        pointerY: worldPos.y,
        shapePoints: contourLinesState.shapePoints.length,
      });
      const { basis } = contourLinesState;
      if (!basis) {
        resetContourLinesState();
        clearOverlayCanvas();
        logContourFillDebug('spacing-reset-missing-basis');
        return;
      }

      const defaultSpacing = clampContourSpacing((tools.brushSettings.contourSpacing || 5) * 2);
      const resolved = resolveContourSpacing(basis, worldPos, contourLinesState, defaultSpacing);
      const spacing = clampContourSpacing(resolved.spacing);

      const centroid =
        contourLinesState.centroid ?? computePolygonCentroid(contourLinesState.shapePoints);

      setContourLinesState({
        previewSpacing: spacing,
        spacingReferenceDistance: resolved.referenceDistance,
        spacingReferenceSpacing: resolved.referenceSpacing,
        centroid,
      });

      drawContourLinesPreview(spacing, spacing, {
        shapePoints: contourLinesState.shapePoints,
        basis: basis as ContourBasis,
        stage: 'awaitingAnchorA',
      });

      logContourFillDebug('spacing-finalized', {
        mode: tools.brushSettings.shapeGradientMode || 'contour',
        spacing,
      });

      const endCommitLog = cl.grp('commit spacing (pointerdown)', {
        pointerId: event.pointerId,
        spacing,
        worldPos: { x: worldPos.x | 0, y: worldPos.y | 0 },
        stage: contourLinesState.stage,
        basisMaxDistance: basis?.maxDistance,
      });
      endCommitLog();

      finalizeContourLinesStroke(spacing, spacing);
      return;
    }

    // Recolor/Brush sampling finalize (on second click as a fallback)
    const rsUp = getDynamicDeps().recolorSampling;
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
          deps.setBrushSettings({ colorCycleGradient: stops });
        } catch {}
      }

      const overlayCanvas = overlayCanvasRef.current;
      if (overlayCanvas) {
        const overlayCtx = overlayCanvas.getContext('2d');
        overlayCtx?.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
      }
      deps.stopRecolorSampling();
      return;
    }

    // Recolor sampling: start point
    const rs1 = getDynamicDeps().recolorSampling;
    if (rs1.active) {
      deps.updateRecolorSampling({ start: { x: worldPos.x, y: worldPos.y }, end: null });
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
      const pasteWidth = floatingPaste.displayWidth ?? floatingPaste.width;
      const pasteHeight = floatingPaste.displayHeight ?? floatingPaste.height;

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
            displayWidth: floatingData.displayWidth,
            displayHeight: floatingData.displayHeight,
            originalPosition: floatingData.position,
            sourceLayerId: floatingData.layerId,
            colorCycleIndices: floatingData.colorCycleIndices ?? null,
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

    // Only allow shape handlers when using brush/eraser/custom tools
    // This prevents shape mode from intercepting other tools like fill, eyedropper, etc.
    const shouldRouteToShapeHandler =
      (tools.currentTool === 'brush' || tools.currentTool === 'custom') &&
      isAdvancedShapeBrush(tools.brushSettings.brushShape);

    if (shouldRouteToShapeHandler) {
      const rewriteHandled = shapeHandler.handlePointerDown(event);
      if (rewriteHandled) {
        const polygonState = getDynamicDeps().polygonGradientState;
        if (polygonState.drawingState === 'idle') {
          isMouseDownRef.current = false;
          if ((event.target as HTMLCanvasElement).hasPointerCapture?.(event.pointerId)) {
            (event.target as HTMLCanvasElement).releasePointerCapture(event.pointerId);
          }
        }
        return;
      }
    }

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
      (tools.brushSettings.brushShape === BrushShape.CONTOUR_POLYGON &&
        normalizedShapeMode === 'lines2')
    );

    if (
      event.button === 0 &&
      (tools.currentTool === 'brush' || tools.currentTool === 'custom') &&
      tools.shapeMode &&
      tools.brushSettings.brushShape !== BrushShape.RECTANGLE_GRADIENT &&
      tools.brushSettings.brushShape !== BrushShape.POLYGON_GRADIENT &&
      tools.brushSettings.brushShape !== BrushShape.CONTOUR_POLYGON &&
      !isLines2Active &&
      tools.brushSettings.brushShape !== BrushShape.COLOR_CYCLE_SHAPE
    ) {
      // quiet
      // Strictly block incompatible brush/layer combinations before starting shape drawing
      const compat = checkLayerBrushCompatibility();
      if (!compat.ok) {
        deps.feedback?.(compat.message);
        return;
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
    
    // Dispatch to state machine with SCREEN position for normal interactions
    stateMachine.dispatch({ 
      type: 'MOUSE_DOWN', 
      button: event.button,
      position: pointerPos,  // Use screen coordinates, not world
      tool: tools.currentTool,
      pressure
    });
    
    // For simple drawing mode, use the existing drawing handlers
    // Use the currentMode captured BEFORE dispatch!
    if (currentMode === 'IDLE' && 
        (tools.currentTool === 'brush' || tools.currentTool === 'eraser') &&
        !tools.shapeMode &&
        tools.brushSettings.brushShape !== BrushShape.RECTANGLE_GRADIENT &&
        tools.brushSettings.brushShape !== BrushShape.POLYGON_GRADIENT &&
        tools.brushSettings.brushShape !== BrushShape.CONTOUR_POLYGON &&
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

      const brushPresetId = getDynamicDeps().currentBrushPresetId;
      drawingHandlers.beginStrokeSession({
        pointerId: event.pointerId,
        layerId: activeLayerId ?? null,
        tool: tools.currentTool,
        brushId: brushPresetId ?? undefined,
      });
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
        
        const beforeImage = cloneLayerImageData(currentImageData);
        const beforeColorState =
          activeLayer.layerType === 'color-cycle'
            ? captureColorCycleBrushState(activeLayer.id)
            : null;

        const shouldErase = tools.fillSettings.eraseInstead;
        const fillColor = shouldErase
          ? { r: 0, g: 0, b: 0, a: 0 }
          : (() => {
              const palette = getDynamicDeps().palette;
              const activeFillColor =
                palette.activeSlot === 'background'
                  ? palette.backgroundColor
                  : palette.foregroundColor;
              const { r, g, b } = hexToRgb(cssColorToHex(activeFillColor ?? '#000000'));
              return { r, g, b, a: 255 };
            })();

        // Perform flood fill on the current image data
        const { imageData: filledImageData, bounds: fillBounds } = floodFill(
          currentImageData,
          Math.floor(worldPos.x),
          Math.floor(worldPos.y),
          fillColor,
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
        
        void commitLayerHistory({
          layerId: activeLayer.id,
          beforeImage,
          beforeColorState,
          actionType: 'fill',
          description: shouldErase ? 'Flood erase' : 'Flood fill',
          tool: shouldErase ? 'eraser-fill' : 'fill',
          bitmapRoi: fillBounds ?? undefined,
        }).catch((error) => {
          if (process.env.NODE_ENV !== 'production') {
            console.warn('[history] Failed to record flood fill history', error);
          }
        });
        
      return;
    }

    if (tools.currentTool === 'custom' && tools.customBrushCapture?.mode === 'freehand') {
      startFreehandCapture(event.pointerId, worldPos);
      setShowBrushCursor(false);
      updateBrushCursorVisibility(false);
      return;
    }

      // Handle selection/custom brush capture tool (always behaves as selection)
      if (tools.currentTool === 'selection' || tools.currentTool === 'custom') {
        const beforeSelection = captureSelectionSnapshot();
        pendingSelectionHistory = {
          before: cloneSelectionSnapshot(beforeSelection),
          description: beforeSelection.start && beforeSelection.end ? 'Adjust selection' : 'Create selection',
          meta: {
            source: tools.currentTool === 'custom' ? 'custom-selection-tool' : 'selection-tool',
            pointerId: event.pointerId,
          },
        };
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
          const beforeSelection = captureSelectionSnapshot();
          clearSelection();
          commitSelectionHistory({
            before: beforeSelection,
            description: 'Clear selection',
            meta: { source: 'click-outside' },
          });
          pendingSelectionHistory = null;
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

              const perpX = -dy / length * (width / 2);
              const perpY = dx / length * (width / 2);
              const rectCorners = [
                { x: currentRectState.startPos.x + perpX, y: currentRectState.startPos.y + perpY },
                { x: currentRectState.startPos.x - perpX, y: currentRectState.startPos.y - perpY },
                { x: currentRectState.endPos.x - perpX, y: currentRectState.endPos.y - perpY },
                { x: currentRectState.endPos.x + perpX, y: currentRectState.endPos.y + perpY },
              ];
              drawingHandlers.seedManualStrokeBoundingBox(rectCorners, 2);
              
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
          drawingHandlers.endStrokeSession(Date.now());
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
        if (tools.shapeMode && tools.currentTool === 'brush') {
          drawingHandlers.startShapeDrawing(worldPos, pressure);
        } else {
          const brushPresetId = getDynamicDeps().currentBrushPresetId;
          drawingHandlers.beginStrokeSession({
            pointerId: event.pointerId,
            layerId: activeLayerId ?? null,
            tool: tools.currentTool,
            brushId: brushPresetId ?? undefined,
          });
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
    const {
      canvas,
      tools,
      floatingPaste,
      selectionStart,
      selectionEnd,
      project,
      isDraggingFloatingPaste,
      layers,
      activeLayerId,
    } = getDynamicDeps();
    void floatingPaste;
    void selectionStart;
    void selectionEnd;
    void project;
    void isDraggingFloatingPaste;
    void layers;
    void activeLayerId;
    const rect = canvasRef.current?.getBoundingClientRect();
    const currentPointerPos = rect
      ? {
          x: event.clientX - rect.left,
          y: event.clientY - rect.top,
        }
      : { x: 0, y: 0 };
    const scale = canvas?.zoom || 1;

    pointerInsideCanvas = isPointerWithinCanvas(event.clientX, event.clientY);
    const shouldAlignCursor = shouldPixelAlignCursor(tools.brushSettings);
    const worldPos = alignPointToPixel(
      pan.screenToWorld(currentPointerPos.x, currentPointerPos.y, scale),
      shouldAlignCursor
    );

    updateAlignedMousePosition(worldPos, rect, scale, shouldAlignCursor);

    // Fallback: if the pointer was pressed outside the canvas and enters while the primary
    // button is still held, bootstrap a stroke so drawing begins immediately.
    if (
      !interaction.state.isDrawing &&
      (event.buttons & 1) === 1 && // primary button held
      !isMouseDownRef.current &&
      !pan.panState.isPanning &&
      !isSpacePressedRef.current &&
      !tools.shapeMode &&
      (tools.currentTool === 'brush' || tools.currentTool === 'eraser')
    ) {
      // Recompute pressure similarly to pointerdown
      let pressure = event.pressure ?? 0.5;
      if (event.pointerType === 'mouse') {
        pressure = tools.brushSettings.pressureEnabled ? 1 : 0.5;
      }

      // Respect layer/brush compatibility
      if (tools.currentTool !== 'eraser') {
        const compat = checkLayerBrushCompatibility();
        if (!compat.ok) {
          deps.feedback?.(compat.message);
          // Do not start stroke; let cursor keep updating
        } else {
          const brushPresetId = getDynamicDeps().currentBrushPresetId;
          const activeLayerId = getDynamicDeps().activeLayerId ?? null;
          strokeStartWorldPosRef.current = worldPos;
          lastBrushSampleWorldPosRef.current = worldPos;
          shiftAnchorWorldPosRef.current = event.shiftKey ? worldPos : null;
          isMouseDownRef.current = true;
          stateMachine.dispatch({
            type: 'MOUSE_DOWN',
            button: 0,
            position: currentPointerPos,
            tool: tools.currentTool,
            pressure,
          });
          drawingHandlers.beginStrokeSession({
            pointerId: event.pointerId,
            layerId: activeLayerId,
            tool: tools.currentTool,
            brushId: brushPresetId ?? undefined,
          });
          interaction.dispatch({ type: 'DRAWING_START', pressure });
          drawingHandlers.startDrawing(worldPos, pressure);
          return; // Stroke started; ignore the rest of this move handler
        }
      } else {
        // Eraser is always allowed on any layer
        const brushPresetId = getDynamicDeps().currentBrushPresetId;
        const activeLayerId = getDynamicDeps().activeLayerId ?? null;
        strokeStartWorldPosRef.current = worldPos;
        lastBrushSampleWorldPosRef.current = worldPos;
        shiftAnchorWorldPosRef.current = event.shiftKey ? worldPos : null;
        isMouseDownRef.current = true;
        stateMachine.dispatch({
          type: 'MOUSE_DOWN',
          button: 0,
          position: currentPointerPos,
          tool: tools.currentTool,
          pressure,
        });
        drawingHandlers.beginStrokeSession({
          pointerId: event.pointerId,
          layerId: activeLayerId,
          tool: tools.currentTool,
          brushId: brushPresetId ?? undefined,
        });
        interaction.dispatch({ type: 'DRAWING_START', pressure });
        drawingHandlers.startDrawing(worldPos, pressure);
        return;
      }
    }

    if (
      freehandCaptureState.active &&
      freehandCaptureState.pointerId === event.pointerId &&
      tools.currentTool === 'custom' &&
      tools.customBrushCapture?.mode === 'freehand'
    ) {
      appendFreehandPoint(worldPos);
      return;
    }

    if (tools.currentTool === 'color-picker') {
      setCursorStyle('crosshair');
      setShowBrushCursor(false);
      if (isMouseDownRef.current) {
        applyColorPickerSample(worldPos);
      }
      return;
    }

    const canPan = tools.currentTool !== 'crop' || isSpacePressedRef.current;

    if (!canPan && pan.panState.isPanning) {
      pan.endPan();
      setCursorStyle(deps.defaultCursorStyle || 'crosshair');
      setShowBrushCursor(true);
    }

    // If space is held and mouse is down, but pan hasn't started yet, start it now and exit early.
    if (isSpacePressedRef.current && isMouseDownRef.current && !pan.panState.isPanning && canPan) {
      pan.startPan(currentPointerPos.x, currentPointerPos.y);
      setCursorStyle('grabbing');
      setShowBrushCursor(false);
      pauseAnimationForPan?.();
      return; // Important: skip shape/brush updates on the same frame
    }

    const shouldRouteToShapeHandler =
      (tools.currentTool === 'brush' || tools.currentTool === 'custom') &&
      isAdvancedShapeBrush(tools.brushSettings.brushShape);

    // Check if we're in hatch adjustment mode
    if (shouldRouteToShapeHandler && shapeHandler.handlePointerMove(event)) {
      return;
    }

    // PANNING TAKES PRECEDENCE: if actively panning, update pan and skip other handling
    if (pan.panState.isPanning && canPan) {
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
    const rsMove = getDynamicDeps().recolorSampling;
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
    
    // Store pressure value (0-1, with reasonable defaults for mice)
    // For testing: Simulate pressure with mouse using Shift (low) and Ctrl (high)
    let pressure = event.pressure ?? 0.5;
    if (event.pointerType === 'mouse') {
      if (tools.brushSettings.pressureEnabled) {
        if (event.shiftKey) {
          pressure = 0.1; // Simulate low pressure with Shift
        } else if (event.ctrlKey) {
          pressure = 0.9; // Simulate high pressure with Ctrl
        } else {
          pressure = 1;
        }
      } else {
        pressure = 0.5;
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
                deps.setRectangleBrushState({
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

    const contourLinesPreviewState = contourLinesStateRef.current;
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

          const currentState = contourLinesStateRef.current;
          const defaults = getLines2DefaultsCached(currentState.shapePoints, currentState.basis);

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
          const currentState = contourLinesStateRef.current;
          const { basis } = currentState;

          if (!basis) {
            resetContourLinesState();
            clearOverlayCanvas();
            if (deps.previewAnimationFrameRef) deps.previewAnimationFrameRef.current = null;
            return;
          }

          const brushDefaultSpacing = clampContourSpacing((tools.brushSettings.contourSpacing || 5) * 2);
          const { spacing, referenceDistance, referenceSpacing } = resolveContourSpacing(
            basis,
            worldPos,
            currentState,
            brushDefaultSpacing
          );

          const spacingValue = clampContourSpacing(spacing);

          const centroid = currentState.centroid ?? computePolygonCentroid(currentState.shapePoints);

          setContourLinesState({
            previewSpacing: spacingValue,
            spacingReferenceDistance: referenceDistance,
            spacingReferenceSpacing: referenceSpacing,
            centroid,
          });

          cl.log('preview', {
            stage: 'awaitingAnchorA',
            pointer: { x: worldPos.x | 0, y: worldPos.y | 0 },
            spacing: spacingValue,
            refDist: referenceDistance,
            refSpacing: referenceSpacing,
            centroid: { x: centroid.x | 0, y: centroid.y | 0 },
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
        drawingHandlers.continueShapeDrawing(shapeWorld, pressure, event.timeStamp);
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
    const {
      canvas,
      tools,
      project,
      layers,
      activeLayerId,
      floatingPaste,
      selectionStart,
      selectionEnd,
      isDraggingFloatingPaste,
    } = getDynamicDeps();
    void floatingPaste;
    void project;
    void layers;
    void activeLayerId;
    void selectionStart;
    void selectionEnd;
    void isDraggingFloatingPaste;
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

    const polygonGradientStateGuard = getDynamicDeps().polygonGradientState;
    const adjustSessionActive =
      polygonGradientStateGuard != null &&
      (polygonGradientStateGuard.drawingState === 'adjustingSpacing' ||
        polygonGradientStateGuard.drawingState === 'adjustingRotation' ||
        polygonGradientStateGuard.drawingState === 'adjustingSize');

    if (adjustSessionActive) {
      const adjustShouldRoute = isAdvancedShapeBrush(getDynamicDeps().tools.brushSettings.brushShape);
      if (adjustShouldRoute && shapeHandler.handlePointerUp(event)) {
        return;
      }
      return;
    }

    if (tools.currentTool === 'color-picker') {
      setCursorStyle('crosshair');
      setShowBrushCursor(false);
      return;
    }

    if (
      freehandCaptureState.active &&
      freehandCaptureState.pointerId === event.pointerId &&
      tools.currentTool === 'custom' &&
      tools.customBrushCapture?.mode === 'freehand'
    ) {
      const captured = completeFreehandCapture();
      setCursorStyle(deps.defaultCursorStyle || 'none');
      updateBrushCursorVisibility();
      setShowBrushCursor(true);
      if (captured) {
        void flushAndSetCurrentTool('brush');
        clearSelection();
      }
      return;
    }

    // Clear overlay canvas
    const contourStateOnUp = contourLinesStateRef.current;
    if (contourStateOnUp.stage === 'awaitingAnchorA') {
      cl.log('pointerup ignored in awaitingAnchorA', { pointerId: event.pointerId });
      return;
    }

    const linesStateOnPointerUp = contourStateOnUp;
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

    const shouldRouteToShapeHandler =
      (tools.currentTool === 'brush' || tools.currentTool === 'custom') &&
      isAdvancedShapeBrush(tools.brushSettings.brushShape);

    if (shouldRouteToShapeHandler && shapeHandler.handlePointerUp(event)) {
      return;
    }

    // Recolor/Brush sampling finalize on drag-release
    const rsFinalize = getDynamicDeps().recolorSampling;
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
          deps.setBrushSettings({ colorCycleGradient: stopsFinalize });
        } catch {}
      }

      deps.stopRecolorSampling();
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
    if (isDraggingFloatingPaste || floatingPasteDragStart.current) {
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
          void flushAndSetCurrentTool('brush');
          clearSelection();
          updateBrushCursorVisibility(); // Show brush cursor again after custom brush selection
        }
      }
      if (pendingSelectionHistory) {
        commitSelectionHistory({
          before: pendingSelectionHistory.before,
          description: pendingSelectionHistory.description,
          meta: {
            ...(pendingSelectionHistory.meta ?? {}),
            pointerId: event.pointerId,
            outcome: tools.currentTool === 'custom' ? 'custom-selection' : 'selection',
          },
        });
        pendingSelectionHistory = null;
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
          drawingHandlers.endStrokeSession(Date.now());
        }
        // Don't end drawing state if we're still defining width
        return;
      }
      
      // Normal brush or shape mode
      interaction.dispatch({ type: 'DRAWING_END' });
      drawingHandlers.endStrokeSession(Date.now());
      
      // Mark composite as dirty BEFORE finalization to ensure it updates
      compositeCanvasDirtyRef.current = true;
      
      if (tools.shapeMode && drawingHandlers.isDrawingShapeRef.current) {
        // Guard: require at least 3 points to finalize a polygon
        let shapePointCount = drawingHandlers.shapePointsRef.current.length;
        if (shapePointCount < 3) {
          const coerced = drawingHandlers.coerceDragShapeToPolygon?.() ?? false;
          shapePointCount = drawingHandlers.shapePointsRef.current.length;
          if (!coerced || shapePointCount < 3) {
            // Keep collecting vertices with subsequent clicks
            return;
          }
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
          const brushShape = tools.brushSettings.brushShape;
          const isContourBrush =
            brushShape === BrushShape.CONTOUR_POLYGON ||
            brushShape === BrushShape.CONTOUR_LINES2;

          if (isContourBrush) {
            const shapePoints = drawingHandlers.shapePointsRef.current
              .filter((point): point is { x: number; y: number } => Boolean(point));

            if (shapePoints.length >= 3) {
              const variant = brushShape === BrushShape.CONTOUR_LINES2 ? 'lines2' : 'legacy';
              const clampSpacingFn = clampContourSpacing;
              const baseSpacing = tools.brushSettings.contourSpacing || 5;
              const initialSpacing = clampSpacingFn(baseSpacing);
              const fillColor = tools.brushSettings.color;

              initializeContourLinesState(shapePoints.map((pt) => ({ x: pt.x, y: pt.y })), {
                variant,
                fillColor,
                initialSpacing,
              });
            }
          }

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
    const polygonGradientStateGuard = getDynamicDeps().polygonGradientState;
    const adjustSessionActive =
      polygonGradientStateGuard != null &&
      (polygonGradientStateGuard.drawingState === 'adjustingSpacing' ||
        polygonGradientStateGuard.drawingState === 'adjustingRotation' ||
        polygonGradientStateGuard.drawingState === 'adjustingSize');

    if (adjustSessionActive) {
      const adjustShouldRoute = isAdvancedShapeBrush(getDynamicDeps().tools.brushSettings.brushShape);
      pointerInsideCanvas = isPointerWithinCanvas(event.clientX, event.clientY);
      const { canvas, tools } = getDynamicDeps();
      const rect = canvasRef.current?.getBoundingClientRect();
      const pointerPos = rect
        ? {
            x: event.clientX - rect.left,
            y: event.clientY - rect.top,
          }
        : { x: 0, y: 0 };
      const scale = canvas?.zoom || 1;
      const worldPos = alignPointToPixel(
        pan.screenToWorld(pointerPos.x, pointerPos.y, scale),
        shouldPixelAlignCursor(tools.brushSettings)
      );
      updateAlignedMousePosition(worldPos, rect, scale, shouldPixelAlignCursor(tools.brushSettings));
      if (adjustShouldRoute && shapeHandler.handlePointerMove(event)) {
        return;
      }
      return;
    }

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
    const { tools } = getDynamicDeps();
    if (tools.currentTool === 'color-picker') {
      setCursorStyle('crosshair');
    }
  };

  const handlePointerLeave = () => {
    pointerInsideCanvas = false;
    // Drop any queued move frame so a stale in-canvas event can't re-show the cursor
    if (scheduledMoveRAF != null) {
      cancelAnimationFrame(scheduledMoveRAF);
      scheduledMoveRAF = null;
    }
    lastMoveEvent = null;
    updateBrushCursorVisibility(false);
    const { tools } = getDynamicDeps();
    if (tools.currentTool === 'color-picker') {
      setCursorStyle(deps.defaultCursorStyle || 'crosshair');
    }
    if (pan.panState.isPanning) {
      pan.endPan();
      void resumeAnimationAfterPan?.();
    }
    if (freehandCaptureState.active) {
      cancelFreehandCapture();
      setShowBrushCursor(true);
    }
  };

  const handlePointerCancel = (event: React.PointerEvent<HTMLCanvasElement>) => {
    // Handle pointer cancel (e.g., stylus moving out of range)
    isMouseDownRef.current = false;
    (event.target as HTMLCanvasElement).releasePointerCapture(event.pointerId);

    drawingHandlers.endStrokeSession(Date.now());
    drawingHandlers.clearStrokeSession();

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

    const { tools } = getDynamicDeps();
    if (tools.currentTool === 'color-picker') {
      setCursorStyle('crosshair');
      setShowBrushCursor(false);
    }
    if (
      freehandCaptureState.active &&
      freehandCaptureState.pointerId === event.pointerId
    ) {
      cancelFreehandCapture();
      updateBrushCursorVisibility();
      setShowBrushCursor(true);
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

export const __TESTING__ = {
  shouldEnableContourDebug,
  isAdvancedShapeBrush,
};
