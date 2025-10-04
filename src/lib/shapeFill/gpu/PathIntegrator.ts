import { PATH_INTEGRATOR_WGSL } from './shaders/pathIntegrator.wgsl';
import { WebGPUDeviceManager, isWebGPUSupported } from './WebGPUDeviceManager';
import type { StrokeJob } from '../types';
import type { SeedGeneratorResult } from './SeedGenerator';
import type { BrushSettings } from '@/types';

const DEFAULT_LINE_LENGTH = 16;

export interface PathIntegratorConfig {
  lineLength?: number;
}

export interface PathIntegrationResult {
  buffer: GPUBuffer;
  vertexCount: number;
  release(): void;
}

export class PathIntegrator {
  private readonly deviceManager = WebGPUDeviceManager.getInstance();

  private pipeline: GPUComputePipeline | null = null;

  private readonly defaultLineLength: number;

  constructor(config: PathIntegratorConfig = {}) {
    this.defaultLineLength = config.lineLength ?? DEFAULT_LINE_LENGTH;
  }

  private async ensurePipeline(device: GPUDevice): Promise<void> {
    if (this.pipeline) {
      return;
    }

    const module = device.createShaderModule({
      label: 'shape-fill-path-integrator-shader',
      code: PATH_INTEGRATOR_WGSL,
    });

    this.pipeline = await device.createComputePipelineAsync({
      label: 'shape-fill-path-integrator-pipeline',
      layout: 'auto',
      compute: {
        module,
        entryPoint: 'main',
      },
    });
  }

  async integrate(
    job: StrokeJob,
    seeds: SeedGeneratorResult,
    config: PathIntegratorConfig = {}
  ): Promise<PathIntegrationResult | null> {
    if (!isWebGPUSupported()) {
      return null;
    }

    const device = await this.deviceManager.ensureDevice();
    if (!device) {
      return null;
    }

    await this.ensurePipeline(device);

    const vertexCount = seeds.count * 2;
    if (vertexCount === 0) {
      return null;
    }

    const lineLength = Math.max(1, config.lineLength ?? this.defaultLineLength);

    const brush = job.brushSettings as BrushSettings | undefined;
    const orientationDeg = brush?.flowOrientationAngle ?? 0;
    const orientationRad = (orientationDeg * Math.PI) / 180;
    const direction = {
      x: Math.cos(orientationRad),
      y: Math.sin(orientationRad),
    };

    const thickness = brush?.shapeFillLineWidth ?? 1;

    const vertexBuffer = device.createBuffer({
      label: `shape-fill-path-vertices-${job.id}`,
      size: vertexCount * 4 * Float32Array.BYTES_PER_ELEMENT,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_SRC,
    });

    const uniformBuffer = device.createBuffer({
      label: `shape-fill-path-uniforms-${job.id}`,
      size: 32,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    const uniformArray = new ArrayBuffer(32);
    const uniformView = new DataView(uniformArray);
    uniformView.setFloat32(0, direction.x, true);
    uniformView.setFloat32(4, direction.y, true);
    uniformView.setFloat32(8, lineLength * 0.5, true);
    uniformView.setFloat32(12, thickness, true);
    uniformView.setUint32(16, vertexCount, true);
    uniformView.setUint32(20, 0, true);
    uniformView.setUint32(24, 0, true);
    uniformView.setUint32(28, 0, true);

    device.queue.writeBuffer(uniformBuffer, 0, uniformArray);

    const bindGroup = device.createBindGroup({
      label: `shape-fill-path-bind-group-${job.id}`,
      layout: this.pipeline!.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: seeds.buffer } },
        { binding: 1, resource: { buffer: vertexBuffer } },
        { binding: 2, resource: { buffer: uniformBuffer } },
      ],
    });

    const encoder = device.createCommandEncoder({
      label: `shape-fill-path-encoder-${job.id}`,
    });

    const pass = encoder.beginComputePass({
      label: `shape-fill-path-pass-${job.id}`,
    });
    pass.setPipeline(this.pipeline!);
    pass.setBindGroup(0, bindGroup);

    const workgroupSize = 64;
    const workgroups = Math.ceil(seeds.count / workgroupSize);
    pass.dispatchWorkgroups(workgroups);
    pass.end();

    device.queue.submit([encoder.finish()]);

    const release = () => {
      vertexBuffer.destroy();
      uniformBuffer.destroy();
    };

    return {
      buffer: vertexBuffer,
      vertexCount,
      release,
    };
  }
}
