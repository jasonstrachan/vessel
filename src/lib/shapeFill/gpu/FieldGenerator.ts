import { prepareStrokeGeometry } from '../tileManager';
import {
  FieldGeneratorConfig,
  FieldGeneratorResult,
  FieldTileGPUResource,
  StrokeJob,
} from '../types';
import { FIELD_GENERATOR_WGSL } from './shaders/fieldGenerator.wgsl';
import { WebGPUDeviceManager, isWebGPUSupported } from './WebGPUDeviceManager';

const DEFAULT_WORKGROUP_SIZE = 8;

const flagsFromJob = (job: StrokeJob): number => {
  let flags = 0;
  if (job.pixelMode ?? true) {
    flags |= 1 << 0;
  }
  if (job.pendingGizmo) {
    flags |= 1 << 1;
  }
  return flags;
};

interface UniformPayload {
  tileOrigin: { x: number; y: number };
  tileSize: { x: number; y: number };
  boundsMin: { x: number; y: number };
  boundsMax: { x: number; y: number };
  resolution: number;
  padding: number;
  vertexCount: number;
  flags: number;
}

const createUniformArrayBuffer = (payload: UniformPayload): ArrayBuffer => {
  const buffer = new ArrayBuffer(12 * 4);
  const floatView = new Float32Array(buffer);
  const intView = new Uint32Array(buffer);

  floatView[0] = payload.tileOrigin.x;
  floatView[1] = payload.tileOrigin.y;
  floatView[2] = payload.tileSize.x;
  floatView[3] = payload.tileSize.y;
  floatView[4] = payload.boundsMin.x;
  floatView[5] = payload.boundsMin.y;
  floatView[6] = payload.boundsMax.x;
  floatView[7] = payload.boundsMax.y;
  floatView[8] = payload.resolution;
  floatView[9] = payload.padding;
  intView[10] = payload.vertexCount;
  intView[11] = payload.flags;

  return buffer;
};

export class FieldGenerator {
  private readonly config: FieldGeneratorConfig;

  private readonly deviceManager: WebGPUDeviceManager;

  private device: GPUDevice | null = null;

  private pipeline: GPUComputePipeline | null = null;

  private workgroupSize: number;

  constructor(config: FieldGeneratorConfig = {}) {
    this.config = config;
    this.deviceManager = WebGPUDeviceManager.getInstance();
    this.workgroupSize = config.workgroupSize ?? DEFAULT_WORKGROUP_SIZE;
  }

  private async ensureDevice(): Promise<GPUDevice | null> {
    if (this.device) {
      return this.device;
    }
    this.device = await this.deviceManager.ensureDevice();
    return this.device;
  }

  private async ensurePipeline(device: GPUDevice): Promise<void> {
    if (this.pipeline) {
      return;
    }

    const module = device.createShaderModule({
      label: 'shape-fill-field-generator',
      code: FIELD_GENERATOR_WGSL,
    });

    this.pipeline = await device.createComputePipelineAsync({
      label: 'shape-fill-field-generator-pipeline',
      layout: 'auto',
      compute: {
        module,
        entryPoint: 'main',
      },
    });
  }

  async generate(job: StrokeJob): Promise<FieldGeneratorResult | null> {
    if (!isWebGPUSupported()) {
      console.warn('[FieldGenerator] WebGPU is unavailable; skipping GPU field generation');
      return null;
    }

    const device = await this.ensureDevice();
    if (!device) {
      return null;
    }

    await this.ensurePipeline(device);

    const startTime = typeof performance !== 'undefined' ? performance.now() : Date.now();

    const geometry = prepareStrokeGeometry(job, this.config);
    const vertexCount = geometry.vertices.length / 2;

    const vertexBuffer = device.createBuffer({
      label: `stroke-${job.id}-vertices`,
      size: geometry.vertices.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(vertexBuffer, 0, geometry.vertices);

    const bindGroupLayout = this.pipeline!.getBindGroupLayout(0);
    const commandEncoder = device.createCommandEncoder({
      label: `stroke-${job.id}-field-pass`,
    });
    const pass = commandEncoder.beginComputePass({
      label: `stroke-${job.id}-field-compute`,
    });

    let workgroupsDispatched = 0;
    const tileResources: FieldTileGPUResource[] = [];

    const margin = job.margin ?? this.config.margin ?? (this.config.overlap ?? 64);
    const flags = flagsFromJob(job);

    pass.setPipeline(this.pipeline!);

    for (const tile of geometry.tiles) {
      const uniformPayload: UniformPayload = {
        tileOrigin: tile.origin,
        tileSize: tile.size,
        boundsMin: { x: geometry.bounds.minX, y: geometry.bounds.minY },
        boundsMax: { x: geometry.bounds.maxX, y: geometry.bounds.maxY },
        resolution: tile.resolution,
        padding: margin,
        vertexCount,
        flags,
      };

      const uniformBuffer = device.createBuffer({
        label: `stroke-${job.id}-tile-${tile.id}-uniforms`,
        size: 12 * 4,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      });
      const uniformData = createUniformArrayBuffer(uniformPayload);
      device.queue.writeBuffer(uniformBuffer, 0, uniformData);

      const distanceTexture = device.createTexture({
        label: `stroke-${job.id}-tile-${tile.id}-distance`,
        size: {
          width: tile.gridWidth,
          height: tile.gridHeight,
          depthOrArrayLayers: 1,
        },
        format: 'rgba32float',
        usage:
          GPUTextureUsage.STORAGE_BINDING |
          GPUTextureUsage.TEXTURE_BINDING |
          GPUTextureUsage.COPY_SRC,
      });

      const bindGroup = device.createBindGroup({
        label: `stroke-${job.id}-tile-${tile.id}-bind-group`,
        layout: bindGroupLayout,
        entries: [
          { binding: 0, resource: { buffer: vertexBuffer } },
          { binding: 1, resource: { buffer: uniformBuffer } },
          { binding: 2, resource: distanceTexture.createView() },
        ],
      });

      pass.setBindGroup(0, bindGroup);

      const dispatchX = Math.ceil(tile.gridWidth / this.workgroupSize);
      const dispatchY = Math.ceil(tile.gridHeight / this.workgroupSize);
      pass.dispatchWorkgroups(dispatchX, dispatchY);
      workgroupsDispatched += dispatchX * dispatchY;

      tileResources.push({
        descriptor: tile,
        distanceTexture,
        uniformBuffer,
      });
    }

    pass.end();

    device.queue.submit([commandEncoder.finish()]);

    const endTime = typeof performance !== 'undefined' ? performance.now() : Date.now();

    const release = () => {
      for (const tile of tileResources) {
        tile.distanceTexture.destroy();
        tile.uniformBuffer.destroy();
      }
      vertexBuffer.destroy();
    };

    return {
      jobId: job.id,
      tiles: tileResources,
      vertexBuffer,
      metrics: {
        tilesProcessed: tileResources.length,
        workgroupsDispatched,
        generationTimeMs: endTime - startTime,
      },
      release,
    };
  }
}
