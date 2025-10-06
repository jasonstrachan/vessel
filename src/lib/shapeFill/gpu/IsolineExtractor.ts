import { WebGPUDeviceManager, isWebGPUSupported } from './WebGPUDeviceManager';
import { ISOLINE_EXTRACTOR_WGSL } from './shaders/isolineExtractor.wgsl';
import { UniformBufferWriter } from './uniformWriter';
import { GpuBufferPool } from './bufferPool';
import { waitForQueueIdle } from './queueUtils';
import { ReadbackPool } from './readbackPool';
import type { BoundingBox, FieldGeneratorResult, StrokeJob } from '../types';
import type { PathIntegrationResult } from './PathIntegrator';

const MAX_VERTEX_CAPACITY = 4_000_000;
const MIN_VERTEX_CAPACITY = 2_048;
const WORKGROUP_SIZE = 8;

const clampValue = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

const computeVertexCapacity = (field: FieldGeneratorResult, maxLevels: number): number => {
  if (maxLevels <= 0) {
    return 0;
  }

  const totalCells = field.tiles.reduce((acc, tile) => {
    const width = Math.max(0, tile.descriptor.gridWidth - 1);
    const height = Math.max(0, tile.descriptor.gridHeight - 1);
    return acc + width * height;
  }, 0);

  if (totalCells === 0) {
    return 0;
  }

  const estimatedVertices = totalCells * maxLevels * 4; // 2 segments * 2 vertices each
  const clamped = clampValue(estimatedVertices, MIN_VERTEX_CAPACITY, MAX_VERTEX_CAPACITY);
  return clamped;
};

export interface IsolineExtractorOptions {
  mode: 'contour' | 'lines';
  spacingA: number;
  spacingB: number;
  variance: number;
  smoothness: number;
  maxLevels: number;
  maxDistance: number;
  lineWidth: number;
  seed: number;
  preview: boolean;
  baseOrigin?: { x: number; y: number };
  baseDirection?: { x: number; y: number };
  normal?: { x: number; y: number };
  directionExtent?: number;
  backDistance?: number;
  alternateStride?: number;
}

export class IsolineExtractor {
  private readonly deviceManager = WebGPUDeviceManager.getInstance();

  private pipeline: GPUComputePipeline | null = null;

  private readonly uniformPool = new GpuBufferPool();

  private pipelineGeneration = -1;

  private counterPool: ReadbackPool | null = null;

  private counterPoolGeneration = -1;

  private ensureCounterPool(device: GPUDevice): ReadbackPool {
    const generation = this.deviceManager.getDeviceGeneration();
    if (!this.counterPool || this.counterPoolGeneration !== generation) {
      this.counterPool?.destroy();
      this.counterPool = new ReadbackPool(device, {
        size: 4,
        label: 'contour-isoline-counter-readback',
      });
      this.counterPoolGeneration = generation;
    }
    return this.counterPool;
  }

  private async ensurePipeline(device: GPUDevice): Promise<void> {
    const generation = this.deviceManager.getDeviceGeneration();
    if (this.pipeline && this.pipelineGeneration === generation) {
      return;
    }

    this.pipeline = null;

    const shaderModule = device.createShaderModule({
      label: 'contour-isoline-extractor-shader',
      code: ISOLINE_EXTRACTOR_WGSL,
    });

    this.pipeline = await device.createComputePipelineAsync({
      label: 'contour-isoline-extractor-pipeline',
      layout: 'auto',
      compute: {
        module: shaderModule,
        entryPoint: 'main',
      },
    });
    this.pipelineGeneration = generation;
  }

  async extract(
    job: StrokeJob,
    field: FieldGeneratorResult,
    bounds: BoundingBox,
    options: IsolineExtractorOptions,
  ): Promise<PathIntegrationResult | null> {
    if (!isWebGPUSupported()) {
      return null;
    }

    if (options.spacingA <= 1e-4 || options.maxLevels <= 0) {
      return null;
    }

    const device = await this.deviceManager.ensureDevice();
    if (!device) {
      return null;
    }

    await this.ensurePipeline(device);

    const vertexCapacity = computeVertexCapacity(field, options.maxLevels);
    if (vertexCapacity < 2) {
      return null;
    }

    const vertexBuffer = device.createBuffer({
      label: `contour-isoline-vertices-${job.id}`,
      size: vertexCapacity * 2 * Float32Array.BYTES_PER_ELEMENT,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_SRC,
    });

    const segmentCapacity = Math.max(1, Math.ceil(vertexCapacity / 2));
    const metadataBuffer = device.createBuffer({
      label: `contour-isoline-metadata-${job.id}`,
      size: segmentCapacity * Float32Array.BYTES_PER_ELEMENT,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
    });

    const counterBuffer = device.createBuffer({
      label: `contour-isoline-counter-${job.id}`,
      size: 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(counterBuffer, 0, new Uint32Array([0]));

    const counterPool = this.ensureCounterPool(device);
    const counterReadback = counterPool.acquire();

    const bindGroupLayout = this.pipeline!.getBindGroupLayout(0);

    const commandEncoder = device.createCommandEncoder({
      label: `contour-isoline-encoder-${job.id}`,
    });
    const pass = commandEncoder.beginComputePass({
      label: `contour-isoline-pass-${job.id}`,
    });
    pass.setPipeline(this.pipeline!);

    const transientBuffers: GPUBuffer[] = [];

    const boundsMinX = bounds.minX;
    const boundsMinY = bounds.minY;
    const boundsMaxX = bounds.maxX;
    const boundsMaxY = bounds.maxY;

    for (const tile of field.tiles) {
      const descriptor = tile.descriptor;
      const mode = options.mode === 'lines' ? 1 : 0;
      const baseOrigin = options.baseOrigin ?? { x: boundsMinX, y: boundsMinY };
      const direction = options.baseDirection ?? { x: 1, y: 0 };
      const normal = options.normal ?? { x: 0, y: 1 };
      const directionExtent = Math.max(1e-3, options.directionExtent ?? 1);
      const backDistance = Math.max(0, options.backDistance ?? 0);

      const uniformBuffer = this.uniformPool.acquire(
        device,
        128,
        GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        `contour-isoline-uniforms-${job.id}-${descriptor.id}`,
      );
      /**
       * struct IsolineUniforms (vec4 x 8) layout reference.
       * data0: [tileOrigin.x, tileOrigin.y, resolution, mode]
       * data1: [spacingA, spacingB, variance, smoothness]
       * data2: [maxDistance, lineWidth, maxLevels, seed]
       * data3: [vertexCapacity, previewFlag, boundsMin.x, boundsMin.y]
       * data4: [boundsMax.x, boundsMax.y, baseOrigin.x, baseOrigin.y]
       * data5: [direction.x, direction.y, normal.x, normal.y]
       * data6: [directionExtent, backDistance, 0, 0]
       */
      const writer = new UniformBufferWriter(128);
      writer.writeF32(0, descriptor.origin.x);
      writer.writeF32(4, descriptor.origin.y);
      writer.writeF32(8, descriptor.resolution);
      writer.writeF32(12, mode);

      writer.writeF32(16, options.spacingA);
      writer.writeF32(20, options.spacingB);
      writer.writeF32(24, options.variance);
      writer.writeF32(28, options.smoothness);

      writer.writeF32(32, options.maxDistance);
      writer.writeF32(36, options.lineWidth);
      writer.writeF32(40, options.maxLevels);
      writer.writeF32(44, options.seed);

      writer.writeF32(48, vertexCapacity);
      writer.writeF32(52, options.preview ? 1 : 0);
      writer.writeF32(56, boundsMinX);
      writer.writeF32(60, boundsMinY);

      writer.writeF32(64, boundsMaxX);
      writer.writeF32(68, boundsMaxY);
      writer.writeF32(72, baseOrigin.x);
      writer.writeF32(76, baseOrigin.y);

      writer.writeF32(80, direction.x);
      writer.writeF32(84, direction.y);
      writer.writeF32(88, normal.x);
      writer.writeF32(92, normal.y);

      writer.writeF32(96, directionExtent);
      writer.writeF32(100, backDistance);
      writer.writeF32(104, segmentCapacity);
      writer.writeF32(108, Math.max(0, options.alternateStride ?? 0));

      device.queue.writeBuffer(uniformBuffer, 0, writer.buffer);
      transientBuffers.push(uniformBuffer);

      const bindGroup = device.createBindGroup({
        label: `contour-isoline-bindgroup-${job.id}-${descriptor.id}`,
        layout: bindGroupLayout,
        entries: [
          { binding: 0, resource: { buffer: uniformBuffer } },
          { binding: 1, resource: tile.distanceTexture.createView() },
          { binding: 2, resource: { buffer: vertexBuffer } },
          { binding: 3, resource: { buffer: counterBuffer } },
          { binding: 4, resource: { buffer: metadataBuffer } },
        ],
      });

      pass.setBindGroup(0, bindGroup);

      const dispatchX = Math.max(1, Math.ceil(Math.max(0, descriptor.gridWidth - 1) / WORKGROUP_SIZE));
      const dispatchY = Math.max(1, Math.ceil(Math.max(0, descriptor.gridHeight - 1) / WORKGROUP_SIZE));
      pass.dispatchWorkgroups(dispatchX, dispatchY);
    }

    pass.end();

    (commandEncoder as unknown as { copyBufferToBuffer: (...args: unknown[]) => void })
      .copyBufferToBuffer(counterBuffer, 0, counterReadback, 0, 4);

    device.queue.submit([commandEncoder.finish()]);
    await waitForQueueIdle(device.queue);
    const counterCopy = await counterPool.read(device.queue, counterReadback);
    const counterView = new Uint32Array(counterCopy);

    transientBuffers.forEach(buffer => {
      this.uniformPool.release(buffer, 128, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST);
    });

    const vertexCount = Math.min(counterView[0], vertexCapacity);
    if (vertexCount < 2) {
      vertexBuffer.destroy();
      counterBuffer.destroy();
      metadataBuffer.destroy();
      return null;
    }

    const release = () => {
      vertexBuffer.destroy();
      counterBuffer.destroy();
      metadataBuffer.destroy();
    };

    return {
      buffer: vertexBuffer,
      vertexCount,
      coordinateSpace: 'normalized',
      bounds,
      segmentMetadata: {
        buffer: metadataBuffer,
        kind: 'level-index',
        stride: Math.max(0, Math.floor(options.alternateStride ?? 0)),
      },
      release,
    };
  }
}
