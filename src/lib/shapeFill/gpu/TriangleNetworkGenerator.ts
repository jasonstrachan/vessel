import { WebGPUDeviceManager, isWebGPUSupported } from './WebGPUDeviceManager';
import { DELAUNAY_FILL_WGSL } from './shaders/delaunayFill.wgsl';
import { UniformBufferWriter } from './uniformWriter';
import { waitForQueueIdle } from './queueUtils';
import { ReadbackPool } from './readbackPool';
import type { BoundingBox, FieldGeneratorResult, StrokeJob, Vec2 } from '../types';
import type { PathIntegrationResult } from './PathIntegrator';

export interface TriangleNetworkOptions {
  seed: number;
  cellSize: number;
  minSpacing: number;
  jitter: number;
  maxSeeds: number;
  maxTriangles: number;
  maxEdges: number;
  lineWidth: number;
  rotationSin: number;
  rotationCos: number;
}

export class TriangleNetworkGenerator {
  private readonly deviceManager = WebGPUDeviceManager.getInstance();

  private pipeline: GPUComputePipeline | null = null;

  private pipelineGeneration = -1;

  private counterPool: ReadbackPool | null = null;

  private counterPoolGeneration = -1;

  private ensureCounterPool(device: GPUDevice): ReadbackPool {
    const generation = this.deviceManager.getDeviceGeneration();
    if (!this.counterPool || this.counterPoolGeneration !== generation) {
      this.counterPool?.destroy();
      this.counterPool = new ReadbackPool(device, {
        size: 4,
        label: 'triangle-network-counter-readback',
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
      label: 'triangle-network-generator-shader',
      code: DELAUNAY_FILL_WGSL,
    });

    this.pipeline = await device.createComputePipelineAsync({
      label: 'triangle-network-generator-pipeline',
      layout: 'auto',
      compute: {
        module: shaderModule,
        entryPoint: 'main',
      },
    });
    this.pipelineGeneration = generation;
  }

  async generate(
    job: StrokeJob,
    _field: FieldGeneratorResult,
    bounds: BoundingBox,
    options: TriangleNetworkOptions,
  ): Promise<PathIntegrationResult | null> {
    if (!isWebGPUSupported()) {
      return null;
    }

    const device = await this.deviceManager.ensureDevice();
    if (!device) {
      return null;
    }

    await this.ensurePipeline(device);

    const maxEdges = Math.max(16, options.maxEdges);
    const vertexCapacity = maxEdges * 2;

    let polygonVertices: Float32Array;
    if (job.vertices instanceof Float32Array) {
      polygonVertices = job.vertices;
    } else {
      const source = job.vertices as readonly Vec2[];
      polygonVertices = new Float32Array(source.length * 2);
      for (let i = 0; i < source.length; i += 1) {
        const vertex = source[i];
        polygonVertices[i * 2] = vertex.x;
        polygonVertices[i * 2 + 1] = vertex.y;
      }
    }

    if (polygonVertices.length < 6) {
      return null;
    }

    const polygonBuffer = device.createBuffer({
      label: `triangle-network-polygon-${job.id}`,
      size: polygonVertices.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(polygonBuffer, 0, polygonVertices);

    const vertexBuffer = device.createBuffer({
      label: `triangle-network-vertices-${job.id}`,
      size: vertexCapacity * 2 * Float32Array.BYTES_PER_ELEMENT,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_SRC,
    });

    const counterBuffer = device.createBuffer({
      label: `triangle-network-counter-${job.id}`,
      size: 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
    });
    device.queue.writeBuffer(counterBuffer, 0, new Uint32Array([0]));

    const counterPool = this.ensureCounterPool(device);
    const counterReadback = counterPool.acquire();

    const uniformBuffer = device.createBuffer({
      label: `triangle-network-uniforms-${job.id}`,
      size: 128,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    /**
     * Matches WGSL struct TriangleUniforms (8 x vec4<f32>):
     * data0: [boundsMin.x, boundsMin.y, boundsMax.x, boundsMax.y]
     * data1: [cellSize, minSpacing, jitter, seed]
     * data2: [maxSeeds, maxTriangles, maxEdges, polygonVertexCount]
     * data3: [lineWidth, rotationSin, rotationCos, 0]
     * data4..data7 reserved for future use.
     */
    const writer = new UniformBufferWriter(128);
    writer.writeF32(0, bounds.minX);
    writer.writeF32(4, bounds.minY);
    writer.writeF32(8, bounds.maxX);
    writer.writeF32(12, bounds.maxY);

    writer.writeF32(16, options.cellSize);
    writer.writeF32(20, options.minSpacing);
    writer.writeF32(24, options.jitter);
    writer.writeF32(28, options.seed);

    writer.writeF32(32, options.maxSeeds);
    writer.writeF32(36, options.maxTriangles);
    writer.writeF32(40, maxEdges);
    writer.writeF32(44, polygonVertices.length / 2);

    writer.writeF32(48, options.lineWidth);
    writer.writeF32(52, options.rotationSin);
    writer.writeF32(56, options.rotationCos);
    writer.writeF32(60, 0);

    device.queue.writeBuffer(uniformBuffer, 0, writer.buffer);

    const bindGroup = device.createBindGroup({
      label: `triangle-network-bind-group-${job.id}`,
      layout: this.pipeline!.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: uniformBuffer } },
        { binding: 1, resource: { buffer: polygonBuffer } },
        { binding: 2, resource: { buffer: vertexBuffer } },
        { binding: 3, resource: { buffer: counterBuffer } },
      ],
    });

    const commandEncoder = device.createCommandEncoder({
      label: `triangle-network-encoder-${job.id}`,
    });

    const pass = commandEncoder.beginComputePass({
      label: `triangle-network-pass-${job.id}`,
    });
    pass.setPipeline(this.pipeline!);
    pass.setBindGroup(0, bindGroup);
    pass.dispatchWorkgroups(1);
    pass.end();

    (commandEncoder as unknown as { copyBufferToBuffer: (...args: unknown[]) => void })
      .copyBufferToBuffer(counterBuffer, 0, counterReadback, 0, 4);

    device.queue.submit([commandEncoder.finish()]);

    await waitForQueueIdle(device.queue);

    const counterCopy = await counterPool.read(device.queue, counterReadback);
    const counterView = new Uint32Array(counterCopy);

    const vertexCount = Math.min(counterView[0], vertexCapacity);
    if (vertexCount < 2) {
      polygonBuffer.destroy();
      vertexBuffer.destroy();
      counterBuffer.destroy();
      uniformBuffer.destroy();
      return null;
    }

    const release = () => {
      polygonBuffer.destroy();
      vertexBuffer.destroy();
      counterBuffer.destroy();
      uniformBuffer.destroy();
    };

    return {
      buffer: vertexBuffer,
      vertexCount,
      coordinateSpace: 'world',
      bounds,
      release,
    };
  }
}
