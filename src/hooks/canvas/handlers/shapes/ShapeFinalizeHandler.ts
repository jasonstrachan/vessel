import type React from 'react';
import type { AppState } from '@/stores/useAppStore';
import type { BrushSettings } from '@/types';
import { BrushShape } from '@/types';
import type { BrushEngine } from '@/hooks/useBrushEngineSimplified';
import { getRisographPattern, getRisographEffectSettings } from '@/utils/risographTexture';
import { applyLostEdgeErosionToContext } from '@/shapeFill/lostEdgeErosion';
import { parseCssColorToRgba } from '@/hooks/canvas/utils/colorCycleHelpers';
import type { ColorCycleSerializedState } from '@/history/helpers/colorCycle';
import { commitLayerHistory } from '@/history/helpers/layerHistory';
import {
  scaleOrderedAxis,
  renderDitherGradientToImageData,
  resolveDitherGradPalette,
} from '@/utils/orderedDitherGradient';
import { canvasPool } from '@/utils/canvasPool';

export type ShapePoint = { x: number; y: number };

export type BoundingBox = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
};

export type CaptureRegion = { x: number; y: number; width: number; height: number };

export type AutoSampleStops = Array<{ position: number; color: string }>;

export const buildLostEdgePolygon = (
  points: ShapePoint[],
  fallbackWidth: number
): ShapePoint[] => {
  if (points.length >= 3) {
    return points;
  }
  if (points.length < 2) {
    return [];
  }

  const [a, b] = points;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const half = Math.max(1, fallbackWidth / 2);
  const nx = -(dy / len) * half;
  const ny = (dx / len) * half;

  return [
    { x: a.x + nx, y: a.y + ny },
    { x: b.x + nx, y: b.y + ny },
    { x: b.x - nx, y: b.y - ny },
    { x: a.x - nx, y: a.y - ny },
  ];
};

export const applyPolygonLostEdgeErosion = ({
  ctx,
  canvas,
  brushShape,
  lostEdge,
  thickness,
  spacing,
  polygonVertices,
  polygonPoints,
  fallbackPoints,
  logDevStats,
}: {
  ctx: CanvasRenderingContext2D;
  canvas: HTMLCanvasElement;
  brushShape: BrushSettings['brushShape'];
  lostEdge: number | null | undefined;
  thickness: number | null | undefined;
  spacing: number | null | undefined;
  polygonVertices?: ShapePoint[] | null;
  polygonPoints?: ShapePoint[] | null;
  fallbackPoints?: ShapePoint[] | null;
  logDevStats?: boolean;
}): void => {
  if (brushShape !== BrushShape.POLYGON_GRADIENT && brushShape !== BrushShape.DITHER_GRADIENT) {
    return;
  }

  const points =
    polygonVertices && polygonVertices.length >= 3
      ? polygonVertices
      : polygonPoints && polygonPoints.length >= 3
        ? polygonPoints
        : fallbackPoints && fallbackPoints.length >= 3
          ? fallbackPoints
          : [];

  const clampedLostEdge = Math.max(0, Math.min(100, lostEdge ?? 0));
  if (!points.length || clampedLostEdge <= 0) {
    return;
  }

  let minX = points[0].x;
  let maxX = points[0].x;
  let minY = points[0].y;
  let maxY = points[0].y;
  for (let i = 1; i < points.length; i += 1) {
    const p = points[i];
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }

  const bounds = { minX, maxX, minY, maxY };
  const padding = Math.max(4, Math.ceil((thickness ?? 1) * 2 + (spacing ?? 0)));

  let preAlpha = 0;
  if (logDevStats) {
    const preRegion = ctx.getImageData(0, 0, canvas.width, canvas.height);
    for (let i = 3; i < preRegion.data.length; i += 4) {
      if (preRegion.data[i] !== 0) preAlpha += 1;
    }
  }

  applyLostEdgeErosionToContext(ctx, points, bounds, padding, clampedLostEdge);

  if (logDevStats) {
    let postAlpha = 0;
    const postRegion = ctx.getImageData(0, 0, canvas.width, canvas.height);
    for (let i = 3; i < postRegion.data.length; i += 4) {
      if (postRegion.data[i] !== 0) postAlpha += 1;
    }
    console.log('[polygonGradient] erosion', {
      lostEdge: clampedLostEdge,
      padding,
      preAlpha,
      postAlpha,
      points: points.length,
      bounds,
    });
  }
};

export const commitRasterShapeFill = async ({
  shapePoints,
  shapeBeforeSnapshot,
  shapeBeforeColorState,
  liveBrushSettings,
  tool,
}: {
  shapePoints: ShapePoint[];
  shapeBeforeSnapshot: { kind: 'full'; image: ImageData } | { kind: 'region'; image: ImageData; roi: CaptureRegion } | null;
  shapeBeforeColorState: ColorCycleSerializedState | null;
  liveBrushSettings: BrushSettings;
  tool: string;
}, deps: {
  storeRef: React.MutableRefObject<AppState>;
  project: { width: number; height: number } | null;
  drawingCanvasRef: React.MutableRefObject<HTMLCanvasElement | null>;
  drawingCtxRef: React.MutableRefObject<CanvasRenderingContext2D | null>;
  drawingCanvasHasContent: React.MutableRefObject<boolean>;
  strokeBoundingBoxRef: React.MutableRefObject<BoundingBox | null>;
  strokeCapturePaddingRef: React.MutableRefObject<number>;
  roiPadding: number;
  captureRegionFromPoints: (
    points: ShapePoint[],
    padding: number,
    project: { width: number; height: number } | null
  ) => CaptureRegion | undefined;
  boundingBoxToCaptureRegion: (
    bbox: BoundingBox | null,
    padding: number,
    project: { width: number; height: number } | null
  ) => CaptureRegion | undefined;
  inflateShapeBeforeSnapshot: (
    layer: AppState['layers'][number] | null | undefined,
    snapshot: { kind: 'full'; image: ImageData } | { kind: 'region'; image: ImageData; roi: CaptureRegion }
  ) => ImageData | null;
  ensureLayerSnapshotWithRetry: (layer: AppState['layers'][number], existing: ImageData | null, maxAttempts?: number) => Promise<ImageData | null>;
  applyBackdropFromSnapshot: (
    ctx: CanvasRenderingContext2D | null,
    image: ImageData | null,
    roi?: CaptureRegion
  ) => void;
  captureCanvasToActiveLayer: (canvas: HTMLCanvasElement, roi?: CaptureRegion) => Promise<void>;
  scheduleHistoryCommit: (payload: Parameters<typeof commitLayerHistory>[0]) => Promise<void>;
  clearShapeBeforeSnapshot: () => void;
  resetPolygonState: () => void;
  resumeColorCycleAfterInteraction: () => Promise<void>;
  setBusy?: (busy: boolean) => void;
  withTiming: <T>(label: string, task: () => Promise<T> | T) => Promise<T>;
  logError: (message: string, error?: unknown) => void;
}): Promise<boolean> => {
  const currentLayer = deps.storeRef.current.layers.find(
    (layer) => layer.id === deps.storeRef.current.activeLayerId
  );
  const drawingCanvas = deps.drawingCanvasRef.current;
  if (!drawingCanvas || !currentLayer || currentLayer.layerType === 'color-cycle') {
    return false;
  }

  const fallbackProjectDimensions =
    deps.project ??
    deps.storeRef.current.project ??
    (currentLayer.imageData
      ? { width: currentLayer.imageData.width, height: currentLayer.imageData.height }
      : drawingCanvas
        ? { width: drawingCanvas.width, height: drawingCanvas.height }
        : null);

  let captureRegion =
    fallbackProjectDimensions
      ? deps.captureRegionFromPoints(
          shapePoints,
          deps.roiPadding + deps.strokeCapturePaddingRef.current,
          fallbackProjectDimensions
        )
      : undefined;

  if (!captureRegion && fallbackProjectDimensions) {
    captureRegion = deps.boundingBoxToCaptureRegion(
      deps.strokeBoundingBoxRef.current,
      deps.roiPadding + deps.strokeCapturePaddingRef.current,
      fallbackProjectDimensions
    );
  }

  if (!captureRegion && drawingCanvas) {
    captureRegion = {
      x: 0,
      y: 0,
      width: drawingCanvas.width,
      height: drawingCanvas.height,
    };
  }

  const beforeBitmap = shapeBeforeSnapshot
    ? deps.inflateShapeBeforeSnapshot(currentLayer, shapeBeforeSnapshot)
    : await deps.ensureLayerSnapshotWithRetry(currentLayer, null, 3);
  const historyDescription = `Shape Fill: ${liveBrushSettings?.shapeFillMode ?? 'default'}`;

  if (!beforeBitmap) {
    deps.logError('[shape-finalize] beforeImage missing; skipping history to avoid destructive undo.');
    deps.clearShapeBeforeSnapshot();
    deps.drawingCanvasHasContent.current = false;
    if (deps.drawingCtxRef.current) {
      deps.drawingCtxRef.current.clearRect(0, 0, drawingCanvas.width, drawingCanvas.height);
    }
    deps.resetPolygonState();
    await deps.resumeColorCycleAfterInteraction();
    deps.setBusy?.(false);
    return true;
  }

  if (deps.drawingCtxRef.current) {
    deps.applyBackdropFromSnapshot(deps.drawingCtxRef.current, beforeBitmap, captureRegion);
  }

  await deps.withTiming('cc:capture', () => deps.captureCanvasToActiveLayer(drawingCanvas, captureRegion));
  if (!captureRegion) {
    console.warn('[shape-finalize] captureRegion missing; committing full-layer delta.');
  }

  await deps.scheduleHistoryCommit({
    layerId: currentLayer.id,
    beforeImage: beforeBitmap,
    beforeColorState: shapeBeforeColorState,
    actionType: 'fill',
    description: historyDescription,
    tool,
    bitmapRoi: captureRegion,
    skipBitmapDelta: false,
  });

  deps.clearShapeBeforeSnapshot();
  deps.drawingCanvasHasContent.current = false;
  if (deps.drawingCtxRef.current) {
    deps.drawingCtxRef.current.clearRect(0, 0, drawingCanvas.width, drawingCanvas.height);
  }
  deps.resetPolygonState();
  await deps.resumeColorCycleAfterInteraction();
  deps.setBusy?.(false);
  return true;
};

const renderDitherGradientPolygon = ({
  canvas,
  ctx,
  points,
  liveBrushSettings,
  palette,
  project,
  drawingCanvasHasContent,
  strokeBoundingBoxRef,
  strokeCapturePaddingRef,
  roiPadding,
  lastStablePressure,
  latestShapePixelSizeRef,
  computeShapePixelSize,
}: {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  points: ShapePoint[];
  liveBrushSettings: BrushSettings;
  palette: AppState['palette'];
  project: AppState['project'];
  drawingCanvasHasContent: React.MutableRefObject<boolean>;
  strokeBoundingBoxRef: React.MutableRefObject<BoundingBox | null>;
  strokeCapturePaddingRef: React.MutableRefObject<number>;
  roiPadding: number;
  lastStablePressure: number;
  latestShapePixelSizeRef: React.MutableRefObject<number | null>;
  computeShapePixelSize: (pressure: number) => number;
}): boolean => {
  if (!project || points.length < 3) {
    return false;
  }

  let minX = points[0].x;
  let maxX = points[0].x;
  let minY = points[0].y;
  let maxY = points[0].y;
  for (let i = 1; i < points.length; i += 1) {
    const p = points[i];
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }

  minX = Math.max(0, Math.floor(minX));
  minY = Math.max(0, Math.floor(minY));
  maxX = Math.min(project.width, Math.ceil(maxX));
  maxY = Math.min(project.height, Math.ceil(maxY));

  strokeBoundingBoxRef.current = {
    minX,
    minY,
    maxX,
    maxY,
  };
  const paddingForDither = 6;
  strokeCapturePaddingRef.current = Math.max(strokeCapturePaddingRef.current, roiPadding + paddingForDither);

  const width = Math.max(1, Math.ceil(maxX - minX));
  const height = Math.max(1, Math.ceil(maxY - minY));
  if (width <= 0 || height <= 0) {
    return false;
  }

  const localVertices = points.map((pt) => ({ x: pt.x - minX, y: pt.y - minY }));
  const computeAxisOpposingEnds = (verts: ShapePoint[]) => {
    if (verts.length < 2) {
      return {
        start: { x: 0, y: 0 },
        end: { x: 1, y: 0 },
        dir: { x: 1, y: 0 },
        length: 1,
      };
    }

    let maxDist = -Infinity;
    let endA = verts[0];
    let endB = verts[0];
    for (let i = 0; i < verts.length; i += 1) {
      for (let j = i + 1; j < verts.length; j += 1) {
        const a = verts[i];
        const b = verts[j];
        const d = Math.hypot(b.x - a.x, b.y - a.y);
        if (d > maxDist) {
          maxDist = d;
          endA = a;
          endB = b;
        }
      }
    }

    let dx = endB.x - endA.x;
    let dy = endB.y - endA.y;
    let len = Math.hypot(dx, dy);
    if (len < 1e-6) {
      dx = 1;
      dy = 0;
      len = 1;
    }
    dx /= len;
    dy /= len;

    let minT = Infinity;
    let maxT = -Infinity;
    const corners = [
      { x: 0, y: 0 },
      { x: width, y: 0 },
      { x: 0, y: height },
      { x: width, y: height },
    ];

    for (const v of verts) {
      const t = v.x * dx + v.y * dy;
      if (t < minT) minT = t;
      if (t > maxT) maxT = t;
    }
    for (const c of corners) {
      const t = c.x * dx + c.y * dy;
      if (t < minT) minT = t;
      if (t > maxT) maxT = t;
    }

    const length = Math.max(1e-6, maxT - minT);
    return {
      start: { x: dx * minT, y: dy * minT },
      end: { x: dx * maxT, y: dy * maxT },
      dir: { x: dx, y: dy },
      length,
    };
  };

  let axis = computeAxisOpposingEnds(localVertices);
  const lengthFactor = Math.max(
    0.05,
    Math.min(2, ((liveBrushSettings.gradientLength ?? 100) / 100) * 1.3)
  );
  axis = scaleOrderedAxis(axis, lengthFactor);
  const fg = parseCssColorToRgba(palette?.foregroundColor || liveBrushSettings.color || '#000');
  const bg = parseCssColorToRgba(palette?.backgroundColor || '#fff');
  const paletteRGBA = resolveDitherGradPalette(
    fg,
    bg,
    liveBrushSettings.ditherGradBgFill,
    liveBrushSettings.ditherGradStops,
    liveBrushSettings.trans
  );
  const pixelSize = computeShapePixelSize(lastStablePressure);
  latestShapePixelSizeRef.current = pixelSize;

  const imageData = renderDitherGradientToImageData({
    width,
    height,
    axis,
    paletteRGBA,
    tileSize: 8,
    pixelSize,
    origin: { x: minX, y: minY },
    algorithm: liveBrushSettings.ditherAlgorithm,
    patternStyle: liveBrushSettings.patternStyle,
  });

  const tempCanvas = canvasPool.acquire(width, height);
  const tempCtx = tempCanvas.getContext('2d', { willReadFrequently: true } as CanvasRenderingContext2DSettings);
  if (!tempCtx) {
    canvasPool.release(tempCanvas);
    return false;
  }

  tempCtx.clearRect(0, 0, width, height);
  tempCtx.putImageData(imageData, 0, 0);
  tempCtx.globalCompositeOperation = 'destination-in';
  tempCtx.beginPath();
  tempCtx.moveTo(localVertices[0].x, localVertices[0].y);
  for (let i = 1; i < localVertices.length; i += 1) {
    const pt = localVertices[i];
    tempCtx.lineTo(pt.x, pt.y);
  }
  tempCtx.closePath();
  tempCtx.fillStyle = 'white';
  tempCtx.fill();
  tempCtx.globalCompositeOperation = 'source-over';

  ctx.save();
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(tempCanvas, minX, minY);
  ctx.restore();
  drawingCanvasHasContent.current = true;

  canvasPool.release(tempCanvas);
  return true;
};

export const finalizeDitherGradientShape = ({
  drawCtx,
  canvas,
  drawingCanvasHasContent,
  liveBrushSettings,
  polygonState,
  shapePoints,
  palette,
  project,
  strokeBoundingBoxRef,
  strokeCapturePaddingRef,
  roiPadding,
  lastStablePressure,
  latestShapePixelSizeRef,
  computeShapePixelSize,
}: {
  drawCtx: CanvasRenderingContext2D;
  canvas: HTMLCanvasElement;
  drawingCanvasHasContent: React.MutableRefObject<boolean>;
  liveBrushSettings: BrushSettings;
  polygonState: AppState['polygonGradientState'];
  shapePoints: ShapePoint[];
  palette: AppState['palette'];
  project: AppState['project'];
  strokeBoundingBoxRef: React.MutableRefObject<BoundingBox | null>;
  strokeCapturePaddingRef: React.MutableRefObject<number>;
  roiPadding: number;
  lastStablePressure: number;
  latestShapePixelSizeRef: React.MutableRefObject<number | null>;
  computeShapePixelSize: (pressure: number) => number;
}): ShapePoint[] | null => {
  const points =
    polygonState.vertices && polygonState.vertices.length >= 3
      ? polygonState.vertices
      : polygonState.points && polygonState.points.length >= 3
        ? polygonState.points
        : shapePoints;

  if (!points || points.length < 3) {
    return null;
  }

  renderDitherGradientPolygon({
    canvas,
    ctx: drawCtx,
    points,
    liveBrushSettings,
    palette,
    project,
    drawingCanvasHasContent,
    strokeBoundingBoxRef,
    strokeCapturePaddingRef,
    roiPadding,
    lastStablePressure,
    latestShapePixelSizeRef,
    computeShapePixelSize,
  });

  const lostEdge = Math.max(0, Math.min(100, liveBrushSettings.lostEdge ?? 0));
  if (lostEdge > 0) {
    let minX = points[0].x;
    let maxX = points[0].x;
    let minY = points[0].y;
    let maxY = points[0].y;
    for (let i = 1; i < points.length; i += 1) {
      const p = points[i];
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }

    const px = Math.max(1, Math.round(latestShapePixelSizeRef.current ?? 1));
    const padding = Math.max(4, px * 4);

    applyLostEdgeErosionToContext(
      drawCtx,
      points,
      { minX, maxX, minY, maxY },
      padding,
      lostEdge
    );
  }

  return points;
};

export const finalizeRasterShapeFill = ({
  drawCtx,
  brushEngine,
  storeRef,
  liveBrushSettings,
  shapePoints,
  ditherGradPoints,
  strokeBoundingBox,
  project,
  roiPadding,
  computeAutoSampleStops,
  setSharedColorCycleGradient,
  computeShapePixelSize,
  hadValidShapePressureRef,
  lastStablePressureRef,
  latestShapePixelSizeRef,
  boundingBoxToCaptureRegion,
  logError,
  ccDebug,
}: {
  drawCtx: CanvasRenderingContext2D;
  brushEngine: BrushEngine;
  storeRef: React.MutableRefObject<AppState>;
  liveBrushSettings: BrushSettings;
  shapePoints: ShapePoint[];
  ditherGradPoints: ShapePoint[] | null;
  strokeBoundingBox: BoundingBox | null;
  project: { width: number; height: number } | null;
  roiPadding: number;
  computeAutoSampleStops: (sourcePts: ShapePoint[], options?: { allowTiny?: boolean }) => AutoSampleStops | null;
  setSharedColorCycleGradient: (stops: AutoSampleStops) => void;
  computeShapePixelSize: (pressure: number) => number;
  hadValidShapePressureRef: React.MutableRefObject<boolean>;
  lastStablePressureRef: React.MutableRefObject<number>;
  latestShapePixelSizeRef: React.MutableRefObject<number | null>;
  boundingBoxToCaptureRegion: (
    bbox: BoundingBox | null,
    padding: number,
    project: { width: number; height: number } | null
  ) => CaptureRegion | undefined;
  logError: (message: string, error?: unknown) => void;
  ccDebug?: { on?: boolean; verbose?: boolean };
}): void => {
  drawCtx.globalAlpha = 1.0;
  drawCtx.globalCompositeOperation = 'source-over';

  const isPixelBrush = liveBrushSettings.brushShape === BrushShape.PIXEL_ROUND ||
    liveBrushSettings.brushShape === BrushShape.PIXEL_DITHER ||
    (liveBrushSettings.brushShape === BrushShape.SQUARE && !liveBrushSettings.antialiasing);

  if (isPixelBrush) {
    drawCtx.imageSmoothingEnabled = false;
    drawCtx.imageSmoothingQuality = 'low';
  } else {
    drawCtx.imageSmoothingEnabled = true;
    drawCtx.imageSmoothingQuality = 'high';
  }

  try {
    const st = storeRef.current;
    const isCCShape = st.tools.brushSettings.brushShape === BrushShape.COLOR_CYCLE_SHAPE;
    const autoSampleEnabled =
      st.tools.brushSettings.autoSampleGradient ||
      st.tools.brushSettings.autoSampleGradientRealtime;
    if (isCCShape && autoSampleEnabled) {
      const finalPts = [...shapePoints];
      const stops = computeAutoSampleStops(finalPts, { allowTiny: true });
      if (stops && stops.length >= 2) {
        try {
          setSharedColorCycleGradient(stops);
        } catch {
          storeRef.current.setBrushSettings({ colorCycleGradient: stops });
        }
        try {
          const liveState = storeRef.current;
          const gb = liveState.tools.brushSettings.gradientBands || 0;
          if (gb < stops.length) {
            liveState.setBrushSettings({ gradientBands: stops.length });
          }
        } catch {}
        try { brushEngine.updateColorCycleGradient?.(stops); } catch {}
        try {
          if (st.tools.brushSettings.autoSampleGradient && !st.tools.brushSettings.autoSampleGradientRealtime) {
            st.setBrushSettings({ autoSampleGradient: false });
          }
        } catch {}
      }
    }
  } catch {}

  const isCustomBrush = liveBrushSettings.brushShape === BrushShape.CUSTOM;
  let customBrushImageData: ImageData | null = null;
  let customBrushWidth = 0;
  let customBrushHeight = 0;
  let customBrushMaxDimension = 0;
  let isColorizable = false;

  if (isCustomBrush) {
    if (liveBrushSettings.currentBrushTip) {
      const brushTip = liveBrushSettings.currentBrushTip;
      customBrushImageData = brushTip.imageData;
      customBrushWidth = brushTip.naturalWidth ?? brushTip.width ?? brushTip.imageData.width;
      customBrushHeight = brushTip.naturalHeight ?? brushTip.height ?? brushTip.imageData.height;
      customBrushMaxDimension = brushTip.maxDimension ?? Math.max(customBrushWidth, customBrushHeight);
      isColorizable = brushTip.isColorizable || liveBrushSettings.useSwatchColor || !!liveBrushSettings.customBrushColorCycle;
    } else if (liveBrushSettings.selectedCustomBrush) {
      const currentState = storeRef.current;

      if (currentState.temporaryCustomBrush?.id === liveBrushSettings.selectedCustomBrush) {
        const tempBrush = currentState.temporaryCustomBrush;
        customBrushImageData = tempBrush.imageData;
        customBrushWidth = tempBrush.naturalWidth ?? tempBrush.width;
        customBrushHeight = tempBrush.naturalHeight ?? tempBrush.height;
        customBrushMaxDimension = tempBrush.maxDimension ?? Math.max(customBrushWidth, customBrushHeight);
        isColorizable = liveBrushSettings.useSwatchColor || !!liveBrushSettings.customBrushColorCycle;
      } else {
        const customBrush = currentState.getCustomBrushById?.(liveBrushSettings.selectedCustomBrush ?? '') ?? null;
        if (customBrush) {
          customBrushImageData = customBrush.imageData;
          customBrushWidth = customBrush.naturalWidth ?? customBrush.width;
          customBrushHeight = customBrush.naturalHeight ?? customBrush.height;
          customBrushMaxDimension = customBrush.maxDimension ?? Math.max(customBrushWidth, customBrushHeight);
          isColorizable = liveBrushSettings.useSwatchColor || !!liveBrushSettings.customBrushColorCycle;
        }
      }
    }
  }

  if (isCustomBrush && customBrushImageData) {
    const maxDimension = customBrushMaxDimension || Math.max(customBrushWidth, customBrushHeight) || 1;
    const scale = (liveBrushSettings.size ?? maxDimension) / maxDimension;
    const scaledWidth = Math.max(1, Math.round(customBrushWidth * scale));
    const scaledHeight = Math.max(1, Math.round(customBrushHeight * scale));

    const patternCanvas = document.createElement('canvas');
    patternCanvas.width = scaledWidth;
    patternCanvas.height = scaledHeight;
    const patternCtx = patternCanvas.getContext('2d');

    if (patternCtx) {
      const tipCanvas = document.createElement('canvas');
      tipCanvas.width = customBrushWidth;
      tipCanvas.height = customBrushHeight;
      const tipCtx = tipCanvas.getContext('2d');

      if (tipCtx) {
        tipCtx.putImageData(customBrushImageData, 0, 0);

        if (isColorizable) {
          tipCtx.globalCompositeOperation = 'source-atop';
          tipCtx.fillStyle = liveBrushSettings.color;
          tipCtx.fillRect(0, 0, tipCanvas.width, tipCanvas.height);
        }

        if (patternCtx) {
          patternCtx.imageSmoothingEnabled = false;
          try {
            patternCtx.imageSmoothingQuality = 'low';
          } catch {}
        }
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

        const pattern = drawCtx.createPattern(patternCanvas, 'repeat');
        if (pattern) {
          drawCtx.imageSmoothingEnabled = false;
          drawCtx.fillStyle = pattern;
        } else {
          drawCtx.fillStyle = liveBrushSettings.color;
        }

        tipCanvas.width = 1;
        tipCanvas.height = 1;
        tipCtx.clearRect(0, 0, 1, 1);
      } else {
        drawCtx.fillStyle = liveBrushSettings.color;
      }
    } else {
      drawCtx.fillStyle = liveBrushSettings.color;
    }
  } else {
    drawCtx.fillStyle = liveBrushSettings.color;
  }

  const isDitherGradientShape = liveBrushSettings.brushShape === BrushShape.DITHER_GRADIENT;
  if (!isDitherGradientShape) {
    drawCtx.beginPath();
    if (isPixelBrush) {
      drawCtx.moveTo(Math.round(shapePoints[0].x), Math.round(shapePoints[0].y));
      for (let i = 1; i < shapePoints.length; i++) {
        drawCtx.lineTo(Math.round(shapePoints[i].x), Math.round(shapePoints[i].y));
      }
    } else {
      drawCtx.moveTo(shapePoints[0].x, shapePoints[0].y);
      for (let i = 1; i < shapePoints.length; i++) {
        drawCtx.lineTo(shapePoints[i].x, shapePoints[i].y);
      }
    }
    drawCtx.closePath();
    drawCtx.fill();
  }

  if (
    liveBrushSettings.brushShape === BrushShape.POLYGON_GRADIENT ||
    liveBrushSettings.brushShape === BrushShape.DITHER_GRADIENT
  ) {
    const polyState = storeRef.current.polygonGradientState;
    const rawPts =
      liveBrushSettings.brushShape === BrushShape.DITHER_GRADIENT && ditherGradPoints
        ? ditherGradPoints
        : polyState.vertices && polyState.vertices.length >= 3
          ? polyState.vertices
          : polyState.points && polyState.points.length >= 3
            ? polyState.points
            : shapePoints.length >= 2
              ? [...shapePoints]
              : [];
    const lostEdge = Math.max(0, Math.min(100, liveBrushSettings.lostEdge ?? 0));

    if (lostEdge > 0 && rawPts.length >= 2) {
      const effectiveWidth =
        liveBrushSettings.fillResolution ??
        liveBrushSettings.thickness ??
        liveBrushSettings.size ??
        8;
      const pts = buildLostEdgePolygon(rawPts, effectiveWidth);
      if (pts.length >= 3) {
        let minX = pts[0].x;
        let maxX = pts[0].x;
        let minY = pts[0].y;
        let maxY = pts[0].y;

        for (let i = 1; i < pts.length; i += 1) {
          const p = pts[i];
          if (p.x < minX) minX = p.x;
          if (p.x > maxX) maxX = p.x;
          if (p.y < minY) minY = p.y;
          if (p.y > maxY) maxY = p.y;
        }

        const bounds = { minX, maxX, minY, maxY };
        const padding = Math.max(
          4,
          Math.ceil((liveBrushSettings.thickness ?? 1) * 2 + (liveBrushSettings.spacing ?? 0))
        );

        applyLostEdgeErosionToContext(drawCtx, pts, bounds, padding, lostEdge);
      }
    }
  }

  if (brushEngine.applyStrokeDither && liveBrushSettings.brushShape !== BrushShape.DITHER_GRADIENT) {
    try {
      let ditherRegion = boundingBoxToCaptureRegion(
        strokeBoundingBox,
        roiPadding,
        project
      );

      if (!ditherRegion && shapePoints.length >= 3) {
        const pts = shapePoints;
        let minX = pts[0].x;
        let maxX = pts[0].x;
        let minY = pts[0].y;
        let maxY = pts[0].y;
        for (let i = 1; i < pts.length; i += 1) {
          const p = pts[i];
          if (p.x < minX) minX = p.x;
          if (p.x > maxX) maxX = p.x;
          if (p.y < minY) minY = p.y;
          if (p.y > maxY) maxY = p.y;
        }
        const pad = roiPadding + 8;
        const padded = {
          minX: minX - pad,
          maxX: maxX + pad,
          minY: minY - pad,
          maxY: maxY + pad
        };
        ditherRegion = boundingBoxToCaptureRegion(padded, 0, project);
      }

      if (ditherRegion && ditherRegion.width > 0 && ditherRegion.height > 0) {
        const state = storeRef.current;

        const settings = storeRef.current.tools.brushSettings;
        const sliderBase = Math.max(1, Math.round(settings.fillResolution || 1));

        const hasPressureSample = hadValidShapePressureRef.current;
        const usePressure =
          settings.pressureLinkedFillResolution && hasPressureSample;

        const effectivePressure = usePressure ? lastStablePressureRef.current : 0;

        let forcedPixelSize = usePressure
          ? computeShapePixelSize(effectivePressure)
          : sliderBase;

        forcedPixelSize = Math.max(1, Math.round(forcedPixelSize || 1));

        latestShapePixelSizeRef.current = forcedPixelSize;

        const originalFillResolution = state.tools.brushSettings.fillResolution;
        const originalLinked = state.tools.brushSettings.pressureLinkedFillResolution;

        if (ccDebug?.on && ccDebug?.verbose) {
          console.log('[dither-shape-finalize]', {
            effectivePressure,
            usePressure,
            forcedPixelSize
          });
        }

        try {
          state.setBrushSettings({
            fillResolution: forcedPixelSize,
            pressureLinkedFillResolution: false
          });

          brushEngine.applyStrokeDither(
            drawCtx,
            {
              x: ditherRegion.x,
              y: ditherRegion.y,
              width: ditherRegion.width,
              height: ditherRegion.height
            },
            undefined,
            {
              mergeExisting: liveBrushSettings.ditherBackgroundFill !== false,
              overridePressure: effectivePressure,
              overridePixelSize: forcedPixelSize,
              settingsOverride: liveBrushSettings
            }
          );
        } finally {
          state.setBrushSettings({
            fillResolution: originalFillResolution,
            pressureLinkedFillResolution: originalLinked
          });
        }
      }
    } catch (error) {
      logError('Shape dithering failed', error);
    }
  }

  const risographIntensity = liveBrushSettings.risographIntensity || 0;
  if (risographIntensity > 0) {
    const pattern = getRisographPattern(drawCtx);

    if (pattern) {
      drawCtx.save();

      const effect = getRisographEffectSettings(risographIntensity, { isPixelBrush });
      if (effect.alpha <= 0) {
        drawCtx.restore();
      } else {
        const misregX = (Math.random() - 0.5) * effect.jitter;
        const misregY = (Math.random() - 0.5) * effect.jitter;
        drawCtx.translate(misregX, misregY);

        drawCtx.beginPath();
        if (isPixelBrush) {
          drawCtx.moveTo(Math.round(shapePoints[0].x), Math.round(shapePoints[0].y));
          for (let i = 1; i < shapePoints.length; i++) {
            if (liveBrushSettings.risographOutline) {
              const roughX = Math.round(
                shapePoints[i].x + (Math.random() - 0.5) * effect.outlineJitter
              );
              const roughY = Math.round(
                shapePoints[i].y + (Math.random() - 0.5) * effect.outlineJitter
              );
              drawCtx.lineTo(roughX, roughY);
            } else {
              drawCtx.lineTo(Math.round(shapePoints[i].x), Math.round(shapePoints[i].y));
            }
          }
        } else {
          drawCtx.moveTo(shapePoints[0].x, shapePoints[0].y);
          for (let i = 1; i < shapePoints.length; i++) {
            if (liveBrushSettings.risographOutline) {
              const roughX = shapePoints[i].x + (Math.random() - 0.5) * effect.outlineJitter;
              const roughY = shapePoints[i].y + (Math.random() - 0.5) * effect.outlineJitter;
              drawCtx.lineTo(roughX, roughY);
            } else {
              drawCtx.lineTo(shapePoints[i].x, shapePoints[i].y);
            }
          }
        }
        drawCtx.closePath();
        drawCtx.clip();

        drawCtx.globalCompositeOperation = 'multiply';
        const fillAlpha = Math.min(effect.alpha * (isPixelBrush ? 1.05 : 0.95), 0.98);
        drawCtx.globalAlpha = fillAlpha;
        drawCtx.fillStyle = pattern;
        drawCtx.fillRect(0, 0, drawCtx.canvas.width, drawCtx.canvas.height);

        drawCtx.restore();
      }
    }
  }
};
