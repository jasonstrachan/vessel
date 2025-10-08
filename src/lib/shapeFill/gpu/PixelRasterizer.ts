import { WebGPUDeviceManager, isWebGPUSupported } from './WebGPUDeviceManager';
import { debugLog, debugWarn } from '@/utils/debug';
import { PIXEL_RASTERIZER_WGSL } from './shaders/pixelRasterizer.wgsl';
import { waitForQueueIdle } from './queueUtils';
import { UniformBufferWriter } from './uniformWriter';
import { ReadbackPool } from './readbackPool';
import type { QuadExpandResult } from './QuadExpander';
import type { CpuQuadGeometry } from '../cpu/contourMesh';
import type { StrokeJob, StrokeResolution, BoundingBox } from '../types';
import { STROKE_MESH_LAYOUTS } from '../types';
import type { RGBAColor } from '@/utils/color/parseCssColor';

const alignTo = (value: number, alignment: number): number => Math.ceil(value / alignment) * alignment;

export interface PixelRasterizerOptions {
  resolution: StrokeResolution;
  color: RGBAColor;
  bounds: BoundingBox;
  pixelMode: boolean;
  hardeningStrength?: number;
  edgeFeather?: number;
  threshold?: number;
}

export interface PixelRasterizerResult {
  pixels: Uint8ClampedArray;
  width: number;
  height: number;
  origin: { x: number; y: number };
  release(): void;
}

type RasterGeometry = QuadExpandResult | CpuQuadGeometry;

const convertCanvasToClip = (vertexData: Float32Array, bounds: BoundingBox): Float32Array => {
  const result = new Float32Array(vertexData.length);
  const width = Math.max(bounds.maxX - bounds.minX, 1e-6);
  const height = Math.max(bounds.maxY - bounds.minY, 1e-6);
  const minX = bounds.minX;
  const minY = bounds.minY;

  for (let i = 0; i < vertexData.length; i += 4) {
    const x = vertexData[i];
    const y = vertexData[i + 1];
    const uvX = (x - minX) / width;
    const uvY = (y - minY) / height;
    const ndcX = uvX * 2 - 1;
    const ndcY = (1 - uvY) * 2 - 1;

    result[i] = ndcX;
    result[i + 1] = ndcY;
    result[i + 2] = vertexData[i + 2];
    result[i + 3] = vertexData[i + 3];
  }

  return result;
};

export class PixelRasterizer {
  private readonly deviceManager = WebGPUDeviceManager.getInstance();

  private pipeline: GPURenderPipeline | null = null;

  private pipelineGeneration = -1;

  private readbackPool: ReadbackPool | null = null;

  private readbackPoolGeneration = -1;

  private readbackPoolSize = 0;

  private ensureReadbackPool(device: GPUDevice, requiredSize: number): ReadbackPool {
    const generation = this.deviceManager.getDeviceGeneration();
    const alignedSize = alignTo(requiredSize, 256);

    if (!this.readbackPool || this.readbackPoolGeneration !== generation || this.readbackPoolSize !== alignedSize) {
      this.readbackPool?.destroy();
      this.readbackPool = new ReadbackPool(device, {
        size: alignedSize,
        label: 'shape-fill-raster-readback-buffer',
      });
      this.readbackPoolGeneration = generation;
      this.readbackPoolSize = alignedSize;
    }

    return this.readbackPool;
  }

  private async ensurePipeline(device: GPUDevice): Promise<void> {
    const generation = this.deviceManager.getDeviceGeneration();
    if (this.pipeline && this.pipelineGeneration === generation) {
      return;
    }

    this.pipeline = null;

    const shaderModule = device.createShaderModule({
      label: 'shape-fill-pixel-rasterizer-shader',
      code: PIXEL_RASTERIZER_WGSL,
    });

    this.pipeline = await device.createRenderPipelineAsync({
      label: 'shape-fill-pixel-rasterizer-pipeline',
      layout: 'auto',
      vertex: {
        module: shaderModule,
        entryPoint: 'vs_main',
        buffers: [
          {
            arrayStride: STROKE_MESH_LAYOUTS.pos2uv2.vertexStride,
            stepMode: 'vertex',
            attributes: [
              {
                shaderLocation: 0,
                offset: STROKE_MESH_LAYOUTS.pos2uv2.positionOffset,
                format: 'float32x2',
              },
              {
                shaderLocation: 1,
                offset: STROKE_MESH_LAYOUTS.pos2uv2.uvOffset,
                format: 'float32x2',
              },
            ],
          },
        ],
      },
      fragment: {
        module: shaderModule,
        entryPoint: 'fs_main',
        targets: [
          {
            format: 'rgba8unorm',
          },
        ],
      },
      primitive: {
        topology: 'triangle-list',
      },
      multisample: {
        count: 1,
      },
    });
    this.pipelineGeneration = generation;
  }

  async rasterize(
    job: StrokeJob,
    geometry: RasterGeometry,
    options: PixelRasterizerOptions
  ): Promise<PixelRasterizerResult | null> {
    if (!isWebGPUSupported()) {
      return null;
    }

    const device = await this.deviceManager.ensureDevice();
    if (!device) {
      return null;
    }

    await this.ensurePipeline(device);

    const width = Math.max(1, Math.floor(options.resolution.width));
    const height = Math.max(1, Math.floor(options.resolution.height));

    if (geometry.vertexCount === 0) {
      debugWarn('shape-fill', 'Pixel rasterizer received empty quad buffer', {
        jobId: job.id,
      });
      return null;
    }

    const quadCount = geometry.quadCount;
    if (quadCount <= 0) {
      debugWarn('shape-fill', 'Pixel rasterizer received zero quad count', {
        jobId: job.id,
      });
      return null;
    }

    if (geometry.layout !== 'pos2uv2') {
      debugWarn('shape-fill', 'Pixel rasterizer received unsupported mesh layout', {
        jobId: job.id,
        layout: geometry.layout,
      });
      return null;
    }

    let quadBuffer: GPUBuffer | null = null;
    let releaseGeometry: (() => void) | null = null;

    if ('buffer' in geometry) {
      quadBuffer = geometry.buffer;
      releaseGeometry = geometry.release;
    } else {
      const uploadData = geometry.coordinateSpace === 'canvas'
        ? convertCanvasToClip(geometry.vertexData, options.bounds)
        : geometry.vertexData;
      quadBuffer = device.createBuffer({
        label: `shape-fill-cpu-quad-vertices-${job.id}`,
        size: uploadData.byteLength,
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
      });
      device.queue.writeBuffer(quadBuffer, 0, uploadData);
      releaseGeometry = () => {
        quadBuffer?.destroy();
      };
    }

    const texture = device.createTexture({
      label: `shape-fill-raster-target-${job.id}`,
      size: { width, height, depthOrArrayLayers: 1 },
      format: 'rgba8unorm',
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
    });

    const uniformBuffer = device.createBuffer({
      label: `shape-fill-raster-uniforms-${job.id}`,
      size: 32,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    const color = { ...options.color };
    if (color.a <= 0 || !Number.isFinite(color.a)) {
      debugWarn('shape-fill', 'Pixel rasterizer received transparent color; forcing alpha to 1', {
        jobId: job.id,
        originalColor: options.color,
      });
      color.a = 255;
    }

    const writer = new UniformBufferWriter(32);
    writer.writeF32(0, color.r / 255);
    writer.writeF32(4, color.g / 255);
    writer.writeF32(8, color.b / 255);
    writer.writeF32(12, color.a / 255);

    const pixelModeFlag = options.pixelMode ? 1 : 0;
    const hardeningStrength = options.pixelMode
      ? Math.min(Math.max(options.hardeningStrength ?? 1, 0), 1)
      : 0;
    const edgeFeather = Math.max(0.5, options.edgeFeather ?? 1);
    const threshold = options.threshold ?? 0.5;

    debugLog('shape-fill', 'Pixel rasterizer uniforms', {
      jobId: job.id,
      colorString: `rgba(${color.r}, ${color.g}, ${color.b}, ${color.a})`,
      resolution: options.resolution,
      vertexCount: geometry.vertexCount,
      quadCount,
      pixelMode: options.pixelMode,
      hardeningStrength,
      edgeFeather,
      threshold,
    });

    writer.writeF32(16, pixelModeFlag);
    writer.writeF32(20, hardeningStrength);
    writer.writeF32(24, edgeFeather);
    writer.writeF32(28, threshold);

    device.queue.writeBuffer(uniformBuffer, 0, writer.buffer);

    const bindGroup = device.createBindGroup({
      label: `shape-fill-raster-bind-group-${job.id}`,
      layout: this.pipeline!.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: uniformBuffer } },
      ],
    });

    const encoder = device.createCommandEncoder({
      label: `shape-fill-raster-encoder-${job.id}`,
    });

    const renderPass = encoder.beginRenderPass({
      label: `shape-fill-raster-pass-${job.id}`,
      colorAttachments: [
        {
          view: texture.createView(),
          loadOp: 'clear',
          storeOp: 'store',
          clearValue: { r: 0, g: 0, b: 0, a: 0 },
        },
      ],
    });

    renderPass.setPipeline(this.pipeline!);
    renderPass.setBindGroup(0, bindGroup);
    renderPass.setViewport(0, 0, width, height, 0, 1);
    renderPass.setScissorRect(0, 0, width, height);
    renderPass.setVertexBuffer(0, quadBuffer);
    renderPass.draw(geometry.vertexCount, 1, 0, 0);
    renderPass.end();

    const bytesPerPixel = 4;
    const bytesPerRow = alignTo(width * bytesPerPixel, 256);
    const bufferSize = bytesPerRow * height;

    const readbackPool = this.ensureReadbackPool(device, bufferSize);
    const readbackBuffer = readbackPool.acquire();

    encoder.copyTextureToBuffer(
      { texture },
      {
        buffer: readbackBuffer,
        bytesPerRow,
        rowsPerImage: height,
      },
      { width, height, depthOrArrayLayers: 1 }
    );

    device.queue.submit([encoder.finish()]);

    await waitForQueueIdle(device.queue);

    const mappedCopy = await readbackPool.read(device.queue, readbackBuffer);
    const padded = new Uint8Array(mappedCopy);

    const pixels = new Uint8ClampedArray(width * height * bytesPerPixel);
    for (let row = 0; row < height; row += 1) {
      const srcOffset = row * bytesPerRow;
      const dstOffset = row * width * bytesPerPixel;
      pixels.set(padded.subarray(srcOffset, srcOffset + width * bytesPerPixel), dstOffset);
    }

    const hasContent = pixels.some(channel => channel !== 0);
    if (!hasContent) {
      debugWarn('shape-fill', 'Pixel rasterizer produced empty output', {
        jobId: job.id,
        vertexCount: geometry.vertexCount,
        quadCount,
        width,
        height,
      });
    } else {
      debugLog('shape-fill', 'Pixel rasterizer produced output', {
        jobId: job.id,
        vertexCount: geometry.vertexCount,
        quadCount,
        width,
        height,
      });
    }

    const release = () => {
      texture.destroy();
      uniformBuffer.destroy();
      releaseGeometry?.();
    };

    return {
      pixels,
      width,
      height,
      origin: { x: options.bounds.minX, y: options.bounds.minY },
      release,
    };
  }
}
