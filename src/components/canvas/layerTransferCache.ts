import type { Layer } from '@/types';

export interface LayerTransferCacheEntry {
  canvas: HTMLCanvasElement | OffscreenCanvas;
  version: number | null;
  width: number;
  height: number;
  imageDataRef: ImageData | null;
}

type TransferCanvas = HTMLCanvasElement | OffscreenCanvas;

const createTransferCanvas = (width: number, height: number): TransferCanvas | null => {
  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    return canvas;
  }
  if (typeof OffscreenCanvas !== 'undefined') {
    return new OffscreenCanvas(width, height);
  }
  return null;
};

const getTransferContext = (canvas: TransferCanvas) =>
  canvas.getContext(
    '2d',
    { willReadFrequently: true } as CanvasRenderingContext2DSettings
  ) as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;

export const getLayerTransferCanvas = (
  layer: Layer,
  cache: Map<string, LayerTransferCacheEntry>
): TransferCanvas | null => {
  const imageData = layer.imageData;
  if (!imageData) {
    return null;
  }

  let entry = cache.get(layer.id) ?? null;
  if (!entry) {
    const canvas = createTransferCanvas(imageData.width, imageData.height);
    if (!canvas) {
      return null;
    }
    entry = {
      canvas,
      version: null,
      width: imageData.width,
      height: imageData.height,
      imageDataRef: null,
    };
    cache.set(layer.id, entry);
  }

  if (entry.canvas.width !== imageData.width || entry.canvas.height !== imageData.height) {
    entry.canvas.width = imageData.width;
    entry.canvas.height = imageData.height;
    entry.width = imageData.width;
    entry.height = imageData.height;
    entry.version = null;
    entry.imageDataRef = null;
  }

  const layerVersion = layer.version ?? null;
  const needsUpload =
    entry.version !== layerVersion || entry.imageDataRef !== imageData;

  if (needsUpload) {
    const transferCtx = getTransferContext(entry.canvas);
    if (!transferCtx) {
      return null;
    }
    transferCtx.clearRect(0, 0, entry.canvas.width, entry.canvas.height);
    transferCtx.putImageData(imageData, 0, 0);
    entry.version = layerVersion;
    entry.imageDataRef = imageData;
  }

  return entry.canvas;
};
