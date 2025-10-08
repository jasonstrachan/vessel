import {
  computeBoundingBox,
  ensureFloat32Vertices,
  getStrokePipeline,
  getWebGPUSupportStatus,
  isWebGPUSupported,
  SHAPE_FILL_GPU_RETIRED_REASON,
  type ShapeFillScheduler,
  type StrokeJob,
} from '@/lib/shapeFill';
import { debugLog, debugWarn } from '@/utils/debug';
import {
  generateContourLines,
  MAX_LINE_SPACING,
  MIN_LINE_SPACING,
  prepareContourLinesBasis,
} from '@/utils/contourLines';
import { clamp } from '@/utils/num';

import { resolveCoordinateSnap, resolveShapeFillGpuParams } from './common';
import type { LinesFillParams } from './types';

const FNV_OFFSET = 2166136261;
const FNV_PRIME = 16777619;

const inflightGpuJobs = new Map<string, Promise<void>>();

const hashLinesJob = (
  vertices: Float32Array,
  spacingA: number,
  spacingB: number,
  variance: number,
  smoothness: number,
  seed: number,
  fieldResolution: number,
  pixelMode: boolean,
): string => {
  let hash = (FNV_OFFSET ^ (seed >>> 0)) >>> 0;
  hash = Math.imul(hash, FNV_PRIME) >>> 0;
  hash ^= Math.round(spacingA * 100);
  hash = Math.imul(hash, FNV_PRIME) >>> 0;
  hash ^= Math.round(spacingB * 100);
  hash = Math.imul(hash, FNV_PRIME) >>> 0;
  hash ^= Math.round(variance * 1000);
  hash = Math.imul(hash, FNV_PRIME) >>> 0;
  hash ^= Math.round(smoothness * 1000);
  hash = Math.imul(hash, FNV_PRIME) >>> 0;
  hash ^= fieldResolution;
  hash = Math.imul(hash, FNV_PRIME) >>> 0;
  hash ^= pixelMode ? 0xf00d : 0x0bad;
  hash = Math.imul(hash, FNV_PRIME) >>> 0;

  for (let i = 0; i < vertices.length; i += 1) {
    const scaled = Math.round(vertices[i] * 32);
    hash ^= scaled >>> 0;
    hash = Math.imul(hash, FNV_PRIME) >>> 0;
  }

  return `lines-${hash.toString(16)}`;
};

const drawLinesFillCpu = ({
  ctx,
  vertices,
  brushSettings,
  lineOptions,
}: LinesFillParams): void => {
  if (vertices.length < 3) {
    return;
  }

  const clampSpacing = (value: number) => clamp(Math.round(value), MIN_LINE_SPACING, MAX_LINE_SPACING);
  const spacingA = clampSpacing(lineOptions?.lineSpacingA ?? (brushSettings.contourSpacing || 5) * 2);
  const spacingB = clampSpacing(lineOptions?.lineSpacingB ?? spacingA);
  const basis = lineOptions?.lineBasis ?? prepareContourLinesBasis(vertices);

  if (!basis) {
    return;
  }

  const pixelMode = brushSettings.shapeFillPixelMode ?? true;
  const snap = resolveCoordinateSnap(pixelMode);
  const lineWidth = Math.max(0.2, brushSettings.shapeFillLineWidth ?? 1);

  ctx.strokeStyle = brushSettings.color;
  ctx.lineWidth = lineWidth;
  ctx.imageSmoothingEnabled = !pixelMode;

  const lines = generateContourLines(vertices, basis, spacingA, spacingB);

  ctx.save();
  ctx.beginPath();
  ctx.moveTo(snap(vertices[0].x), snap(vertices[0].y));
  for (let i = 1; i < vertices.length; i++) {
    ctx.lineTo(snap(vertices[i].x), snap(vertices[i].y));
  }
  ctx.closePath();
  ctx.clip();

  for (const path of lines) {
    if (!path.points || path.points.length < 2) continue;
    ctx.beginPath();
    ctx.moveTo(snap(path.points[0].x), snap(path.points[0].y));
    for (let i = 1; i < path.points.length; i++) {
      ctx.lineTo(snap(path.points[i].x), snap(path.points[i].y));
    }
    ctx.stroke();
  }

  ctx.restore();
};

const enqueueLinesGpuStroke = (
  job: StrokeJob,
  scheduler: ShapeFillScheduler,
  priority: 'preview' | 'final',
  ctx: CanvasRenderingContext2D,
  strokeColor: string,
  onFallback: () => void,
): void => {
  const pipeline = getStrokePipeline();
  const inflightKey = `${job.id}:${priority}`;
  if (inflightGpuJobs.get(inflightKey)) {
    return;
  }

  const jobPromise = scheduler
    .queueJob(job, {
      priority,
      cacheResult: true,
      reuseCache: true,
    })
    .then(async result => {
      try {
        if (!result.fieldResult) {
          debugWarn('shape-fill', `Lines GPU stroke skipped (${priority})`);
          onFallback();
          return;
        }

        const output = await pipeline.render(result.job, result.fieldResult, {
          priority,
          color: strokeColor,
        });

        if (!output) {
          debugWarn('shape-fill', 'Lines GPU pipeline returned no raster data.');
          onFallback();
          return;
        }

        try {
          if (typeof ImageData === 'undefined') {
            output.release();
            onFallback();
            return;
          }

          const imageData = new ImageData(output.pixels, output.width, output.height);
          if (typeof createImageBitmap === 'function') {
            const bitmap = await createImageBitmap(imageData);
            ctx.save();
            ctx.globalAlpha = job.brushSettings?.opacity ?? 1;
            ctx.globalCompositeOperation = job.brushSettings?.blendMode || 'source-over';
            ctx.imageSmoothingEnabled = !(job.pixelMode ?? true);
            ctx.drawImage(bitmap, output.origin.x, output.origin.y);
            ctx.restore();
            bitmap.close();
          } else {
            ctx.putImageData(imageData, output.origin.x, output.origin.y);
          }

          debugLog('shape-fill', `GPU lines stroke completed (${priority})`, {
            jobId: job.id,
            diagnostics: result.diagnostics,
            metrics: result.fieldResult.metrics,
          });
        } catch (error) {
          debugWarn('shape-fill', 'Lines GPU render failed to draw to canvas', error);
          onFallback();
        } finally {
          output.release();
        }
      } catch (error) {
        const errorName = typeof error === 'object' && error && 'name' in error
          ? (error as { name?: string }).name
          : undefined;
        if (errorName !== 'AbortError') {
          debugWarn('shape-fill', 'Lines GPU pipeline failed', error);
        }
        onFallback();
      } finally {
        result.release();
      }
    })
    .catch(error => {
      const errorName = typeof error === 'object' && error && 'name' in error
        ? (error as { name?: string }).name
        : undefined;
      if (errorName !== 'AbortError') {
        debugWarn('shape-fill', 'Lines GPU queue failed', error);
      }
      onFallback();
    })
    .finally(() => {
      inflightGpuJobs.delete(inflightKey);
    });

  inflightGpuJobs.set(inflightKey, jobPromise);
};

export const drawLinesFill = (params: LinesFillParams): void => {
  const {
    ctx,
    vertices,
    brushSettings,
    lineOptions,
    dependencies,
    isPreview = false,
    strokeColorOverride,
  } = params;

  if (vertices.length < 3) {
    return;
  }

  const scheduler = dependencies?.gpuScheduler;
  if (typeof window === 'undefined' || !scheduler) {
    drawLinesFillCpu(params);
    return;
  }

  if (!isWebGPUSupported()) {
    const status = getWebGPUSupportStatus();
    if (status.status === 'unavailable' && status.reason === SHAPE_FILL_GPU_RETIRED_REASON) {
      debugLog('shape-fill', 'Lines GPU pipeline retired; using CPU renderer.');
    } else {
      const reason = status.status === 'unavailable'
        ? status.reason
        : 'WebGPU support is disabled';
      debugWarn('shape-fill', `WebGPU is unavailable; contour lines falling back to CPU (${reason}).`);
    }
    drawLinesFillCpu(params);
    return;
  }

  const clampSpacing = (value: number) => clamp(Math.round(value), MIN_LINE_SPACING, MAX_LINE_SPACING);
  const spacingA = clampSpacing(lineOptions?.lineSpacingA ?? (brushSettings.contourSpacing || 5) * 2);
  const spacingB = clampSpacing(lineOptions?.lineSpacingB ?? spacingA);
  const basis = lineOptions?.lineBasis ?? prepareContourLinesBasis(vertices);

  if (!basis) {
    drawLinesFillCpu(params);
    return;
  }

  const pixelMode = brushSettings.shapeFillPixelMode ?? true;
  const vertexBuffer = ensureFloat32Vertices(vertices, pixelMode);
  const bounds = computeBoundingBox(vertexBuffer);
  const width = Math.max(1, Math.ceil(bounds.maxX - bounds.minX));
  const height = Math.max(1, Math.ceil(bounds.maxY - bounds.minY));

  const fieldResolution = Math.max(1, Math.round(brushSettings.flowFieldResolution ?? 2));
  const variancePercent = Math.min(1, Math.max(0, (brushSettings.contourVariance ?? 5) / 10));
  const smoothnessPercent = Math.min(0.9, Math.max(0, (brushSettings.contourSmoothness ?? 0.5) / 5));
  const lineWidth = Math.max(0.2, brushSettings.shapeFillLineWidth ?? 1);
  const strokeColor = strokeColorOverride ?? brushSettings.color ?? '#000000';

  const baseEdge = basis.baseEdge;
  const baseOrigin = baseEdge.a;
  const directionVec = {
    x: baseEdge.b.x - baseEdge.a.x,
    y: baseEdge.b.y - baseEdge.a.y,
  };
  const directionExtent = Math.max(1, Math.hypot(directionVec.x, directionVec.y));
  const dirNormalised = {
    x: directionVec.x / directionExtent,
    y: directionVec.y / directionExtent,
  };

  const normalVec = basis.normal;
  const maxDistance = Math.max(0.1, basis.maxDistance + basis.backDistance * 0.25);
  const primarySpacing = Math.max(MIN_LINE_SPACING, spacingA);
  const maxLevels = Math.min(160, Math.max(1, Math.floor(maxDistance / primarySpacing)));

  const seed = (lineOptions?.randomSeed ?? Math.floor(Math.random() * 0xffffffff)) >>> 0;
  const priority: 'preview' | 'final' = isPreview ? 'preview' : 'final';
  const jobId = hashLinesJob(vertexBuffer, spacingA, spacingB, variancePercent, smoothnessPercent, seed, fieldResolution, pixelMode);

  const stroke: StrokeJob = {
    id: jobId,
    vertices: vertexBuffer,
    bounds,
    brushSettings: {
      ...brushSettings,
      shapeFillLineWidth: lineWidth,
      color: strokeColor,
    },
    seed,
    previewResolution: {
      width,
      height,
      scale: priority === 'preview' ? 0.6 : 1,
      fieldResolution,
    },
    finalResolution: {
      width,
      height,
      scale: 1,
      fieldResolution,
    },
    pixelMode,
    dynamicParams: {
      ...resolveShapeFillGpuParams(brushSettings),
      contourSpacing: spacingA,
      contourSpacingB: spacingB,
      contourVariance: variancePercent,
      contourSmoothness: smoothnessPercent,
      contourMaxLevels: maxLevels,
      contourMaxDistance: maxDistance,
      contourLinesOriginX: baseOrigin.x,
      contourLinesOriginY: baseOrigin.y,
      contourLinesDirX: dirNormalised.x,
      contourLinesDirY: dirNormalised.y,
      contourLinesNormalX: normalVec.x,
      contourLinesNormalY: normalVec.y,
      contourLinesDirExtent: directionExtent,
      contourLinesBackDistance: basis.backDistance,
      contourIndexStride: 5,
      contourIndexWidthMultiplier: 1.75,
    },
    metadata: {
      brush: 'contour-lines',
      mode: priority,
    },
  };

  let fallbackUsed = false;
  const fallback = () => {
    if (!fallbackUsed) {
      fallbackUsed = true;
      drawLinesFillCpu(params);
    }
  };

  enqueueLinesGpuStroke(stroke, scheduler, priority, ctx, strokeColor, fallback);
};
