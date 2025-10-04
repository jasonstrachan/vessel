import { getStrokePipeline, isWebGPUSupported } from '@/lib/shapeFill';
import type { ShapeFillScheduler, StrokeJob } from '@/lib/shapeFill';
import { debugLog, debugWarn } from '@/utils/debug';
import type { InkRibbonsFillParams, Point } from './types';

const FNV_OFFSET = 2166136261;
const FNV_PRIME = 16777619;

const inflightGpuJobs = new Set<string>();

const computeBounds = (vertices: Point[]) => {
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

  return {
    minX,
    minY,
    maxX,
    maxY,
    width: Math.max(1, maxX - minX),
    height: Math.max(1, maxY - minY),
  };
};

const hashRibbonJob = (
  vertices: Point[],
  seed: number | undefined,
  fieldResolution: number,
  pixelMode: boolean,
  spacing: number,
  lineWidth: number
): string => {
  let hash = (FNV_OFFSET ^ (seed ?? 0)) >>> 0;
  for (const { x, y } of vertices) {
    hash ^= Math.round(x * 16);
    hash = Math.imul(hash, FNV_PRIME) >>> 0;
    hash ^= Math.round(y * 16);
    hash = Math.imul(hash, FNV_PRIME) >>> 0;
  }
  hash ^= Math.round(fieldResolution * 100);
  hash = Math.imul(hash, FNV_PRIME) >>> 0;
  hash ^= pixelMode ? 0xf00d : 0x0bad;
  hash = Math.imul(hash, FNV_PRIME) >>> 0;
  hash ^= Math.round(spacing * 10);
  hash = Math.imul(hash, FNV_PRIME) >>> 0;
  hash ^= Math.round(lineWidth * 100);
  hash = Math.imul(hash, FNV_PRIME) >>> 0;
  return `ink-ribbons-${hash.toString(16)}`;
};

const enqueueGpuStroke = (
  job: StrokeJob,
  priority: 'preview' | 'final',
  ctx: CanvasRenderingContext2D,
  scheduler: ShapeFillScheduler,
  options: { strokeColor: string }
): void => {
  const pipeline = getStrokePipeline();

  const inflightKey = `${job.id}:${priority}`;
  if (inflightGpuJobs.has(inflightKey)) {
    return;
  }
  inflightGpuJobs.add(inflightKey);

  scheduler
    .queueJob(job, {
      priority,
      cacheResult: true,
    })
    .then(async result => {
      try {
        if (!result.fieldResult) {
          debugWarn('shape-fill', `Ink ribbons GPU stroke skipped (${priority})`);
          return;
        }

        const output = await pipeline.render(result.job, result.fieldResult, {
          priority,
          color: options.strokeColor,
        });

        if (!output) {
          debugWarn('shape-fill', 'Ink ribbons GPU pipeline did not return raster data.');
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
            ctx.globalAlpha = job.brushSettings?.opacity ?? 1;
            ctx.globalCompositeOperation = job.brushSettings?.blendMode || 'source-over';
            ctx.imageSmoothingEnabled = !(job.pixelMode ?? true);
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
          debugWarn('shape-fill', 'Ink ribbons GPU render could not paint onto canvas.');
        } else {
          debugLog('shape-fill', `GPU ink ribbons stroke completed (${priority})`, {
            diagnostics: result.diagnostics,
            gpuMetrics: result.fieldResult.metrics,
            jobId: job.id,
          });
        }

        output.release();
      } catch (error) {
        const errorName = typeof error === 'object' && error && 'name' in error
          ? (error as { name?: string }).name
          : undefined;
        if (errorName !== 'AbortError') {
          debugWarn('shape-fill', 'GPU ink ribbons stroke failed', error);
        }
      } finally {
        result.release();
      }
    })
    .catch(error => {
      const errorName = typeof error === 'object' && error && 'name' in error
        ? (error as { name?: string }).name
        : undefined;
      if (errorName !== 'AbortError') {
        debugWarn('shape-fill', 'GPU ink ribbons queue failed', error);
      }
    })
    .finally(() => {
      inflightGpuJobs.delete(inflightKey);
    });
};

export const drawInkRibbonsFill = ({
  ctx,
  vertices,
  brushSettings,
  dependencies,
  isPreview = false,
  randomSeed,
  strokeColorOverride,
}: InkRibbonsFillParams): void => {
  if (vertices.length < 3) {
    return;
  }

  if (typeof window === 'undefined' || !dependencies.gpuScheduler) {
    debugWarn('shape-fill', 'Ink ribbons GPU pipeline requires the shape fill scheduler runtime.');
    return;
  }

  if (!isWebGPUSupported()) {
    debugWarn('shape-fill', 'WebGPU is unavailable; ink ribbons fill skipped.');
    return;
  }

  const pixelMode = brushSettings.shapeFillPixelMode ?? true;
  const fieldResolution = Math.max(4, Math.round(brushSettings.ribbonSdfStep ?? 8));
  const baseSpacing = Math.max(6, brushSettings.ribbonSeedSpacing ?? 18);
  const spacing = isPreview ? baseSpacing * 1.2 : baseSpacing;
  const lineWidth = brushSettings.ribbonLineWidth ?? brushSettings.shapeFillLineWidth ?? 1.6;
  const seed = brushSettings.ribbonSeed ?? randomSeed ?? 0;

  const bounds = computeBounds(vertices);
  const width = Math.max(1, Math.ceil(bounds.width));
  const height = Math.max(1, Math.ceil(bounds.height));

  const verticesBuffer = new Float32Array(vertices.length * 2);
  for (let i = 0; i < vertices.length; i++) {
    const vertex = vertices[i];
    verticesBuffer[i * 2] = vertex.x;
    verticesBuffer[i * 2 + 1] = vertex.y;
  }

  const orientationDeg = brushSettings.ribbonBiasAngle ?? 0;
  const strokeBrushSettings = {
    ...brushSettings,
    flowOrientationAngle: orientationDeg,
    shapeFillLineWidth: lineWidth,
  } as StrokeJob['brushSettings'];

  const jobId = hashRibbonJob(vertices, seed, fieldResolution, pixelMode, spacing, lineWidth);

  const priority: 'preview' | 'final' = isPreview ? 'preview' : 'final';

  const stroke: StrokeJob = {
    id: jobId,
    vertices: verticesBuffer,
    bounds: {
      minX: bounds.minX,
      minY: bounds.minY,
      maxX: bounds.maxX,
      maxY: bounds.maxY,
    },
    brushSettings: strokeBrushSettings,
    seed,
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
    dynamicParams: {
      spacing,
      ribbonLineWidth: lineWidth,
    },
    metadata: {
      brush: 'ink-ribbons',
      mode: priority,
    },
  };

  const strokeColor = strokeColorOverride ?? brushSettings.color ?? '#0d1d71';

  enqueueGpuStroke(stroke, priority, ctx, dependencies.gpuScheduler, { strokeColor });
};
