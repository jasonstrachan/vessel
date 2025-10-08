import { QUAD_EXPAND_WGSL } from './shaders/quadExpand.wgsl';
import { WebGPUDeviceManager, isWebGPUSupported } from './WebGPUDeviceManager';
import { UniformBufferWriter } from './uniformWriter';
import type { PathIntegrationResult } from './PathIntegrator';
import { STROKE_MESH_LAYOUTS } from '../types';
import type { BoundingBox, StrokeResolution, StrokeMeshLayout } from '../types';

export interface QuadExpandOptions {
  bounds: BoundingBox;
  resolution: StrokeResolution;
  lineWidth: number;
  alternateLineWidth?: number;
  alternateStride?: number;
  segmentMetadata?: {
    buffer: GPUBuffer;
    kind: 'level-index';
    stride?: number;
  };
}

export interface QuadExpandResult {
  buffer: GPUBuffer;
  vertexCount: number;
  quadCount: number;
  layout: StrokeMeshLayout;
  vertexStride: number;
  winding: 'ccw' | 'cw';
  release(): void;
}

export class QuadExpander {
  private readonly deviceManager = WebGPUDeviceManager.getInstance();

  private pipeline: GPUComputePipeline | null = null;

  private pipelineGeneration = -1;

  private metadataFallback: { buffer: GPUBuffer | null; generation: number } = {
    buffer: null,
    generation: -1,
  };

  private ensureMetadataFallback(device: GPUDevice): GPUBuffer {
    const generation = this.deviceManager.getDeviceGeneration();
    if (this.metadataFallback.buffer && this.metadataFallback.generation === generation) {
      return this.metadataFallback.buffer;
    }

    this.metadataFallback.buffer?.destroy();
    this.metadataFallback = {
      buffer: device.createBuffer({
        label: 'shape-fill-quad-metadata-fallback',
        size: Float32Array.BYTES_PER_ELEMENT,
        usage: GPUBufferUsage.STORAGE,
      }),
      generation,
    };

    const zero = new Float32Array([0]);
    device.queue.writeBuffer(this.metadataFallback.buffer!, 0, zero);
    return this.metadataFallback.buffer!;
  }

  private async ensurePipeline(device: GPUDevice): Promise<void> {
    const generation = this.deviceManager.getDeviceGeneration();
    if (this.pipeline && this.pipelineGeneration === generation) {
      return;
    }

    this.pipeline = null;

    const shaderModule = device.createShaderModule({
      label: 'shape-fill-quad-expand-shader',
      code: QUAD_EXPAND_WGSL,
    });

    this.pipeline = await device.createComputePipelineAsync({
      label: 'shape-fill-quad-expand-pipeline',
      layout: 'auto',
      compute: {
        module: shaderModule,
        entryPoint: 'main',
      },
    });
    this.pipelineGeneration = generation;
  }

  async expand(
    path: PathIntegrationResult,
    options: QuadExpandOptions,
  ): Promise<QuadExpandResult | null> {
    if (!isWebGPUSupported()) {
      return null;
    }

    const segmentCount = Math.floor(path.vertexCount / 2);
    if (segmentCount <= 0) {
      return null;
    }

    const device = await this.deviceManager.ensureDevice();
    if (!device) {
      return null;
    }

    await this.ensurePipeline(device);

    const quadCount = segmentCount;
    const outputVertexCount = quadCount * 6;
    const outputBuffer = device.createBuffer({
      label: 'shape-fill-quad-vertices',
      size: outputVertexCount * 4 * Float32Array.BYTES_PER_ELEMENT,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_SRC,
    });

    const uniformBuffer = device.createBuffer({
      label: 'shape-fill-quad-uniforms',
      size: 64,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    const metadata = options.segmentMetadata ?? path.segmentMetadata;
    const hasMetadata = Boolean(metadata && metadata.kind === 'level-index');
    const metadataBuffer = hasMetadata
      ? metadata!.buffer
      : this.ensureMetadataFallback(device);
    const alternateStride = hasMetadata
      ? Math.max(0, options.alternateStride ?? metadata?.stride ?? 0)
      : Math.max(0, options.alternateStride ?? 0);
    const halfPx = Math.max(1e-3, options.lineWidth * 0.5);
    const halfPxAlt = Math.max(1e-3, (options.alternateLineWidth ?? options.lineWidth) * 0.5);

    /**
     * struct Params layout (std140 style alignment):
     * bounds  = [minX, minY, sizeX, sizeY]
     * texSize = [width, height, 0, 0]
     * inCount = total input vertices (u32)
     * halfPx  = half line width in pixels
     */
    const bounds = options.bounds;
    const boundsSizeX = Math.max(1e-6, bounds.maxX - bounds.minX);
    const boundsSizeY = Math.max(1e-6, bounds.maxY - bounds.minY);
    const writer = new UniformBufferWriter(64);
    writer.writeF32(0, bounds.minX);
    writer.writeF32(4, bounds.minY);
    writer.writeF32(8, boundsSizeX);
    writer.writeF32(12, boundsSizeY);

    writer.writeF32(16, options.resolution.width);
    writer.writeF32(20, options.resolution.height);
    writer.writeF32(24, 0);
    writer.writeF32(28, 0);

    writer.writeU32(32, segmentCount * 2);
    writer.writeU32(36, path.coordinateSpace === 'normalized' ? 1 : 0);
    writer.writeF32(40, halfPx);
    writer.writeF32(44, halfPxAlt);
    writer.writeU32(48, hasMetadata ? Math.max(0, Math.floor(alternateStride)) : 0);
    writer.writeU32(52, hasMetadata ? 1 : 0);
    writer.writeF32(56, 0);
    writer.writeF32(60, 0);

    device.queue.writeBuffer(uniformBuffer, 0, writer.buffer);

    const bindGroup = device.createBindGroup({
      label: 'shape-fill-quad-expand-bind-group',
      layout: this.pipeline!.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: uniformBuffer } },
        { binding: 1, resource: { buffer: path.buffer } },
        { binding: 2, resource: { buffer: outputBuffer } },
        { binding: 3, resource: { buffer: metadataBuffer } },
      ],
    });

    const commandEncoder = device.createCommandEncoder({
      label: 'shape-fill-quad-expand-encoder',
    });

    const pass = commandEncoder.beginComputePass({
      label: 'shape-fill-quad-expand-pass',
    });
    pass.setPipeline(this.pipeline!);
    pass.setBindGroup(0, bindGroup);
    const workgroupSize = 64;
    const workgroups = Math.ceil(segmentCount / workgroupSize);
    pass.dispatchWorkgroups(workgroups);
    pass.end();

    device.queue.submit([commandEncoder.finish()]);

    return {
      buffer: outputBuffer,
      vertexCount: outputVertexCount,
      quadCount,
      layout: 'pos2uv2',
      vertexStride: STROKE_MESH_LAYOUTS.pos2uv2.vertexStride,
      winding: STROKE_MESH_LAYOUTS.pos2uv2.winding,
      release: () => {
        outputBuffer.destroy();
        uniformBuffer.destroy();
      },
    };
  }
}
