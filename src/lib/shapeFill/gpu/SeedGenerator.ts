import { WebGPUDeviceManager, isWebGPUSupported } from './WebGPUDeviceManager';
import { SEED_GENERATOR_WGSL } from './shaders/seedGenerator.wgsl';
import { UniformBufferWriter } from './uniformWriter';
import type { BoundingBox, StrokeJob } from '../types';

const DEFAULT_SEEDS_PER_AXIS = 16;

export interface SeedGeneratorConfig {
  seedsPerAxis?: number;
}

export interface SeedGeneratorResult {
  buffer: GPUBuffer;
  count: number;
  release(): void;
}

export class SeedGenerator {
  private readonly deviceManager = WebGPUDeviceManager.getInstance();

  private pipeline: GPUComputePipeline | null = null;

  private pipelineGeneration = -1;

  private seedsPerAxis: number;

  constructor(config: SeedGeneratorConfig = {}) {
    this.seedsPerAxis = Math.max(1, config.seedsPerAxis ?? DEFAULT_SEEDS_PER_AXIS);
  }

  private async ensurePipeline(device: GPUDevice): Promise<void> {
    const generation = this.deviceManager.getDeviceGeneration();
    if (this.pipeline && this.pipelineGeneration === generation) {
      return;
    }

    this.pipeline = null;

    const shaderModule = device.createShaderModule({
      label: 'shape-fill-seed-generator-shader',
      code: SEED_GENERATOR_WGSL,
    });

    this.pipeline = await device.createComputePipelineAsync({
      label: 'shape-fill-seed-generator-pipeline',
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
    bounds: BoundingBox,
    config: SeedGeneratorConfig = {}
  ): Promise<SeedGeneratorResult | null> {
    if (!isWebGPUSupported()) {
      return null;
    }

    const device = await this.deviceManager.ensureDevice();
    if (!device) {
      return null;
    }

    await this.ensurePipeline(device);

    const gridAxis = Math.max(1, config.seedsPerAxis ?? this.seedsPerAxis);
    const gridX = gridAxis;
    const gridY = gridAxis;
    const seedCount = gridX * gridY;

    const seedBuffer = device.createBuffer({
      label: `shape-fill-seeds-${job.id}`,
      size: seedCount * 4 * Float32Array.BYTES_PER_ELEMENT,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
    });

    const uniformBuffer = device.createBuffer({
      label: `shape-fill-seed-uniforms-${job.id}`,
      size: 32,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    const boundsWidth = Math.max(1, bounds.maxX - bounds.minX);
    const boundsHeight = Math.max(1, bounds.maxY - bounds.minY);

    /**
     * Matches WGSL struct SeedUniforms:
     * struct SeedUniforms {
     *   boundsMin : vec2<f32>;
     *   boundsSize : vec2<f32>;
     *   gridSize : vec2<u32>;
     *   seedCount : u32;
     *   _padding : u32;
     * }
     */
    const writer = new UniformBufferWriter(32);
    writer.writeF32(0, bounds.minX);
    writer.writeF32(4, bounds.minY);
    writer.writeF32(8, boundsWidth);
    writer.writeF32(12, boundsHeight);
    writer.writeU32(16, gridX);
    writer.writeU32(20, gridY);
    writer.writeU32(24, seedCount);
    writer.writeU32(28, 0);

    device.queue.writeBuffer(uniformBuffer, 0, writer.buffer);

    const bindGroup = device.createBindGroup({
      label: `shape-fill-seed-bind-group-${job.id}`,
      layout: this.pipeline!.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: uniformBuffer } },
        { binding: 1, resource: { buffer: seedBuffer } },
      ],
    });

    const commandEncoder = device.createCommandEncoder({
      label: `shape-fill-seed-encoder-${job.id}`,
    });

    const pass = commandEncoder.beginComputePass({
      label: `shape-fill-seed-pass-${job.id}`,
    });
    pass.setPipeline(this.pipeline!);
    pass.setBindGroup(0, bindGroup);

    const workgroupSize = 64;
    const workgroupCount = Math.ceil(seedCount / workgroupSize);
    pass.dispatchWorkgroups(workgroupCount);
    pass.end();

    device.queue.submit([commandEncoder.finish()]);

    const release = () => {
      seedBuffer.destroy();
      uniformBuffer.destroy();
    };

    return {
      buffer: seedBuffer,
      count: seedCount,
      release,
    };
  }
}
