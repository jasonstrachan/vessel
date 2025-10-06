import {
  computeBoundingBox,
  ensureFloat32Vertices,
  getStrokePipeline,
  isWebGPUSupported,
  type ShapeFillScheduler,
  type StrokeJob,
} from '@/lib/shapeFill';
import { computeContoursCPU, rasterizeContoursCPU } from '@/lib/shapeFill/cpu/contourGeometry';
import { resolveContourParams } from '@/lib/shapeFill/contourParams';
import { debugLog, debugWarn } from '@/utils/debug';
import type { ContourFillParams } from './types';

const FNV_OFFSET = 2166136261;
const FNV_PRIME = 16777619;

const inflightGpuJobs = new Set<string>();

const hashContourJob = (
  vertices: Float32Array,
  spacing: number,
  variance: number,
  smoothness: number,
  seed: number,
  fieldResolution: number,
  pixelMode: boolean,
  maxLevels: number,
): string => {
  let hash = (FNV_OFFSET ^ (seed >>> 0)) >>> 0;
  hash = Math.imul(hash, FNV_PRIME) >>> 0;
  hash ^= Math.round(spacing * 100);
  hash = Math.imul(hash, FNV_PRIME) >>> 0;
  hash ^= Math.round(variance * 1000);
  hash = Math.imul(hash, FNV_PRIME) >>> 0;
  hash ^= Math.round(smoothness * 1000);
  hash = Math.imul(hash, FNV_PRIME) >>> 0;
  hash ^= fieldResolution;
  hash = Math.imul(hash, FNV_PRIME) >>> 0;
  hash ^= pixelMode ? 0xf00d : 0x0bad;
  hash = Math.imul(hash, FNV_PRIME) >>> 0;
  hash ^= maxLevels;
  hash = Math.imul(hash, FNV_PRIME) >>> 0;

  for (let i = 0; i < vertices.length; i++) {
    const scaled = Math.round(vertices[i] * 16);
    hash ^= scaled >>> 0;
    hash = Math.imul(hash, FNV_PRIME) >>> 0;
  }

  return `contour-${hash.toString(16)}`;
};

const enqueueContourGpuStroke = (
  params: ContourFillParams,
  scheduler: ShapeFillScheduler,
  options: {
    spacing: number;
    variance: number;
    smoothness: number;
    maxLevels: number;
    maxDistance: number;
    fieldResolution: number;
    strokeColor: string;
    seed: number;
    priority: 'preview' | 'final';
    strokeWidth: number;
  },
  onFallback: () => void,
): boolean => {
  if (!scheduler) {
    return false;
  }

  const { ctx, vertices, brushSettings } = params;
  if (vertices.length < 3) {
    return false;
  }

  const pixelMode = brushSettings.shapeFillPixelMode ?? true;
  const vertexBuffer = ensureFloat32Vertices(vertices, pixelMode);
  const baseBounds = computeBoundingBox(vertexBuffer);
  const jobId = hashContourJob(
    vertexBuffer,
    options.spacing,
    options.variance,
    options.smoothness,
    options.seed,
    options.fieldResolution,
    pixelMode,
    options.maxLevels,
  );

  const inflightKey = `${jobId}:${options.priority}`;
  if (inflightGpuJobs.has(inflightKey)) {
    return true;
  }

  const stubJob: StrokeJob = {
    id: jobId,
    vertices: vertexBuffer,
    brushSettings: brushSettings,
    seed: options.seed >>> 0,
    metadata: { brush: 'contour' },
  };

  const contourGeometry = computeContoursCPU(stubJob, baseBounds, {
    spacing: options.spacing,
    maxDistance: options.maxDistance,
    variance: options.variance,
    fieldResolution: options.fieldResolution,
    randomSeed: options.seed,
  });

  const geometryBounds = contourGeometry.bounds;
  const width = Math.max(1, Math.ceil(geometryBounds.maxX - geometryBounds.minX));
  const height = Math.max(1, Math.ceil(geometryBounds.maxY - geometryBounds.minY));

  const stroke: StrokeJob = {
    id: jobId,
    vertices: vertexBuffer,
    bounds: geometryBounds,
    brushSettings: {
      ...brushSettings,
      shapeFillLineWidth: options.strokeWidth,
    },
    seed: options.seed >>> 0,
    previewResolution: {
      width,
      height,
      scale: options.priority === 'preview' ? 0.5 : 1,
      fieldResolution: options.fieldResolution,
    },
    finalResolution: {
      width,
      height,
      scale: 1,
      fieldResolution: options.fieldResolution,
    },
    pixelMode,
    dynamicParams: {
      contourSpacing: options.spacing,
      contourVariance: options.variance,
      contourSmoothness: options.smoothness,
      contourMaxLevels: options.maxLevels,
      contourMaxDistance: options.maxDistance,
    },
    metadata: {
      brush: 'contour',
      variant: params.spacingOverride != null ? 'override' : 'auto',
      contourGeometry,
    },
  };

  const pipeline = getStrokePipeline();
  const abortFallback = { invoked: false };
  const triggerFallback = () => {
    if (!abortFallback.invoked) {
      abortFallback.invoked = true;
      onFallback();
    }
  };

  inflightGpuJobs.add(inflightKey);

  scheduler
    .queueJob(stroke, {
      priority: options.priority,
      cacheResult: true,
    })
    .then(async result => {
      try {
        const hasGeometry = Boolean((result.job.metadata as Record<string, unknown> | undefined)?.contourGeometry);

        if (!result.fieldResult && !hasGeometry) {
          debugWarn('shape-fill', `Contour GPU stroke skipped (${options.priority})`);
          triggerFallback();
          return;
        }

        const output = await pipeline.render(result.job, result.fieldResult, {
          priority: options.priority,
          color: options.strokeColor,
        });

        if (!output) {
          debugWarn('shape-fill', 'Contour GPU pipeline returned no raster output.');
          triggerFallback();
          return;
        }

        try {
          if (typeof ImageData === 'undefined') {
            triggerFallback();
            output.release();
            return;
          }

          const imageData = new ImageData(output.pixels, output.width, output.height);
          if (typeof createImageBitmap === 'function') {
            const bitmap = await createImageBitmap(imageData);
            ctx.save();
            ctx.globalAlpha = brushSettings.opacity;
            ctx.globalCompositeOperation = brushSettings.blendMode || 'source-over';
            ctx.imageSmoothingEnabled = !pixelMode;
            ctx.drawImage(bitmap, output.origin.x, output.origin.y);
            ctx.restore();
            bitmap.close();
          } else {
            ctx.putImageData(imageData, output.origin.x, output.origin.y);
          }

          debugLog('shape-fill', `GPU contour stroke completed (${options.priority})`, {
            jobId,
            diagnostics: result.diagnostics,
            metrics: result.fieldResult?.metrics,
          });
        } catch (error) {
          debugWarn('shape-fill', 'Contour GPU render failed to draw to canvas', error);
          triggerFallback();
        } finally {
          output.release();
        }
      } catch (error) {
        const errorName = typeof error === 'object' && error && 'name' in error
          ? (error as { name?: string }).name
          : undefined;
        if (errorName !== 'AbortError') {
          debugWarn('shape-fill', 'Contour GPU pipeline failed', error);
        }
        triggerFallback();
      } finally {
        result.release();
      }
    })
    .catch(error => {
      const errorName = typeof error === 'object' && error && 'name' in error
        ? (error as { name?: string }).name
        : undefined;
      if (errorName !== 'AbortError') {
        debugWarn('shape-fill', 'Contour GPU queue failed', error);
      }
      triggerFallback();
    })
    .finally(() => {
      inflightGpuJobs.delete(inflightKey);
    });

  return true;
};

const drawContourFillCpu = ({
  ctx,
  vertices,
  brushSettings,
  isPreview = false,
  spacingOverride,
  randomSeed,
  strokeColorOverride,
}: ContourFillParams): void => {
  if (vertices.length < 3) {
    return;
  }

  const pixelMode = brushSettings.shapeFillPixelMode ?? true;
  const lineWidth = Math.max(0.2, brushSettings.shapeFillLineWidth ?? 1);
  const strokeColor = strokeColorOverride ?? brushSettings.color ?? '#1a1a1a';

  const bounds = computeBoundingBox(ensureFloat32Vertices(vertices, pixelMode));

  const resolved = resolveContourParams({
    spacing: spacingOverride ?? brushSettings.contourSpacing,
    variance: Math.min(1, Math.max(0, (brushSettings.contourVariance ?? 5) / 10)),
    smoothness: brushSettings.contourSmoothness ?? 0.15,
    maxDistance: brushSettings.contourMaxDistance,
    resolution: { width: ctx.canvas.width, height: ctx.canvas.height },
    bounds,
    fieldResolution: Math.max(0.5, brushSettings.flowFieldResolution ?? 2),
    previewScale: isPreview ? 0.5 : 1,
    minSpacing: 0.5,
  });

  const jobStub = {
    id: 'contour-cpu',
    vertices,
    brushSettings,
    seed: randomSeed,
  } as unknown as StrokeJob;

  const geometry = computeContoursCPU(jobStub, bounds, {
    spacing: resolved.spacingA,
    maxDistance: resolved.maxDistance,
    variance: resolved.variance,
    fieldResolution: resolved.fieldResolution,
    randomSeed,
  });

  rasterizeContoursCPU(ctx, geometry, strokeColor, lineWidth, pixelMode);
};

export const drawContourFill = (params: ContourFillParams): void => {
  const {
    brushSettings,
    dependencies,
    spacingOverride,
    isPreview = false,
    strokeColorOverride,
    randomSeed,
    previewDetail,
  } = params;

  const pixelMode = brushSettings.shapeFillPixelMode ?? true;
  const strokeColor = strokeColorOverride ?? brushSettings.color ?? '#1a1a1a';
  const lineWidth = Math.max(0.2, brushSettings.shapeFillLineWidth ?? 1);
  const spacingBase = spacingOverride ?? brushSettings.contourSpacing ?? 5;
  const spacing = Math.max(0.5, spacingOverride != null ? spacingBase : spacingBase * 2);
  const variance = Math.min(1, Math.max(0, (brushSettings.contourVariance ?? 5) / 10));
  const smoothness = Math.min(1, Math.max(0, (brushSettings.contourSmoothness ?? 0.5) / 5));
  const fieldResolution = Math.max(1, Math.round(brushSettings.flowFieldResolution ?? 2));

  const gpuScheduler = dependencies.gpuScheduler;
  const canUseGpu = typeof window !== 'undefined' && gpuScheduler && isWebGPUSupported();

  if (isPreview) {
    drawContourFillCpu(params);
    return;
  }

  if (canUseGpu) {
    const vertices = params.vertices;
    if (vertices.length >= 3) {
      const pixelAligned = ensureFloat32Vertices(vertices, pixelMode);
      const bounds = computeBoundingBox(pixelAligned);
      const width = Math.max(1, bounds.maxX - bounds.minX);
      const height = Math.max(1, bounds.maxY - bounds.minY);
      const maxDistance = Math.min(width, height) * 0.5;
      const baseLevels = Math.max(3, Math.floor(maxDistance / Math.max(spacing, 0.5)));
      const levelsCap = previewDetail === 'minimal' ? Math.max(2, Math.ceil(baseLevels * 0.5)) : baseLevels;
      const maxLevels = Math.min(30, levelsCap);
      const seed = (randomSeed ?? Math.floor(Math.random() * 0xffffffff)) >>> 0;
      const priority: 'preview' | 'final' = isPreview ? 'preview' : 'final';

      let fallbackUsed = false;
      const fallback = () => {
        if (!fallbackUsed) {
          fallbackUsed = true;
          drawContourFillCpu(params);
        }
      };

      const scheduled = enqueueContourGpuStroke(
        params,
        gpuScheduler,
        {
          spacing,
          variance,
          smoothness,
          maxLevels,
          maxDistance,
          fieldResolution,
          strokeColor,
          seed,
          priority,
          strokeWidth: lineWidth,
        },
        fallback,
      );

      if (scheduled) {
        return;
      }

      fallback();
      return;
    }
  }

  drawContourFillCpu(params);
};
