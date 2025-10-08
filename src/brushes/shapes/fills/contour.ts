import {
  computeBoundingBox,
  ensureFloat32Vertices,
  getWebGPUSupportStatus,
  isWebGPUSupported,
  type StrokeJob,
} from '@/lib/shapeFill';
import type { BoundingBox } from '@/lib/shapeFill/types';
import { generateContourLoops } from '@/lib/shapeFill/cpu/contourGeometry';
import { buildContourMesh } from '@/lib/shapeFill/cpu/contourMesh';
import { PixelRasterizer } from '@/lib/shapeFill/gpu/PixelRasterizer';
import { debugLog, debugWarn } from '@/utils/debug';
import { parseCssColor, type RGBAColor } from '@/utils/color/parseCssColor';
import type { ContourFillParams } from './types';
import { resolveShapeFillGpuParams, withShapeFillViewport } from './common';

const FNV_OFFSET = 2166136261;
const FNV_PRIME = 16777619;

const inflightJobs = new Map<string, Promise<void>>();
const pixelRasterizer = new PixelRasterizer();
const DEFAULT_COLOR: RGBAColor = { r: 0, g: 0, b: 0, a: 255 };
const PREVIEW_SCOPE = 'shape-fill-preview';
const CPU_SCOPE = 'shape-fill-cpu';

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

  for (let i = 0; i < vertices.length; i += 1) {
    const scaled = Math.round(vertices[i] * 16);
    hash ^= scaled >>> 0;
    hash = Math.imul(hash, FNV_PRIME) >>> 0;
  }

  return `contour-${hash.toString(16)}`;
};

const colorToRgba = (color?: string): RGBAColor => parseCssColor(color ?? '', DEFAULT_COLOR);

const drawPreviewLoops = (
  ctx: CanvasRenderingContext2D,
  loops: ReturnType<typeof generateContourLoops>,
  strokeColor: string,
  strokeWidth: number,
  pixelMode: boolean,
  opacity: number,
  blendMode?: string | null,
) => {
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.save();
  ctx.globalAlpha = opacity;
  ctx.globalCompositeOperation = (blendMode ?? 'source-over') as GlobalCompositeOperation;
  ctx.lineWidth = Math.max(0.2, strokeWidth);
  ctx.strokeStyle = strokeColor;
  ctx.imageSmoothingEnabled = !pixelMode;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  const closingTolerance = 2;

  for (const loopResult of loops) {
    const loop = loopResult.loop;
    if (loop.length < 2) {
      continue;
    }
    ctx.beginPath();
    ctx.moveTo(loop[0].x, loop[0].y);
    for (let i = 1; i < loop.length; i += 1) {
      ctx.lineTo(loop[i].x, loop[i].y);
    }
    const last = loop[loop.length - 1];
    const first = loop[0];
    const dx = last.x - first.x;
    const dy = last.y - first.y;
    if (Math.hypot(dx, dy) <= closingTolerance) {
      ctx.lineTo(first.x, first.y);
    }
    ctx.stroke();
  }

  ctx.restore();
};

interface RenderConfig {
  jobId: string;
  priority: 'preview' | 'final';
  spacing: number;
  variance: number;
  smoothness: number;
  maxLevels: number;
  maxDistance: number;
  fieldResolution: number;
  strokeWidth: number;
  strokeColor: string;
  colorRgba: RGBAColor;
  pixelMode: boolean;
  seed: number;
  expandedBounds: BoundingBox;
  width: number;
  height: number;
  margin: number;
  vertexBuffer: Float32Array;
  hardeningStrength: number;
  edgeFeather: number;
  threshold: number;
  alternateStride: number;
  alternateLineWidth: number;
  dynamicParams: Record<string, number>;
}

const renderContourStroke = (
  params: ContourFillParams,
  config: RenderConfig,
  onFallback: () => void,
): boolean => {
  const inflightKey = `${config.jobId}:${config.priority}`;
  if (inflightJobs.has(inflightKey)) {
    return true;
  }

  if (config.priority === 'final' && !isWebGPUSupported()) {
    const status = getWebGPUSupportStatus();
    const reason = status.status === 'unavailable'
      ? status.reason
      : 'WebGPU support is disabled';
    debugWarn('shape-fill', `WebGPU is unavailable; contour fill skipped (${reason}).`);
    return false;
  }

  const { ctx, vertices, brushSettings, dependencies } = params;

  const jobPromise = (async () => {
    let loops: ReturnType<typeof generateContourLoops> = [];
    try {
      const field = dependencies.createSignedDistanceField(
        vertices,
        ctx.canvas.width,
        ctx.canvas.height,
        config.fieldResolution,
      );

      loops = generateContourLoops(field, {
        spacing: config.spacing,
        variance: config.variance,
        smoothness: config.smoothness,
        maxLevels: config.maxLevels,
        maxDistance: config.maxDistance,
        seed: config.seed,
      });

      debugLog(CPU_SCOPE, 'generated loops', {
        jobId: config.jobId,
        priority: config.priority,
        loopCount: loops.length,
      });

      if (!loops.length) {
        debugWarn('shape-fill', 'Contour CPU pipeline produced no loops.');
        if (config.priority === 'preview') {
          ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
        } else {
          onFallback();
        }
        return;
      }

      if (config.priority === 'preview') {
        withShapeFillViewport(
          ctx,
          'preview',
          params.runtimeContext,
          () => {
            drawPreviewLoops(
              ctx,
              loops,
              config.strokeColor,
              config.strokeWidth,
              config.pixelMode,
              brushSettings.opacity,
              brushSettings.blendMode,
            );
          },
        );
        debugLog(PREVIEW_SCOPE, 'rendered preview loops', {
          jobId: config.jobId,
          loopCount: loops.length,
          vertexCount: loops.reduce((total, loop) => total + loop.loop.length, 0),
        });
        return;
      }

      const mesh = buildContourMesh(loops, {
        bounds: config.expandedBounds,
        pixelMode: config.pixelMode,
        baseLineWidth: config.strokeWidth,
        alternateLineWidth: config.alternateLineWidth,
        alternateStride: config.alternateStride,
      });

      if (!mesh) {
        debugWarn('shape-fill', 'Contour CPU mesh builder produced no geometry.');
        withShapeFillViewport(
          ctx,
          'preview',
          params.runtimeContext,
          () => {
            drawPreviewLoops(
              ctx,
              loops,
              config.strokeColor,
              config.strokeWidth,
              config.pixelMode,
              brushSettings.opacity,
              brushSettings.blendMode,
            );
          },
        );
        debugLog(PREVIEW_SCOPE, 'fallback preview loops for mesh miss', {
          jobId: config.jobId,
          loopCount: loops.length,
        });
        return;
      }

      const vertexData = mesh.vertexData;
      if (vertexData?.length) {
        let minX = Infinity;
        let minY = Infinity;
        let maxX = -Infinity;
        let maxY = -Infinity;

        for (let i = 0; i < vertexData.length; i += 4) {
          const x = vertexData[i];
          const y = vertexData[i + 1];
          if (x < minX) minX = x;
          if (y < minY) minY = y;
          if (x > maxX) maxX = x;
          if (y > maxY) maxY = y;
        }

        debugLog('contour-mesh-space', {
          meshMinX: minX,
          meshMinY: minY,
          meshMaxX: maxX,
          meshMaxY: maxY,
          expandedBounds: config.expandedBounds,
        });
      }

      debugLog(CPU_SCOPE, 'built CPU mesh', {
        jobId: config.jobId,
        vertexCount: mesh.vertexCount,
        quadCount: mesh.quadCount,
      });

      const job: StrokeJob = {
        id: config.jobId,
        vertices: config.vertexBuffer,
        bounds: config.expandedBounds,
        brushSettings: {
          ...brushSettings,
          shapeFillLineWidth: config.strokeWidth,
        },
        seed: config.seed >>> 0,
        previewResolution: {
          width: config.width,
          height: config.height,
          scale: 0.5,
          fieldResolution: config.fieldResolution,
        },
        finalResolution: {
          width: config.width,
          height: config.height,
          scale: 1,
          fieldResolution: config.fieldResolution,
        },
        pixelMode: config.pixelMode,
        margin: config.margin,
        dynamicParams: {
          ...config.dynamicParams,
          contourSpacing: config.spacing,
          contourVariance: config.variance,
          contourSmoothness: config.smoothness,
          contourMaxLevels: config.maxLevels,
          contourMaxDistance: config.maxDistance,
        },
        metadata: {
          brush: 'contour',
          variant: params.spacingOverride != null ? 'override' : 'auto',
        },
      };

      debugLog('contour-mesh', {
        jobId: config.jobId,
        meshBounds: config.expandedBounds,
        meshFirstVerts: mesh.vertexData?.slice?.(0, 8) ?? [],
        width: config.width,
        height: config.height,
      });

      const raster = await pixelRasterizer.rasterize(job, mesh, {
        resolution: {
          width: config.width,
          height: config.height,
          scale: 1,
          fieldResolution: config.fieldResolution,
        },
        color: config.colorRgba,
        bounds: config.expandedBounds,
        pixelMode: config.pixelMode,
        hardeningStrength: config.hardeningStrength,
        edgeFeather: config.edgeFeather,
        threshold: config.threshold,
      });

      if (raster) {
        debugLog('contour-raster-space', {
          rasterOrigin: raster.origin,
          rasterW: raster.width,
          rasterH: raster.height,
        });
      } else {
        debugLog('contour-raster-space', { raster: null });
      }

      if (!raster) {
        withShapeFillViewport(
          ctx,
          'preview',
          params.runtimeContext,
          () => {
            drawPreviewLoops(
              ctx,
              loops,
              config.strokeColor,
              config.strokeWidth,
              config.pixelMode,
              brushSettings.opacity,
              brushSettings.blendMode,
            );
          },
        );
        return;
      }

      try {
        const imageData = new ImageData(raster.pixels, raster.width, raster.height);
        if (typeof createImageBitmap === 'function') {
          const bitmap = await createImageBitmap(imageData);
          withShapeFillViewport(
            ctx,
            config.priority,
            params.runtimeContext,
            () => {
              ctx.save();
              ctx.globalAlpha = brushSettings.opacity;
              ctx.globalCompositeOperation = brushSettings.blendMode || 'source-over';
              ctx.imageSmoothingEnabled = !config.pixelMode;
              ctx.drawImage(bitmap, raster.origin.x, raster.origin.y);
              ctx.restore();
            },
          );
          bitmap.close();
        } else {
          withShapeFillViewport(
            ctx,
            config.priority,
            params.runtimeContext,
            () => {
              ctx.putImageData(imageData, raster.origin.x, raster.origin.y);
            },
          );
        }

        debugLog('contour-raster', {
          jobId: config.jobId,
          origin: raster.origin,
          width: raster.width,
          height: raster.height,
        });

        debugLog('shape-fill', 'Pixel rasterizer received geometry', {
          jobId: config.jobId,
          vertexCount: mesh.vertexCount,
          quadCount: mesh.quadCount,
        });

        debugLog('shape-fill', `GPU contour stroke completed (${config.priority})`, {
          jobId: config.jobId,
          vertexCount: mesh.vertexCount,
          quadCount: mesh.quadCount,
          width: raster.width,
          height: raster.height,
        });

        dependencies.recordShapeFillJob?.(job, {
          brushSettings,
          mode: 'contour',
        });
      } finally {
        raster.release();
      }
    } catch (error) {
      debugWarn('shape-fill', 'Contour hybrid pipeline failed', error);
      if (loops.length && config.priority === 'final') {
        withShapeFillViewport(
          ctx,
          'preview',
          params.runtimeContext,
          () => {
            drawPreviewLoops(
              ctx,
              loops,
              config.strokeColor,
              config.strokeWidth,
              config.pixelMode,
              brushSettings.opacity,
              brushSettings.blendMode,
            );
          },
        );
      }
      onFallback();
    }
  })();

  inflightJobs.set(inflightKey, jobPromise);
  void jobPromise.finally(() => inflightJobs.delete(inflightKey));
  return true;
};

export const drawContourFill = (params: ContourFillParams): void => {
  const { ctx, vertices, brushSettings, dependencies, isPreview = false } = params;
  if (vertices.length < 3) {
    return;
  }

  const pixelMode = brushSettings.shapeFillPixelMode ?? true;
  const vertexBuffer = ensureFloat32Vertices(vertices, pixelMode);
  const baseBounds = computeBoundingBox(vertexBuffer);

  const strokeWidth = Math.max(0.2, brushSettings.shapeFillLineWidth ?? 1);
  const spacingBase = params.spacingOverride ?? brushSettings.contourSpacing ?? 5;
  const spacing = Math.max(0.5, spacingBase);
  const previewSpacingMultiplier = params.previewDetail === 'minimal' ? 1.75 : 1.25;
  const effectiveSpacing = isPreview ? spacing * previewSpacingMultiplier : spacing;

  const varianceRaw = brushSettings.contourVariance ?? 0;
  const varianceBase = Math.min(1, Math.max(0, typeof varianceRaw === 'number' ? varianceRaw : 0));
  const effectiveVariance = isPreview ? varianceBase * 0.5 : varianceBase;

  const smoothnessRaw = brushSettings.contourSmoothness ?? 0.3;
  const smoothnessBase = Math.min(1, Math.max(0, smoothnessRaw));
  const effectiveSmoothness = isPreview ? smoothnessBase * 0.75 : smoothnessBase;

  const fieldResolution = Math.max(1, Math.round(brushSettings.flowFieldResolution ?? 2));
  const diagonal = Math.hypot(baseBounds.maxX - baseBounds.minX, baseBounds.maxY - baseBounds.minY);
  const maxDistanceSetting = brushSettings.contourMaxDistance ?? diagonal * 0.5;
  const maxDistance = Math.max(effectiveSpacing * 2, maxDistanceSetting);
  const baseLevels = Math.max(2, Math.floor(maxDistance / Math.max(effectiveSpacing, 0.5)));
  const maxLevels = Math.min(48, isPreview ? Math.max(2, Math.ceil(baseLevels * 0.75)) : baseLevels);

  const margin = Math.max(maxDistance, effectiveSpacing * 4);
  const expandedBounds: BoundingBox = {
    minX: baseBounds.minX - margin,
    minY: baseBounds.minY - margin,
    maxX: baseBounds.maxX + margin,
    maxY: baseBounds.maxY + margin,
  };

  const width = Math.max(1, Math.ceil(expandedBounds.maxX - expandedBounds.minX));
  const height = Math.max(1, Math.ceil(expandedBounds.maxY - expandedBounds.minY));

  const seed = (params.randomSeed ?? Math.floor(Math.random() * 0xffffffff)) >>> 0;
  const jobId = hashContourJob(
    vertexBuffer,
    effectiveSpacing,
    effectiveVariance,
    effectiveSmoothness,
    seed,
    fieldResolution,
    pixelMode,
    maxLevels,
  );

  const baseDynamicParams = resolveShapeFillGpuParams(brushSettings);
  const hardeningStrength = pixelMode
    ? Math.min(Math.max(baseDynamicParams.shapeFillHardening ?? 1, 0), 1)
    : 0;
  const edgeFeather = Math.max(0.5, baseDynamicParams.shapeFillEdgeFeather ?? (pixelMode ? 1 : 1));
  const hardeningThreshold = Math.min(Math.max(baseDynamicParams.shapeFillHardeningThreshold ?? 0.5, 0), 1);
  const dynamicParams: Record<string, number> = { ...baseDynamicParams };
  const alternateStride = 0;
  const alternateLineWidth = strokeWidth;

  const strokeColor = params.strokeColorOverride ?? brushSettings.color ?? '#1a1a1a';
  const colorRgba = colorToRgba(strokeColor);

  const fallback = () => {
    debugWarn('shape-fill', 'Contour GPU stroke failed; output skipped.');
  };

  renderContourStroke(
    params,
    {
      jobId,
      priority: isPreview ? 'preview' : 'final',
      spacing: effectiveSpacing,
      variance: effectiveVariance,
      smoothness: effectiveSmoothness,
      maxLevels,
      maxDistance,
      fieldResolution,
      strokeWidth,
      strokeColor,
      colorRgba,
      pixelMode,
      seed,
      expandedBounds,
      width,
      height,
      margin,
      vertexBuffer,
      hardeningStrength,
      edgeFeather,
      threshold: hardeningThreshold,
      alternateStride,
      alternateLineWidth,
      dynamicParams,
    },
    fallback,
  );
};
