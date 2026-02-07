type LayerLike = {
  id: string;
  layerType?: string;
  framebuffer?: HTMLCanvasElement | OffscreenCanvas | null;
  colorCycleData?: {
    canvas?: HTMLCanvasElement | OffscreenCanvas | null;
  };
};

type StoreLike = {
  activeLayerId: string | null;
  layers: LayerLike[];
  getLayerColorCycleBrush?: (layerId: string) => {
    getCanvas?: () => HTMLCanvasElement | OffscreenCanvas | null;
    getPaintBuffer?: () => HTMLCanvasElement | OffscreenCanvas | null;
  } | null;
};

const setMaskSourceDebug = (value: string) => {
  if (typeof window !== 'undefined') {
    window.__AL_maskSrc = value;
  }
};

export const getActiveLayerBitmapCanvas = ({
  getState,
}: {
  getState: () => StoreLike;
}): HTMLCanvasElement | OffscreenCanvas | null => {
  const state = getState();
  const layer = state.layers.find((entry) => entry.id === state.activeLayerId);
  if (!layer) {
    return null;
  }

  if (layer.layerType === 'color-cycle') {
    const ccCanvas = layer.colorCycleData?.canvas;
    if (ccCanvas && typeof ccCanvas.getContext === 'function') {
      setMaskSourceDebug('ccCanvas');
      return ccCanvas as HTMLCanvasElement | OffscreenCanvas;
    }

    const brush = typeof state.getLayerColorCycleBrush === 'function'
      ? state.getLayerColorCycleBrush(layer.id)
      : null;

    const internalCanvas = brush?.getCanvas?.();
    if (internalCanvas && typeof internalCanvas.getContext === 'function') {
      setMaskSourceDebug('ccInternal');
      return internalCanvas as HTMLCanvasElement | OffscreenCanvas;
    }

    const paintBuffer = brush?.getPaintBuffer?.();
    if (paintBuffer && typeof paintBuffer.getContext === 'function') {
      setMaskSourceDebug('ccPaintBuffer');
      return paintBuffer as HTMLCanvasElement | OffscreenCanvas;
    }

    setMaskSourceDebug('null-cc');
    return null;
  }

  const framebuffer = layer.framebuffer;
  if (framebuffer && typeof framebuffer.getContext === 'function') {
    setMaskSourceDebug('framebuffer');
    return framebuffer as HTMLCanvasElement | OffscreenCanvas;
  }

  setMaskSourceDebug('null-bitmap');
  return null;
};

