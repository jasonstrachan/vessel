import { SeedGenerator } from './SeedGenerator';
import { PathIntegrator } from './PathIntegrator';
import type { PathIntegrationResult } from './PathIntegrator';
import { PixelRasterizer } from './PixelRasterizer';
import { IsolineExtractor } from './IsolineExtractor';
import { TriangleNetworkGenerator } from './TriangleNetworkGenerator';
import { QuadExpander } from './QuadExpander';
import type { QuadExpandResult } from './QuadExpander';
import type { StrokeJob, StrokeResolution, BoundingBox } from '../types';
import type { FieldGeneratorResult } from '../types';
import { WebGPUDeviceManager, isWebGPUSupported } from './WebGPUDeviceManager';
import { parseCssColor, DEFAULT_RGBA, type RGBAColor } from '@/utils/color/parseCssColor';
import { debugLog } from '@/utils/debug';
import type { ContourGeometry } from '@/lib/shapeFill/cpu/contourGeometry';

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
  private readonly deviceManager = WebGPUDeviceManager.getInstance();

  private readonly seedGenerator = new SeedGenerator();

  private readonly pathIntegrator = new PathIntegrator();

  private readonly pixelRasterizer = new PixelRasterizer();

  private readonly isolineExtractor = new IsolineExtractor();

  private readonly triangleNetworkGenerator = new TriangleNetworkGenerator();

  private readonly quadExpander = new QuadExpander();

  private async uploadContourGeometry(
    job: StrokeJob,
    geometry: ContourGeometry,
  ): Promise<PathIntegrationResult | null> {
    if (!geometry.loops.length) {
      return null;
    }

    const device = await this.deviceManager.ensureDevice();
    if (!device) {
      return null;
    }

    let segmentCount = 0;
    for (const loop of geometry.loops) {
      segmentCount += Math.max(0, loop.points.length / 2);
    }
    if (segmentCount === 0) {
      return null;
    }

    const vertexData = new Float32Array(segmentCount * 4);
    const metadataData = new Float32Array(segmentCount);

    let vertexOffset = 0;
    let segmentIndex = 0;
    for (const loop of geometry.loops) {
      const points = loop.points;
      const pointCount = Math.max(0, points.length / 2);
      if (pointCount < 2) {
        continue;
      }
      for (let index = 0; index < pointCount; index += 1) {
        const nextIndex = (index + 1) % pointCount;
        const ax = points[index * 2];
        const ay = points[index * 2 + 1];
        const bx = points[nextIndex * 2];
        const by = points[nextIndex * 2 + 1];
        vertexData[vertexOffset++] = ax;
        vertexData[vertexOffset++] = ay;
        vertexData[vertexOffset++] = bx;
        vertexData[vertexOffset++] = by;
        metadataData[segmentIndex++] = loop.levelIndex;
      }
    }

    if (segmentIndex === 0) {
      return null;
    }

    const vertexBuffer = device.createBuffer({
      label: `contour-cpu-vertices-${job.id}`,
      size: vertexData.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
      mappedAtCreation: true,
    });
    new Float32Array(vertexBuffer.getMappedRange()).set(vertexData);
    vertexBuffer.unmap();

    const metadataBuffer = device.createBuffer({
      label: `contour-cpu-metadata-${job.id}`,
      size: metadataData.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
      mappedAtCreation: true,
    });
    new Float32Array(metadataBuffer.getMappedRange()).set(metadataData);
    metadataBuffer.unmap();

    const release = () => {
      vertexBuffer.destroy();
      metadataBuffer.destroy();
    };

    return {
      buffer: vertexBuffer,
      vertexCount: segmentIndex * 2,
      coordinateSpace: 'world',
      bounds: geometry.bounds,
      segmentMetadata: {
        buffer: metadataBuffer,
        kind: 'level-index',
        stride: 1,
      },
      release,
    };
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
      const geometry = job.metadata?.contourGeometry as ContourGeometry | undefined;
      if (!geometry || !geometry.loops.length) {
        return null;
      }

      if (options.priority === 'preview') {
        return null;
      }

      const pathGeometry = await this.uploadContourGeometry(job, geometry);
      if (!pathGeometry) {
        return null;
      }

      const quadGeometry = await this.quadExpander.expand(pathGeometry, {
        bounds: geometry.bounds,
        resolution,
        lineWidth: strokeLineWidth,
      });
      if (!quadGeometry) {
        pathGeometry.release();
        return null;
      }

      try {
        logRasterPass(pathGeometry, quadGeometry);
        const raster = await this.pixelRasterizer.rasterize(job, quadGeometry, {
          resolution,
          color,
          bounds: geometry.bounds,
        });
        if (!raster) {
          quadGeometry.release();
          pathGeometry.release();
          return null;
        }

        const release = () => {
          raster.release();
          quadGeometry.release();
          pathGeometry.release();
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
        pathGeometry.release();
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

      const quadGeometry = await this.quadExpander.expand(triangleResult, {
        bounds: effectiveBounds,
        resolution,
        lineWidth: strokeLineWidth,
      });
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

      const quadGeometry = await this.quadExpander.expand(linesResult, {
        bounds: effectiveBounds,
        resolution,
        lineWidth: strokeLineWidth,
        alternateLineWidth,
        alternateStride,
        segmentMetadata: linesResult.segmentMetadata,
      });
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

      const quadGeometry = await this.quadExpander.expand(path, {
        bounds: effectiveBounds,
        resolution,
        lineWidth: strokeLineWidth,
      });
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
