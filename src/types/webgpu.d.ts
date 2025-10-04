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

declare interface GPUTextureView {}

declare interface GPUCommandBuffer {}

declare interface GPUPipelineLayout {}

declare interface GPUShaderModule {}

declare interface GPUBindGroup {}

declare interface GPUBindGroupLayout {}

declare interface GPUExternalTexture {}

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
}

declare interface GPUTexture {
  createView(descriptor?: GPUTextureViewDescriptor): GPUTextureView;
  destroy(): void;
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

declare interface GPUComputePipelineDescriptor {
  label?: string;
  layout?: GPUPipelineLayout | 'auto';
  compute: {
    module: GPUShaderModule;
    entryPoint: string;
  };
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

declare interface GPUComputePassEncoder {
  setPipeline(pipeline: GPUComputePipeline): void;
  setBindGroup(index: number, bindGroup: GPUBindGroup): void;
  dispatchWorkgroups(x: number, y?: number, z?: number): void;
  end(): void;
}

declare interface GPUCommandEncoder {
  beginComputePass(descriptor?: GPUComputePassDescriptor): GPUComputePassEncoder;
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
