import {
  computeBoundingBox,
  ensureFloat32Vertices,
  getStrokePipeline,
  isWebGPUSupported,
  type ShapeFillScheduler,
  type StrokeJob,
} from '@/lib/shapeFill';
import { debugLog, debugWarn } from '@/utils/debug';
import { resolveCoordinateSnap } from './common';
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
  const bounds = computeBoundingBox(vertexBuffer);
  const width = Math.max(1, Math.ceil(bounds.maxX - bounds.minX));
  const height = Math.max(1, Math.ceil(bounds.maxY - bounds.minY));
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

  const stroke: StrokeJob = {
    id: jobId,
    vertices: vertexBuffer,
    bounds,
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
        if (!result.fieldResult) {
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
            metrics: result.fieldResult.metrics,
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
  dependencies,
  isPreview = false,
  spacingOverride,
  randomSeed,
  previewDetail,
  strokeColorOverride,
}: ContourFillParams): void => {
  const {
    createSignedDistanceField,
    extractContour,
    connectSegments,
  } = dependencies;

  const pixelMode = brushSettings.shapeFillPixelMode ?? true;
  const snap = resolveCoordinateSnap(pixelMode);
  const lineWidth = Math.max(0.2, brushSettings.shapeFillLineWidth ?? 1);

  if (vertices.length < 3) {
    return;
  }

  const strokeColor = strokeColorOverride ?? brushSettings.color;
  ctx.strokeStyle = strokeColor;
  ctx.lineWidth = lineWidth;
  ctx.imageSmoothingEnabled = !pixelMode;

  const fieldData = createSignedDistanceField(vertices, ctx.canvas.width, ctx.canvas.height, 2);

  const createRandomGenerator = (seed?: number) => {
    if (seed == null) {
      return Math.random;
    }
    let value = seed >>> 0;
    return () => {
      value = (value * 1664525 + 1013904223) >>> 0;
      return value / 0x100000000;
    };
  };

  const random = createRandomGenerator(randomSeed);
  const allowFullDetail = !isPreview || previewDetail === 'full';

  let maxDistance = 0;
  for (let y = 0; y < fieldData.rows; y++) {
    const row = fieldData.field[y];
    for (let x = 0; x < row.length; x++) {
      if (row[x] > maxDistance) {
        maxDistance = row[x];
      }
    }
  }
  const safeMinStep = Math.max(0.5, maxDistance * 0.02);
  const hasSpacingOverride = spacingOverride != null;
  const spacingBase = spacingOverride ?? brushSettings.contourSpacing ?? 5;
  const spacing = Math.max(0.5, hasSpacingOverride ? spacingBase : spacingBase * 2);
  const variancePercent = Math.min(1, Math.max(0, (brushSettings.contourVariance ?? 5) / 10));

  const maxStartDistance = Math.min(maxDistance * 0.95, Math.max(spacing * 2, safeMinStep * 6));
  const minStartDistance = Math.max(safeMinStep * 1.5, spacing * 0.5);
  const startDistance = Math.min(maxStartDistance, Math.max(minStartDistance, spacing * 1.5));

  let currentDistance = startDistance;
  let drewAnyContours = false;

  const maxElevation = Math.max(maxDistance * 36, 200);
  const snapElevation = (value: number) => Math.max(1, Math.round((value / maxElevation) * 1000) / 2);

  const baseNoise = (random() * 2 - 1) * variancePercent;
  let randomWalk = (random() * 2 - 1) * variancePercent * 0.5;
  let clusterPhase = random() * Math.PI * 2;
  const clusterStrength = variancePercent * 0.5;
  const clusterFreq = 0.2 + variancePercent * 0.4;
  const walkSpeed = 0.05 + variancePercent * 0.2;
  const noiseScale = 0.4 + variancePercent * 0.6;

  while (currentDistance < maxDistance) {
    const contourSegments = extractContour(
      fieldData.field,
      fieldData.cols,
      fieldData.rows,
      fieldData.resolution,
      currentDistance,
      fieldData.extension
    );

    if (!contourSegments || contourSegments.length === 0) {
      currentDistance += spacing;
      continue;
    }

    const loops = connectSegments(contourSegments);

    loops.forEach(loop => {
      if (loop.length < 2) return;
      ctx.beginPath();
      ctx.moveTo(snap(loop[0].x), snap(loop[0].y));
      for (let i = 1; i < loop.length; i++) {
        ctx.lineTo(snap(loop[i].x), snap(loop[i].y));
      }
      ctx.lineTo(snap(loop[0].x), snap(loop[0].y));
      ctx.stroke();
      drewAnyContours = true;

      if (!allowFullDetail) {
        return;
      }

      const elevation = snapElevation(currentDistance * 100);
      if (random() < 0.08) {
        const labelIndex = Math.floor(loop.length * 0.25 + random() * loop.length * 0.5);
        const point = loop[Math.min(loop.length - 1, Math.max(0, labelIndex))];
        const text = `${Math.round(elevation)}m`;

        ctx.save();
        ctx.font = '8px monospace';
        ctx.globalCompositeOperation = 'destination-out';
        const metrics = ctx.measureText(text);
        const textWidth = metrics.width;
        const padding = 2;
        const textX = snap(point.x);
        const textY = snap(point.y);
        ctx.fillRect(
          Math.floor(textX - textWidth / 2 - padding),
          Math.floor(textY - 5),
          Math.ceil(textWidth + padding * 2),
          10
        );
        ctx.globalCompositeOperation = brushSettings.blendMode || 'source-over';
        ctx.fillStyle = strokeColor;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(text, textX, textY);
        ctx.restore();
      }
    });

    const clusterEffect = Math.sin(clusterPhase) * clusterStrength;
    const jumpChance = 0.15 * variancePercent;
    const jump = random() < jumpChance ? (random() * 2 - 0.5) : 0;
    const localNoise = (random() * 2 - 1) * noiseScale;
    const totalVariance = (
      randomWalk * 0.4 +
      clusterEffect * 0.3 +
      localNoise * 0.2 +
      jump * 0.5 +
      baseNoise * 0.1
    ) * variancePercent;

    const baseSpacing = spacing * (1 + totalVariance * 2.0);
    const minSpacing = spacing * (0.1 + (1 - variancePercent) * 0.4);
    const maxSpacingAdjusted = spacing * (1.5 + variancePercent * 3.5);

    currentDistance += Math.max(minSpacing, Math.min(maxSpacingAdjusted, baseSpacing));
    clusterPhase += clusterFreq;
    randomWalk += (random() * 2 - 1) * walkSpeed;
    randomWalk = Math.max(-1, Math.min(1, randomWalk));
  }

  if (!drewAnyContours) {
    let fallbackDistance = Math.max(
      Math.min(maxDistance * 0.66, maxStartDistance),
      Math.max(0.1, safeMinStep * 0.5)
    );
    if (fallbackDistance >= maxDistance) {
      fallbackDistance = Math.max(maxDistance * 0.5, maxDistance - 0.01);
    }
    fallbackDistance = Math.max(0.005, Math.min(fallbackDistance, Math.max(0.005, maxDistance * 0.95)));
    const fallbackSegments = extractContour(
      fieldData.field,
      fieldData.cols,
      fieldData.rows,
      fieldData.resolution,
      fallbackDistance,
      fieldData.extension
    );
    const fallbackLoops = connectSegments(fallbackSegments);

    fallbackLoops.forEach(loop => {
      if (loop.length < 2) return;
      ctx.beginPath();
      ctx.moveTo(snap(loop[0].x), snap(loop[0].y));
      for (let i = 1; i < loop.length; i++) {
        ctx.lineTo(snap(loop[i].x), snap(loop[i].y));
      }
      ctx.lineTo(snap(loop[0].x), snap(loop[0].y));
      ctx.stroke();
    });

    if (!drewAnyContours && vertices.length >= 2) {
      ctx.beginPath();
      ctx.moveTo(snap(vertices[0].x), snap(vertices[0].y));
      for (let i = 1; i < vertices.length; i++) {
        ctx.lineTo(snap(vertices[i].x), snap(vertices[i].y));
      }
      ctx.closePath();
      ctx.stroke();
    }
  }
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
