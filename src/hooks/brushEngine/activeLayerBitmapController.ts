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
