import { WebGPUDeviceManager, isWebGPUSupported } from './WebGPUDeviceManager';
import { DELAUNAY_FILL_WGSL } from './shaders/delaunayFill.wgsl';
import type { FieldGeneratorResult, StrokeJob } from '../types';
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

  private async ensurePipeline(device: GPUDevice): Promise<void> {
    if (this.pipeline) {
      return;
    }

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
  }

  async generate(
    job: StrokeJob,
    field: FieldGeneratorResult,
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

    const vertexBuffer = device.createBuffer({
      label: `triangle-network-vertices-${job.id}`,
      size: vertexCapacity * 4 * Float32Array.BYTES_PER_ELEMENT,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_SRC,
    });

    const counterBuffer = device.createBuffer({
      label: `triangle-network-counter-${job.id}`,
      size: 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
    });
    device.queue.writeBuffer(counterBuffer, 0, new Uint32Array([0]));

    const counterReadback = device.createBuffer({
      label: `triangle-network-counter-readback-${job.id}`,
      size: 4,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });

    const uniformArray = new Float32Array(32);
    const bounds = job.bounds ?? {
      minX: 0,
      minY: 0,
      maxX: 0,
      maxY: 0,
    };

    uniformArray[0] = bounds.minX;
    uniformArray[1] = bounds.minY;
    uniformArray[2] = bounds.maxX;
    uniformArray[3] = bounds.maxY;

    uniformArray[4] = options.cellSize;
    uniformArray[5] = options.minSpacing;
    uniformArray[6] = options.jitter;
    uniformArray[7] = options.seed >>> 0;

    uniformArray[8] = options.maxSeeds;
    uniformArray[9] = options.maxTriangles;
    uniformArray[10] = maxEdges;
    uniformArray[11] = job.vertices.length / 2;

    uniformArray[12] = options.lineWidth;
    uniformArray[13] = options.rotationSin;
    uniformArray[14] = options.rotationCos;

    const uniformBuffer = device.createBuffer({
      label: `triangle-network-uniforms-${job.id}`,
      size: uniformArray.byteLength,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(uniformBuffer, 0, uniformArray.buffer);

    const bindGroup = device.createBindGroup({
      label: `triangle-network-bind-group-${job.id}`,
      layout: this.pipeline!.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: uniformBuffer } },
        { binding: 1, resource: { buffer: field.vertexBuffer } },
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

    await counterReadback.mapAsync(GPUMapMode.READ);
    const counterView = new Uint32Array(counterReadback.getMappedRange().slice(0));
    counterReadback.unmap();

    const vertexCount = Math.min(counterView[0], vertexCapacity);
    if (vertexCount < 2) {
      vertexBuffer.destroy();
      counterBuffer.destroy();
      counterReadback.destroy();
      uniformBuffer.destroy();
      return null;
    }

    const release = () => {
      vertexBuffer.destroy();
      counterBuffer.destroy();
      counterReadback.destroy();
      uniformBuffer.destroy();
    };

    return {
      buffer: vertexBuffer,
      vertexCount,
      release,
    };
  }
}
