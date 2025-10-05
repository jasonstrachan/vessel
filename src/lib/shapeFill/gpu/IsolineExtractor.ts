import { WebGPUDeviceManager, isWebGPUSupported } from './WebGPUDeviceManager';
import { ISOLINE_EXTRACTOR_WGSL } from './shaders/isolineExtractor.wgsl';
import type { FieldGeneratorResult, StrokeJob } from '../types';
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
}

export class IsolineExtractor {
  private readonly deviceManager = WebGPUDeviceManager.getInstance();

  private pipeline: GPUComputePipeline | null = null;

  private async ensurePipeline(device: GPUDevice): Promise<void> {
    if (this.pipeline) {
      return;
    }

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
  }

  async extract(
    job: StrokeJob,
    field: FieldGeneratorResult,
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

    const counterBuffer = device.createBuffer({
      label: `contour-isoline-counter-${job.id}`,
      size: 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(counterBuffer, 0, new Uint32Array([0]));

    const counterReadback = device.createBuffer({
      label: `contour-isoline-counter-readback-${job.id}`,
      size: 4,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });

    const bindGroupLayout = this.pipeline!.getBindGroupLayout(0);

    const commandEncoder = device.createCommandEncoder({
      label: `contour-isoline-encoder-${job.id}`,
    });
    const pass = commandEncoder.beginComputePass({
      label: `contour-isoline-pass-${job.id}`,
    });
    pass.setPipeline(this.pipeline!);

    const transientBuffers: GPUBuffer[] = [];

    const boundsMinX = job.bounds?.minX ?? 0;
    const boundsMinY = job.bounds?.minY ?? 0;
    const boundsMaxX = job.bounds?.maxX ?? 0;
    const boundsMaxY = job.bounds?.maxY ?? 0;

    for (const tile of field.tiles) {
      const descriptor = tile.descriptor;
      const uniformArray = new Float32Array(32);
      const mode = options.mode === 'lines' ? 1 : 0;
      const baseOrigin = options.baseOrigin ?? { x: boundsMinX, y: boundsMinY };
      const direction = options.baseDirection ?? { x: 1, y: 0 };
      const normal = options.normal ?? { x: 0, y: 1 };
      const directionExtent = Math.max(1e-3, options.directionExtent ?? 1);
      const backDistance = Math.max(0, options.backDistance ?? 0);

      uniformArray[0] = descriptor.origin.x;
      uniformArray[1] = descriptor.origin.y;
      uniformArray[2] = descriptor.resolution;
      uniformArray[3] = mode;

      uniformArray[4] = options.spacingA;
      uniformArray[5] = options.spacingB;
      uniformArray[6] = options.variance;
      uniformArray[7] = options.smoothness;

      uniformArray[8] = options.maxDistance;
      uniformArray[9] = options.lineWidth;
      uniformArray[10] = options.maxLevels;
      uniformArray[11] = options.seed >>> 0;

      uniformArray[12] = vertexCapacity;
      uniformArray[13] = options.preview ? 1 : 0;
      uniformArray[14] = boundsMinX;
      uniformArray[15] = boundsMinY;

      uniformArray[16] = boundsMaxX;
      uniformArray[17] = boundsMaxY;
      uniformArray[18] = baseOrigin.x;
      uniformArray[19] = baseOrigin.y;

      uniformArray[20] = direction.x;
      uniformArray[21] = direction.y;
      uniformArray[22] = normal.x;
      uniformArray[23] = normal.y;

      uniformArray[24] = directionExtent;
      uniformArray[25] = backDistance;
      // remaining entries stay zero for padding

      const uniformBuffer = device.createBuffer({
        label: `contour-isoline-uniforms-${job.id}-${descriptor.id}`,
        size: uniformArray.byteLength,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });
      device.queue.writeBuffer(uniformBuffer, 0, uniformArray.buffer);
      transientBuffers.push(uniformBuffer);

      const bindGroup = device.createBindGroup({
        label: `contour-isoline-bindgroup-${job.id}-${descriptor.id}`,
        layout: bindGroupLayout,
        entries: [
          { binding: 0, resource: { buffer: uniformBuffer } },
          { binding: 1, resource: tile.distanceTexture.createView() },
          { binding: 2, resource: { buffer: vertexBuffer } },
          { binding: 3, resource: { buffer: counterBuffer } },
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
    await counterReadback.mapAsync(GPUMapMode.READ);
    const counterView = new Uint32Array(counterReadback.getMappedRange().slice(0));
    counterReadback.unmap();

    transientBuffers.forEach(buffer => buffer.destroy());

    const vertexCount = Math.min(counterView[0], vertexCapacity);
    if (vertexCount < 2) {
      vertexBuffer.destroy();
      counterBuffer.destroy();
      counterReadback.destroy();
      return null;
    }

    const release = () => {
      vertexBuffer.destroy();
      counterBuffer.destroy();
      counterReadback.destroy();
    };

    return {
      buffer: vertexBuffer,
      vertexCount,
      coordinateSpace: 'normalized',
      release,
    };
  }
}
