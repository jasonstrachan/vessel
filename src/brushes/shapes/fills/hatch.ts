import type { StrokeJob, ShapeFillScheduler } from '@/lib/shapeFill';
import { getStrokePipeline, isWebGPUSupported } from '@/lib/shapeFill';
import type { StrokePipelineResult } from '@/lib/shapeFill/gpu/StrokePipeline';
import { debugLog, debugWarn } from '@/utils/debug';
import type { BrushSettings } from '@/types';

import type { Point } from './types';

type CrossHatchDependencies = {
  gpuScheduler?: ShapeFillScheduler;
};

export type DrawCrossHatchPolygonParams = {
  ctx: CanvasRenderingContext2D;
  polygonData: {
    vertices: Point[];
    fillColor?: string;
    spacingOverride?: number;
    rotationOverride?: number;
    lineWidthOverride?: number;
  };
  brushSettings: BrushSettings;
  isPreview?: boolean;
  dependencies?: CrossHatchDependencies;
};

type Bounds = {
  minx: number;
  maxx: number;
  miny: number;
  maxy: number;
};

type HatchLine = {
  base: number;
  tilt: number;
  bow: number;
  waveAmp: number;
  waveFreq: number;
  wavePhase: number;
  waveAmp2: number;
  waveFreq2: number;
  wavePhase2: number;
  weight: number;
  constant: number;
};

type HatchLineSet = {
  angle: number;
  cos: number;
  sin: number;
  lines: HatchLine[];
};

type HatchContext = {
  startY: number;
  endY: number;
  rangeY: number;
  segmentStep: number;
  cx: number;
  cy: number;
};

const DEFAULT_LINE_WIDTH = 1;
const DEFAULT_ORGANIC = 0.75;
const DEFAULT_HIGHLIGHT_SCALE = 1.05;

const drawCrossHatchPolygonCpu = ({
  ctx,
  polygonData,
  brushSettings,
  isPreview = false,
  dependencies,
}: DrawCrossHatchPolygonParams): void => {
  const vertices = (polygonData?.vertices ?? []).filter(
    (vertex): vertex is Point => Boolean(vertex) && typeof vertex.x === 'number' && typeof vertex.y === 'number'
  );

  if (vertices.length < 3) {
    return;
  }

  void isPreview;
  void dependencies;

  ctx.save();
  ctx.globalAlpha = brushSettings.opacity;
  ctx.globalCompositeOperation = brushSettings.blendMode || 'source-over';

  tracePolygonPath(ctx, vertices);
  ctx.clip('nonzero');

  const angle = (((polygonData?.rotationOverride ?? brushSettings.crossHatchRotation) ?? 45) * Math.PI) / 180;
  const spacing = Math.max(2, polygonData?.spacingOverride ?? brushSettings.crossHatchSpacing ?? 10);
  const baseLineWidth = brushSettings.shapeFillLineWidth
    ?? brushSettings.crossHatchLineWidth
    ?? DEFAULT_LINE_WIDTH;
  const lineWidth = Math.max(
    0.2,
    polygonData?.lineWidthOverride ?? baseLineWidth
  );
  const cross = true;
  const highlightScale = DEFAULT_HIGHLIGHT_SCALE;
  const organic = clamp01(DEFAULT_ORGANIC);
  const color = polygonData?.fillColor ?? brushSettings.color ?? '#000000';

  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  const bounds = computeBounds(vertices);
  const canvas = ctx.canvas;
  const pad = Math.hypot(canvas.width, canvas.height);
  const cx = (bounds.minx + bounds.maxx) / 2;
  const cy = (bounds.miny + bounds.maxy) / 2;

  const context: HatchContext = {
    startY: bounds.miny - pad,
    endY: bounds.maxy + pad,
    rangeY: Math.max(1, bounds.maxy - bounds.miny + pad * 2),
    segmentStep: Math.max(6, spacing * 0.35),
    cx,
    cy,
  };

  const baseSeed = hashPoints(vertices);
  const mainSet = buildLineSet({
    angle,
    spacing,
    bounds,
    pad,
    rng: createRng(baseSeed ^ 0x9e3779b9 ^ (Math.floor(angle * 1000) >>> 0)),
    context,
    organic,
  });

  drawLineSet(ctx, mainSet, context, lineWidth);

  if (cross) {
    const crossAngle = angle + Math.PI / 2;
    const crossSet = buildLineSet({
      angle: crossAngle,
      spacing,
      bounds,
      pad,
      rng: createRng(baseSeed ^ 0x51633e2d ^ (Math.floor(crossAngle * 873) >>> 0)),
      context,
      organic,
    });

    drawLineSet(ctx, crossSet, context, lineWidth);
    drawCrossHighlights(ctx, mainSet, crossSet, {
      color,
      lineWidth,
      polygon: vertices,
      bounds,
      context,
      highlightScale,
    });
  }

  ctx.restore();
};

export const drawCrossHatchPolygon = (params: DrawCrossHatchPolygonParams): void => {
  const scheduler = params.dependencies?.gpuScheduler;
  const canUseGpu = Boolean(scheduler) && typeof window !== 'undefined' && isWebGPUSupported();

  if (!canUseGpu) {
    drawCrossHatchPolygonCpu(params);
    return;
  }

  const scheduled = drawCrossHatchPolygonGpu(params, scheduler!);
  if (!scheduled) {
    drawCrossHatchPolygonCpu(params);
  }
};

const FNV_OFFSET = 2166136261;
const FNV_PRIME = 16777619;
const MAX_GPU_HIGHLIGHTS = 6000;

type OrientationFrame = {
  direction: Point;
  normal: Point;
  baseOrigin: Point;
  directionExtent: number;
  forwardDistance: number;
  backDistance: number;
  maxLevels: number;
  perpRange: { min: number; max: number };
};

const drawCrossHatchPolygonGpu = (
  params: DrawCrossHatchPolygonParams,
  scheduler: ShapeFillScheduler,
): boolean => {
  const {
    ctx,
    polygonData,
    brushSettings,
    isPreview = false,
  } = params;

  const vertices = (polygonData?.vertices ?? []).filter(
    (vertex): vertex is Point => Boolean(vertex) && typeof vertex.x === 'number' && typeof vertex.y === 'number'
  );

  if (vertices.length < 3) {
    return false;
  }

  const spacing = Math.max(2, polygonData?.spacingOverride ?? brushSettings.crossHatchSpacing ?? 10);
  const baseLineWidth = brushSettings.shapeFillLineWidth
    ?? brushSettings.crossHatchLineWidth
    ?? DEFAULT_LINE_WIDTH;
  const lineWidth = Math.max(0.2, polygonData?.lineWidthOverride ?? baseLineWidth);
  const color = polygonData?.fillColor ?? brushSettings.color ?? '#000000';
  const highlightScale = DEFAULT_HIGHLIGHT_SCALE;

  const angleDeg = (polygonData?.rotationOverride ?? brushSettings.crossHatchRotation ?? 45) % 360;
  const crossAngleDeg = (angleDeg + 90) % 360;
  const angleRad = (angleDeg * Math.PI) / 180;
  const crossAngleRad = (crossAngleDeg * Math.PI) / 180;

  const bounds = computeBounds(vertices);
  const center = {
    x: (bounds.minx + bounds.maxx) / 2,
    y: (bounds.miny + bounds.maxy) / 2,
  };

  const dirA = { x: Math.cos(angleRad), y: Math.sin(angleRad) };
  const normalA = { x: -dirA.y, y: dirA.x };
  const dirB = { x: Math.cos(crossAngleRad), y: Math.sin(crossAngleRad) };
  const normalB = { x: -dirB.y, y: dirB.x };

  const frameA = computeOrientationFrame(vertices, center, dirA, normalA, spacing);
  const frameB = computeOrientationFrame(vertices, center, dirB, normalB, spacing);

  const fieldResolution = Math.max(2, brushSettings.flowFieldResolution ?? 8);
  const width = Math.max(1, Math.ceil(bounds.maxx - bounds.minx));
  const height = Math.max(1, Math.ceil(bounds.maxy - bounds.miny));
  const diagonal = Math.hypot(width, height);
  const verticesBuffer = toVertexBuffer(vertices);
  const baseSeed = hashPoints(vertices);
  const pixelMode = brushSettings.shapeFillPixelMode ?? true;

  const pipeline = getStrokePipeline();
  let didFallback = false;
  let hasDrawn = false;

  const fallbackToCpu = () => {
    if (didFallback) return;
    didFallback = true;
    drawCrossHatchPolygonCpu({
      ...params,
      dependencies: { ...params.dependencies, gpuScheduler: undefined },
    });
  };

  type OrientationJob = {
    angleDeg: number;
    seedSalt: number;
  };

  const orientationJobs: OrientationJob[] = [
    { angleDeg, seedSalt: 0 },
    { angleDeg: crossAngleDeg, seedSalt: 0x51633e2d },
  ];

  const priority = isPreview ? 'preview' : 'final';

  const runOrientation = async ({ angleDeg: orientationDeg, seedSalt }: OrientationJob): Promise<boolean> => {
    if (didFallback) return false;

    const orientationBrush: BrushSettings = {
      ...brushSettings,
      flowOrientationAngle: orientationDeg,
      shapeFillLineWidth: lineWidth,
    };

    const seedsPerAxis = Math.max(6, Math.round(Math.max(width, height) / spacing));
    const lineLength = Math.max(spacing * 4, diagonal + spacing * 2);

    const job: StrokeJob = {
      id: computeCrossHatchGpuJobId(
        verticesBuffer,
        spacing,
        orientationDeg,
        lineWidth,
        fieldResolution,
        pixelMode,
        baseSeed ^ seedSalt,
      ),
      vertices: verticesBuffer,
      bounds: {
        minX: bounds.minx,
        minY: bounds.miny,
        maxX: bounds.maxx,
        maxY: bounds.maxy,
      },
      brushSettings: orientationBrush,
      seed: baseSeed ^ seedSalt,
      dynamicParams: {
        crossHatchSpacing: spacing,
        crossHatchSeedsPerAxis: seedsPerAxis,
        crossHatchLineLength: lineLength,
      },
      previewResolution: {
        width,
        height,
        scale: isPreview ? 0.5 : 1,
        fieldResolution,
      },
      finalResolution: {
        width,
        height,
        scale: 1,
        fieldResolution,
      },
      pixelMode,
      margin: spacing * 2,
      metadata: {
        brush: 'cross-hatch',
        orientation: orientationDeg,
      },
    };

    const drawOutput = async (output: StrokePipelineResult): Promise<boolean> => {
      if (typeof ImageData === 'undefined') {
        return false;
      }

      const imageData = new ImageData(output.pixels, output.width, output.height);
      const renderBitmap = async (): Promise<boolean> => {
        ctx.save();
        tracePolygonPath(ctx, vertices);
        ctx.clip('nonzero');
        ctx.globalAlpha = brushSettings.opacity;
        ctx.globalCompositeOperation = brushSettings.blendMode || 'source-over';
        ctx.imageSmoothingEnabled = !(brushSettings.shapeFillPixelMode ?? true);

        if (typeof createImageBitmap === 'function') {
          const bitmap = await createImageBitmap(imageData);
          ctx.drawImage(bitmap, output.origin.x, output.origin.y);
          ctx.restore();
          bitmap.close();
          return true;
        }

        ctx.putImageData(imageData, output.origin.x, output.origin.y);
        ctx.restore();
        return true;
      };

      const rendered = await renderBitmap().catch(() => false);
      if (rendered) {
        hasDrawn = true;
      }
      return rendered;
    };

    try {
      const result = await scheduler.queueJob(job, {
        priority,
        cacheResult: true,
        readback: priority === 'preview' ? 'all' : false,
      });

      try {
        if (!result.fieldResult) {
          debugWarn('shape-fill', 'Cross hatch GPU field unavailable');
          return false;
        }

        const output = await pipeline.render(job, result.fieldResult, {
          priority,
          color,
        });

        if (!output) {
          debugWarn('shape-fill', 'Cross hatch GPU render failed');
          return false;
        }

        try {
          const drawn = await drawOutput(output);
          if (!drawn) {
            return false;
          }
        } finally {
          output.release();
        }

        debugLog('shape-fill', `GPU cross hatch orientation ${orientationDeg.toFixed(1)}° complete (${priority})`, {
          gpuGenerationMs: result.fieldResult.metrics?.generationTimeMs,
          gpuTiles: result.fieldResult.metrics?.tilesProcessed,
          jobId: job.id,
        });

        return true;
      } finally {
        result.release();
      }
    } catch (error) {
      const errorName = typeof error === 'object' && error && 'name' in error
        ? (error as { name?: string }).name
        : undefined;
      if (errorName !== 'AbortError') {
        debugWarn('shape-fill', 'Cross hatch GPU orientation failed', error);
      }
      return false;
    }
  };

  const runAllOrientations = async () => {
    for (const job of orientationJobs) {
      const ok = await runOrientation(job);
      if (!ok) {
        fallbackToCpu();
        return;
      }
    }

    if (!isPreview && hasDrawn) {
      ctx.save();
      tracePolygonPath(ctx, vertices);
      ctx.clip('nonzero');
      drawGpuHighlights(ctx, {
        polygon: vertices,
        center,
        spacing,
        color,
        lineWidth,
        highlightScale,
        frameA,
        frameB,
      });
      ctx.restore();
    }
  };

  void runAllOrientations().catch(error => {
    const errorName = typeof error === 'object' && error && 'name' in error
      ? (error as { name?: string }).name
      : undefined;
    if (errorName !== 'AbortError') {
      debugWarn('shape-fill', 'Cross hatch GPU job sequence failed', error);
    }
    fallbackToCpu();
  });

  return true;
};

const toVertexBuffer = (vertices: Point[]): Float32Array => {
  const buffer = new Float32Array(vertices.length * 2);
  for (let i = 0; i < vertices.length; i += 1) {
    buffer[i * 2] = vertices[i].x;
    buffer[i * 2 + 1] = vertices[i].y;
  }
  return buffer;
};

const computeCrossHatchGpuJobId = (
  vertices: Float32Array,
  spacing: number,
  angleDeg: number,
  lineWidth: number,
  fieldResolution: number,
  pixelMode: boolean,
  seed: number,
): string => {
  let hash = (FNV_OFFSET ^ seed) >>> 0;
  for (let i = 0; i < vertices.length; i += 1) {
    hash ^= Math.round(vertices[i] * 4);
    hash = Math.imul(hash, FNV_PRIME) >>> 0;
  }
  hash ^= Math.round(spacing * 256) >>> 0;
  hash = Math.imul(hash, FNV_PRIME) >>> 0;
  hash ^= Math.round(lineWidth * 1024) >>> 0;
  hash = Math.imul(hash, FNV_PRIME) >>> 0;
  hash ^= Math.round(angleDeg * 1024) >>> 0;
  hash = Math.imul(hash, FNV_PRIME) >>> 0;
  hash ^= Math.round(fieldResolution * 256) >>> 0;
  hash = Math.imul(hash, FNV_PRIME) >>> 0;
  hash ^= pixelMode ? 1 : 0;
  hash = Math.imul(hash, FNV_PRIME) >>> 0;
  return `cross-hatch-${hash.toString(16)}`;
};

const computeOrientationFrame = (
  vertices: Point[],
  center: { x: number; y: number },
  direction: Point,
  normal: Point,
  spacing: number,
): OrientationFrame => {
  let alongMin = Infinity;
  let alongMax = -Infinity;
  let perpMin = Infinity;
  let perpMax = -Infinity;

  for (const vertex of vertices) {
    const relX = vertex.x - center.x;
    const relY = vertex.y - center.y;
    const along = relX * direction.x + relY * direction.y;
    const perp = relX * normal.x + relY * normal.y;
    if (along < alongMin) alongMin = along;
    if (along > alongMax) alongMax = along;
    if (perp < perpMin) perpMin = perp;
    if (perp > perpMax) perpMax = perp;
  }

  if (!Number.isFinite(alongMin) || !Number.isFinite(alongMax)) {
    alongMin = -spacing;
    alongMax = spacing;
  }
  if (!Number.isFinite(perpMin) || !Number.isFinite(perpMax)) {
    perpMin = -spacing;
    perpMax = spacing;
  }

  const directionExtent = Math.max(spacing, alongMax - alongMin + spacing * 0.5);
  const baseOrigin = {
    x: center.x + direction.x * alongMin,
    y: center.y + direction.y * alongMin,
  };

  const extendedPerpMin = perpMin - spacing;
  const extendedPerpMax = perpMax + spacing;
  const forwardDistance = Math.max(0, extendedPerpMax);
  const backDistance = Math.max(0, -extendedPerpMin);

  const totalSpan = forwardDistance + backDistance;
  const safeSpacing = Math.max(spacing, 1e-3);
  const maxLevels = Math.max(1, Math.ceil(totalSpan / safeSpacing) + 4);

  return {
    direction,
    normal,
    baseOrigin,
    directionExtent,
    forwardDistance,
    backDistance,
    maxLevels,
    perpRange: {
      min: extendedPerpMin,
      max: extendedPerpMax,
    },
  };
};

const collectOffsets = (range: { min: number; max: number }, spacing: number): number[] => {
  const safeSpacing = Math.max(spacing, 1e-3);
  const start = Math.floor(range.min / safeSpacing) * safeSpacing;
  const end = Math.ceil(range.max / safeSpacing) * safeSpacing;
  const offsets: number[] = [];
  for (let value = start; value <= end + safeSpacing * 0.5; value += safeSpacing) {
    offsets.push(value);
  }
  return offsets;
};

const drawGpuHighlights = (
  ctx: CanvasRenderingContext2D,
  options: {
    polygon: Point[];
    center: { x: number; y: number };
    spacing: number;
    color: string;
    lineWidth: number;
    highlightScale: number;
    frameA: OrientationFrame;
    frameB: OrientationFrame;
  },
): void => {
  const radius = Math.max(0.1, options.lineWidth * options.highlightScale);
  if (!Number.isFinite(radius) || radius <= 0) {
    return;
  }

  const offsetsA = collectOffsets(options.frameA.perpRange, options.spacing);
  const offsetsB = collectOffsets(options.frameB.perpRange, options.spacing);

  if (!offsetsA.length || !offsetsB.length) {
    return;
  }

  const maxPairs = Math.max(1, MAX_GPU_HIGHLIGHTS);
  const strideA = Math.max(1, Math.ceil(offsetsA.length / Math.sqrt(maxPairs)));
  const strideB = Math.max(1, Math.ceil(offsetsB.length / Math.sqrt(maxPairs)));

  ctx.fillStyle = options.color;
  ctx.globalAlpha = 1;

  let drawn = 0;
  for (let i = 0; i < offsetsA.length && drawn < maxPairs; i += strideA) {
    const offsetA = offsetsA[i];
    for (let j = 0; j < offsetsB.length && drawn < maxPairs; j += strideB) {
      const offsetB = offsetsB[j];
      const point = {
        x: options.center.x + options.frameA.normal.x * offsetA + options.frameB.normal.x * offsetB,
        y: options.center.y + options.frameA.normal.y * offsetA + options.frameB.normal.y * offsetB,
      };

      if (!pointInPoly(point.x, point.y, options.polygon)) {
        continue;
      }

      ctx.beginPath();
      ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
      ctx.fill();
      drawn += 1;
    }
  }
};

function buildLineSet({
  angle,
  spacing,
  bounds,
  pad,
  rng,
  context,
  organic,
}: {
  angle: number;
  spacing: number;
  bounds: Bounds;
  pad: number;
  rng: () => number;
  context: HatchContext;
  organic: number;
}): HatchLineSet {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const lines: HatchLine[] = [];
  const min = bounds.minx - pad - spacing * 3;
  const max = bounds.maxx + pad + spacing * 3;
  const wobble = clamp01(organic);
  let pos = min + (rng() - 0.5) * spacing * wobble;
  const guardLimit = 2000;
  let guard = 0;

  while (pos <= max && guard < guardLimit) {
    const base = pos + (rng() - 0.5) * spacing * 0.75 * wobble;
    const line: HatchLine = {
      base,
      tilt: (rng() - 0.5) * spacing * 0.45 * wobble,
      bow: (rng() - 0.5) * spacing * 0.35 * wobble,
      waveAmp: spacing * (0.14 + rng() * 0.22) * wobble,
      waveFreq: (0.7 + rng() * 1.1) / Math.max(160, spacing * 10),
      wavePhase: rng() * Math.PI * 2,
      waveAmp2: spacing * 0.09 * (0.5 + rng() * 0.7) * wobble,
      waveFreq2: (1.4 + rng() * 1.6) / Math.max(220, spacing * 12),
      wavePhase2: rng() * Math.PI * 2,
      weight: 1 + (rng() - 0.5) * 0.22 * (0.35 + wobble * 0.65),
      constant: 0,
    };
    line.constant = computeLineConstant(line.base, cos, sin, context.cx, context.cy);
    lines.push(line);

    const spacingFactor = 1 + (rng() - 0.5) * 0.6 * wobble;
    pos += spacing * Math.max(0.35, spacingFactor);
    guard++;
  }

  if (lines.length === 0) {
    const fallback: HatchLine = {
      base: (bounds.minx + bounds.maxx) / 2,
      tilt: 0,
      bow: 0,
      waveAmp: 0,
      waveFreq: 1,
      wavePhase: 0,
      waveAmp2: 0,
      waveFreq2: 1,
      wavePhase2: 0,
      weight: 1,
      constant: 0,
    };
    fallback.constant = computeLineConstant(fallback.base, cos, sin, context.cx, context.cy);
    lines.push(fallback);
  }

  return { angle, cos, sin, lines };
}

function drawLineSet(ctx: CanvasRenderingContext2D, set: HatchLineSet, context: HatchContext, baseLineWidth: number): void {
  ctx.save();
  ctx.translate(context.cx, context.cy);
  ctx.rotate(set.angle);
  ctx.translate(-context.cx, -context.cy);

  const startY = context.startY;
  const endY = context.endY;
  const step = context.segmentStep;

  for (const line of set.lines) {
    ctx.lineWidth = Math.max(0.2, baseLineWidth * line.weight);
    ctx.beginPath();
    let first = true;
    let y = startY;
    while (y <= endY) {
      const x = evalLineLocalX(line, y, context);
      if (first) {
        ctx.moveTo(x, y);
        first = false;
      } else {
        ctx.lineTo(x, y);
      }
      y += step;
    }
    if (y - step < endY) {
      const xEnd = evalLineLocalX(line, endY, context);
      ctx.lineTo(xEnd, endY);
    }
    ctx.stroke();
  }

  ctx.restore();
}

function drawCrossHighlights(
  ctx: CanvasRenderingContext2D,
  setA: HatchLineSet,
  setB: HatchLineSet,
  options: {
    color: string;
    lineWidth: number;
    polygon: Point[];
    bounds: Bounds;
    context: HatchContext;
    highlightScale?: number;
  }
): void {
  const intersections = computeIntersections(setA, setB, options);
  if (!intersections.length) return;

  ctx.save();
  ctx.fillStyle = options.color;
  ctx.globalAlpha = 1;
  const scale = options.highlightScale && Number.isFinite(options.highlightScale)
    ? Math.max(0, options.highlightScale)
    : DEFAULT_HIGHLIGHT_SCALE;
  for (const inter of intersections) {
    const baseWidth = Math.max(inter.widthA, inter.widthB);
    const radius = Math.max(0.1, baseWidth * scale);
    ctx.beginPath();
    ctx.arc(inter.x, inter.y, radius, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function computeIntersections(
  setA: HatchLineSet,
  setB: HatchLineSet,
  options: {
    lineWidth: number;
    polygon: Point[];
    bounds: Bounds;
    context: HatchContext;
  }
): Array<{ x: number; y: number; widthA: number; widthB: number }> {
  const results: Array<{ x: number; y: number; widthA: number; widthB: number }> = [];
  const bounds = options.bounds;
  const margin = Math.max(6, (options.lineWidth || 1) * 4);
  for (const lineA of setA.lines) {
    for (const lineB of setB.lines) {
      const det = setA.cos * setB.sin - setA.sin * setB.cos;
      if (Math.abs(det) < 1e-6) continue;
      const px = (lineA.constant * setB.sin - setA.sin * lineB.constant) / det;
      const py = (-lineA.constant * setB.cos + setA.cos * lineB.constant) / det;
      if (
        px < bounds.minx - margin ||
        px > bounds.maxx + margin ||
        py < bounds.miny - margin ||
        py > bounds.maxy + margin
      ) {
        continue;
      }
      if (!pointInPoly(px, py, options.polygon)) continue;

      const localA = toLocal(px, py, setA.angle, options.context.cx, options.context.cy);
      const localB = toLocal(px, py, setB.angle, options.context.cx, options.context.cy);
      const adjAx = evalLineLocalX(lineA, localA.y, options.context);
      const adjBx = evalLineLocalX(lineB, localB.y, options.context);
      const worldA = toWorld(adjAx, localA.y, setA.angle, options.context.cx, options.context.cy);
      const worldB = toWorld(adjBx, localB.y, setB.angle, options.context.cx, options.context.cy);
      const ix = (worldA.x + worldB.x) * 0.5;
      const iy = (worldA.y + worldB.y) * 0.5;
      results.push({
        x: ix,
        y: iy,
        widthA: Math.max(0.2, options.lineWidth * lineA.weight),
        widthB: Math.max(0.2, options.lineWidth * lineB.weight),
      });
    }
  }
  return results;
}

function evalLineLocalX(line: HatchLine, y: number, context: HatchContext): number {
  const t = (y - context.startY) / context.rangeY;
  const centered = t - 0.5;
  const lean = line.tilt * centered * 1.2;
  const bow = line.bow * (centered * centered - 0.25) * 2.4;
  const wave1 = Math.sin(y * line.waveFreq + line.wavePhase) * line.waveAmp;
  const wave2 = Math.sin(y * line.waveFreq2 + line.wavePhase2) * line.waveAmp2;
  return line.base + lean + bow + wave1 + wave2;
}

function computeLineConstant(base: number, cos: number, sin: number, cx: number, cy: number): number {
  return (base - cx) + cos * cx + sin * cy;
}

function toLocal(x: number, y: number, angle: number, cx: number, cy: number): { x: number; y: number } {
  const dx = x - cx;
  const dy = y - cy;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return {
    x: cos * dx + sin * dy + cx,
    y: -sin * dx + cos * dy + cy,
  };
}

function toWorld(x: number, y: number, angle: number, cx: number, cy: number): { x: number; y: number } {
  const dx = x - cx;
  const dy = y - cy;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return {
    x: cos * dx - sin * dy + cx,
    y: sin * dx + cos * dy + cy,
  };
}

function hashPoints(points: Point[]): number {
  let hash = 2166136261;
  for (const pt of points) {
    hash ^= Math.round(pt.x * 16);
    hash = Math.imul(hash, 16777619);
    hash ^= Math.round(pt.y * 16);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function createRng(seed: number): () => number {
  let state = seed >>> 0;
  if (state === 0) state = 0x6d2b79f5;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function clamp01(value: number): number {
  if (Number.isNaN(value) || value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function computeBounds(points: Point[]): Bounds {
  let minx = points[0].x;
  let maxx = points[0].x;
  let miny = points[0].y;
  let maxy = points[0].y;

  for (const pt of points) {
    if (pt.x < minx) minx = pt.x;
    if (pt.x > maxx) maxx = pt.x;
    if (pt.y < miny) miny = pt.y;
    if (pt.y > maxy) maxy = pt.y;
  }

  return { minx, maxx, miny, maxy };
}

function pointInPoly(x: number, y: number, polygon: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x;
    const yi = polygon[i].y;
    const xj = polygon[j].x;
    const yj = polygon[j].y;
    const intersect = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi + 1e-6) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function tracePolygonPath(ctx: CanvasRenderingContext2D, vertices: Point[]): void {
  ctx.beginPath();
  ctx.moveTo(vertices[0].x, vertices[0].y);
  for (let i = 1; i < vertices.length; i += 1) {
    ctx.lineTo(vertices[i].x, vertices[i].y);
  }
  ctx.closePath();
}
