import { SeedGenerator } from './SeedGenerator';
import { PathIntegrator } from './PathIntegrator';
import { PixelRasterizer } from './PixelRasterizer';
import { IsolineExtractor } from './IsolineExtractor';
import { TriangleNetworkGenerator } from './TriangleNetworkGenerator';
import type { StrokeJob, StrokeResolution } from '../types';
import type { FieldGeneratorResult } from '../types';
import { isWebGPUSupported } from './WebGPUDeviceManager';
import { parseCssColor, DEFAULT_RGBA, type RGBAColor } from '@/utils/color/parseCssColor';

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

export class StrokePipeline {
  private readonly seedGenerator = new SeedGenerator();

  private readonly pathIntegrator = new PathIntegrator();

  private readonly pixelRasterizer = new PixelRasterizer();

  private readonly isolineExtractor = new IsolineExtractor();

  private readonly triangleNetworkGenerator = new TriangleNetworkGenerator();

  async render(
    job: StrokeJob,
    field: FieldGeneratorResult,
    options: StrokePipelineOptions
  ): Promise<StrokePipelineResult | null> {
    if (!isWebGPUSupported()) {
      return null;
    }

    const resolution = getResolutionForJob(job, options.priority);
    if (!resolution) {
      return null;
    }

    const color = colorToRgba(options.color ?? job.brushSettings?.color);

    const dynamicParams = job.dynamicParams ?? {};

    if (job.metadata?.brush === 'triangle-fill') {
      const cellSize = dynamicParams.triangleCellSize ?? 24;
      const minSpacing = dynamicParams.triangleMinSpacing ?? cellSize * 0.6;
      const jitter = dynamicParams.triangleJitter ?? 0.35;
      const seedCount = Math.max(8, Math.round(dynamicParams.triangleMaxSeeds ?? 256));
      const maxTriangles = Math.max(seedCount * 4, Math.round(dynamicParams.triangleMaxTriangles ?? seedCount * 6));
      const maxEdges = Math.max(seedCount * 6, Math.round(dynamicParams.triangleMaxEdges ?? seedCount * 8));
      const rotationSin = Math.sin((job.brushSettings?.triangleFillRotation ?? 0) * (Math.PI / 180));
      const rotationCos = Math.cos((job.brushSettings?.triangleFillRotation ?? 0) * (Math.PI / 180));

      const triangleResult = await this.triangleNetworkGenerator.generate(job, field, {
        seed: job.seed ?? 0,
        cellSize,
        minSpacing,
        jitter,
        maxSeeds: seedCount,
        maxTriangles,
        maxEdges,
        lineWidth: Math.max(0.2, job.brushSettings?.shapeFillLineWidth ?? 1),
        rotationSin,
        rotationCos,
      });

      if (!triangleResult) {
        return null;
      }

      try {
        const raster = await this.pixelRasterizer.rasterize(job, triangleResult, {
          resolution,
          color,
        });
        if (!raster) {
          triangleResult.release();
          return null;
        }

        const release = () => {
          raster.release();
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
        triangleResult.release();
        throw error;
      }
    }

    if (job.metadata?.brush === 'contour-lines') {
      const spacingA = typeof dynamicParams.contourSpacing === 'number'
        ? dynamicParams.contourSpacing
        : 8;
      const spacingB = typeof dynamicParams.contourSpacingB === 'number'
        ? dynamicParams.contourSpacingB
        : spacingA;
      const variance = typeof dynamicParams.contourVariance === 'number'
        ? dynamicParams.contourVariance
        : 0;
      const smoothness = typeof dynamicParams.contourSmoothness === 'number'
        ? dynamicParams.contourSmoothness
        : 0;
      const maxLevels = Math.max(1, Math.round(dynamicParams.contourMaxLevels ?? 32));
      const maxDistance = Math.max(0.1, dynamicParams.contourMaxDistance ?? Math.min(resolution.width, resolution.height) * 0.5);
      const directionExtent = Math.max(1e-3, dynamicParams.contourLinesDirExtent ?? Math.min(resolution.width, resolution.height));
      const baseOrigin = {
        x: dynamicParams.contourLinesOriginX ?? job.bounds?.minX ?? 0,
        y: dynamicParams.contourLinesOriginY ?? job.bounds?.minY ?? 0,
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

      const linesResult = await this.isolineExtractor.extract(job, field, {
        mode: 'lines',
        spacingA,
        spacingB,
        variance,
        smoothness,
        maxLevels,
        maxDistance,
        lineWidth: Math.max(0.2, job.brushSettings?.shapeFillLineWidth ?? 1),
        seed: job.seed ?? 0,
        preview: options.priority === 'preview',
        baseOrigin,
        baseDirection,
        normal,
        directionExtent,
        backDistance,
      });

      if (!linesResult) {
        return null;
      }

      try {
        const raster = await this.pixelRasterizer.rasterize(job, linesResult, {
          resolution,
          color,
        });
        if (!raster) {
          linesResult.release();
          return null;
        }

        const release = () => {
          raster.release();
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
        linesResult.release();
        throw error;
      }
    }

    const contourSpacing = dynamicParams.contourSpacing;
    if (job.metadata?.brush === 'contour' && typeof contourSpacing === 'number') {
      const contourVariance = typeof dynamicParams.contourVariance === 'number'
        ? dynamicParams.contourVariance
        : 0;
      const contourSmoothness = typeof dynamicParams.contourSmoothness === 'number'
        ? dynamicParams.contourSmoothness
        : 0;
      const contourMaxLevels = Math.max(1, Math.round(dynamicParams.contourMaxLevels ?? 16));
      const contourMaxDistance = Math.max(0.1, dynamicParams.contourMaxDistance ?? Math.min(resolution.width, resolution.height) * 0.5);

      const contourResult = await this.isolineExtractor.extract(job, field, {
        mode: 'contour',
        spacingA: contourSpacing,
        spacingB: contourSpacing,
        variance: contourVariance,
        smoothness: contourSmoothness,
        maxLevels: contourMaxLevels,
        maxDistance: contourMaxDistance,
        lineWidth: Math.max(0.2, job.brushSettings?.shapeFillLineWidth ?? 1),
        seed: job.seed ?? 0,
        preview: options.priority === 'preview',
      });

      if (!contourResult) {
        return null;
      }

      try {
        const raster = await this.pixelRasterizer.rasterize(job, contourResult, {
          resolution,
          color,
        });
        if (!raster) {
          contourResult.release();
          return null;
        }

        const release = () => {
          raster.release();
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
        contourResult.release();
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

    const seeds = await this.seedGenerator.generate(job, { seedsPerAxis });
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
      );
      if (!path) {
        seeds.release();
        return null;
      }

      try {
        const raster = await this.pixelRasterizer.rasterize(job, path, {
          resolution,
          color,
        });
        if (!raster) {
          path.release();
          seeds.release();
          return null;
        }

        const release = () => {
          raster.release();
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
