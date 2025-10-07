import { WebGPUDeviceManager, isWebGPUSupported } from '@/lib/shapeFill/gpu/WebGPUDeviceManager';
import type { Fill, FillSolid, Mesh } from './types';
import type { HybridRenderer, RenderContext } from './runtime';

const UNIFORM_FLOAT_CAPACITY = 64; // 64 * 4 bytes = 256 (aligned for uniforms)

const enum FillType {
  Solid = 0,
  Linear = 1,
  Image = 2,
}

const GPU_SHADER_STAGE_VERTEX = (globalThis as unknown as { GPUShaderStage?: { VERTEX: number; FRAGMENT: number } })?.GPUShaderStage?.VERTEX ?? 0x1;
const GPU_SHADER_STAGE_FRAGMENT = (globalThis as unknown as { GPUShaderStage?: { VERTEX: number; FRAGMENT: number } })?.GPUShaderStage?.FRAGMENT ?? 0x2;
const GPU_STAGE_ALL = GPU_SHADER_STAGE_VERTEX | GPU_SHADER_STAGE_FRAGMENT;

const SHADER_SOURCE = /* wgsl */ `
struct Uniforms {
  view0 : vec4<f32>;
  view1 : vec4<f32>;
  view2 : vec4<f32>;
  color : vec4<f32>;
  params0 : vec4<f32>;
  gradientOrigin : vec4<f32>;
  gradientDir : vec4<f32>;
  stop0 : vec4<f32>;
  stop1 : vec4<f32>;
  stop2 : vec4<f32>;
  stop3 : vec4<f32>;
};

struct VSOutput {
  @builtin(position) clip : vec4<f32>;
  @location(0) world : vec2<f32>;
  @location(1) uv : vec2<f32>;
};

@group(0) @binding(0) var<uniform> uniforms : Uniforms;

fn make_view() -> mat3x3<f32> {
  return mat3x3<f32>(
    uniforms.view0.xyz,
    uniforms.view1.xyz,
    uniforms.view2.xyz
  );
}

fn gradient_color(t : f32) -> vec3<f32> {
  let stops = array<vec4<f32>, 4>(uniforms.stop0, uniforms.stop1, uniforms.stop2, uniforms.stop3);
  let count = max(1.0, uniforms.params0.y);
  var lower : vec4<f32> = stops[0];
  var upper : vec4<f32> = stops[min(i32(count - 1.0), 3)];
  var index : i32 = 0;
  loop {
    if (f32(index) >= count - 1.0) {
      break;
    }
    let a = stops[index];
    let b = stops[index + 1];
    if (t >= a.w && t <= b.w) {
      lower = a;
      upper = b;
      break;
    }
    index += 1;
  }
  let span = max(upper.w - lower.w, 1e-5);
  let local_t = clamp((t - lower.w) / span, 0.0, 1.0);
  return mix(lower.xyz, upper.xyz, local_t);
}

@vertex
fn vs_pos2(@location(0) position : vec2<f32>) -> VSOutput {
  let view = make_view();
  let clip = view * vec3<f32>(position, 1.0);
  var out : VSOutput;
  out.clip = vec4<f32>(clip.xy, 0.0, 1.0);
  out.world = position;
  out.uv = vec2<f32>(0.0, 0.0);
  return out;
}

@vertex
fn vs_pos2uv2(@location(0) position : vec2<f32>, @location(1) uv : vec2<f32>) -> VSOutput {
  let view = make_view();
  let clip = view * vec3<f32>(position, 1.0);
  var out : VSOutput;
  out.clip = vec4<f32>(clip.xy, 0.0, 1.0);
  out.world = position;
  out.uv = uv;
  return out;
}

@fragment
fn fs_solid(input : VSOutput) -> @location(0) vec4<f32> {
  let fill_type = uniforms.params0.x;
  let opacity = uniforms.color.w;
  if (fill_type == ${FillType.Solid}.0) {
    return vec4<f32>(uniforms.color.xyz, opacity);
  }
  if (fill_type == ${FillType.Linear}.0) {
    let origin = uniforms.gradientOrigin.xy;
    let dir = uniforms.gradientDir.xy;
    let inv_len = uniforms.params0.z;
    let rel = input.world - origin;
    let t = clamp(dot(rel, dir) * inv_len, 0.0, 1.0);
    let rgb = gradient_color(t);
    return vec4<f32>(rgb, opacity);
  }
  return vec4<f32>(uniforms.color.xyz, opacity);
}

@group(0) @binding(1) var textureFill : texture_2d<f32>;
@group(0) @binding(2) var samplerFill : sampler;

@fragment
fn fs_image(input : VSOutput) -> @location(0) vec4<f32> {
  let fill_type = uniforms.params0.x;
  let opacity = uniforms.color.w;
  if (fill_type == ${FillType.Image}.0) {
    let texel = textureSample(textureFill, samplerFill, input.uv);
    return vec4<f32>(texel.xyz, texel.w * opacity);
  }
  if (fill_type == ${FillType.Linear}.0) {
    let origin = uniforms.gradientOrigin.xy;
    let dir = uniforms.gradientDir.xy;
    let inv_len = uniforms.params0.z;
    let rel = input.world - origin;
    let t = clamp(dot(rel, dir) * inv_len, 0.0, 1.0);
    let rgb = gradient_color(t);
    return vec4<f32>(rgb, opacity);
  }
  return vec4<f32>(uniforms.color.xyz, opacity);
}
`;

const identityViewMatrix = (): Float32Array => Float32Array.from([
  1, 0, 0,
  0, 1, 0,
  0, 0, 1,
]);

const toLinearColor = (rgba: [number, number, number, number]): [number, number, number, number] => (
  [rgba[0], rgba[1], rgba[2], rgba[3]]
);

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

const MAX_GRADIENT_STOPS = 4;

export class HybridShapeFillRenderer implements HybridRenderer {
  private readonly deviceManager = WebGPUDeviceManager.getInstance();

  private device: GPUDevice | null = null;

  private vertexBuffer: GPUBuffer | null = null;

  private vertexCapacity = 0;

  private indexBuffer: GPUBuffer | null = null;

  private indexCapacity = 0;

  private uniformBuffer: GPUBuffer | null = null;

  private readonly uniformData = new Float32Array(UNIFORM_FLOAT_CAPACITY);

  private solidPipeline: GPURenderPipeline | null = null;

  private imagePipeline: GPURenderPipeline | null = null;

  private solidBindGroupLayout: GPUBindGroupLayout | null = null;

  private imageBindGroupLayout: GPUBindGroupLayout | null = null;

  private sampler: GPUSampler | null = null;

  private currentFormat: GPUTextureFormat | null = null;

  private deviceGeneration = -1;

  private bindGroupSolid: GPUBindGroup | null = null;

  private bindGroupImage: GPUBindGroup | null = null;

  constructor() {
    if (isWebGPUSupported()) {
      this.deviceManager.onDeviceLost(() => {
        this.releaseResources();
      });
    }
  }

  destroyPreview(): void {
    // Preview targets are managed by caller; nothing to release here.
  }

  async upload(mesh: Mesh, fill: Fill, context?: RenderContext): Promise<void> {
    void fill;
    if (!isWebGPUSupported()) {
      return;
    }

    const format = context?.format;
    const device = await this.ensureDevice(format);
    if (!device) {
      return;
    }

    this.ensureUniformBuffer(device);

    this.ensureVertexBuffer(device, mesh.verts.byteLength);
    this.ensureIndexBuffer(device, mesh.indices.byteLength);

    if (this.vertexBuffer) {
      device.queue.writeBuffer(this.vertexBuffer, 0, mesh.verts);
    }
    if (this.indexBuffer) {
      device.queue.writeBuffer(this.indexBuffer, 0, mesh.indices);
    }
  }

  draw(mesh: Mesh, fill: Fill, context: RenderContext | undefined, preview: boolean): void {
    if (!isWebGPUSupported()) {
      return;
    }

    if (!context) {
      return;
    }

    const target = preview ? context.previewTarget ?? null : context.finalTarget ?? null;
    if (!target) {
      return;
    }

    const devicePromise = this.ensureDevice(context.format);
    void devicePromise.then(device => {
      if (!device || !this.vertexBuffer || !this.indexBuffer || !this.uniformBuffer) {
        return;
      }

      const pipeline = this.selectPipeline(device, mesh.layout, context.format);
      if (!pipeline) {
        return;
      }

      const commandEncoder = device.createCommandEncoder();
      const pass = commandEncoder.beginRenderPass({
        colorAttachments: [
          {
            view: target.view,
            loadOp: preview ? 'clear' : 'load',
            storeOp: 'store',
            clearValue: { r: 0, g: 0, b: 0, a: 0 },
          },
        ],
      });

      pass.setPipeline(pipeline);
      pass.setVertexBuffer(0, this.vertexBuffer);
      pass.setIndexBuffer(this.indexBuffer, 'uint32');

      this.writeUniforms(device, fill, mesh, context);

      if (mesh.layout === 'pos2uv2') {
        const bindGroup = this.createImageBindGroup(device, fill, context);
        if (!bindGroup) {
          pass.end();
          device.queue.submit([commandEncoder.finish()]);
          return;
        }
        pass.setBindGroup(0, bindGroup);
      } else {
        const bindGroup = this.createSolidBindGroup(device);
        pass.setBindGroup(0, bindGroup);
      }

      pass.setViewport(0, 0, target.size.width, target.size.height, 0, 1);
      pass.setScissorRect(0, 0, Math.floor(target.size.width), Math.floor(target.size.height));
      pass.drawIndexed(mesh.indices.length);
      pass.end();

      device.queue.submit([commandEncoder.finish()]);

      context.onComplete?.(target, preview);
    });
  }

  private async ensureDevice(format?: GPUTextureFormat): Promise<GPUDevice | null> {
    const device = await this.deviceManager.ensureDevice();
    if (!device) {
      return null;
    }

    const generation = this.deviceManager.getDeviceGeneration();
    if (this.device !== device || this.deviceGeneration !== generation) {
      this.releaseResources();
      this.device = device;
      this.deviceGeneration = generation;
      this.currentFormat = null;
    }

    if (format && this.currentFormat !== format) {
      this.currentFormat = null;
      this.releasePipelines();
    }

    return device;
  }

  private ensureVertexBuffer(device: GPUDevice, byteLength: number): void {
    if (this.vertexBuffer && this.vertexCapacity >= byteLength) {
      return;
    }
    if (this.vertexBuffer) {
      this.vertexBuffer.destroy();
    }
    const size = Math.max(256, Math.ceil(byteLength / 256) * 256);
    this.vertexBuffer = device.createBuffer({
      size,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
      label: 'hybrid-shape-fill-vertices',
    });
    this.vertexCapacity = size;
  }

  private ensureIndexBuffer(device: GPUDevice, byteLength: number): void {
    if (this.indexBuffer && this.indexCapacity >= byteLength) {
      return;
    }
    if (this.indexBuffer) {
      this.indexBuffer.destroy();
    }
    const size = Math.max(256, Math.ceil(byteLength / 256) * 256);
    this.indexBuffer = device.createBuffer({
      size,
      usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
      label: 'hybrid-shape-fill-indices',
    });
    this.indexCapacity = size;
  }

  private ensureUniformBuffer(device: GPUDevice): void {
    if (this.uniformBuffer) {
      return;
    }
    this.uniformBuffer = device.createBuffer({
      size: UNIFORM_FLOAT_CAPACITY * 4,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      label: 'hybrid-shape-fill-uniforms',
    });
  }

  private selectPipeline(device: GPUDevice, layout: Mesh['layout'], format: GPUTextureFormat): GPURenderPipeline | null {
    this.ensurePipelines(device, format);
    if (layout === 'pos2uv2') {
      return this.imagePipeline;
    }
    return this.solidPipeline;
  }

  private ensurePipelines(device: GPUDevice, format: GPUTextureFormat): void {
    if (this.currentFormat === format && this.solidPipeline && this.imagePipeline) {
      return;
    }

    this.releasePipelines();

    const shaderModule = device.createShaderModule({
      label: 'hybrid-shape-fill-shader',
      code: SHADER_SOURCE,
    });

    this.solidBindGroupLayout = device.createBindGroupLayout({
      label: 'hybrid-shape-fill-solid-bgl',
      entries: [
        {
          binding: 0,
          visibility: GPU_STAGE_ALL,
          buffer: { type: 'uniform' },
        },
      ],
    });

    this.imageBindGroupLayout = device.createBindGroupLayout({
      label: 'hybrid-shape-fill-image-bgl',
      entries: [
        {
          binding: 0,
          visibility: GPU_STAGE_ALL,
          buffer: { type: 'uniform' },
        },
        {
          binding: 1,
          visibility: GPU_SHADER_STAGE_FRAGMENT,
          texture: { sampleType: 'float' },
        },
        {
          binding: 2,
          visibility: GPU_SHADER_STAGE_FRAGMENT,
          sampler: { type: 'filtering' },
        },
      ],
    });

    const pipelineLayoutSolid = device.createPipelineLayout({
      bindGroupLayouts: [this.solidBindGroupLayout],
    });

    const pipelineLayoutImage = device.createPipelineLayout({
      bindGroupLayouts: [this.imageBindGroupLayout],
    });

    this.solidPipeline = device.createRenderPipeline({
      label: 'hybrid-shape-fill-solid',
      layout: pipelineLayoutSolid,
      vertex: {
        shaderModule,
        entryPoint: 'vs_pos2',
        buffers: [
          {
            arrayStride: 8,
            attributes: [
              { shaderLocation: 0, format: 'float32x2', offset: 0 },
            ],
          },
        ],
      },
      fragment: {
        shaderModule,
        entryPoint: 'fs_solid',
        targets: [{ format }],
      },
      primitive: { topology: 'triangle-list' },
    });

    this.imagePipeline = device.createRenderPipeline({
      label: 'hybrid-shape-fill-image',
      layout: pipelineLayoutImage,
      vertex: {
        shaderModule,
        entryPoint: 'vs_pos2uv2',
        buffers: [
          {
            arrayStride: 16,
            attributes: [
              { shaderLocation: 0, format: 'float32x2', offset: 0 },
              { shaderLocation: 1, format: 'float32x2', offset: 8 },
            ],
          },
        ],
      },
      fragment: {
        shaderModule,
        entryPoint: 'fs_image',
        targets: [{ format }],
      },
      primitive: { topology: 'triangle-list' },
    });

    this.currentFormat = format;
  }

  private createSolidBindGroup(device: GPUDevice): GPUBindGroup {
    if (!this.solidBindGroupLayout || !this.uniformBuffer) {
      throw new Error('Solid pipeline not initialised');
    }
    this.bindGroupSolid = device.createBindGroup({
      label: 'hybrid-shape-fill-solid-bg',
      layout: this.solidBindGroupLayout,
      entries: [
        {
          binding: 0,
          resource: { buffer: this.uniformBuffer },
        },
      ],
    });
    return this.bindGroupSolid;
  }

  private createImageBindGroup(device: GPUDevice, fill: Fill, context: RenderContext): GPUBindGroup | null {
    if (!this.imageBindGroupLayout || !this.uniformBuffer) {
      throw new Error('Image pipeline not initialised');
    }

    if (fill.type !== 'image') {
      return this.createSolidBindGroup(device);
    }

    const resolve = context.textureResolver?.(fill.tex);
    if (!resolve) {
      return this.createSolidBindGroup(device);
    }

    if (!this.sampler) {
      this.sampler = device.createSampler({
        label: 'hybrid-shape-fill-sampler',
        magFilter: 'linear',
        minFilter: 'linear',
        mipmapFilter: 'linear',
      });
    }

    this.bindGroupImage = device.createBindGroup({
      label: 'hybrid-shape-fill-image-bg',
      layout: this.imageBindGroupLayout,
      entries: [
        {
          binding: 0,
          resource: { buffer: this.uniformBuffer },
        },
        {
          binding: 1,
          resource: resolve,
        },
        {
          binding: 2,
          resource: this.sampler!,
        },
      ],
    });

    return this.bindGroupImage;
  }

  private writeUniforms(device: GPUDevice, fill: Fill, mesh: Mesh, context: RenderContext): void {
    if (!this.uniformBuffer) {
      return;
    }

    void mesh;

    this.uniformData.fill(0);

    const view = context.viewMatrix ?? identityViewMatrix();

    // view matrix columns packed as vec4
    this.uniformData[0] = view[0];
    this.uniformData[1] = view[1];
    this.uniformData[2] = view[2];

    this.uniformData[4] = view[3];
    this.uniformData[5] = view[4];
    this.uniformData[6] = view[5];

    this.uniformData[8] = view[6];
    this.uniformData[9] = view[7];
    this.uniformData[10] = view[8];

    let fillType = FillType.Solid;
    let opacity = 1;

    const writeStops = (stops: Array<{ t: number; rgba: [number, number, number, number] }>) => {
      const clamped = stops
        .slice()
        .sort((a, b) => a.t - b.t)
        .slice(0, MAX_GRADIENT_STOPS);
      if (clamped.length === 0) {
        clamped.push({ t: 0, rgba: [0, 0, 0, 1] });
        clamped.push({ t: 1, rgba: [1, 1, 1, 1] });
      } else if (clamped.length === 1) {
        clamped.push({ t: 1, rgba: clamped[0].rgba });
        clamped[0].t = 0;
      }
      const count = clamped.length;
      for (let i = 0; i < MAX_GRADIENT_STOPS; i += 1) {
        const baseIndex = 28 + i * 4;
        if (i < count) {
          const stop = clamped[i];
          const color = toLinearColor(stop.rgba);
          this.uniformData[baseIndex] = clamp01(color[0]);
          this.uniformData[baseIndex + 1] = clamp01(color[1]);
          this.uniformData[baseIndex + 2] = clamp01(color[2]);
          this.uniformData[baseIndex + 3] = clamp01(stop.t);
        } else {
          this.uniformData[baseIndex] = this.uniformData[baseIndex + 1] = this.uniformData[baseIndex + 2] = this.uniformData[baseIndex + 3] = 0;
        }
      }
      return count;
    };

    const writeSolid = (solid: FillSolid) => {
      const color = toLinearColor(solid.rgba);
      this.uniformData[12] = clamp01(color[0]);
      this.uniformData[13] = clamp01(color[1]);
      this.uniformData[14] = clamp01(color[2]);
      opacity = clamp01(color[3]);
    };

    if (fill.type === 'solid') {
      fillType = FillType.Solid;
      writeSolid(fill);
    } else if (fill.type === 'linear') {
      fillType = FillType.Linear;
      const count = writeStops(fill.stops);
      const p0x = fill.p0[0];
      const p0y = fill.p0[1];
      const dirX = fill.p1[0] - fill.p0[0];
      const dirY = fill.p1[1] - fill.p0[1];
      const length = Math.max(Math.hypot(dirX, dirY), 1e-6);
      const invLength = 1 / length;
      this.uniformData[20] = p0x;
      this.uniformData[21] = p0y;
      this.uniformData[24] = dirX;
      this.uniformData[25] = dirY;
      this.uniformData[16] = FillType.Linear;
      this.uniformData[17] = count;
      this.uniformData[18] = invLength;
      this.uniformData[19] = 0;
      opacity = 1;
    } else if (fill.type === 'image') {
      fillType = FillType.Image;
      // Base opacity stored in params; color may act as tint
      this.uniformData[12] = 1;
      this.uniformData[13] = 1;
      this.uniformData[14] = 1;
      opacity = 1;
    } else if (fill.type === 'contour') {
      const base = fill.base;
      if (base.type === 'solid') {
        fillType = FillType.Solid;
        writeSolid(base);
      } else if (base.type === 'linear') {
        fillType = FillType.Linear;
        const count = writeStops(base.stops);
        const p0x = base.p0[0];
        const p0y = base.p0[1];
        const dirX = base.p1[0] - base.p0[0];
        const dirY = base.p1[1] - base.p0[1];
        const length = Math.max(Math.hypot(dirX, dirY), 1e-6);
        const invLength = 1 / length;
        this.uniformData[20] = p0x;
        this.uniformData[21] = p0y;
        this.uniformData[24] = dirX;
        this.uniformData[25] = dirY;
        this.uniformData[16] = FillType.Linear;
        this.uniformData[17] = count;
        this.uniformData[18] = invLength;
        this.uniformData[19] = 0;
        opacity = 1;
      } else {
        fillType = FillType.Solid;
        writeSolid({ type: 'solid', rgba: [1, 1, 1, 1] });
        opacity = 1;
      }
    }

    this.uniformData[12 + 3] = opacity;
    this.uniformData[16] = fillType;
    if (fillType !== FillType.Linear) {
      this.uniformData[17] = 0;
      this.uniformData[18] = 0;
      this.uniformData[19] = 0;
    }

    device.queue.writeBuffer(this.uniformBuffer, 0, this.uniformData.buffer, this.uniformData.byteOffset, this.uniformData.byteLength);
  }

  private releasePipelines(): void {
    this.solidPipeline = null;
    this.imagePipeline = null;
    this.solidBindGroupLayout = null;
    this.imageBindGroupLayout = null;
    this.bindGroupSolid = null;
    this.bindGroupImage = null;
  }

  private releaseResources(): void {
    this.vertexBuffer?.destroy();
    this.indexBuffer?.destroy();
    this.uniformBuffer?.destroy();
    this.vertexBuffer = null;
    this.indexBuffer = null;
    this.uniformBuffer = null;
    this.vertexCapacity = 0;
    this.indexCapacity = 0;
    this.releasePipelines();
    this.currentFormat = null;
  }
}
