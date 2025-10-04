/* eslint-disable @typescript-eslint/no-floating-promises */
const WEBGPU_UNSUPPORTED_ERROR = 'WebGPU is not available in this environment';

type DeviceLostCallback = (info: GPUDeviceLostInfo) => void;

declare global {
  interface Navigator {
    gpu?: GPU;
  }
}

export const isWebGPUSupported = (): boolean => typeof navigator !== 'undefined' && 'gpu' in navigator;

export class WebGPUDeviceManager {
  private static instance: WebGPUDeviceManager | null = null;

  private adapter: GPUAdapter | null = null;

  private device: GPUDevice | null = null;

  private onLostCallbacks: Set<DeviceLostCallback> = new Set();

  private constructor() {}

  static getInstance(): WebGPUDeviceManager {
    if (!WebGPUDeviceManager.instance) {
      WebGPUDeviceManager.instance = new WebGPUDeviceManager();
    }
    return WebGPUDeviceManager.instance;
  }

  async getAdapter(): Promise<GPUAdapter> {
    if (!isWebGPUSupported()) {
      throw new Error(WEBGPU_UNSUPPORTED_ERROR);
    }

    if (this.adapter) {
      return this.adapter;
    }

    const adapter = await navigator.gpu!.requestAdapter({
      powerPreference: 'high-performance',
    });

    if (!adapter) {
      throw new Error('Unable to acquire WebGPU adapter');
    }

    this.adapter = adapter;
    return adapter;
  }

  async getDevice(features: GPUFeatureName[] = []): Promise<GPUDevice> {
    if (this.device) {
      return this.device;
    }

    const adapter = await this.getAdapter();
    const supportedFeatures = features.filter(feature => adapter.features.has(feature));
    this.device = await adapter.requestDevice({
      requiredFeatures: supportedFeatures,
    });

    this.device.addEventListener('uncapturederror', event => {
      console.error('[WebGPU] Uncaptured device error', event.error);
    });

    this.device.lost.then(info => {
      this.device = null;
      for (const callback of this.onLostCallbacks) {
        callback(info);
      }
    });

    return this.device;
  }

  onDeviceLost(callback: DeviceLostCallback): () => void {
    this.onLostCallbacks.add(callback);
    return () => this.onLostCallbacks.delete(callback);
  }

  async ensureDevice(features?: GPUFeatureName[]): Promise<GPUDevice | null> {
    try {
      return await this.getDevice(features);
    } catch (error) {
      console.error('[WebGPU] Failed to acquire device', error);
      return null;
    }
  }

  destroy(): void {
    this.device = null;
    this.adapter = null;
    this.onLostCallbacks.clear();
  }
}
