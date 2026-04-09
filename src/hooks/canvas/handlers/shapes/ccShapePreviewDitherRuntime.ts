import type React from 'react';
import { useAppStore } from '@/stores/useAppStore';
import type { BrushSettings } from '@/types';
import { canvasPool } from '@/utils/canvasPool';
import type { DitherAlgorithm, PatternStyle } from '@/utils/ditherAlgorithms';
import {
  createPressureResolutionState,
  type PressureResolutionState,
} from '@/utils/pressureResolution';
import { fillCcGradientDither } from '@/utils/colorCycle/ccGradientDither';
import { resolveStableFlatSeed } from '@/utils/colorCycle/ccFlatSeed';
import { computeConcentricMaxDistance } from '@/utils/colorCycle/concentricFillCore';
import { getActiveMarkGradientSession } from '@/hooks/canvas/utils/colorCycleMarkSession';
import type { StoredStop } from '@/utils/colorCycleGradientDefs';

export type PreparedPreviewGradient = {
  renderStops: StoredStop[];
  sortedStops: Array<{ position: number; rgba: [number, number, number, number] }>;
};

export type CcPreviewRoi = {
  origin: { x: number; y: number };
  size: { width: number; height: number };
};

export type CcPreviewRenderSettings = {
  pixelSize: number;
  levels: number;
  algorithm: DitherAlgorithm;
  patternStyle: PatternStyle;
  isFastPreview: boolean;
};

export type DitherGradPreviewState = {
  origin: { x: number; y: number } | null;
  lastPx: number;
  resState: PressureResolutionState;
  ccJobInFlight: boolean;
  ccJobDirty: boolean;
  ccJobSeq: number;
  ccLastCanvas?: HTMLCanvasElement;
  ccLastOrigin?: { x: number; y: number };
  ccLastSize?: { width: number; height: number };
  ccLastReplayKey?: string;
  ccScratchCanvas?: HTMLCanvasElement;
  ccScratchBuffer?: Uint8ClampedArray;
  ccPreparedGradientKey?: string;
  ccPreparedGradient?: PreparedPreviewGradient;
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

export const createCcShapePreviewSampleNormalized = ({
  colorCycleFillMode,
  localVertices,
  width,
  height,
}: {
  colorCycleFillMode?: BrushSettings['colorCycleFillMode'];
  localVertices: Array<{ x: number; y: number }>;
  width: number;
  height: number;
}): ((x: number, y: number) => number) => {
  if (colorCycleFillMode === 'concentric') {
    const edges = new Array(localVertices.length);
    for (let i = 0; i < localVertices.length; i += 1) {
      const v1 = localVertices[i];
      const v2 = localVertices[(i + 1) % localVertices.length];
      const dx = v2.x - v1.x;
      const dy = v2.y - v1.y;
      edges[i] = { v1x: v1.x, v1y: v1.y, dx, dy, len2: dx * dx + dy * dy };
    }
    const safeMaxDist = computeConcentricMaxDistance(localVertices, {
      minX: 0,
      minY: 0,
      width,
      height,
    });
    return (x, y) => {
      let minDistSq = Infinity;
      for (let i = 0; i < edges.length; i += 1) {
        const edge = edges[i];
        if (edge.len2 <= 0) continue;
        const tNum = (x - edge.v1x) * edge.dx + (y - edge.v1y) * edge.dy;
        const tVal = Math.max(0, Math.min(1, tNum / edge.len2));
        const px = edge.v1x + tVal * edge.dx;
        const py = edge.v1y + tVal * edge.dy;
        const ddx = x - px;
        const ddy = y - py;
        const d2 = ddx * ddx + ddy * ddy;
        if (d2 < minDistSq) {
          minDistSq = d2;
        }
      }
      return Math.min(1, Math.sqrt(Math.max(0, minDistSq)) / safeMaxDist);
    };
  }

  const axis = computeAxisOpposingEnds(localVertices);
  let minProj = Infinity;
  let maxProj = -Infinity;
  for (const vertex of localVertices) {
    const proj = vertex.x * axis.dir.x + vertex.y * axis.dir.y;
    if (proj < minProj) minProj = proj;
    if (proj > maxProj) maxProj = proj;
  }
  const projRange = Math.max(1e-6, maxProj - minProj);
  return (x, y) => {
    const proj = x * axis.dir.x + y * axis.dir.y;
    return (proj - minProj) / projRange;
  };
};

export const computeCcPreviewRoi = (
  points: Array<{ x: number; y: number }>,
  pad: number = 1,
): CcPreviewRoi => {
  let roiMinX = points[0].x;
  let roiMinY = points[0].y;
  let roiMaxX = points[0].x;
  let roiMaxY = points[0].y;

  for (let i = 1; i < points.length; i++) {
    const point = points[i];
    if (point.x < roiMinX) roiMinX = point.x;
    if (point.y < roiMinY) roiMinY = point.y;
    if (point.x > roiMaxX) roiMaxX = point.x;
    if (point.y > roiMaxY) roiMaxY = point.y;
  }

  const origin = {
    x: Math.floor(roiMinX) - pad,
    y: Math.floor(roiMinY) - pad,
  };
  const maxXInt = Math.ceil(roiMaxX) + pad;
  const maxYInt = Math.ceil(roiMaxY) + pad;

  return {
    origin,
    size: {
      width: Math.max(1, maxXInt - origin.x + 1),
      height: Math.max(1, maxYInt - origin.y + 1),
    },
  };
};

export const buildCcPreviewReplayKey = ({
  points,
  preparedGradientKey,
  colorCycleFillMode,
  pixelSize,
  levels,
  algorithm,
  patternStyle,
}: {
  points: Array<{ x: number; y: number }>;
  preparedGradientKey: string;
  colorCycleFillMode?: BrushSettings['colorCycleFillMode'];
  pixelSize: number;
  levels: number;
  algorithm: DitherAlgorithm;
  patternStyle: PatternStyle;
}): string => {
  const geometryKey = points
    .map(point => `${Math.round(point.x * 100) / 100},${Math.round(point.y * 100) / 100}`)
    .join('|');

  return [
    preparedGradientKey,
    `mode:${colorCycleFillMode ?? 'linear'}`,
    `px:${pixelSize}`,
    `levels:${levels}`,
    `algo:${algorithm}`,
    `pattern:${patternStyle}`,
    `points:${geometryKey}`,
  ].join('||');
};

export const canReplayCcPreview = (
  cachedOrigin: { x: number; y: number } | undefined,
  cachedSize: { width: number; height: number } | undefined,
  cachedReplayKeyOrRoi?: string | CcPreviewRoi,
  roi?: CcPreviewRoi,
  replayKey?: string,
): boolean => {
  if (!cachedOrigin || !cachedSize) {
    return false;
  }

  let cachedReplayKey: string | undefined;
  const effectiveReplayKey = replayKey;
  let effectiveRoi: CcPreviewRoi | undefined = roi;

  if (
    cachedReplayKeyOrRoi &&
    typeof cachedReplayKeyOrRoi === 'object' &&
    'origin' in cachedReplayKeyOrRoi &&
    'size' in cachedReplayKeyOrRoi
  ) {
    effectiveRoi = cachedReplayKeyOrRoi;
  } else {
    cachedReplayKey = cachedReplayKeyOrRoi;
  }

  if (!effectiveRoi) {
    return false;
  }

  return (
    cachedOrigin.x === effectiveRoi.origin.x &&
    cachedOrigin.y === effectiveRoi.origin.y &&
    cachedSize.width === effectiveRoi.size.width &&
    cachedSize.height === effectiveRoi.size.height &&
    (effectiveReplayKey === undefined || cachedReplayKey === effectiveReplayKey)
  );
};

const ensurePreviewCanvasCapacity = (
  existing: HTMLCanvasElement | undefined,
  width: number,
  height: number
): HTMLCanvasElement => {
  if (existing && existing.width >= width && existing.height >= height) {
    return existing;
  }
  if (existing) {
    canvasPool.release(existing);
  }
  return canvasPool.acquire(width, height);
};

const ensurePreviewBufferCapacity = (
  existing: Uint8ClampedArray | undefined,
  requiredBytes: number
): Uint8ClampedArray => {
  if (existing && existing.length >= requiredBytes) {
    return existing;
  }
  return new Uint8ClampedArray(requiredBytes);
};

const ditherGradPreviewStateByCanvas = new WeakMap<
  React.RefObject<HTMLCanvasElement>,
  DitherGradPreviewState
>();

export const getDitherGradPreviewState = (
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

export const shouldUseRenderedCcPreviewFill = (params: {
  canReplayCurrentPreview: boolean;
  shouldDrawCachedPreview: boolean;
}): boolean => params.shouldDrawCachedPreview;

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

type DrawingHandlersSubset = {
  hadValidShapePressureRef?: React.MutableRefObject<boolean>;
  latestShapePixelSizeRef?: React.MutableRefObject<number | null | undefined>;
  computeShapePixelSize?: (pressure: number) => number;
  lastStablePressureRef?: React.MutableRefObject<number>;
  ccShapePreviewCacheRef?: React.MutableRefObject<{ canvas: HTMLCanvasElement; origin: { x: number; y: number } } | null>;
  isDrawingShapeRef: React.MutableRefObject<boolean>;
  shapePointsRef: React.MutableRefObject<Array<{ x: number; y: number }>>;
};

export const runCcDitherPreviewRuntime = (args: {
  overlayCtx: CanvasRenderingContext2D;
  overlayCanvas: HTMLCanvasElement;
  allPoints: Array<{ x: number; y: number }>;
  brushSettings: BrushSettings;
  preparedGradientKey: string;
  preparedGradient: PreparedPreviewGradient;
  ditherGradPreviewState: DitherGradPreviewState;
  drawingHandlers: DrawingHandlersSubset;
  shouldKeepCachedCcPreviewVisible: (params: {
    hasCachedPreview: boolean;
    canReplayCurrentPreview: boolean;
    jobInFlight: boolean;
  }) => boolean;
  previewOpacity: number;
  schedulePolygonShapePreviewFrame: (
    resolvePreviewPoint: () => { x: number; y: number } | null
  ) => void;
  getLatestPolygonPreviewPoint: () => { x: number; y: number } | null;
  previewRenderSettings: CcPreviewRenderSettings;
}): { didCustomFill: boolean; suppressLivePreviewChrome: boolean } => {
  const {
    overlayCtx,
    overlayCanvas,
    allPoints,
    brushSettings,
    preparedGradientKey,
    preparedGradient,
    ditherGradPreviewState,
    drawingHandlers,
    shouldKeepCachedCcPreviewVisible,
    previewOpacity,
    schedulePolygonShapePreviewFrame,
    getLatestPolygonPreviewPoint,
    previewRenderSettings,
  } = args;

  const nextPreviewRoi = computeCcPreviewRoi(allPoints);
  const pixelSize = previewRenderSettings.pixelSize;
  const levels = previewRenderSettings.levels;
  const fillAlgorithm = previewRenderSettings.algorithm;
  const fillPatternStyle = previewRenderSettings.patternStyle;
  const replayKey = buildCcPreviewReplayKey({
    points: allPoints,
    preparedGradientKey,
    colorCycleFillMode: brushSettings.colorCycleFillMode,
    pixelSize,
    levels,
    algorithm: fillAlgorithm,
    patternStyle: fillPatternStyle,
  });
  const canReplayCurrentPreview =
    ditherGradPreviewState.ccLastCanvas &&
    canReplayCcPreview(
      ditherGradPreviewState.ccLastOrigin,
      ditherGradPreviewState.ccLastSize,
      ditherGradPreviewState.ccLastReplayKey,
      nextPreviewRoi,
      replayKey,
    );
  const hasCachedPreview =
    Boolean(ditherGradPreviewState.ccLastCanvas) &&
    Boolean(ditherGradPreviewState.ccLastOrigin);
  const shouldDrawCachedPreview =
    Boolean(canReplayCurrentPreview) ||
    shouldKeepCachedCcPreviewVisible({
      hasCachedPreview,
      canReplayCurrentPreview: Boolean(canReplayCurrentPreview),
      jobInFlight: ditherGradPreviewState.ccJobInFlight,
    });
  const shouldUseCustomFill = shouldUseRenderedCcPreviewFill({
    canReplayCurrentPreview: Boolean(canReplayCurrentPreview),
    shouldDrawCachedPreview: Boolean(shouldDrawCachedPreview),
  });
  const suppressLivePreviewChrome = false;

  if (shouldDrawCachedPreview && ditherGradPreviewState.ccLastCanvas && ditherGradPreviewState.ccLastOrigin) {
    overlayCtx.save();
    overlayCtx.setTransform(1, 0, 0, 1, 0, 0);
    overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
    overlayCtx.restore();
    overlayCtx.save();
    overlayCtx.globalAlpha = previewOpacity;
    overlayCtx.imageSmoothingEnabled = false;
    overlayCtx.drawImage(
      ditherGradPreviewState.ccLastCanvas,
      ditherGradPreviewState.ccLastOrigin.x,
      ditherGradPreviewState.ccLastOrigin.y
    );
    overlayCtx.restore();
  } else {
    overlayCtx.save();
    overlayCtx.setTransform(1, 0, 0, 1, 0, 0);
    overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
    overlayCtx.restore();
  }

  if (ditherGradPreviewState.ccJobInFlight) {
    ditherGradPreviewState.ccJobDirty = true;
  } else {
    ditherGradPreviewState.ccJobInFlight = true;
    ditherGradPreviewState.ccJobDirty = false;
    const mySeq = ++ditherGradPreviewState.ccJobSeq;
    const origin = nextPreviewRoi.origin;
    const w = nextPreviewRoi.size.width;
    const h = nextPreviewRoi.size.height;
    const localVertices = allPoints.map(pt => ({
      x: pt.x - origin.x,
      y: pt.y - origin.y,
    }));
    const sampleNormalized = createCcShapePreviewSampleNormalized({
      colorCycleFillMode: brushSettings.colorCycleFillMode,
      localVertices,
      width: w,
      height: h,
    });
    const sortedStops = preparedGradient.sortedStops;
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
    const fillBackground = (brushSettings.ditherGradBgFill ?? brushSettings.ditherBackgroundFill) !== false;
    ditherGradPreviewState.ccScratchCanvas = ensurePreviewCanvasCapacity(
      ditherGradPreviewState.ccScratchCanvas,
      w,
      h
    );
    const tempCanvas = ditherGradPreviewState.ccScratchCanvas;
    const tempCtx = tempCanvas.getContext(
      '2d',
      { willReadFrequently: true } as CanvasRenderingContext2DSettings
    );
    if (!tempCtx) {
      canvasPool.release(tempCanvas);
      ditherGradPreviewState.ccScratchCanvas = undefined;
      ditherGradPreviewState.ccJobInFlight = false;
    } else {
      tempCtx.setTransform(1, 0, 0, 1, 0, 0);
      tempCtx.globalCompositeOperation = 'source-over';
      tempCtx.globalAlpha = 1;
      tempCtx.imageSmoothingEnabled = false;
      tempCtx.clearRect(0, 0, w, h);
      const requiredBytes = w * h * 4;
      ditherGradPreviewState.ccScratchBuffer = ensurePreviewBufferCapacity(
        ditherGradPreviewState.ccScratchBuffer,
        requiredBytes
      );
      const data = ditherGradPreviewState.ccScratchBuffer.subarray(0, requiredBytes);
      data.fill(0);
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
            return;
          }
          const flatSeed = resolveStableFlatSeed({
            markId: liveSession?.markId ?? null,
            bounds: { minX: 0, minY: 0, width: w, height: h },
            points: localVertices,
          });
          await fillCcGradientDither({
            vertices: localVertices,
            minX: 0,
            minY: 0,
            maxX: w - 1,
            maxY: h - 1,
            pixelSize: previewRenderSettings.pixelSize,
            levels: previewRenderSettings.levels,
            baseOffset: 0,
            flatPairSpread: brushSettings.ditherPaletteSpread,
            ditherPatternDiversity: brushSettings.ditherPatternDiversity,
            flatSeed,
            algorithm: previewRenderSettings.algorithm,
            patternStyle: previewRenderSettings.patternStyle,
            sampledFlatTraceId: liveSession?.markId
              ? `${liveSession.markId}:preview`
              : undefined,
            sampledFlatTraceStage: 'preview',
            fillBackground,
            yieldIfNeeded,
            sampleNormalized,
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
          const imageData = new ImageData(new Uint8ClampedArray(data), w, h);
          tempCtx.putImageData(imageData, 0, 0);
          ditherGradPreviewState.ccLastCanvas = ensurePreviewCanvasCapacity(
            ditherGradPreviewState.ccLastCanvas,
            w,
            h
          );
          const displayCanvas = ditherGradPreviewState.ccLastCanvas;
          const displayCtx = displayCanvas.getContext(
            '2d',
            { willReadFrequently: true } as CanvasRenderingContext2DSettings
          );
          if (!displayCtx) {
            return;
          }
          displayCtx.setTransform(1, 0, 0, 1, 0, 0);
          displayCtx.globalCompositeOperation = 'source-over';
          displayCtx.globalAlpha = 1;
          displayCtx.imageSmoothingEnabled = false;
          displayCtx.clearRect(0, 0, w, h);
          displayCtx.drawImage(tempCanvas, 0, 0, w, h, 0, 0, w, h);
          ditherGradPreviewState.ccLastOrigin = { ...origin };
          ditherGradPreviewState.ccLastSize = { width: w, height: h };
          ditherGradPreviewState.ccLastReplayKey = replayKey;
          if (drawingHandlers.ccShapePreviewCacheRef) {
            drawingHandlers.ccShapePreviewCacheRef.current = {
              canvas: displayCanvas,
              origin: { ...origin },
            };
          }
          const canRefreshPreview =
            liveState.tools.shapeMode &&
            drawingHandlers.isDrawingShapeRef.current &&
            drawingHandlers.shapePointsRef.current.length > 0;
          if (canRefreshPreview) {
            schedulePolygonShapePreviewFrame(() =>
              getLatestPolygonPreviewPoint()
            );
          }
        } catch {
          // Keep scratch buffers for reuse on the next preview job.
        } finally {
          ditherGradPreviewState.ccJobInFlight = false;
          if (ditherGradPreviewState.ccJobDirty) {
            ditherGradPreviewState.ccJobDirty = false;
            const rerenderPoint = getLatestPolygonPreviewPoint();
            const canReplayPreview =
              Boolean(rerenderPoint) &&
              useAppStore.getState().tools.shapeMode &&
              drawingHandlers.isDrawingShapeRef.current &&
              drawingHandlers.shapePointsRef.current.length > 0;
            if (canReplayPreview) {
              schedulePolygonShapePreviewFrame(() =>
                getLatestPolygonPreviewPoint() ?? rerenderPoint
              );
            }
          }
        }
      })();
    }
  }
  return {
    didCustomFill: shouldUseCustomFill,
    suppressLivePreviewChrome,
  };
};
