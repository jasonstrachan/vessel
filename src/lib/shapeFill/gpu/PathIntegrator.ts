import { PATH_INTEGRATOR_WGSL } from './shaders/pathIntegrator.wgsl';
import { WebGPUDeviceManager, isWebGPUSupported } from './WebGPUDeviceManager';
import { UniformBufferWriter } from './uniformWriter';
import type { BoundingBox, StrokeJob } from '../types';
import type { SeedGeneratorResult } from './SeedGenerator';
import type { BrushSettings } from '@/types';

const DEFAULT_LINE_LENGTH = 16;

export interface PathIntegratorConfig {
  lineLength?: number;
}

/**
 * Coordinate system emitted by GPU path generators.
 * - `world`: Same units as the stroke `effectiveBounds` (canvas/world pixels).
 * - `normalized`: Normalized [0,1] coordinates mapped over the same `effectiveBounds`.
 */
export type CoordinateSpace = 'world' | 'normalized';

export interface PathIntegrationResult {
  buffer: GPUBuffer;
  vertexCount: number;
  coordinateSpace: CoordinateSpace;
  /** Reference bounds that were used when writing the vertex data. */
  bounds: BoundingBox;
  segmentMetadata?: {
    buffer: GPUBuffer;
    kind: 'level-index';
    stride: number;
  };
  release(): void;
}

export class PathIntegrator {
  private readonly deviceManager = WebGPUDeviceManager.getInstance();

  private pipeline: GPUComputePipeline | null = null;

  private pipelineGeneration = -1;

  private readonly defaultLineLength: number;

  constructor(config: PathIntegratorConfig = {}) {
    this.defaultLineLength = config.lineLength ?? DEFAULT_LINE_LENGTH;
  }

  private async ensurePipeline(device: GPUDevice): Promise<void> {
    const generation = this.deviceManager.getDeviceGeneration();
    if (this.pipeline && this.pipelineGeneration === generation) {
      return;
    }

    this.pipeline = null;

    const shaderModule = device.createShaderModule({
      label: 'shape-fill-path-integrator-shader',
      code: PATH_INTEGRATOR_WGSL,
    });

    this.pipeline = await device.createComputePipelineAsync({
      label: 'shape-fill-path-integrator-pipeline',
      layout: 'auto',
      compute: {
        module: shaderModule,
        entryPoint: 'main',
      },
    });
    this.pipelineGeneration = generation;
  }

  async integrate(
    job: StrokeJob,
    seeds: SeedGeneratorResult,
    config: PathIntegratorConfig = {},
    bounds: BoundingBox
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

    const vertexBuffer = device.createBuffer({
      label: `shape-fill-path-vertices-${job.id}`,
      size: vertexCount * 2 * Float32Array.BYTES_PER_ELEMENT,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_SRC,
    });

    const uniformBuffer = device.createBuffer({
      label: `shape-fill-path-uniforms-${job.id}`,
      size: 32,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    /**
     * Matches WGSL struct PathUniforms:
     * struct PathUniforms {
     *   direction : vec2<f32>;
     *   halfLength : f32;
     *   thickness : f32;
     *   totalVertices : u32;
     * };
     * Extra padding is reserved for future fields.
     */
    const writer = new UniformBufferWriter(32);
    writer.writeF32(0, direction.x);
    writer.writeF32(4, direction.y);
    writer.writeF32(8, lineLength * 0.5);
    writer.writeF32(12, brush?.shapeFillLineWidth ?? 1);
    writer.writeU32(16, vertexCount);
    writer.writeU32(20, 0);
    writer.writeU32(24, 0);
    writer.writeU32(28, 0);

    device.queue.writeBuffer(uniformBuffer, 0, writer.buffer);

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
      coordinateSpace: 'world',
      bounds,
      release,
    };
  }
}
