import type { Layer, Project } from '@/types';

type SelectionPoint = { x: number; y: number };

export interface SelectionCaptureRequest {
  selectionStart: SelectionPoint | null;
  selectionEnd: SelectionPoint | null;
  project: Project | null;
  layer: Layer | null;
  clearSource?: boolean;
}

export interface SelectionCaptureResult {
  bounds: { x: number; y: number; width: number; height: number };
  selectionImageData: ImageData;
  updatedLayerImageData?: ImageData;
}

const resolveLayerImageData = (layer: Layer | null): ImageData | null => {
  if (!layer) {
    return null;
  }

  if (layer.imageData) {
    return layer.imageData;
  }

  if (typeof document === 'undefined' || !layer.framebuffer) {
    return null;
  }

  try {
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = layer.framebuffer.width;
    tempCanvas.height = layer.framebuffer.height;
    const tempCtx = tempCanvas.getContext('2d', { willReadFrequently: true });
    if (!tempCtx) {
      return null;
    }
    tempCtx.drawImage(layer.framebuffer, 0, 0);
    return tempCtx.getImageData(0, 0, tempCanvas.width, tempCanvas.height);
  } catch {
    return null;
  }
};

export const captureSelectionBitmap = (
  request: SelectionCaptureRequest
): SelectionCaptureResult | null => {
  const { selectionStart, selectionEnd, project, layer, clearSource = false } = request;

  if (!selectionStart || !selectionEnd || !project || !layer) {
    return null;
  }

  const layerImageData = resolveLayerImageData(layer);
  if (!layerImageData) {
    return null;
  }

  const rawMinX = Math.min(selectionStart.x, selectionEnd.x);
  const rawMinY = Math.min(selectionStart.y, selectionEnd.y);
  const rawMaxX = Math.max(selectionStart.x, selectionEnd.x);
  const rawMaxY = Math.max(selectionStart.y, selectionEnd.y);

  const clampedMinX = Math.max(0, Math.min(project.width, Math.floor(rawMinX)));
  const clampedMinY = Math.max(0, Math.min(project.height, Math.floor(rawMinY)));
  const clampedMaxX = Math.max(0, Math.min(project.width, Math.ceil(rawMaxX)));
  const clampedMaxY = Math.max(0, Math.min(project.height, Math.ceil(rawMaxY)));

  const boundsWidth = clampedMaxX - clampedMinX;
  const boundsHeight = clampedMaxY - clampedMinY;

  if (boundsWidth <= 0 || boundsHeight <= 0) {
    return null;
  }

  const safeWidth = Math.min(boundsWidth, layerImageData.width - clampedMinX);
  const safeHeight = Math.min(boundsHeight, layerImageData.height - clampedMinY);

  if (safeWidth <= 0 || safeHeight <= 0) {
    return null;
  }

  const selectionBuffer = new Uint8ClampedArray(safeWidth * safeHeight * 4);
  const updatedLayerBuffer = clearSource ? new Uint8ClampedArray(layerImageData.data) : null;

  for (let y = 0; y < safeHeight; y += 1) {
    const sourceY = clampedMinY + y;
    if (sourceY < 0 || sourceY >= layerImageData.height) {
      continue;
    }

    for (let x = 0; x < safeWidth; x += 1) {
      const sourceX = clampedMinX + x;
      if (sourceX < 0 || sourceX >= layerImageData.width) {
        continue;
      }

      const sourceIndex = (sourceY * layerImageData.width + sourceX) * 4;
      const destIndex = (y * safeWidth + x) * 4;

      selectionBuffer[destIndex] = layerImageData.data[sourceIndex];
      selectionBuffer[destIndex + 1] = layerImageData.data[sourceIndex + 1];
      selectionBuffer[destIndex + 2] = layerImageData.data[sourceIndex + 2];
      selectionBuffer[destIndex + 3] = layerImageData.data[sourceIndex + 3];

      if (updatedLayerBuffer) {
        updatedLayerBuffer[sourceIndex] = 0;
        updatedLayerBuffer[sourceIndex + 1] = 0;
        updatedLayerBuffer[sourceIndex + 2] = 0;
        updatedLayerBuffer[sourceIndex + 3] = 0;
      }
    }
  }

  const selectionImageData = new ImageData(selectionBuffer, safeWidth, safeHeight);
  const updatedLayerImageData = updatedLayerBuffer
    ? new ImageData(updatedLayerBuffer, layerImageData.width, layerImageData.height)
    : undefined;

  return {
    bounds: {
      x: clampedMinX,
      y: clampedMinY,
      width: safeWidth,
      height: safeHeight,
    },
    selectionImageData,
    updatedLayerImageData,
  };
};
