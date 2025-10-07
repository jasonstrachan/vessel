import { HybridShapeFillEngine, getHybridShapeFillEngine } from './runtime';
import { HybridShapeFillRenderer } from './renderer';
import type { Fill, Mesh } from './types';
import type { PathInput, RenderContext, RenderTarget } from './runtime';
import { WebGPUDeviceManager, isWebGPUSupported } from '@/lib/shapeFill/gpu/WebGPUDeviceManager';

const ALIGNMENT = 256;
const DEFAULT_FORMAT: GPUTextureFormat = 'bgra8unorm';

const identityMatrix = (): Float32Array => Float32Array.from([
  1, 0, 0,
  0, 1, 0,
  0, 0, 1,
]);

const align = (value: number, multiple: number): number => Math.ceil(value / multiple) * multiple;

const fnv1a = (values: ArrayLike<number>): number => {
  let hash = 0x811c9dc5;
  for (let i = 0; i < values.length; i += 1) {
    hash ^= Math.round(values[i] * 16384);
    hash *= 0x01000193;
    hash >>>= 0;
  }
  return hash >>> 0;
};

const hashFill = (fill: Fill): number => {
  switch (fill.type) {
    case 'solid':
      return fnv1a(fill.rgba);
    case 'linear': {
      const stopValues: number[] = [];
      for (const stop of fill.stops) {
        stopValues.push(stop.t, ...stop.rgba);
      }
      return fnv1a([
        ...fill.p0,
        ...fill.p1,
        ...stopValues,
      ]);
    }
    case 'image':
      return fnv1a([fill.tex.length, fill.uv === 'cover' ? 1 : fill.uv === 'contain' ? 2 : 3]);
    case 'contour':
      return fnv1a([
        fill.spacing,
        fill.join === 'round' ? 1 : fill.join === 'bevel' ? 2 : 3,
        fill.miterLimit,
        hashFill(fill.base),
      ]);
    default:
      return 0;
  }
};

export type ViewTransform = {
  scale: number;
  offsetX: number;
  offsetY: number;
};

export interface HybridControllerOptions {
  engine?: HybridShapeFillEngine;
  renderer?: HybridShapeFillRenderer;
  deviceManager?: WebGPUDeviceManager;
}

export interface BuildRequestOptions {
  paths: PathInput[];
  fill: Fill;
  preview: boolean;
  viewportScale?: number;
  viewTransform?: ViewTransform;
}

export class HybridShapeFillController {
  private readonly engine: HybridShapeFillEngine;

  private readonly renderer: HybridShapeFillRenderer;

  private readonly deviceManager: WebGPUDeviceManager;

  private overlayCanvas: HTMLCanvasElement | null = null;

  private finalCanvas: HTMLCanvasElement | null = null;

  private overlayCtx: CanvasRenderingContext2D | null = null;

  private finalCtx: CanvasRenderingContext2D | null = null;

  private previewTarget: RenderTarget | null = null;

  private finalTarget: RenderTarget | null = null;

  private lastKey: string | null = null;

  private lastMesh: Mesh | null = null;

  private lastFill: Fill | null = null;

  private format: GPUTextureFormat = DEFAULT_FORMAT;

  constructor(options: HybridControllerOptions = {}) {
    this.engine = options.engine ?? getHybridShapeFillEngine();
    this.renderer = options.renderer ?? new HybridShapeFillRenderer();
    this.deviceManager = options.deviceManager ?? WebGPUDeviceManager.getInstance();
  }

  attachCanvases(overlay: HTMLCanvasElement | null, finalCanvas: HTMLCanvasElement | null): void {
    this.overlayCanvas = overlay;
    this.finalCanvas = finalCanvas;
    this.overlayCtx = overlay ? overlay.getContext('2d') : null;
    this.finalCtx = finalCanvas ? finalCanvas.getContext('2d') : null;
    void this.updateTargets();
  }

  async build(options: BuildRequestOptions): Promise<Mesh | null> {
    if (!this.overlayCanvas) {
      return null;
    }

    if (!isWebGPUSupported()) {
      return null;
    }

    await this.updateTargets();
    const renderContext = this.createRenderContext(options);

    const key = this.computeKey(options, renderContext);
    if (key && this.lastKey === key && this.lastMesh && this.lastFill) {
      await this.renderer.upload(this.lastMesh, this.lastFill, renderContext);
      this.renderer.draw(this.lastMesh, this.lastFill, renderContext, options.preview);
      return this.lastMesh;
    }

    const result = await this.engine.build({
      paths: options.paths,
      fill: options.fill,
      preview: options.preview,
      viewportScale: options.viewportScale,
      render: renderContext,
    });

    this.lastKey = key;
    this.lastMesh = result.mesh;
    this.lastFill = result.fill;
    return result.mesh;
  }

  destroyPreview(): void {
    if (this.overlayCtx && this.overlayCanvas) {
      const ctx = this.overlayCtx;
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, this.overlayCanvas.width, this.overlayCanvas.height);
      ctx.restore();
    }
    this.renderer.destroyPreview();
    this.engine.destroyPreview();
  }

  dispose(): void {
    this.previewTarget?.texture.destroy();
    this.finalTarget?.texture.destroy();
    this.previewTarget = null;
    this.finalTarget = null;
  }

  private computeKey(options: BuildRequestOptions, context: RenderContext): string {
    const pathValues: number[] = [];
    for (const path of options.paths) {
      for (const command of path.commands) {
        switch (command) {
          case 'moveTo':
            pathValues.push(1);
            break;
          case 'lineTo':
            pathValues.push(2);
            break;
          case 'closePath':
            pathValues.push(3);
            break;
          default:
            pathValues.push(0);
        }
      }
      for (let i = 0; i < path.points.length; i += 1) {
        pathValues.push(path.points[i]);
      }
    }
    const pathHash = fnv1a(pathValues);
    const fillHash = hashFill(options.fill);
    const scaleBucket = Math.round((options.viewportScale ?? 1) * 1024);
    const view = context.viewMatrix ?? identityMatrix();
    const viewHash = fnv1a(view);
    return `${pathHash}:${fillHash}:${scaleBucket}:${viewHash}`;
  }

  private createRenderContext(options: BuildRequestOptions): RenderContext {
    const viewMatrix = this.computeViewMatrix(options.viewTransform);
    const onComplete = this.handleRenderComplete;
    return {
      viewMatrix,
      previewTarget: options.preview ? this.previewTarget ?? undefined : this.previewTarget ?? undefined,
      finalTarget: options.preview ? undefined : this.finalTarget ?? undefined,
      format: this.format,
      onComplete,
    };
  }

  private computeViewMatrix(transform?: ViewTransform): Float32Array {
    if (!transform || !this.overlayCanvas) {
      return identityMatrix();
    }
    const width = this.overlayCanvas.width;
    const height = this.overlayCanvas.height;
    const scale = transform.scale || 1;
    const offsetX = transform.offsetX || 0;
    const offsetY = transform.offsetY || 0;
    const sx = (2 * scale) / Math.max(width, 1e-6);
    const sy = (-2 * scale) / Math.max(height, 1e-6);
    const tx = (2 * offsetX) / Math.max(width, 1e-6) - 1;
    const ty = 1 - (2 * offsetY) / Math.max(height, 1e-6);
    return Float32Array.from([
      sx, 0, tx,
      0, sy, ty,
      0, 0, 1,
    ]);
  }

  private readonly handleRenderComplete = async (target: RenderTarget, preview: boolean): Promise<void> => {
    const ctx = preview ? this.overlayCtx : this.finalCtx;
    if (!ctx) {
      return;
    }

    const device = await this.deviceManager.ensureDevice();
    if (!device) {
      return;
    }

    const width = target.size.width;
    const height = target.size.height;
    const bytesPerPixel = 4;
    const bytesPerRow = align(width * bytesPerPixel, ALIGNMENT);
    const bufferSize = bytesPerRow * height;

    const readBuffer = device.createBuffer({
      size: bufferSize,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
      label: 'hybrid-shape-fill-readback',
    });

    const encoder = device.createCommandEncoder({ label: 'hybrid-shape-fill-readback-encoder' });
    encoder.copyTextureToBuffer(
      { texture: target.texture },
      { buffer: readBuffer, bytesPerRow },
      { width, height, depthOrArrayLayers: 1 }
    );
    device.queue.submit([encoder.finish()]);

    await readBuffer.mapAsync(GPUMapMode.READ);
    const mapped = readBuffer.getMappedRange();
    const source = new Uint8Array(mapped);
    const pixels = new Uint8ClampedArray(width * height * bytesPerPixel);

    for (let row = 0; row < height; row += 1) {
      const srcOffset = row * bytesPerRow;
      const dstOffset = row * width * bytesPerPixel;
      pixels.set(source.subarray(srcOffset, srcOffset + width * bytesPerPixel), dstOffset);
    }

    readBuffer.unmap();
    readBuffer.destroy();

    const imageData = new ImageData(pixels, width, height);
    const bitmap = await createImageBitmap(imageData);

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.globalCompositeOperation = 'source-over';
    ctx.drawImage(bitmap, 0, 0, width, height);
    ctx.restore();
    bitmap.close();
  };

  private async updateTargets(): Promise<void> {
    if (!isWebGPUSupported()) {
      return;
    }

    const device = await this.deviceManager.ensureDevice();
    if (!device || !this.overlayCanvas) {
      return;
    }

    const format = navigator.gpu?.getPreferredCanvasFormat?.() ?? DEFAULT_FORMAT;
    this.format = format;

    const overlaySize = {
      width: this.overlayCanvas.width,
      height: this.overlayCanvas.height,
    };

    if (!this.previewTarget || this.previewTarget.size.width !== overlaySize.width || this.previewTarget.size.height !== overlaySize.height) {
      this.previewTarget?.texture.destroy();
      const texture = device.createTexture({
        size: { ...overlaySize, depthOrArrayLayers: 1 },
        format,
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
        label: 'hybrid-shape-fill-preview-target',
      });
      this.previewTarget = {
        texture,
        view: texture.createView(),
        size: overlaySize,
      };
    }

    if (this.finalCanvas) {
      const finalSize = {
        width: this.finalCanvas.width,
        height: this.finalCanvas.height,
      };
      if (!this.finalTarget || this.finalTarget.size.width !== finalSize.width || this.finalTarget.size.height !== finalSize.height) {
        this.finalTarget?.texture.destroy();
        const texture = device.createTexture({
          size: { ...finalSize, depthOrArrayLayers: 1 },
          format,
          usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
          label: 'hybrid-shape-fill-final-target',
        });
        this.finalTarget = {
          texture,
          view: texture.createView(),
          size: finalSize,
        };
      }
    }
  }
}
