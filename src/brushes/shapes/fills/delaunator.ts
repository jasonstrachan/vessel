import {
  computeBoundingBox,
  ensureFloat32Vertices,
  getStrokePipeline,
  getWebGPUSupportStatus,
  isWebGPUSupported,
  type ShapeFillScheduler,
  type StrokeJob,
} from '@/lib/shapeFill';
import { debugLog, debugWarn } from '@/utils/debug';

import { drawShapeFillOutput, resolveShapeFillGpuParams } from './common';
import type { DelaunayFillParams, ShapeFillDependencies } from './types';

const FNV_OFFSET = 2166136261;
const FNV_PRIME = 16777619;

const inflightTriangleJobs = new Set<string>();

const hashTriangleJob = (
  vertices: Float32Array,
  cellSize: number,
  jitter: number,
  seed: number,
  pixelMode: boolean,
): string => {
  let hash = (FNV_OFFSET ^ (seed >>> 0)) >>> 0;
  hash = Math.imul(hash, FNV_PRIME) >>> 0;
  hash ^= Math.round(cellSize * 100);
  hash = Math.imul(hash, FNV_PRIME) >>> 0;
  hash ^= Math.round(jitter * 1000);
  hash = Math.imul(hash, FNV_PRIME) >>> 0;
  hash ^= pixelMode ? 0xf00d : 0x0bad;
  hash = Math.imul(hash, FNV_PRIME) >>> 0;

  for (let i = 0; i < vertices.length; i += 1) {
    const scaled = Math.round(vertices[i] * 16);
    hash ^= scaled >>> 0;
    hash = Math.imul(hash, FNV_PRIME) >>> 0;
  }

  return `triangle-${hash.toString(16)}`;
};

const enqueueTriangleGpuStroke = (
  job: StrokeJob,
  scheduler: ShapeFillScheduler,
  priority: 'preview' | 'final',
  ctx: CanvasRenderingContext2D,
  strokeColor: string,
  runtimeContext: DelaunayFillParams['runtimeContext'],
  onFailure: () => void,
  dependencies?: ShapeFillDependencies,
): void => {
  const pipeline = getStrokePipeline();
  const inflightKey = `${job.id}:${priority}`;
  if (inflightTriangleJobs.has(inflightKey)) {
    return;
  }
  inflightTriangleJobs.add(inflightKey);

  scheduler
    .queueJob(job, {
      priority,
      cacheResult: true,
    })
    .then(async result => {
      try {
        if (!result.fieldResult) {
          debugWarn('triangle-fill', `Triangle GPU stroke skipped (${priority})`);
          onFailure();
          return;
        }

        const output = await pipeline.render(result.job, result.fieldResult, {
          priority,
          color: strokeColor,
        });

        if (!output) {
          debugWarn('triangle-fill', 'Triangle GPU pipeline returned no raster data.');
          onFailure();
          return;
        }

        const overlayCtx = runtimeContext?.overlayCanvas
          ? runtimeContext.overlayCanvas.getContext('2d', { willReadFrequently: true }) ?? undefined
          : undefined;
        const finalCtx = runtimeContext?.finalCanvas
          ? runtimeContext.finalCanvas.getContext('2d', { willReadFrequently: true }) ?? undefined
          : undefined;

        const drawn = await drawShapeFillOutput({
          output: {
            pixels: output.pixels,
            width: output.width,
            height: output.height,
            origin: output.origin,
          },
          baseContext: ctx,
          runtimeContext,
          priority,
          brushSettings: job.brushSettings,
          overlayContext: overlayCtx,
          finalContext: finalCtx,
        }).catch((error: unknown) => {
          debugWarn('triangle-fill', 'Triangle GPU render failed to draw to canvas', error);
          return false;
        });

        if (!drawn) {
          onFailure();
        } else {
          debugLog('triangle-fill', `GPU triangle stroke completed (${priority})`, {
            jobId: job.id,
            diagnostics: result.diagnostics,
            metrics: result.fieldResult.metrics,
          });

          if (priority === 'final') {
            dependencies?.recordShapeFillJob?.(job, {
              brushSettings: job.brushSettings,
              mode: 'triangle',
              runtimeContext,
            });
          }
        }

        output.release();
      } catch (error) {
        const errorName = typeof error === 'object' && error && 'name' in error
          ? (error as { name?: string }).name
          : undefined;
        if (errorName !== 'AbortError') {
          debugWarn('triangle-fill', 'Triangle GPU pipeline failed', error);
        }
        onFailure();
      } finally {
        result.release();
      }
    })
    .catch(error => {
      const errorName = typeof error === 'object' && error && 'name' in error
        ? (error as { name?: string }).name
        : undefined;
      if (errorName !== 'AbortError') {
        debugWarn('triangle-fill', 'Triangle GPU queue failed', error);
      }
      onFailure();
    })
    .finally(() => {
      inflightTriangleJobs.delete(inflightKey);
      if (priority === 'final') {
        const finalCanvasTarget = runtimeContext?.finalCanvas
          ?? (ctx.canvas instanceof HTMLCanvasElement ? ctx.canvas : null);
        if (finalCanvasTarget) {
          dependencies?.flushShapeFillJobs?.(finalCanvasTarget, 'Shape fill triangle stroke');
        }
      }
    });
};

export const drawDelaunayFill = ({
  ctx,
  vertices,
  brushSettings,
  boundWidth,
  boundHeight,
  isPreview = false,
  strokeColorOverride,
  dependencies,
  runtimeContext,
}: DelaunayFillParams): void => {
  if (vertices.length < 3) {
    return;
  }

  const scheduler = dependencies?.gpuScheduler;
  if (!scheduler || typeof window === 'undefined') {
    debugWarn('triangle-fill', 'Triangle GPU scheduler unavailable; stroke skipped.');
    return;
  }

  if (!isWebGPUSupported()) {
    const status = getWebGPUSupportStatus();
    const reason = status.status === 'unavailable'
      ? status.reason
      : 'WebGPU support is disabled';
    debugWarn('triangle-fill', `WebGPU is unavailable; triangle fill skipped (${reason}).`);
    return;
  }

  const pixelMode = brushSettings.shapeFillPixelMode ?? true;
  const vertexBuffer = ensureFloat32Vertices(vertices, pixelMode);
  const bounds = computeBoundingBox(vertexBuffer);
  const width = Math.max(1, Math.ceil(bounds.maxX - bounds.minX));
  const height = Math.max(1, Math.ceil(bounds.maxY - bounds.minY));

  const estimatedSize = Math.max(12, Math.min(96, Math.min(boundWidth, boundHeight) / 2));
  const baseSizeSetting = brushSettings.triangleFillSize ?? estimatedSize;
  const cellSize = Math.max(8, Math.min(200, baseSizeSetting));
  const jitterPct = Math.max(0, Math.min(1, (brushSettings.triangleFillJitter ?? 35) / 100));
  const minSpacing = cellSize * (0.6 + jitterPct * 0.2);

  const areaEstimate = Math.max(1, (bounds.maxX - bounds.minX) * (bounds.maxY - bounds.minY));
  const maxSeeds = Math.max(24, Math.min(480, Math.round(areaEstimate / Math.max(cellSize * cellSize * 1.5, 1))));
  const seed = Math.floor(Math.random() * 0xffffffff) >>> 0;
  const priority: 'preview' | 'final' = isPreview ? 'preview' : 'final';
  const jobId = hashTriangleJob(vertexBuffer, cellSize, jitterPct, seed, pixelMode);

  const strokeColor = strokeColorOverride ?? brushSettings.color ?? '#000000';
  const lineWidth = Math.max(0.2, brushSettings.shapeFillLineWidth ?? 1);
  const fieldResolution = Math.max(1, Math.round(brushSettings.flowFieldResolution ?? 3));

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
    triangleCellSize: cellSize,
    triangleMinSpacing: minSpacing,
    triangleJitter: jitterPct,
    triangleMaxSeeds: maxSeeds,
    triangleMaxTriangles: maxSeeds * 6,
      triangleMaxEdges: maxSeeds * 8,
    },
    metadata: {
      brush: 'triangle-fill',
      mode: priority,
      viewportScale: runtimeContext?.viewTransform?.scale,
      devicePixelRatio: runtimeContext?.devicePixelRatio,
    },
  };

  let failureLogged = false;
  const handleFailure = () => {
    if (!failureLogged) {
      failureLogged = true;
      debugWarn('triangle-fill', 'Triangle GPU stroke failed; output skipped.');
    }
  };

  enqueueTriangleGpuStroke(stroke, scheduler, priority, ctx, strokeColor, runtimeContext, handleFailure, dependencies);
};
