if (!global.__webgpuMockInstalled) {
  const defineGlobalConstant = (name, value) => {
    if (typeof global[name] === 'undefined') {
      Object.defineProperty(global, name, {
        configurable: true,
        enumerable: false,
        writable: true,
        value,
      });
    }
  };

  const GPUBufferUsage = {
    MAP_READ: 0x0001,
    MAP_WRITE: 0x0002,
    COPY_SRC: 0x0004,
    COPY_DST: 0x0008,
    INDEX: 0x0010,
    VERTEX: 0x0020,
    UNIFORM: 0x0040,
    STORAGE: 0x0080,
    INDIRECT: 0x0100,
    QUERY_RESOLVE: 0x0200,
  };

  const GPUTextureUsage = {
    COPY_SRC: 0x01,
    COPY_DST: 0x02,
    TEXTURE_BINDING: 0x04,
    STORAGE_BINDING: 0x08,
    RENDER_ATTACHMENT: 0x10,
  };

  const GPUMapMode = {
    READ: 0x0001,
    WRITE: 0x0002,
  };

  const GPUShaderStage = {
    VERTEX: 0x1,
    FRAGMENT: 0x2,
    COMPUTE: 0x4,
  };

  defineGlobalConstant('GPUBufferUsage', GPUBufferUsage);
  defineGlobalConstant('GPUTextureUsage', GPUTextureUsage);
  defineGlobalConstant('GPUMapMode', GPUMapMode);
  defineGlobalConstant('GPUShaderStage', GPUShaderStage);

  class MockGPUBuffer {
    constructor(descriptor = {}) {
      this.label = descriptor.label ?? 'mock-buffer';
      this.size = descriptor.size ?? (descriptor.arrayBuffer ? descriptor.arrayBuffer.byteLength : 0);
      this.usage = descriptor.usage ?? 0;
      this.mappedAtCreation = Boolean(descriptor.mappedAtCreation);
      this._arrayBuffer = new ArrayBuffer(Math.max(this.size, 0));
      this._mapped = this.mappedAtCreation;
    }

    getMappedRange() {
      return this._arrayBuffer;
    }

    async mapAsync() {
      this._mapped = true;
    }

    unmap() {
      this._mapped = false;
    }

    destroy() {
      this._arrayBuffer = new ArrayBuffer(0);
    }
  }

  class MockGPUTexture {
    constructor(descriptor = {}) {
      this.label = descriptor.label ?? 'mock-texture';
      this.size = descriptor.size ?? { width: 0, height: 0, depthOrArrayLayers: 1 };
      this.format = descriptor.format ?? 'bgra8unorm';
      this.usage = descriptor.usage ?? GPUTextureUsage.TEXTURE_BINDING;
    }

    createView() {
      return { label: `${this.label}-view` };
    }

    destroy() {}
  }

  class MockGPUQueue {
    constructor() {
      this.submissions = [];
      this.onSubmittedWorkDone = async () => {};
    }

    submit(commands = []) {
      this.submissions.push(...commands);
    }

    writeBuffer(buffer, bufferOffset, data, dataOffset = 0, size) {
      const sourceBytes = data instanceof ArrayBuffer
        ? new Uint8Array(data)
        : new Uint8Array(data.buffer, data.byteOffset + dataOffset, size ?? data.byteLength);
      const target = new Uint8Array(buffer._arrayBuffer);
      const length = size ?? sourceBytes.length;
      target.set(sourceBytes.subarray(0, length), bufferOffset);
    }
  }

  class MockGPUCommandBuffer {}

  class MockGPURenderPassEncoder {
    setPipeline() {}
    setBindGroup() {}
    setVertexBuffer() {}
    setIndexBuffer() {}
    setViewport() {}
    setScissorRect() {}
    setBlendConstant() {}
    setStencilReference() {}
    draw() {}
    drawIndexed() {}
    end() {}
    endPass() {}
  }

  class MockGPUCommandEncoder {
    beginRenderPass() {
      return new MockGPURenderPassEncoder();
    }

    copyTextureToBuffer() {}
    copyBufferToBuffer() {}

    finish() {
      return new MockGPUCommandBuffer();
    }
  }

  class MockGPUShaderModule {
    constructor(descriptor = {}) {
      this.label = descriptor.label ?? 'mock-shader-module';
      this.code = descriptor.code ?? '';
    }

    async getCompilationInfo() {
      return { messages: [] };
    }
  }

  class MockGPUBindGroupLayout {}
  class MockGPUBindGroup {}
  class MockGPUPipelineLayout {}
  class MockGPURenderPipeline {}
  class MockGPUComputePipeline {}
  class MockGPUSampler {}

  class MockGPUDevice {
    constructor() {
      this.queue = new MockGPUQueue();
      this._listeners = new Map();
      this.lost = new Promise(resolve => {
        this._resolveLost = resolve;
      });
    }

    createBuffer(descriptor) {
      return new MockGPUBuffer(descriptor);
    }

    createTexture(descriptor) {
      return new MockGPUTexture(descriptor);
    }

    createCommandEncoder() {
      return new MockGPUCommandEncoder();
    }

    createShaderModule(descriptor) {
      return new MockGPUShaderModule(descriptor);
    }

    createBindGroupLayout() {
      return new MockGPUBindGroupLayout();
    }

    createBindGroup(descriptor) {
      return new MockGPUBindGroup(descriptor);
    }

    createPipelineLayout() {
      return new MockGPUPipelineLayout();
    }

    createRenderPipeline() {
      return new MockGPURenderPipeline();
    }

    createComputePipeline() {
      return new MockGPUComputePipeline();
    }

    async createComputePipelineAsync(descriptor) {
      return this.createComputePipeline(descriptor);
    }

    createSampler() {
      return new MockGPUSampler();
    }

    addEventListener(type, listener) {
      if (!this._listeners.has(type)) {
        this._listeners.set(type, new Set());
      }
      this._listeners.get(type).add(listener);
    }

    removeEventListener(type, listener) {
      this._listeners.get(type)?.delete(listener);
    }

    destroy() {
      this._resolveLost?.({ reason: 'destroyed', message: '' });
    }
  }

  class MockGPUAdapter {
    constructor() {
      this.features = new Set();
      this.limits = {};
    }

    async requestDevice() {
      return new MockGPUDevice();
    }
  }

  const ensureNavigator = () => {
    if (typeof global.navigator === 'undefined') {
      global.navigator = {};
    }
  };

  const attachGpu = () => {
    ensureNavigator();
    Object.defineProperty(global.navigator, 'gpu', {
      configurable: true,
      enumerable: true,
      get() {
        return {
          getPreferredCanvasFormat: () => 'bgra8unorm',
          async requestAdapter() {
            return new MockGPUAdapter();
          },
        };
      },
    });
  };

  const detachGpu = () => {
    if (typeof global.navigator !== 'undefined' && 'gpu' in global.navigator) {
      delete global.navigator.gpu;
    }
  };

  const installCanvasMock = () => {
    const prototype = global.HTMLCanvasElement?.prototype;
    if (!prototype || prototype.__webgpuPatched) {
      return;
    }

    const originalGetContext = prototype.getContext;
    prototype.getContext = function patchedGetContext(type, ...args) {
      if (type === 'webgpu') {
        return {
          canvas: this,
          configuration: null,
          configure(config) {
            this.configuration = config;
          },
          unconfigure() {
            this.configuration = null;
          },
          getCurrentTexture() {
            return new MockGPUTexture({
              size: { width: this.canvas.width ?? 0, height: this.canvas.height ?? 0, depthOrArrayLayers: 1 },
              format: this.configuration?.format ?? 'bgra8unorm',
              usage: GPUTextureUsage.RENDER_ATTACHMENT,
            });
          },
        };
      }
      return originalGetContext?.call(this, type, ...args) ?? null;
    };
    prototype.__webgpuPatched = true;
  };

  attachGpu();
  installCanvasMock();

  global.__mockWebgpu = {
    enable: () => {
      attachGpu();
    },
    disable: () => {
      detachGpu();
    },
    reset: () => {
      detachGpu();
      attachGpu();
    },
    createDevice: () => new MockGPUDevice(),
  };

  global.__webgpuMockInstalled = true;
}

module.exports = global.__mockWebgpu;
