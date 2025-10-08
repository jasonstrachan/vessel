import {
  computeBoundingBox,
  ensureFloat32Vertices,
  getWebGPUSupportStatus,
  isWebGPUSupported,
  SHAPE_FILL_GPU_RETIRED_REASON,
  type StrokeJob,
} from '@/lib/shapeFill';
import type { BoundingBox } from '@/lib/shapeFill/types';
import { generateContourLoops } from '@/lib/shapeFill/cpu/contourGeometry';
import { buildContourMesh } from '@/lib/shapeFill/cpu/contourMesh';
import { PixelRasterizer } from '@/lib/shapeFill/gpu/PixelRasterizer';
import { debugLog, debugWarn, isDebugEnabled } from '@/utils/debug';
import { parseCssColor, type RGBAColor } from '@/utils/color/parseCssColor';
import type { ContourFillParams, Point } from './types';
import { resolveShapeFillGpuParams } from './common';

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

const withDeviceSpace = (ctx: CanvasRenderingContext2D, fn: () => void): void => {
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  try {
    fn();
  } finally {
    ctx.restore();
  }
};

const clearCanvasDeviceSpace = (ctx: CanvasRenderingContext2D): void => {
  withDeviceSpace(ctx, () => {
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  });
};

type DevicePoint = Point;

type Pt = { x: number; y: number };

const getCanvasCSSSize = (canvas: HTMLCanvasElement | OffscreenCanvas | undefined) => {
  if (!canvas || !(canvas instanceof HTMLCanvasElement)) {
    return { w: 0, h: 0 };
  }
  return {
    w: canvas.clientWidth || 0,
    h: canvas.clientHeight || 0,
  };
};

const cssScale = (ctx: CanvasRenderingContext2D) => {
  const el = ctx.canvas as HTMLCanvasElement;
  const dpr = (typeof window !== 'undefined' ? window.devicePixelRatio : 1) || 1;
  const sx = el && el.clientWidth ? ctx.canvas.width / el.clientWidth : dpr;
  const sy = el && el.clientHeight ? ctx.canvas.height / el.clientHeight : dpr;
  return { sx, sy, dpr };
};

const loggedPreviewJobs = new Set<string>();

const logContourDrawSample = (
  ctx: CanvasRenderingContext2D,
  info: {
    transform: DOMMatrix | null;
    dpr: number;
    rasterOrigin: Point;
    drawAt: Point;
    deviceOrigin: Point;
    cssDeviceOrigin: Point;
    useCSSOrigin: boolean;
    jobId: string;
    priority: RenderConfig['priority'];
  },
): void => {
  if (info.priority !== 'preview') {
    return;
  }

  if (loggedPreviewJobs.has(info.jobId)) {
    return;
  }
  loggedPreviewJobs.add(info.jobId);

  const canvasEl = ctx.canvas instanceof HTMLCanvasElement ? ctx.canvas : null;
  debugLog('contour-draw', {
    ctm: info.transform
      ? { a: info.transform.a, b: info.transform.b, c: info.transform.c, d: info.transform.d, e: info.transform.e, f: info.transform.f }
      : null,
    dpr: info.dpr,
    canvas: { w: ctx.canvas.width, h: ctx.canvas.height },
    client: {
      w: canvasEl?.clientWidth ?? 0,
      h: canvasEl?.clientHeight ?? 0,
    },
    rasterOrigin: info.rasterOrigin,
    deviceOrigin: info.deviceOrigin,
    cssDeviceOrigin: info.cssDeviceOrigin,
    drawAt: info.drawAt,
    useCSSOrigin: info.useCSSOrigin,
  });
};

const toDeviceSpaceVertices = (ctx: CanvasRenderingContext2D, verts: readonly Point[]): DevicePoint[] => {
  const matrix = ctx.getTransform();
  const dpr = (typeof window !== 'undefined' ? window.devicePixelRatio : 1) || 1;
  const cssSize = getCanvasCSSSize(ctx.canvas as HTMLCanvasElement | OffscreenCanvas | undefined);
  const sx = cssSize.w > 0 ? ctx.canvas.width / cssSize.w : dpr;
  const sy = cssSize.h > 0 ? ctx.canvas.height / cssSize.h : dpr;

  const transformed: DevicePoint[] = new Array(verts.length);
  for (let i = 0; i < verts.length; i += 1) {
    const source = verts[i];
    const cx = source.x * matrix.a + source.y * matrix.c + matrix.e;
    const cy = source.x * matrix.b + source.y * matrix.d + matrix.f;
    transformed[i] = {
      x: cx * sx,
      y: cy * sy,
    };
  }

  return transformed;
};

const drawPreviewLoops = (
  ctx: CanvasRenderingContext2D,
  loops: ReturnType<typeof generateContourLoops>,
  strokeColor: string,
  strokeWidth: number,
  pixelMode: boolean,
  opacity: number,
  blendMode?: string | null,
) => {
  withDeviceSpace(ctx, () => {
    clearCanvasDeviceSpace(ctx);

    ctx.save();
    ctx.globalAlpha = opacity;
    ctx.globalCompositeOperation = (blendMode ?? 'source-over') as GlobalCompositeOperation;
    ctx.imageSmoothingEnabled = !pixelMode;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.strokeStyle = strokeColor;

    const closingTolerance = 2;

    for (const loopResult of loops) {
      const loop = loopResult.loop;
      if (loop.length < 2) {
        continue;
      }
      const isIndex = loopResult.level % 5 === 0;
      const lineWidth = isIndex ? strokeWidth * 1.6 : strokeWidth;
      ctx.lineWidth = Math.max(0.2, lineWidth);
      if (isIndex) {
        ctx.setLineDash([]);
      } else {
        const dashLength = Math.max(3, lineWidth * 2.4);
        const gapLength = Math.max(2, lineWidth * 1.6);
        ctx.setLineDash([dashLength, gapLength]);
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

    ctx.setLineDash([]);
    ctx.restore();
  });
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
  deviceVertices?: Point[];
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
    if (status.status === 'unavailable' && status.reason === SHAPE_FILL_GPU_RETIRED_REASON) {
      debugLog('shape-fill', 'Contour GPU pipeline retired; using CPU renderer.');
    } else {
      const reason = status.status === 'unavailable'
        ? status.reason
        : 'WebGPU support is disabled';
      debugWarn('shape-fill', `WebGPU is unavailable; contour fill skipped (${reason}).`);
    }
    return false;
  }

  const { ctx, vertices, brushSettings, dependencies } = params;
  const deviceVertices = config.deviceVertices ?? toDeviceSpaceVertices(ctx, vertices);
  let warnedNonIdentity = false;

  const jobPromise = (async () => {
    let loops: ReturnType<typeof generateContourLoops> = [];
    try {
      const transform = typeof ctx.getTransform === 'function' ? ctx.getTransform() : null;
      if (
        transform && (
          transform.a !== 1 ||
          transform.d !== 1 ||
          transform.b !== 0 ||
          transform.c !== 0 ||
          transform.e !== 0 ||
          transform.f !== 0
        )
      ) {
        if (!warnedNonIdentity) {
          debugWarn('shape-fill', 'Resetting non-identity CTM before SDF; verify upstream transforms.');
          warnedNonIdentity = true;
        }
      }

      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      const field = dependencies.createSignedDistanceField(deviceVertices, {
        canvasWidth: ctx.canvas.width,
        canvasHeight: ctx.canvas.height,
        resolution: config.fieldResolution,
        seed: config.seed,
      });
      ctx.restore();

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
          clearCanvasDeviceSpace(ctx);
        } else {
          onFallback();
        }
        return;
      }

      if (config.priority === 'preview') {
        if (isDebugEnabled('ctm+dpr')) {
          const transform = ctx.getTransform();
          const canvasElement = ctx.canvas as HTMLCanvasElement | OffscreenCanvas | undefined;
          const clientSize =
            canvasElement && 'clientWidth' in canvasElement
              ? {
                  w: (canvasElement as HTMLCanvasElement).clientWidth ?? 0,
                  h: (canvasElement as HTMLCanvasElement).clientHeight ?? 0,
                }
              : { w: 0, h: 0 };
          debugLog('ctm+dpr', {
            jobId: config.jobId,
            dpr: typeof window !== 'undefined' ? window.devicePixelRatio : undefined,
            canvas: { w: ctx.canvas.width, h: ctx.canvas.height },
            client: clientSize,
            ctm: {
              a: transform.a,
              b: transform.b,
              c: transform.c,
              d: transform.d,
              e: transform.e,
              f: transform.f,
            },
          });
        }

        drawPreviewLoops(
          ctx,
          loops,
          config.strokeColor,
          config.strokeWidth,
          config.pixelMode,
          brushSettings.opacity,
          brushSettings.blendMode,
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
        tolerance: Math.max(3, config.fieldResolution * 1.75),
      });

      if (!mesh) {
        debugWarn('shape-fill', 'Contour CPU mesh builder produced no geometry.');
        drawPreviewLoops(
          ctx,
          loops,
          config.strokeColor,
          config.strokeWidth,
          config.pixelMode,
          brushSettings.opacity,
          brushSettings.blendMode,
        );
        debugLog(PREVIEW_SCOPE, 'fallback preview loops for mesh miss', {
          jobId: config.jobId,
          loopCount: loops.length,
        });
        return;
      }

      const bounds = config.expandedBounds;
      const vertexData = mesh.vertexData;
      if (vertexData?.length) {
        let meshMinX = Infinity;
        let meshMinY = Infinity;
        let meshMaxX = -Infinity;
        let meshMaxY = -Infinity;

        for (let i = 0; i < vertexData.length; i += 4) {
          const x = vertexData[i];
          const y = vertexData[i + 1];
          if (x < meshMinX) meshMinX = x;
          if (y < meshMinY) meshMinY = y;
          if (x > meshMaxX) meshMaxX = x;
          if (y > meshMaxY) meshMaxY = y;
        }
        const meshW = meshMaxX - meshMinX;
        const meshH = meshMaxY - meshMinY;
        console.assert(
          meshW <= (bounds.maxX - bounds.minX) + 2 && meshH <= (bounds.maxY - bounds.minY) + 2,
          'Mesh exceeds expandedBounds — likely double-transform',
        );

        if (isDebugEnabled('contour-mesh-space')) {
          debugLog('contour-mesh-space', {
            meshMinX,
            meshMinY,
            meshMaxX,
            meshMaxY,
            expandedBounds: bounds,
          });
        }
      }

      debugLog(CPU_SCOPE, 'built CPU mesh', {
        jobId: config.jobId,
        vertexCount: mesh.vertexCount,
        quadCount: mesh.quadCount,
      });

      const job: StrokeJob = {
        id: config.jobId,
        vertices: new Float32Array([
          bounds.minX,
          bounds.minY,
          bounds.maxX,
          bounds.maxY,
        ]),
        bounds,
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
        drawPreviewLoops(
          ctx,
          loops,
          config.strokeColor,
          config.strokeWidth,
          config.pixelMode,
          brushSettings.opacity,
          brushSettings.blendMode,
        );
        return;
      }

      try {
        const bounds = config.expandedBounds;
        console.assert(
          raster.origin.x === Math.floor(bounds.minX) && raster.origin.y === Math.floor(bounds.minY),
          'Raster origin != expandedBounds.min (space mismatch)',
        );
        console.assert(
          raster.width === Math.ceil(bounds.maxX - bounds.minX) &&
            raster.height === Math.ceil(bounds.maxY - bounds.minY),
          'Raster size != expandedBounds size',
        );

        const imageData = new ImageData(raster.width, raster.height);
        imageData.data.set(raster.pixels);

        const preTransform = typeof ctx.getTransform === 'function' ? ctx.getTransform() : null;
        const { sx, sy, dpr } = cssScale(ctx);

        const deviceOrigin: Pt = {
          x: raster.origin.x,
          y: raster.origin.y,
        };
        const cssAsDeviceOrigin: Pt = {
          x: raster.origin.x * sx,
          y: raster.origin.y * sy,
        };

        const loopsCx = (bounds.minX + bounds.maxX) * 0.5;
        const loopsCy = (bounds.minY + bounds.maxY) * 0.5;
        const half = { x: raster.width * 0.5, y: raster.height * 0.5 };
        const d2 = (center: Pt) => (center.x - loopsCx) ** 2 + (center.y - loopsCy) ** 2;
        const cDev: Pt = { x: deviceOrigin.x + half.x, y: deviceOrigin.y + half.y };
        const cCss: Pt = { x: cssAsDeviceOrigin.x + half.x, y: cssAsDeviceOrigin.y + half.y };
        const useCssOrigin = d2(cCss) < d2(cDev);
        const drawAt = useCssOrigin ? cssAsDeviceOrigin : deviceOrigin;

        debugLog('contour-final-draw', {
          jobId: config.jobId,
          priority: config.priority,
          picked: useCssOrigin ? 'css->device' : 'device',
          drawAt,
          rasterOrigin: raster.origin,
          sx,
          sy,
        });

        if (typeof createImageBitmap === 'function') {
          const bitmap = await createImageBitmap(imageData);
          withDeviceSpace(ctx, () => {
            logContourDrawSample(ctx, {
              transform: preTransform,
              dpr,
              rasterOrigin: raster.origin,
              drawAt,
              deviceOrigin,
              cssDeviceOrigin: cssAsDeviceOrigin,
              useCSSOrigin: useCssOrigin,
              jobId: config.jobId,
              priority: config.priority,
            });

            ctx.save();
            ctx.globalAlpha = brushSettings.opacity;
            ctx.globalCompositeOperation = brushSettings.blendMode || 'source-over';
            ctx.imageSmoothingEnabled = !config.pixelMode;
            ctx.drawImage(bitmap, Math.round(drawAt.x), Math.round(drawAt.y));
            ctx.restore();
          });
          bitmap.close();
        } else {
          withDeviceSpace(ctx, () => {
            logContourDrawSample(ctx, {
              transform: preTransform,
              dpr,
              rasterOrigin: raster.origin,
              drawAt,
              deviceOrigin,
              cssDeviceOrigin: cssAsDeviceOrigin,
              useCSSOrigin: useCssOrigin,
              jobId: config.jobId,
              priority: config.priority,
            });

            ctx.putImageData(imageData, Math.round(drawAt.x), Math.round(drawAt.y));
          });
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
        withDeviceSpace(ctx, () => {
          drawPreviewLoops(
            ctx,
            loops,
            config.strokeColor,
            config.strokeWidth,
            config.pixelMode,
            brushSettings.opacity,
            brushSettings.blendMode,
          );
        });
      }
      onFallback();
    }
  })();

  inflightJobs.set(inflightKey, jobPromise);
  void jobPromise.finally(() => inflightJobs.delete(inflightKey));
  return true;
};

export const drawContourFill = (params: ContourFillParams): void => {
  const { ctx, vertices, brushSettings, isPreview = false } = params;
  if (vertices.length < 3) {
    return;
  }

  const pixelMode = brushSettings.shapeFillPixelMode ?? true;
  const deviceVertices = toDeviceSpaceVertices(ctx, vertices);
  const vertexBuffer = ensureFloat32Vertices(deviceVertices, pixelMode);
  const baseBounds = computeBoundingBox(vertexBuffer);

  const strokeWidth = Math.max(0.2, brushSettings.shapeFillLineWidth ?? 1);
  const diagonal = Math.hypot(baseBounds.maxX - baseBounds.minX, baseBounds.maxY - baseBounds.minY);

  const rawFieldResolution = brushSettings.flowFieldResolution;
  const autoRes = diagonal < 1600 ? 1 : (diagonal < 3200 ? 2 : 3);
  const requestedFieldResolution = Math.round(rawFieldResolution ?? autoRes);
  const normalizedFieldResolution = Number.isFinite(requestedFieldResolution)
    ? requestedFieldResolution
    : autoRes;
  const previewCappedResolution = isPreview && rawFieldResolution == null
    ? Math.min(normalizedFieldResolution, 2)
    : normalizedFieldResolution;
  const minFieldResolution = isPreview ? 1 : 1;
  const fieldResolution = Math.max(minFieldResolution, previewCappedResolution);

  const spacingBase = params.spacingOverride ?? brushSettings.contourSpacing ?? 5;
  const spacing = Math.max(0.5, spacingBase);
  const previewSpacingMultiplier = params.previewDetail === 'minimal' ? 1.75 : 1.25;
  const effectiveSpacing = isPreview ? spacing * previewSpacingMultiplier : spacing;
  // enforce bands wider than grid cells
  const minSpacing = Math.max(3, 3 * fieldResolution); // ≥ ~3 cells per band
  const spacingClamped = Math.max(effectiveSpacing, minSpacing);

  const varianceRaw = brushSettings.contourVariance ?? 0;
  const varianceBase = Math.min(1, Math.max(0, typeof varianceRaw === 'number' ? varianceRaw : 0));
  const effectiveVariance = isPreview ? varianceBase * 0.5 : varianceBase;

  const smoothnessRaw = brushSettings.contourSmoothness ?? 0.3;
  const smoothnessBase = Math.min(1, Math.max(0, smoothnessRaw));
  const effectiveSmoothness = isPreview ? Math.min(1, smoothnessBase * 1.0) : smoothnessBase;

  const maxDistanceSetting = brushSettings.contourMaxDistance ?? diagonal * 0.5;
  const maxDistance = Math.max(spacingClamped * 2, maxDistanceSetting);
  const baseLevels = Math.max(2, Math.floor(maxDistance / Math.max(spacingClamped, 0.5)));
  const maxLevels = Math.min(48, isPreview ? Math.max(2, Math.ceil(baseLevels * 0.75)) : baseLevels);

  const margin = Math.max(maxDistance, spacingClamped * 4);
  const snappedMinX = Math.floor(baseBounds.minX - margin);
  const snappedMinY = Math.floor(baseBounds.minY - margin);
  const snappedMaxX = Math.ceil(baseBounds.maxX + margin);
  const snappedMaxY = Math.ceil(baseBounds.maxY + margin);

  const expandedBounds: BoundingBox = {
    minX: snappedMinX,
    minY: snappedMinY,
    maxX: snappedMaxX,
    maxY: snappedMaxY,
  };

  const width = Math.max(1, snappedMaxX - snappedMinX);
  const height = Math.max(1, snappedMaxY - snappedMinY);

  const seed = (params.randomSeed ?? Math.floor(Math.random() * 0xffffffff)) >>> 0;
  const jobId = hashContourJob(
    vertexBuffer,
    spacingClamped,
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
  const alternateStride = 5;
  const alternateLineWidth = strokeWidth * 1.6;

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
      spacing: spacingClamped,
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
      deviceVertices,
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
