import { SeedGenerator } from './SeedGenerator';
import { PathIntegrator } from './PathIntegrator';
import type { PathIntegrationResult } from './PathIntegrator';
import { PixelRasterizer } from './PixelRasterizer';
import { IsolineExtractor } from './IsolineExtractor';
import { TriangleNetworkGenerator } from './TriangleNetworkGenerator';
import { QuadExpander } from './QuadExpander';
import type { QuadExpandOptions, QuadExpandResult } from './QuadExpander';
import type { StrokeJob, StrokeResolution, BoundingBox } from '../types';
import type { FieldGeneratorResult } from '../types';
import { WebGPUDeviceManager, isWebGPUSupported } from './WebGPUDeviceManager';
import { getShapeFillMeshCache, hashStructuredValue } from './meshCache';
import { parseCssColor, DEFAULT_RGBA, type RGBAColor } from '@/utils/color/parseCssColor';
import { debugLog } from '@/utils/debug';
import type { BrushSettings } from '@/types';

export interface StrokePipelineOptions {
  priority: 'preview' | 'final';
  color?: string;
}

export interface StrokePipelineResult {
  pixels: Uint8ClampedArray;
  width: number;
  height: number;
  origin: { x: number; y: number };
  release(): void;
}

const getResolutionForJob = (job: StrokeJob, priority: 'preview' | 'final'): StrokeResolution | null => {
  if (priority === 'preview' && job.previewResolution) {
    return job.previewResolution;
  }
  if (job.finalResolution) {
    return job.finalResolution;
  }
  return job.previewResolution ?? null;
};

const colorToRgba = (color?: string): RGBAColor => parseCssColor(color ?? '', DEFAULT_RGBA);

const SCALE_BUCKET_FACTOR = 100;

const sanitizeNumberRecord = (input: Record<string, unknown> | undefined): Record<string, unknown> | undefined => {
  if (!input) {
    return undefined;
  }
  const entries = Object.keys(input)
    .sort()
    .reduce<Record<string, unknown>>((acc, key) => {
      const value = input[key];
      if (value === undefined || typeof value === 'function') {
        return acc;
      }
      if (typeof value === 'number') {
        if (Number.isFinite(value)) {
          acc[key] = value;
        }
        return acc;
      }
      if (typeof value === 'boolean' || typeof value === 'string') {
        acc[key] = value;
        return acc;
      }
      if (Array.isArray(value)) {
        acc[key] = value.slice(0, 32);
        return acc;
      }
      if (value && typeof value === 'object') {
        const nested = sanitizeNumberRecord(value as Record<string, unknown>);
        if (nested && Object.keys(nested).length) {
          acc[key] = nested;
        }
        return acc;
      }
      return acc;
    }, {});
  return Object.keys(entries).length ? entries : undefined;
};

const BRUSH_CACHE_KEYS = [
  'shapeFillLineWidth',
  'shapeFillPixelMode',
  'shapeGradientMode',
  'flowFieldResolution',
  'flowSeedSpacing',
  'flowMaxSteps',
  'flowOrientationAngle',
  'flowSeedJitter',
  'triangleFillSize',
  'triangleFillRotation',
  'triangleFillJitter',
  'triangleFillDensity',
  'ribbonLineWidth',
  'ribbonSeedSpacing',
  'ribbonSdfStep',
  'ribbonBiasAngle',
  'crossHatchSpacing',
  'crossHatchLineWidth',
  'crossHatchRotation',
  'contourSpacing',
  'contourSpacingB',
  'contourVariance',
  'contourSmoothness',
  'contourLinesDirExtent',
];

const pickBrushSettingsForCache = (brushSettings: BrushSettings | undefined): Record<string, unknown> | undefined => {
  if (!brushSettings) {
    return undefined;
  }
  const snapshot: Record<string, unknown> = {};
  const source = brushSettings as unknown as Record<string, unknown>;
  for (const key of BRUSH_CACHE_KEYS) {
    if (Object.prototype.hasOwnProperty.call(source, key)) {
      const value = source[key];
      if (value !== undefined && typeof value !== 'function') {
        snapshot[key] = value;
      }
    }
  }
  return Object.keys(snapshot).length ? snapshot : undefined;
};

const buildMeshCacheKey = (
  job: StrokeJob,
  path: PathIntegrationResult,
  options: QuadExpandOptions,
  extras?: Record<string, unknown>,
): string => {
  const scaleValue = options.resolution.scale ?? 1;
  const scaleBucket = Math.max(1, Math.round(scaleValue * SCALE_BUCKET_FACTOR));
  const bounds = options.bounds;

  const payload = {
    jobId: job.id,
    seed: job.seed ?? 0,
    brush: job.metadata?.brush ?? job.brushSettings?.brushShape ?? 'generic',
    pendingGizmo: job.pendingGizmo ?? false,
    pixelMode: job.pixelMode ?? job.brushSettings?.shapeFillPixelMode ?? true,
    dynamic: sanitizeNumberRecord(job.dynamicParams),
    brushSettings: pickBrushSettingsForCache(job.brushSettings as BrushSettings | undefined),
    metadata: sanitizeNumberRecord(job.metadata as Record<string, unknown> | undefined),
    resolution: {
      width: Math.round(options.resolution.width),
      height: Math.round(options.resolution.height),
      scaleBucket,
    },
    geometry: {
      lineWidth: options.lineWidth,
      alternateLineWidth: options.alternateLineWidth,
      alternateStride: options.alternateStride,
      coordinateSpace: path.coordinateSpace,
      vertexCount: path.vertexCount,
      segmentStride: options.segmentMetadata?.stride ?? path.segmentMetadata?.stride ?? 0,
    },
    bounds: {
      minX: bounds.minX,
      minY: bounds.minY,
      maxX: bounds.maxX,
      maxY: bounds.maxY,
    },
    extras,
  };

  return `mesh:${hashStructuredValue(payload)}`;
};

export class StrokePipeline {
  private readonly deviceManager = WebGPUDeviceManager.getInstance();

  private readonly seedGenerator = new SeedGenerator();

  private readonly pathIntegrator = new PathIntegrator();

  private readonly pixelRasterizer = new PixelRasterizer();

  private readonly isolineExtractor = new IsolineExtractor();

  private readonly triangleNetworkGenerator = new TriangleNetworkGenerator();

  private readonly quadExpander = new QuadExpander();

  private readonly meshCache = getShapeFillMeshCache();

  private async acquireQuadGeometry(
    job: StrokeJob,
    path: PathIntegrationResult,
    options: QuadExpandOptions,
    extras?: Record<string, unknown>,
  ): Promise<QuadExpandResult | null> {
    const cacheKey = buildMeshCacheKey(job, path, options, extras);
    const generation = this.deviceManager.getDeviceGeneration();
    const cached = this.meshCache.get(cacheKey, generation);
    if (cached) {
      debugLog('shape-fill', 'mesh cache hit', { jobId: job.id, key: cacheKey });
      return cached;
    }

    const geometry = await this.quadExpander.expand(path, options);
    if (!geometry) {
      return null;
    }

    const stored = this.meshCache.store(cacheKey, generation, geometry);
    if (stored !== geometry) {
      debugLog('shape-fill', 'mesh cache store', {
        jobId: job.id,
        key: cacheKey,
        vertexCount: stored.vertexCount,
      });
    }
    return stored;
  }

  async render(
    job: StrokeJob,
    field: FieldGeneratorResult | null,
    options: StrokePipelineOptions
  ): Promise<StrokePipelineResult | null> {
    if (!isWebGPUSupported()) {
      return null;
    }

    const resolution = getResolutionForJob(job, options.priority);
    if (!resolution) {
      return null;
    }

    const effectiveBounds: BoundingBox = job.bounds ?? {
      minX: 0,
      minY: 0,
      maxX: resolution.width,
      maxY: resolution.height,
    };

    if (
      effectiveBounds.maxX <= effectiveBounds.minX ||
      effectiveBounds.maxY <= effectiveBounds.minY
    ) {
      return null;
    }

    const color = colorToRgba(options.color ?? job.brushSettings?.color);

    const dynamicParams = job.dynamicParams ?? {};
    const strokeLineWidth = Math.max(0.2, job.brushSettings?.shapeFillLineWidth ?? 1);
    const pixelMode = job.pixelMode ?? job.brushSettings?.shapeFillPixelMode ?? true;
    const hardeningStrength = pixelMode
      ? Math.min(Math.max(typeof dynamicParams.shapeFillHardening === 'number'
        ? dynamicParams.shapeFillHardening
        : 1, 0), 1)
      : 0;
    const edgeFeather = Math.max(0.5, typeof dynamicParams.shapeFillEdgeFeather === 'number'
      ? dynamicParams.shapeFillEdgeFeather
      : (pixelMode ? 1 : 1));
    const hardeningThreshold = Math.min(Math.max(typeof dynamicParams.shapeFillHardeningThreshold === 'number'
      ? dynamicParams.shapeFillHardeningThreshold
      : 0.5, 0), 1);

    const logRasterPass = (
      path: PathIntegrationResult,
      quad: QuadExpandResult,
    ): void => {
      debugLog('shape-fill', 'raster pass', {
        jobId: job.id,
        bounds: effectiveBounds,
        coordSpace: path.coordinateSpace,
        isNormalized: path.coordinateSpace === 'normalized',
        target: { w: resolution.width, h: resolution.height },
        verts: quad.vertexCount,
        quads: quad.quadCount,
      });
    };

    if (job.metadata?.brush === 'contour') {
      if (!field) {
        return null;
      }

      const spacing = Math.max(
        0.5,
        typeof dynamicParams.contourSpacing === 'number'
          ? dynamicParams.contourSpacing
          : job.brushSettings?.contourSpacing ?? 5,
      );
      const variance = Math.min(
        1,
        Math.max(
          0,
          typeof dynamicParams.contourVariance === 'number'
            ? dynamicParams.contourVariance
            : job.brushSettings?.contourVariance ?? 0,
        ),
      );
      const smoothness = Math.min(
        1,
        Math.max(
          0,
          typeof dynamicParams.contourSmoothness === 'number'
            ? dynamicParams.contourSmoothness
            : job.brushSettings?.contourSmoothness ?? 0.3,
        ),
      );
      const maxLevels = Math.max(
        1,
        Math.round(
          typeof dynamicParams.contourMaxLevels === 'number'
            ? dynamicParams.contourMaxLevels
            : Math.max(2, (resolution.width + resolution.height) / Math.max(spacing * 4, 1)),
        ),
      );
      const maxDistance = Math.max(
        spacing * 2,
        typeof dynamicParams.contourMaxDistance === 'number'
          ? dynamicParams.contourMaxDistance
          : Math.max(resolution.width, resolution.height) * 0.5,
      );

      const contourResult = await this.isolineExtractor.extract(job, field, effectiveBounds, {
        mode: 'contour',
        spacingA: spacing,
        spacingB: spacing,
        variance,
        smoothness,
        maxLevels,
        maxDistance,
        lineWidth: strokeLineWidth,
        seed: job.seed ?? 0,
        preview: options.priority === 'preview',
      });
      if (!contourResult) {
        return null;
      }

      const quadGeometry = await this.acquireQuadGeometry(
        job,
        contourResult,
        {
          bounds: effectiveBounds,
          resolution,
          lineWidth: strokeLineWidth,
          segmentMetadata: contourResult.segmentMetadata,
        },
        {
          branch: 'contour',
          priority: options.priority,
          spacing,
          variance,
          smoothness,
          maxLevels,
        },
      );
      if (!quadGeometry) {
        contourResult.release();
        return null;
      }

      try {
        logRasterPass(contourResult, quadGeometry);
        const raster = await this.pixelRasterizer.rasterize(job, quadGeometry, {
          resolution,
          color,
          bounds: effectiveBounds,
          pixelMode,
          hardeningStrength,
          edgeFeather,
          threshold: hardeningThreshold,
        });
        if (!raster) {
          quadGeometry.release();
          contourResult.release();
          return null;
        }

        const release = () => {
          raster.release();
          quadGeometry.release();
          contourResult.release();
        };

        return {
          pixels: raster.pixels,
          width: raster.width,
          height: raster.height,
          origin: raster.origin,
          release,
        };
      } catch (error) {
        quadGeometry.release();
        contourResult.release();
        throw error;
      }
    }

    if (!field) {
      return null;
    }

    if (job.metadata?.brush === 'triangle-fill') {
      const cellSize = dynamicParams.triangleCellSize ?? 24;
      const minSpacing = dynamicParams.triangleMinSpacing ?? cellSize * 0.6;
      const jitter = dynamicParams.triangleJitter ?? 0.35;
      const seedCount = Math.max(8, Math.round(dynamicParams.triangleMaxSeeds ?? 256));
      const maxTriangles = Math.max(seedCount * 4, Math.round(dynamicParams.triangleMaxTriangles ?? seedCount * 6));
      const maxEdges = Math.max(seedCount * 6, Math.round(dynamicParams.triangleMaxEdges ?? seedCount * 8));
      const rotationSin = Math.sin((job.brushSettings?.triangleFillRotation ?? 0) * (Math.PI / 180));
      const rotationCos = Math.cos((job.brushSettings?.triangleFillRotation ?? 0) * (Math.PI / 180));

      const triangleResult = await this.triangleNetworkGenerator.generate(job, field, effectiveBounds, {
        seed: job.seed ?? 0,
        cellSize,
        minSpacing,
        jitter,
        maxSeeds: seedCount,
        maxTriangles,
        maxEdges,
        lineWidth: strokeLineWidth,
        rotationSin,
        rotationCos,
      });

      if (!triangleResult) {
        return null;
      }

      const quadGeometry = await this.acquireQuadGeometry(
        job,
        triangleResult,
        {
          bounds: effectiveBounds,
          resolution,
          lineWidth: strokeLineWidth,
        },
        {
          branch: 'triangle',
          priority: options.priority,
        },
      );
      if (!quadGeometry) {
        triangleResult.release();
        return null;
      }

      try {
        logRasterPass(triangleResult, quadGeometry);
        const raster = await this.pixelRasterizer.rasterize(job, quadGeometry, {
          resolution,
          color,
          bounds: effectiveBounds,
          pixelMode,
          hardeningStrength,
          edgeFeather,
          threshold: hardeningThreshold,
        });
        if (!raster) {
          quadGeometry.release();
          triangleResult.release();
          return null;
        }

        const release = () => {
          raster.release();
          quadGeometry.release();
          triangleResult.release();
        };

        return {
          pixels: raster.pixels,
          width: raster.width,
          height: raster.height,
          origin: raster.origin,
          release,
        };
      } catch (error) {
        quadGeometry.release();
        triangleResult.release();
        throw error;
      }
    }

    if (job.metadata?.brush === 'contour-lines') {
      const isPreview = options.priority === 'preview';
      const previewScale = isPreview ? 0.5 : 1;
      const spacingBase = typeof dynamicParams.contourSpacing === 'number'
        ? dynamicParams.contourSpacing
        : 12;
      const spacingA = Math.max(4, Math.round(spacingBase));
      const spacingB = Math.max(4, Math.round(typeof dynamicParams.contourSpacingB === 'number'
        ? dynamicParams.contourSpacingB
        : spacingA));
      const variance = typeof dynamicParams.contourVariance === 'number'
        ? dynamicParams.contourVariance
        : 0;
      const baseSmoothness = typeof dynamicParams.contourSmoothness === 'number'
        ? dynamicParams.contourSmoothness
        : 0.15;
      const smoothness = Math.min(0.9, baseSmoothness * previewScale);
      const baseMaxDistance = dynamicParams.contourMaxDistance ?? Math.min(resolution.width, resolution.height) * 0.5;
      const maxDistance = Math.max(0.1, baseMaxDistance * previewScale);
      const maxLevels = Math.max(1, Math.floor(maxDistance / spacingA));
      const baseDirectionExtent = dynamicParams.contourLinesDirExtent ?? Math.min(resolution.width, resolution.height);
      const directionExtent = Math.max(1e-3, baseDirectionExtent * previewScale);
      const baseOrigin = {
        x: dynamicParams.contourLinesOriginX ?? effectiveBounds.minX,
        y: dynamicParams.contourLinesOriginY ?? effectiveBounds.minY,
      };
      const baseDirection = {
        x: dynamicParams.contourLinesDirX ?? 1,
        y: dynamicParams.contourLinesDirY ?? 0,
      };
      const normal = {
        x: dynamicParams.contourLinesNormalX ?? 0,
        y: dynamicParams.contourLinesNormalY ?? 1,
      };
      const backDistance = Math.max(0, dynamicParams.contourLinesBackDistance ?? 0);
      const alternateStride = Math.max(2, Math.round(dynamicParams.contourIndexStride ?? 5));
      const alternateWidthMultiplier = Math.max(1, dynamicParams.contourIndexWidthMultiplier ?? 1.75);
      const alternateLineWidth = Math.max(strokeLineWidth, strokeLineWidth * alternateWidthMultiplier);

      const linesResult = await this.isolineExtractor.extract(job, field, effectiveBounds, {
        mode: 'lines',
        spacingA,
        spacingB,
        variance,
        smoothness,
        maxLevels,
        maxDistance,
        lineWidth: strokeLineWidth,
        seed: job.seed ?? 0,
        preview: isPreview,
        baseOrigin,
        baseDirection,
        normal,
        directionExtent,
        backDistance,
        alternateStride,
      });

      if (!linesResult) {
        return null;
      }

      const quadGeometry = await this.acquireQuadGeometry(
        job,
        linesResult,
        {
          bounds: effectiveBounds,
          resolution,
          lineWidth: strokeLineWidth,
          alternateLineWidth,
          alternateStride,
          segmentMetadata: linesResult.segmentMetadata,
        },
        {
          branch: 'contour-lines',
          priority: options.priority,
          variant: typeof dynamicParams.contourLinesVariant === 'string'
            ? dynamicParams.contourLinesVariant
            : job.metadata?.brush,
        },
      );
      if (!quadGeometry) {
        linesResult.release();
        return null;
      }

      try {
        logRasterPass(linesResult, quadGeometry);
        const raster = await this.pixelRasterizer.rasterize(job, quadGeometry, {
          resolution,
          color,
          bounds: effectiveBounds,
          pixelMode,
          hardeningStrength,
          edgeFeather,
          threshold: hardeningThreshold,
        });
        if (!raster) {
          quadGeometry.release();
          linesResult.release();
          return null;
        }

        const release = () => {
          raster.release();
          quadGeometry.release();
          linesResult.release();
        };

        return {
          pixels: raster.pixels,
          width: raster.width,
          height: raster.height,
          origin: raster.origin,
          release,
        };
      } catch (error) {
        quadGeometry.release();
        linesResult.release();
        throw error;
      }
    }

    const tileCount = field.metrics?.tilesProcessed ?? field.tiles.length ?? 1;
    let seedsPerAxis = Math.max(4, Math.ceil(Math.sqrt(Math.max(1, tileCount))) * (options.priority === 'preview' ? 1 : 2));

    if (job.metadata?.brush === 'cross-hatch') {
      const spacing = Math.max(1, dynamicParams.crossHatchSpacing ?? 10);
      const span = Math.max(resolution.width, resolution.height, spacing);
      const targetSeeds = Math.max(4, Math.round(span / spacing));
      const preferredSeeds = typeof dynamicParams.crossHatchSeedsPerAxis === 'number'
        ? Math.max(4, Math.round(dynamicParams.crossHatchSeedsPerAxis))
        : targetSeeds;
      const previewScale = options.priority === 'preview' ? 0.75 : 1;
      seedsPerAxis = Math.max(4, Math.round(preferredSeeds * previewScale));
    }

    const seeds = await this.seedGenerator.generate(job, effectiveBounds, { seedsPerAxis });
    if (!seeds) {
      return null;
    }

    try {
      const path = await this.pathIntegrator.integrate(
        job,
        seeds,
        job.metadata?.brush === 'cross-hatch'
          ? {
              lineLength: Math.max(
                1,
                typeof dynamicParams.crossHatchLineLength === 'number'
                  ? dynamicParams.crossHatchLineLength
                  : Math.max(resolution.width, resolution.height)
              ),
            }
          : undefined,
        effectiveBounds,
      );
      if (!path) {
        seeds.release();
        return null;
      }

      const quadGeometry = await this.acquireQuadGeometry(
        job,
        path,
        {
          bounds: effectiveBounds,
          resolution,
          lineWidth: strokeLineWidth,
        },
        {
          branch: 'seed-path',
          priority: options.priority,
          seedsPerAxis,
        },
      );
      if (!quadGeometry) {
        path.release();
        seeds.release();
        return null;
      }

      try {
        logRasterPass(path, quadGeometry);
        const raster = await this.pixelRasterizer.rasterize(job, quadGeometry, {
          resolution,
          color,
          bounds: effectiveBounds,
          pixelMode,
          hardeningStrength,
          edgeFeather,
          threshold: hardeningThreshold,
        });
        if (!raster) {
          quadGeometry.release();
          path.release();
          seeds.release();
          return null;
        }

        const release = () => {
          raster.release();
          quadGeometry.release();
          path.release();
          seeds.release();
        };

        return {
          pixels: raster.pixels,
          width: raster.width,
          height: raster.height,
          origin: raster.origin,
          release,
        };
      } catch (error) {
        quadGeometry.release();
        path.release();
        seeds.release();
        throw error;
      }
    } catch (error) {
      seeds.release();
      throw error;
    }
  }
}

let pipelineInstance: StrokePipeline | null = null;

export const getStrokePipeline = (): StrokePipeline => {
  if (!pipelineInstance) {
    pipelineInstance = new StrokePipeline();
  }
  return pipelineInstance;
};

export const disposeStrokePipeline = (): void => {
  pipelineInstance = null;
};
