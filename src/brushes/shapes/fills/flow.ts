import { getStrokePipeline, isWebGPUSupported } from '@/lib/shapeFill';
import type { StrokeJob } from '@/lib/shapeFill';
import { debugLog, debugWarn } from '@/utils/debug';
import type { FlowFillParams, Point } from './types';

const computePolygonBounds = (vertices: Point[]) => {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const vertex of vertices) {
    if (vertex.x < minX) minX = vertex.x;
    if (vertex.y < minY) minY = vertex.y;
    if (vertex.x > maxX) maxX = vertex.x;
    if (vertex.y > maxY) maxY = vertex.y;
  }

  return { minX, minY, maxX, maxY };
};

const FNV_OFFSET = 2166136261;
const FNV_PRIME = 16777619;

const inflightGpuJobs = new Set<string>();

export const computeFlowGpuJobId = (
  vertices: Point[],
  seed: number | undefined,
  resolution: number,
  pixelMode: boolean,
): string => {
  let hash = (FNV_OFFSET ^ (seed ?? 0)) >>> 0;
  for (const { x, y } of vertices) {
    hash ^= Math.round(x * 16);
    hash = Math.imul(hash, FNV_PRIME) >>> 0;
    hash ^= Math.round(y * 16);
    hash = Math.imul(hash, FNV_PRIME) >>> 0;
  }
  hash ^= Math.round(resolution * 100) ^ (pixelMode ? 1 : 0);
  hash = Math.imul(hash, FNV_PRIME) >>> 0;
  return `flow-${hash.toString(16)}`;
};

const enqueueGpuStroke = (
  params: FlowFillParams,
  bounds: ReturnType<typeof computePolygonBounds>,
  priority: 'preview' | 'final',
  profile: { cpuGenerationMs?: number } | undefined,
  ctx: CanvasRenderingContext2D,
  options: { strokeColor: string; onFallback: () => void }
) => {
  const scheduler = params.dependencies.gpuScheduler;
  if (!scheduler || typeof window === 'undefined' || !isWebGPUSupported()) {
    return;
  }

  const fieldResolution = params.fieldResolution ?? params.brushSettings.flowFieldResolution ?? 8;
  const pixelMode = params.brushSettings.shapeFillPixelMode ?? true;
  const jobId = computeFlowGpuJobId(params.vertices, params.randomSeed, fieldResolution, pixelMode);

  const inflightKey = `${jobId}:${priority}`;
  if (inflightGpuJobs.has(inflightKey)) {
    return;
  }

  inflightGpuJobs.add(inflightKey);

  const width = Math.max(1, Math.ceil(bounds.maxX - bounds.minX));
  const height = Math.max(1, Math.ceil(bounds.maxY - bounds.minY));
  const vertices = new Float32Array(params.vertices.length * 2);
  for (let i = 0; i < params.vertices.length; i++) {
    const vertex = params.vertices[i];
    vertices[i * 2] = vertex.x;
    vertices[i * 2 + 1] = vertex.y;
  }

  const stroke: StrokeJob = {
    id: jobId,
    vertices,
    bounds: {
      minX: bounds.minX,
      minY: bounds.minY,
      maxX: bounds.maxX,
      maxY: bounds.maxY,
    },
    brushSettings: params.brushSettings,
    seed: params.randomSeed,
    previewResolution: {
      width,
      height,
      scale: priority === 'preview' ? 0.5 : 1,
      fieldResolution,
    },
    finalResolution: {
      width,
      height,
      scale: 1,
      fieldResolution,
    },
    pixelMode,
    pendingGizmo: priority === 'preview' && Boolean(params.isPreview),
    metadata: {
      brush: 'flow-fill',
      mode: priority,
    },
  };

  const readback = priority === 'preview' ? 'all' : false;
  const pipeline = getStrokePipeline();

  scheduler
    .queueJob(stroke, {
      priority,
      cacheResult: true,
      readback,
    })
    .then(async result => {
      try {
        if (!result.fieldResult) {
          debugWarn('shape-fill', `GPU flow stroke skipped (${priority})`);
          options.onFallback();
          return;
        }

        const output = await pipeline.render(stroke, result.fieldResult, {
          priority,
          color: options.strokeColor,
        });

        if (!output) {
          options.onFallback();
          return;
        }

        const drawToCanvas = async () => {
          if (typeof ImageData === 'undefined') {
            return false;
          }

          const imageData = new ImageData(output.pixels, output.width, output.height);
          if (typeof createImageBitmap === 'function') {
            const bitmap = await createImageBitmap(imageData);
            ctx.save();
            ctx.globalAlpha = params.brushSettings.opacity;
            ctx.globalCompositeOperation = params.brushSettings.blendMode || 'source-over';
            ctx.imageSmoothingEnabled = !(params.brushSettings.shapeFillPixelMode ?? true);
            ctx.drawImage(bitmap, output.origin.x, output.origin.y);
            ctx.restore();
            bitmap.close();
            return true;
          }

          ctx.putImageData(imageData, output.origin.x, output.origin.y);
          return true;
        };

        const drawn = await drawToCanvas().catch(() => false);
        if (!drawn) {
          options.onFallback();
          output.release();
          return;
        }

        output.release();

        const gpuMetrics = result.fieldResult.metrics;
        debugLog('shape-fill', `GPU flow stroke completed (${priority})`, {
          ...result.diagnostics,
          gpuGenerationMs: gpuMetrics?.generationTimeMs,
          gpuTiles: gpuMetrics?.tilesProcessed,
          cpuGenerationMs: profile?.cpuGenerationMs,
          jobId,
        });
      } catch (error) {
        const errorName = typeof error === 'object' && error && 'name' in error
          ? (error as { name?: string }).name
          : undefined;
        if (errorName !== 'AbortError') {
          debugWarn('shape-fill', 'GPU flow stroke failed', error);
        }
        options.onFallback();
      } finally {
        result.release();
      }
    })
    .catch(error => {
      const errorName = typeof error === 'object' && error && 'name' in error
        ? (error as { name?: string }).name
        : undefined;
      if (errorName !== 'AbortError') {
        debugWarn('shape-fill', 'GPU flow stroke queue failed', error);
      }
      options.onFallback();
    })
    .finally(() => {
      inflightGpuJobs.delete(inflightKey);
    });
};

export const drawFlowFill = ({
  ctx,
  vertices,
  brushSettings,
  dependencies,
  seedSpacing,
  stepSize,
  maxSteps,
  useOrthogonal,
  fieldResolution,
  randomSeed,
  strokeColorOverride,
  isPreview = false,
}: FlowFillParams): void => {
  if (vertices.length < 3) {
    return;
  }

  const strokeColor = strokeColorOverride ?? brushSettings.color ?? '#000000';
  const sdfResolution = fieldResolution ?? brushSettings.flowFieldResolution ?? 8;

  if (typeof window === 'undefined' || !dependencies.gpuScheduler) {
    debugWarn('shape-fill', 'Flow fill requires the GPU scheduler runtime (window WebGPU).');
    return;
  }

  if (!isWebGPUSupported()) {
    debugWarn('shape-fill', 'WebGPU is unavailable; flow fill GPU pipeline cannot run.');
    return;
  }

  const bounds = computePolygonBounds(vertices);
  enqueueGpuStroke(
    {
      ctx,
      vertices,
      brushSettings,
      dependencies,
      seedSpacing,
      stepSize,
      maxSteps,
      useOrthogonal,
      fieldResolution: sdfResolution,
      randomSeed,
      strokeColorOverride,
      isPreview,
    } as FlowFillParams,
    bounds,
    isPreview ? 'preview' : 'final',
    undefined,
    ctx,
    {
      strokeColor,
      onFallback: () => {
        debugWarn('shape-fill', 'Flow fill GPU pipeline failed with no CPU fallback.');
      },
    }
  );
};

export type { FlowFillParams as DrawFlowFillParams };
