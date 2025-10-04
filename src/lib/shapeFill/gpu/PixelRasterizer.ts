import { WebGPUDeviceManager, isWebGPUSupported } from './WebGPUDeviceManager';
import { PIXEL_RASTERIZER_WGSL } from './shaders/pixelRasterizer.wgsl';
import type { PathIntegrationResult } from './PathIntegrator';
import type { StrokeJob, StrokeResolution } from '../types';
import type { RGBAColor } from '@/utils/color/parseCssColor';

const alignTo = (value: number, alignment: number): number => Math.ceil(value / alignment) * alignment;

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

  private pipeline: any = null;

  private vertexBufferLayout: any = null;

  private async ensurePipeline(device: GPUDevice): Promise<void> {
    if (this.pipeline) {
      return;
    }

    const module = device.createShaderModule({
      label: 'shape-fill-pixel-rasterizer-shader',
      code: PIXEL_RASTERIZER_WGSL,
    });

    this.vertexBufferLayout = {
      arrayStride: 4 * Float32Array.BYTES_PER_ELEMENT,
      attributes: [
        { shaderLocation: 0, offset: 0, format: 'float32x2' },
        { shaderLocation: 1, offset: 8, format: 'float32' },
        { shaderLocation: 2, offset: 12, format: 'float32' },
      ],
    };

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
        module,
        entryPoint: 'vs_main',
        buffers: [this.vertexBufferLayout],
      },
      fragment: {
        module,
        entryPoint: 'fs_main',
        targets: [
          {
            format: 'rgba8unorm',
            blend: {
              color: {
                srcFactor: 'src-alpha',
                dstFactor: 'one-minus-src-alpha',
                operation: 'add',
              },
              alpha: {
                srcFactor: 'one',
                dstFactor: 'one-minus-src-alpha',
                operation: 'add',
              },
            },
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

    const depth = device.createTexture({
      label: `shape-fill-depth-${job.id}`,
      size: { width, height, depthOrArrayLayers: 1 },
      format: 'depth24plus',
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });

    const uniformBuffer = device.createBuffer({
      label: `shape-fill-raster-uniforms-${job.id}`,
      size: 16 * Float32Array.BYTES_PER_ELEMENT,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    const color = options.color;
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
      depthStencilAttachment: {
        view: depth.createView(),
        depthLoadOp: 'clear',
        depthStoreOp: 'discard',
        clearDepth: 1,
      },
    });

    renderPass.setPipeline(this.pipeline!);
    renderPass.setBindGroup(0, bindGroup);
    renderPass.setVertexBuffer(0, path.buffer);
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

    const release = () => {
      texture.destroy();
      depth.destroy();
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
