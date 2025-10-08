export const SHAPE_FILL_GPU_RETIRED_REASON = 'Shape fill GPU runtime retired';

export type WebGPUSupportStatus =
  | { status: 'unknown' }
  | { status: 'available'; adapterName?: string }
  | { status: 'unavailable'; reason: string; recoverable: boolean; detail?: unknown };

const RETIRED_STATUS: WebGPUSupportStatus = {
  status: 'unavailable',
  reason: SHAPE_FILL_GPU_RETIRED_REASON,
  recoverable: false,
};

export const isWebGPUSupported = (): boolean => false;

export const getWebGPUSupportStatus = (): WebGPUSupportStatus => ({ ...RETIRED_STATUS });

export const onWebGPUSupportChange = (
  listener: (status: WebGPUSupportStatus) => void,
): (() => void) => {
  listener({ ...RETIRED_STATUS });
  return () => {};
};

export const resetWebGPUSupportStatusForTesting = (): void => {
  // No-op: GPU support is permanently retired.
};

export class WebGPUDeviceManager {
  private static instance: WebGPUDeviceManager | null = null;

  static getInstance(): WebGPUDeviceManager {
    if (!WebGPUDeviceManager.instance) {
      WebGPUDeviceManager.instance = new WebGPUDeviceManager();
    }
    return WebGPUDeviceManager.instance;
  }

  async getAdapter(): Promise<never> {
    throw new Error(SHAPE_FILL_GPU_RETIRED_REASON);
  }

  async getDevice(): Promise<never> {
    throw new Error(SHAPE_FILL_GPU_RETIRED_REASON);
  }

  async ensureDevice(): Promise<GPUDevice | null> {
    return null;
  }

  onDeviceLost(): () => void {
    return () => {};
  }

  dispose(): void {
    // No-op
  }
}
