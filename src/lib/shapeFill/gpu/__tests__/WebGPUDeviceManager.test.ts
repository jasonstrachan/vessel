import {
  WebGPUDeviceManager,
  getWebGPUSupportStatus,
  isWebGPUSupported,
  resetWebGPUSupportStatusForTesting,
} from '../WebGPUDeviceManager';

type MockWebgpuControls = {
  enable(): void;
  disable(): void;
  reset?(): void;
  createDevice?: () => GPUDevice;
};

declare global {
  // eslint-disable-next-line no-var
  var __mockWebgpu: MockWebgpuControls | undefined;
}

describe('WebGPUDeviceManager support gating', () => {
  beforeEach(() => {
    global.__mockWebgpu?.reset?.();
    resetWebGPUSupportStatusForTesting();
  });

  afterEach(() => {
    resetWebGPUSupportStatusForTesting();
    global.__mockWebgpu?.enable();
    WebGPUDeviceManager.getInstance().destroy();
  });

  it('marks support as unavailable when navigator.gpu is missing', () => {
    global.__mockWebgpu?.disable();
    resetWebGPUSupportStatusForTesting();

    expect(isWebGPUSupported()).toBe(false);
    const status = getWebGPUSupportStatus();
    expect(status.status).toBe('unavailable');
    if (status.status !== 'unavailable') {
      throw new Error('Expected WebGPU status to be unavailable');
    }
    expect(status.recoverable).toBe(true);
    expect(status.reason).toContain('Navigator WebGPU interface');

    global.__mockWebgpu?.enable();
    resetWebGPUSupportStatusForTesting();
  });

  it('marks support as unavailable when adapter acquisition fails', async () => {
    const descriptor = Object.getOwnPropertyDescriptor(navigator, 'gpu');
    Object.defineProperty(navigator, 'gpu', {
      configurable: true,
      enumerable: true,
      get() {
        return {
          getPreferredCanvasFormat: () => 'bgra8unorm',
          async requestAdapter() {
            return null;
          },
        };
      },
    });

    resetWebGPUSupportStatusForTesting();

    await expect(WebGPUDeviceManager.getInstance().getAdapter()).rejects.toThrow('Unable to acquire WebGPU adapter');

    const status = getWebGPUSupportStatus();
    expect(status.status).toBe('unavailable');
    if (status.status !== 'unavailable') {
      throw new Error('Expected WebGPU status to be unavailable');
    }
    expect(status.recoverable).toBe(false);
    expect(status.reason).toContain('Unable to acquire WebGPU adapter');

    if (descriptor) {
      Object.defineProperty(navigator, 'gpu', descriptor);
    }
    global.__mockWebgpu?.reset?.();
    resetWebGPUSupportStatusForTesting();
  });

  it('updates support status when the device is lost', async () => {
    const manager = WebGPUDeviceManager.getInstance();
    const device = await manager.ensureDevice();
    expect(device).not.toBeNull();
    expect(isWebGPUSupported()).toBe(true);

    // Trigger the mock device lost handler.
    await (device as unknown as { destroy(): void }).destroy();
    await new Promise(resolve => setTimeout(resolve, 0));

    const status = getWebGPUSupportStatus();
    expect(status.status).toBe('unavailable');
    if (status.status !== 'unavailable') {
      throw new Error('Expected WebGPU status to be unavailable');
    }
    expect(status.recoverable).toBe(false);
    expect(status.reason).toContain('WebGPU device lost');
  });
});
