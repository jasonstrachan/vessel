type GPUFeatureName = string;

type GPUBufferUsageFlags = number;

declare const GPUBufferUsage: {
  readonly MAP_READ: GPUBufferUsageFlags;
  readonly MAP_WRITE: GPUBufferUsageFlags;
  readonly COPY_SRC: GPUBufferUsageFlags;
  readonly COPY_DST: GPUBufferUsageFlags;
  readonly INDEX: GPUBufferUsageFlags;
  readonly VERTEX: GPUBufferUsageFlags;
  readonly UNIFORM: GPUBufferUsageFlags;
  readonly STORAGE: GPUBufferUsageFlags;
  readonly INDIRECT: GPUBufferUsageFlags;
  readonly QUERY_RESOLVE: GPUBufferUsageFlags;
};

type GPUTextureUsageFlags = number;

declare const GPUTextureUsage: {
  readonly COPY_SRC: GPUTextureUsageFlags;
  readonly COPY_DST: GPUTextureUsageFlags;
  readonly TEXTURE_BINDING: GPUTextureUsageFlags;
  readonly STORAGE_BINDING: GPUTextureUsageFlags;
  readonly RENDER_ATTACHMENT: GPUTextureUsageFlags;
};

type GPUExtent3DStrict = {
  width: number;
  height: number;
  depthOrArrayLayers?: number;
};

type GPUOrigin3D = {
  x?: number;
  y?: number;
  z?: number;
};

type GPUTextureFormat = string;

declare interface GPUTextureView {
  readonly label?: string;
  readonly __brand_gpuTextureView?: void;
}

declare interface GPUCommandBuffer {
  readonly label?: string;
}

declare interface GPUPipelineLayout {
  readonly label?: string;
}

declare interface GPUShaderModule {
  readonly label?: string;
}

declare interface GPUBindGroup {
  readonly label?: string;
}

declare interface GPUBindGroupLayout {
  readonly label?: string;
}

declare interface GPUExternalTexture {
  readonly label?: string;
}

declare interface GPUUncapturedErrorEvent extends Event {
  readonly error: DOMException;
}

declare interface GPUDeviceLostInfo {
  readonly reason: GPUDeviceLostReason | null;
  readonly message: string;
}

declare type GPUDeviceLostReason = 'unknown' | 'destroyed';

declare interface GPUBuffer {
  mapAsync(mode: number, offset?: number, size?: number): Promise<void>;
  getMappedRange(offset?: number, size?: number): ArrayBuffer;
  unmap(): void;
  destroy(): void;
  readonly label?: string;
}

declare interface GPUTexture {
  createView(descriptor?: GPUTextureViewDescriptor): GPUTextureView;
  destroy(): void;
  readonly label?: string;
}

declare interface GPUTextureViewDescriptor {
  label?: string;
  dimension?: '1d' | '2d' | '2d-array' | 'cube' | 'cube-array' | '3d';
}

declare interface GPUBufferDescriptor {
  label?: string;
  size: number;
  usage: GPUBufferUsageFlags;
  mappedAtCreation?: boolean;
}

declare interface GPUTextureDescriptor {
  label?: string;
  size: GPUExtent3DStrict;
  format: GPUTextureFormat;
  usage: GPUTextureUsageFlags;
}

declare type GPUBindingResource =
  | { buffer: GPUBuffer }
  | GPUTextureView
  | GPUExternalTexture;

declare interface GPUBindGroupEntry {
  binding: number;
  resource: GPUBindingResource;
}

declare interface GPUBindGroupDescriptor {
  label?: string;
  layout: GPUBindGroupLayout;
  entries: GPUBindGroupEntry[];
}

declare interface GPUShaderModuleDescriptor {
  label?: string;
  code: string;
}

declare interface GPUVertexAttribute {
  shaderLocation: number;
  offset: number;
  format: string;
}

type GPUVertexStepMode = 'vertex' | 'instance';

declare interface GPUVertexBufferLayout {
  arrayStride: number;
  stepMode?: GPUVertexStepMode;
  attributes: GPUVertexAttribute[];
}

declare interface GPUVertexState {
  module: GPUShaderModule;
  entryPoint: string;
  buffers?: GPUVertexBufferLayout[];
}

declare interface GPUColorTargetState {
  format: GPUTextureFormat;
}

declare interface GPUFragmentState {
  module: GPUShaderModule;
  entryPoint: string;
  targets: GPUColorTargetState[];
}

type GPUPrimitiveTopology = 'point-list' | 'line-list' | 'line-strip' | 'triangle-list' | 'triangle-strip';

declare interface GPUPrimitiveState {
  topology?: GPUPrimitiveTopology;
}

declare interface GPUMultisampleState {
  count?: number;
  mask?: number;
  alphaToCoverageEnabled?: boolean;
}

declare interface GPUComputePipelineDescriptor {
  label?: string;
  layout?: GPUPipelineLayout | 'auto';
  compute: {
    module: GPUShaderModule;
    entryPoint: string;
  };
}

declare interface GPURenderPipelineDescriptor {
  label?: string;
  layout?: GPUPipelineLayout | 'auto';
  vertex: GPUVertexState;
  fragment?: GPUFragmentState;
  primitive?: GPUPrimitiveState;
  multisample?: GPUMultisampleState;
}

declare interface GPURenderPipeline {
  getBindGroupLayout(index: number): GPUBindGroupLayout;
}

declare const GPUMapMode: {
  readonly READ: number;
  readonly WRITE: number;
};

declare interface GPUCommandEncoderDescriptor {
  label?: string;
}

declare interface GPUComputePassDescriptor {
  label?: string;
}

declare interface GPUComputePipeline {
  getBindGroupLayout(index: number): GPUBindGroupLayout;
}

declare interface GPUImageCopyTexture {
  texture: GPUTexture;
  mipLevel?: number;
  origin?: GPUOrigin3D;
  aspect?: 'all' | 'depth-only' | 'stencil-only';
}

declare interface GPUImageCopyBuffer {
  buffer: GPUBuffer;
  offset?: number;
  bytesPerRow?: number;
  rowsPerImage?: number;
}

declare interface GPURenderPassColorAttachment {
  view: GPUTextureView;
  loadOp: 'load' | 'clear';
  storeOp: 'store' | 'discard';
  clearValue?: { r: number; g: number; b: number; a: number };
}

declare interface GPURenderPassDescriptor {
  label?: string;
  colorAttachments: GPURenderPassColorAttachment[];
}

declare interface GPUComputePassEncoder {
  setPipeline(pipeline: GPUComputePipeline): void;
  setBindGroup(index: number, bindGroup: GPUBindGroup): void;
  dispatchWorkgroups(x: number, y?: number, z?: number): void;
  end(): void;
}

declare interface GPURenderPassEncoder {
  setPipeline(pipeline: GPURenderPipeline): void;
  setBindGroup(index: number, bindGroup: GPUBindGroup): void;
  setVertexBuffer(slot: number, buffer: GPUBuffer, offset?: number, size?: number): void;
  setViewport(x: number, y: number, width: number, height: number, minDepth: number, maxDepth: number): void;
  setScissorRect(x: number, y: number, width: number, height: number): void;
  draw(vertexCount: number, instanceCount?: number, firstVertex?: number, firstInstance?: number): void;
  end(): void;
}

declare interface GPUCommandEncoder {
  beginComputePass(descriptor?: GPUComputePassDescriptor): GPUComputePassEncoder;
  beginRenderPass(descriptor: GPURenderPassDescriptor): GPURenderPassEncoder;
  copyTextureToBuffer(source: GPUImageCopyTexture, destination: GPUImageCopyBuffer, copySize: GPUExtent3DStrict): void;
  finish(): GPUCommandBuffer;
}

declare interface GPUQueue {
  writeBuffer(
    buffer: GPUBuffer,
    bufferOffset: number,
    data: ArrayBuffer | ArrayBufferView,
    dataOffset?: number,
    size?: number
  ): void;
  submit(commandBuffers: Iterable<GPUCommandBuffer>): void;
}

declare interface GPUDevice {
  readonly queue: GPUQueue;
  readonly lost: Promise<GPUDeviceLostInfo>;
  createBuffer(descriptor: GPUBufferDescriptor): GPUBuffer;
  createTexture(descriptor: GPUTextureDescriptor): GPUTexture;
  createShaderModule(descriptor: GPUShaderModuleDescriptor): GPUShaderModule;
  createComputePipelineAsync(descriptor: GPUComputePipelineDescriptor): Promise<GPUComputePipeline>;
  createRenderPipeline(descriptor: GPURenderPipelineDescriptor): GPURenderPipeline;
  createRenderPipelineAsync?(descriptor: GPURenderPipelineDescriptor): Promise<GPURenderPipeline>;
  createBindGroup(descriptor: GPUBindGroupDescriptor): GPUBindGroup;
  createCommandEncoder(descriptor?: GPUCommandEncoderDescriptor): GPUCommandEncoder;
  addEventListener(type: 'uncapturederror', listener: (event: GPUUncapturedErrorEvent) => void): void;
}

declare interface GPUDeviceDescriptor {
  requiredFeatures?: GPUFeatureName[];
}

declare interface GPUAdapter {
  readonly features: Set<GPUFeatureName>;
  requestDevice(descriptor?: GPUDeviceDescriptor): Promise<GPUDevice>;
}

declare interface GPURequestAdapterOptions {
  powerPreference?: 'low-power' | 'high-performance';
}

declare interface GPU {
  requestAdapter(options?: GPURequestAdapterOptions): Promise<GPUAdapter | null>;
}

declare interface Navigator {
  gpu?: GPU;
}
