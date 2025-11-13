export type ColorCycleWorkerSupport = {
  supported: boolean;
  reason?: string;
};

let cachedSupport: ColorCycleWorkerSupport | null = null;

const evaluateSupport = (): ColorCycleWorkerSupport => {
  if (typeof window === 'undefined') {
    return { supported: false, reason: 'window-unavailable' };
  }

  if (typeof Worker === 'undefined') {
    return { supported: false, reason: 'worker-unavailable' };
  }

  const hasOffscreenCanvas = typeof OffscreenCanvas !== 'undefined';
  if (!hasOffscreenCanvas) {
    return { supported: false, reason: 'offscreen-canvas-unavailable' };
  }

  const hasImageBitmap = typeof window.createImageBitmap === 'function';
  if (!hasImageBitmap) {
    return { supported: false, reason: 'createImageBitmap-unavailable' };
  }

  if (typeof document === 'undefined') {
    return { supported: false, reason: 'document-unavailable' };
  }

  const canvas = document.createElement('canvas');
  const canTransfer = typeof canvas.transferControlToOffscreen === 'function';
  if (!canTransfer) {
    return { supported: false, reason: 'transfer-control-unavailable' };
  }

  return { supported: true };
};

export const detectColorCycleWorkerSupport = (forceRefresh = false): ColorCycleWorkerSupport => {
  if (!forceRefresh && cachedSupport) {
    return cachedSupport;
  }
  cachedSupport = evaluateSupport();
  return cachedSupport;
};

export const supportsColorCycleWorker = (forceRefresh = false): boolean => {
  return detectColorCycleWorkerSupport(forceRefresh).supported;
};
