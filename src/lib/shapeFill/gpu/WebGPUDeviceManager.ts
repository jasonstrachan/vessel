const WEBGPU_UNSUPPORTED_ERROR = 'WebGPU is not available in this environment';

type DeviceLostCallback = (info: GPUDeviceLostInfo) => void;

export type WebGPUSupportStatus =
  | { status: 'unknown' }
  | { status: 'available'; adapterName?: string }
  | { status: 'unavailable'; reason: string; recoverable: boolean; detail?: unknown };

declare global {
  interface Navigator {
    gpu?: GPU;
  }
}

const supportListeners = new Set<(status: WebGPUSupportStatus) => void>();

const notifySupportListeners = (status: WebGPUSupportStatus): void => {
  for (const listener of supportListeners) {
    listener(status);
  }
};

let supportStatus: WebGPUSupportStatus = { status: 'unknown' };

const setSupportStatus = (next: WebGPUSupportStatus): void => {
  if (supportStatus.status === next.status) {
    if (supportStatus.status === 'available' && next.status === 'available') {
      if (supportStatus.adapterName === next.adapterName) {
        return;
      }
    }
    if (supportStatus.status === 'unavailable' && next.status === 'unavailable') {
      if (
        supportStatus.reason === next.reason &&
        supportStatus.recoverable === next.recoverable
      ) {
        return;
      }
    }
    if (supportStatus.status === 'unknown' && next.status === 'unknown') {
      return;
    }
  }
  supportStatus = next;
  notifySupportListeners({ ...supportStatus });
};

const markNavigatorUnavailable = (): void => {
  setSupportStatus({
    status: 'unavailable',
    reason: 'Navigator WebGPU interface is not available',
    recoverable: true,
  });
};

const hasNavigatorWebGPU = (): boolean => typeof navigator !== 'undefined' && Boolean(navigator.gpu);

const ensureNavigatorAvailability = (): boolean => {
  if (!hasNavigatorWebGPU()) {
    markNavigatorUnavailable();
    return false;
  }

  if (supportStatus.status === 'unavailable' && supportStatus.recoverable) {
    setSupportStatus({ status: 'unknown' });
  }

  return true;
};

export const isWebGPUSupported = (): boolean => ensureNavigatorAvailability() && supportStatus.status !== 'unavailable';

export const getWebGPUSupportStatus = (): WebGPUSupportStatus => ({ ...supportStatus });

export const onWebGPUSupportChange = (
  listener: (status: WebGPUSupportStatus) => void,
): (() => void) => {
  supportListeners.add(listener);
  listener({ ...supportStatus });
  return () => supportListeners.delete(listener);
};

export const resetWebGPUSupportStatusForTesting = (): void => {
  if (process.env.NODE_ENV !== 'test') {
    return;
  }
  if (hasNavigatorWebGPU()) {
    setSupportStatus({ status: 'unknown' });
  } else {
    markNavigatorUnavailable();
  }
};

export class WebGPUDeviceManager {
  private static instance: WebGPUDeviceManager | null = null;

  private adapter: GPUAdapter | null = null;

  private device: GPUDevice | null = null;

  private onLostCallbacks: Set<DeviceLostCallback> = new Set();

  private deviceGeneration = 0;

  private markUnavailable(reason: string, recoverable = false, detail?: unknown): void {
    this.device = null;
    this.adapter = null;
    this.deviceGeneration += 1;
    setSupportStatus({ status: 'unavailable', reason, recoverable, detail });
  }

  private markAvailable(adapter: GPUAdapter): void {
    const adapterName = (adapter as GPUAdapter & { name?: string }).name;
    setSupportStatus({ status: 'available', adapterName });
  }

  private constructor() {}

  static getInstance(): WebGPUDeviceManager {
    if (!WebGPUDeviceManager.instance) {
      WebGPUDeviceManager.instance = new WebGPUDeviceManager();
    }
    return WebGPUDeviceManager.instance;
  }

  async getAdapter(): Promise<GPUAdapter> {
    if (!ensureNavigatorAvailability()) {
      throw new Error(WEBGPU_UNSUPPORTED_ERROR);
    }

    if (this.adapter) {
      return this.adapter;
    }

    let adapter: GPUAdapter | null = null;
    try {
      adapter = await navigator.gpu!.requestAdapter({
        powerPreference: 'high-performance',
      });
    } catch (error) {
      this.markUnavailable('Failed to request WebGPU adapter', false, error);
      throw error;
    }

    if (!adapter) {
      this.markUnavailable('Unable to acquire WebGPU adapter', false);
      throw new Error('Unable to acquire WebGPU adapter');
    }

    this.markAvailable(adapter);
    this.adapter = adapter;
    return adapter;
  }

  async getDevice(features: GPUFeatureName[] = []): Promise<GPUDevice> {
    if (this.device) {
      return this.device;
    }

    const adapter = await this.getAdapter();
    const supportedFeatures = features.filter(feature => adapter.features.has(feature));

    try {
      this.device = await adapter.requestDevice({
        requiredFeatures: supportedFeatures,
      });
    } catch (error) {
      this.markUnavailable('Failed to request WebGPU device', false, error);
      throw error;
    }

    this.deviceGeneration += 1;

    this.device.addEventListener('uncapturederror', event => {
      console.error('[WebGPU] Uncaptured device error', event.error);
    });

    void this.device.lost.then(info => {
      this.markUnavailable(`WebGPU device lost (${info.reason})`, false, info);
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
      if (supportStatus.status !== 'unavailable') {
        this.markUnavailable('WebGPU device acquisition failed', false, error);
      }
      return null;
    }
  }

  destroy(): void {
    this.device = null;
    this.adapter = null;
    this.onLostCallbacks.clear();
    this.deviceGeneration += 1;
    if (supportStatus.status === 'available') {
      setSupportStatus({ status: 'unknown' });
    }
  }

  getDeviceGeneration(): number {
    return this.deviceGeneration;
  }
}
