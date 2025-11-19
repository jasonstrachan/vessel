import type { Layer, Project } from '@/types';
import { getColorCycleBrushManager } from '@/stores/colorCycleBrushManager';

const colorCycleBrushManager = getColorCycleBrushManager();

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
  colorCycleIndices?: Uint8Array;
}

type NormalizedRect = { x: number; y: number; width: number; height: number };

export const copyScalarRegion = (
  source: Uint8Array,
  sourceWidth: number,
  sourceHeight: number,
  rect: NormalizedRect
): Uint8Array => {
  const destination = new Uint8Array(rect.width * rect.height);
  if (rect.width <= 0 || rect.height <= 0) {
    return destination;
  }

  const startX = Math.max(0, Math.min(sourceWidth, rect.x));
  const startY = Math.max(0, Math.min(sourceHeight, rect.y));
  const endX = Math.max(0, Math.min(sourceWidth, rect.x + rect.width));
  const endY = Math.max(0, Math.min(sourceHeight, rect.y + rect.height));
  const safeWidth = Math.max(0, endX - startX);
  const safeHeight = Math.max(0, endY - startY);

  for (let row = 0; row < safeHeight; row += 1) {
    const srcRow = startY + row;
    if (srcRow < 0 || srcRow >= sourceHeight) {
      continue;
    }
    const destRow = row;
    for (let col = 0; col < safeWidth; col += 1) {
      const srcCol = startX + col;
      if (srcCol < 0 || srcCol >= sourceWidth) {
        continue;
      }
      const destCol = col;
      const destIndex = destRow * rect.width + destCol;
      const srcIndex = srcRow * sourceWidth + srcCol;
      destination[destIndex] = source[srcIndex];
    }
  }

  return destination;
};

const captureColorCycleIndices = (
  layer: Layer,
  rect: NormalizedRect
): Uint8Array | undefined => {
  if (layer.layerType !== 'color-cycle') {
    return undefined;
  }

  const brush = colorCycleBrushManager.getLayerColorCycleBrush(layer.id);
  if (!brush?.getLayerSnapshot) {
    if (process.env.NODE_ENV !== 'production') {
      console.warn('[cc] no brush snapshot API in captureColorCycleIndices', {
        layerId: layer.id,
      });
    }
    return undefined;
  }
  const snapshot = brush.getLayerSnapshot(layer.id);
  if (!snapshot?.paintBuffer) {
    if (process.env.NODE_ENV !== 'production') {
      console.warn('[cc] no paintBuffer for layer snapshot in captureColorCycleIndices', {
        layerId: layer.id,
      });
    }
    return undefined;
  }

  const canvas =
    layer.colorCycleData?.canvas ??
    (typeof brush.getCanvas === 'function' ? brush.getCanvas() : null);
  const canvasWidth = canvas?.width ?? layer.imageData?.width ?? 0;
  const canvasHeight = canvas?.height ?? layer.imageData?.height ?? 0;
  if (!canvasWidth || !canvasHeight) {
    if (process.env.NODE_ENV !== 'production') {
      console.warn('[cc] invalid canvas size in captureColorCycleIndices', {
        layerId: layer.id,
        canvasWidth,
        canvasHeight,
      });
    }
    return undefined;
  }

  const incoming = new Uint8Array(snapshot.paintBuffer);
  if (incoming.length !== canvasWidth * canvasHeight) {
    if (process.env.NODE_ENV !== 'production') {
      console.warn('[cc] paintBuffer/canvas mismatch in captureColorCycleIndices', {
        layerId: layer.id,
        incoming: incoming.length,
        canvasWidth,
        canvasHeight,
      });
    }
    return undefined;
  }

  return copyScalarRegion(incoming, canvasWidth, canvasHeight, rect);
};

const resolveLayerImageData = (layer: Layer | null): ImageData | null => {
  if (!layer) {
    return null;
  }

  // Prefer live color-cycle canvas when present so selections include animated content.
  if (layer.layerType === 'color-cycle' && layer.colorCycleData?.canvas) {
    try {
      const source = layer.colorCycleData.canvas;
      const tempCanvas = document.createElement('canvas');
      tempCanvas.width = source.width;
      tempCanvas.height = source.height;
      const tempCtx = tempCanvas.getContext('2d', { willReadFrequently: true });
      if (tempCtx) {
        tempCtx.drawImage(source, 0, 0);
        return tempCtx.getImageData(0, 0, tempCanvas.width, tempCanvas.height);
      }
    } catch {
      // Fallback to other sources below.
    }
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
  const colorCycleIndices =
    layer.layerType === 'color-cycle'
      ? captureColorCycleIndices(layer, {
          x: clampedMinX,
          y: clampedMinY,
          width: safeWidth,
          height: safeHeight,
        })
      : undefined;

  if (process.env.NODE_ENV !== 'production' && layer.layerType === 'color-cycle') {
    console.log('[selectionCapture] CC bounds', {
      layerId: layer.id,
      bounds: {
        x: clampedMinX,
        y: clampedMinY,
        width: safeWidth,
        height: safeHeight,
      },
      indicesLen: colorCycleIndices?.length ?? 0,
    });
  }

  return {
    bounds: {
      x: clampedMinX,
      y: clampedMinY,
      width: safeWidth,
      height: safeHeight,
    },
    selectionImageData,
    updatedLayerImageData,
    colorCycleIndices,
  };
};
