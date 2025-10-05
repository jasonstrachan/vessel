import { WebGPUDeviceManager, isWebGPUSupported } from './WebGPUDeviceManager';
import { debugLog, debugWarn } from '@/utils/debug';
import { PIXEL_RASTERIZER_WGSL } from './shaders/pixelRasterizer.wgsl';
import type { PathIntegrationResult } from './PathIntegrator';
import type { StrokeJob, StrokeResolution } from '../types';
import type { RGBAColor } from '@/utils/color/parseCssColor';

const alignTo = (value: number, alignment: number): number => Math.ceil(value / alignment) * alignment;

const FLOATS_PER_VERTEX = 2;
const VERTEX_STRIDE_BYTES = Float32Array.BYTES_PER_ELEMENT * FLOATS_PER_VERTEX;

const VERTEX_BUFFER_LAYOUT: GPUVertexBufferLayout = {
  arrayStride: VERTEX_STRIDE_BYTES,
  stepMode: 'vertex',
  attributes: [
    {
      shaderLocation: 0,
      offset: 0,
      format: 'float32x2',
    },
  ],
};

export interface PixelRasterizerOptions {
  resolution: StrokeResolution;
  color: RGBAColor;
}

export interface PixelRasterizerResult {
  pixels: Uint8ClampedArray;
  width: number;
  height: number;
  origin: { x: number; y: number };
  release(): void;
}

export class PixelRasterizer {
  private readonly deviceManager = WebGPUDeviceManager.getInstance();

  private pipeline: GPURenderPipeline | null = null;

  private async ensurePipeline(device: GPUDevice): Promise<void> {
    if (this.pipeline) {
      return;
    }

    const shaderModule = device.createShaderModule({
      label: 'shape-fill-pixel-rasterizer-shader',
      code: PIXEL_RASTERIZER_WGSL,
    });

    const createRenderPipelineAsync = (device as any).createRenderPipelineAsync?.bind(device);
    const createRenderPipeline = (device as any).createRenderPipeline?.bind(device);
    const pipelineFactory = createRenderPipelineAsync ?? createRenderPipeline;
    if (!pipelineFactory) {
      throw new Error('WebGPU render pipeline creation is not supported in this environment');
    }

    this.pipeline = await pipelineFactory({
      label: 'shape-fill-pixel-rasterizer-pipeline',
      layout: 'auto',
      vertex: {
        module: shaderModule,
        entryPoint: 'vs_main',
        buffers: [VERTEX_BUFFER_LAYOUT],
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
        topology: 'line-list',
      },
      multisample: {
        count: 1,
      },
    });
  }

  async rasterize(
    job: StrokeJob,
    path: PathIntegrationResult,
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

    const bounds = job.bounds ?? {
      minX: 0,
      minY: 0,
      maxX: options.resolution.width,
      maxY: options.resolution.height,
    };

    const width = Math.max(1, Math.floor(options.resolution.width));
    const height = Math.max(1, Math.floor(options.resolution.height));

    const texture = device.createTexture({
      label: `shape-fill-raster-target-${job.id}`,
      size: { width, height, depthOrArrayLayers: 1 },
      format: 'rgba8unorm',
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
    });

    const uniformBuffer = device.createBuffer({
      label: `shape-fill-raster-uniforms-${job.id}`,
      size: 16 * Float32Array.BYTES_PER_ELEMENT,
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

    debugLog('shape-fill', 'Pixel rasterizer uniforms', {
      jobId: job.id,
      colorString: `rgba(${color.r}, ${color.g}, ${color.b}, ${color.a})`,
      bounds,
      resolution: options.resolution,
      vertexCount: path.vertexCount,
    });
    const uniformArray = new Float32Array(16);
    uniformArray[0] = bounds.minX;
    uniformArray[1] = bounds.minY;
    uniformArray[2] = Math.max(1e-6, bounds.maxX - bounds.minX);
    uniformArray[3] = Math.max(1e-6, bounds.maxY - bounds.minY);
    uniformArray[4] = width;
    uniformArray[5] = height;
    uniformArray[6] = color.r / 255;
    uniformArray[7] = color.g / 255;
    uniformArray[8] = color.b / 255;
    uniformArray[9] = color.a / 255;
    uniformArray[10] = path.coordinateSpace === 'normalized' ? 1 : 0;

    device.queue.writeBuffer(uniformBuffer, 0, uniformArray.buffer);

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

    const renderPass = (encoder as any).beginRenderPass({
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
    renderPass.setVertexBuffer(0, path.buffer, 0, path.vertexCount * VERTEX_STRIDE_BYTES);
    renderPass.draw(path.vertexCount, 1, 0, 0);
    renderPass.end();

    const bytesPerPixel = 4;
    const bytesPerRow = alignTo(width * bytesPerPixel, 256);
    const bufferSize = bytesPerRow * height;

    const readbackBuffer = device.createBuffer({
      label: `shape-fill-raster-readback-${job.id}`,
      size: bufferSize,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });

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

    await readbackBuffer.mapAsync(GPUMapMode.READ);
    const mapped = readbackBuffer.getMappedRange();
    const padded = new Uint8Array(mapped.slice(0));
    readbackBuffer.unmap();

    const pixels = new Uint8ClampedArray(width * height * bytesPerPixel);
    for (let row = 0; row < height; row += 1) {
      const srcOffset = row * bytesPerRow;
      const dstOffset = row * width * bytesPerPixel;
      pixels.set(padded.subarray(srcOffset, srcOffset + width * bytesPerPixel), dstOffset);
    }

    const hasContent = pixels.some((value, index) => (index & 3) === 3 ? value !== 0 : false);
    if (!hasContent) {
      debugWarn('shape-fill', 'Pixel rasterizer produced empty output', {
        jobId: job.id,
        vertexCount: path.vertexCount,
        width,
        height,
      });
    } else {
      debugLog('shape-fill', 'Pixel rasterizer produced output', {
        jobId: job.id,
        vertexCount: path.vertexCount,
        width,
        height,
      });
    }

    const release = () => {
      texture.destroy();
      uniformBuffer.destroy();
      readbackBuffer.destroy();
    };

    return {
      pixels,
      width,
      height,
      origin: { x: bounds.minX, y: bounds.minY },
      release,
    };
  }
}
