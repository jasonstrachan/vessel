import { WebGPUDeviceManager, isWebGPUSupported } from './WebGPUDeviceManager';
import { SEED_GENERATOR_WGSL } from './shaders/seedGenerator.wgsl';
import type { StrokeJob } from '../types';

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

  private seedsPerAxis: number;

  constructor(config: SeedGeneratorConfig = {}) {
    this.seedsPerAxis = Math.max(1, config.seedsPerAxis ?? DEFAULT_SEEDS_PER_AXIS);
  }

  private async ensurePipeline(device: GPUDevice): Promise<void> {
    if (this.pipeline) {
      return;
    }

    const module = device.createShaderModule({
      label: 'shape-fill-seed-generator-shader',
      code: SEED_GENERATOR_WGSL,
    });

    this.pipeline = await device.createComputePipelineAsync({
      label: 'shape-fill-seed-generator-pipeline',
      layout: 'auto',
      compute: {
        module,
        entryPoint: 'main',
      },
    });
  }

  async generate(job: StrokeJob, config: SeedGeneratorConfig = {}): Promise<SeedGeneratorResult | null> {
    if (!isWebGPUSupported()) {
      return null;
    }

    const device = await this.deviceManager.ensureDevice();
    if (!device) {
      return null;
    }

    await this.ensurePipeline(device);

    const bounds = job.bounds ?? {
      minX: 0,
      minY: 0,
      maxX: 1,
      maxY: 1,
    };

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

    const uniformArray = new ArrayBuffer(32);
    const uniformView = new DataView(uniformArray);
    uniformView.setFloat32(0, bounds.minX, true);
    uniformView.setFloat32(4, bounds.minY, true);
    uniformView.setFloat32(8, boundsWidth, true);
    uniformView.setFloat32(12, boundsHeight, true);
    uniformView.setUint32(16, gridX, true);
    uniformView.setUint32(20, gridY, true);
    uniformView.setUint32(24, seedCount, true);
    uniformView.setUint32(28, 0, true);

    device.queue.writeBuffer(uniformBuffer, 0, uniformArray);

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
