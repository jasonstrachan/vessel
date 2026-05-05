import { debugWarn } from '@/utils/debug';
import type { Layer, Project } from '@/types';
import { getColorCycleBrushManager, getColorCycleStoreState } from '@/stores/colorCycleBrushManager';

const colorCycleBrushManager = getColorCycleBrushManager();

const resolveLayerBrush = (layerId: string) =>
  getColorCycleStoreState()?.getLayerColorCycleBrush?.(layerId) ??
  colorCycleBrushManager.getLayerColorCycleBrush(layerId);

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
  colorCycleGradientIds?: Uint8Array;
  colorCycleGradientDefIds?: Uint16Array;
  colorCycleSpeed?: Uint8Array;
  colorCycleFlow?: Uint8Array;
  colorCyclePhase?: Uint8Array;
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

const copyScalarRegion16 = (
  source: Uint16Array,
  sourceWidth: number,
  sourceHeight: number,
  rect: NormalizedRect
): Uint16Array => {
  const destination = new Uint16Array(rect.width * rect.height);
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

  const brush = resolveLayerBrush(layer.id);
  const snapshot = brush?.getLayerSnapshot?.(layer.id);

  const canvas =
    layer.colorCycleData?.canvas ??
    (typeof brush?.getCanvas === 'function' ? brush.getCanvas() : null);
  const canvasWidth = canvas?.width ?? layer.imageData?.width ?? 0;
  const canvasHeight = canvas?.height ?? layer.imageData?.height ?? 0;
  if (!canvasWidth || !canvasHeight) {
    if (process.env.NODE_ENV !== 'production') {
      debugWarn('raw-console', '[cc] invalid canvas size in captureColorCycleIndices', {
        layerId: layer.id,
        canvasWidth,
        canvasHeight,
      });
    }
    return undefined;
  }

  const persistedBuffer = layer.colorCycleData?.gradientIdBuffer ?? null;
  const incoming =
    snapshot?.paintBuffer && snapshot.paintBuffer.byteLength > 0
      ? new Uint8Array(snapshot.paintBuffer)
      : persistedBuffer
        ? new Uint8Array(persistedBuffer)
        : null;

  if (!incoming) {
    if (process.env.NODE_ENV !== 'production') {
      debugWarn('raw-console', '[cc] no paint source for captureColorCycleIndices', {
        layerId: layer.id,
        hasSnapshot: Boolean(snapshot?.paintBuffer),
        hasPersistedBuffer: Boolean(persistedBuffer),
      });
    }
    return undefined;
  }

  if (incoming.length !== canvasWidth * canvasHeight) {
    if (process.env.NODE_ENV !== 'production') {
      debugWarn('raw-console', '[cc] paintBuffer/canvas mismatch in captureColorCycleIndices', {
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

const captureColorCycleSnapshotScalar = (
  layer: Layer,
  rect: NormalizedRect,
  field: 'gradientIdBuffer' | 'speedBuffer' | 'flowBuffer' | 'phaseBuffer'
): Uint8Array | undefined => {
  if (layer.layerType !== 'color-cycle') {
    return undefined;
  }

  const brush = resolveLayerBrush(layer.id);
  const snapshot = brush?.getLayerSnapshot?.(layer.id);
  const canvas =
    layer.colorCycleData?.canvas ??
    (typeof brush?.getCanvas === 'function' ? brush.getCanvas() : null);
  const canvasWidth = canvas?.width ?? layer.imageData?.width ?? 0;
  const canvasHeight = canvas?.height ?? layer.imageData?.height ?? 0;
  const sourceBuffer = snapshot?.[field];
  if (!canvasWidth || !canvasHeight || !sourceBuffer) {
    return undefined;
  }

  const source = new Uint8Array(sourceBuffer);
  if (source.length !== canvasWidth * canvasHeight) {
    return undefined;
  }

  return copyScalarRegion(source, canvasWidth, canvasHeight, rect);
};

const captureColorCycleGradientDefIds = (
  layer: Layer,
  rect: NormalizedRect
): Uint16Array | undefined => {
  if (layer.layerType !== 'color-cycle') {
    return undefined;
  }

  const brush = resolveLayerBrush(layer.id);
  const snapshot = brush?.getLayerSnapshot?.(layer.id);
  const canvas =
    layer.colorCycleData?.canvas ??
    (typeof brush?.getCanvas === 'function' ? brush.getCanvas() : null);
  const canvasWidth = canvas?.width ?? layer.imageData?.width ?? 0;
  const canvasHeight = canvas?.height ?? layer.imageData?.height ?? 0;

  const sourceBuffer = snapshot?.gradientDefIdBuffer ?? layer.colorCycleData?.gradientDefIdBuffer;
  if (!canvasWidth || !canvasHeight || !sourceBuffer) {
    return undefined;
  }

  const source = new Uint16Array(sourceBuffer);
  if (source.length !== canvasWidth * canvasHeight) {
    return undefined;
  }

  return copyScalarRegion16(source, canvasWidth, canvasHeight, rect);
};

export const resolveLayerImageData = (layer: Layer | null): ImageData | null => {
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
  const colorCycleGradientIds =
    layer.layerType === 'color-cycle'
      ? captureColorCycleSnapshotScalar(layer, {
          x: clampedMinX,
          y: clampedMinY,
          width: safeWidth,
          height: safeHeight,
        }, 'gradientIdBuffer')
      : undefined;
  const colorCycleGradientDefIds =
    layer.layerType === 'color-cycle'
      ? captureColorCycleGradientDefIds(layer, {
          x: clampedMinX,
          y: clampedMinY,
          width: safeWidth,
          height: safeHeight,
        })
      : undefined;
  const colorCycleSpeed =
    layer.layerType === 'color-cycle'
      ? captureColorCycleSnapshotScalar(layer, {
          x: clampedMinX,
          y: clampedMinY,
          width: safeWidth,
          height: safeHeight,
        }, 'speedBuffer')
      : undefined;
  const colorCycleFlow =
    layer.layerType === 'color-cycle'
      ? captureColorCycleSnapshotScalar(layer, {
          x: clampedMinX,
          y: clampedMinY,
          width: safeWidth,
          height: safeHeight,
        }, 'flowBuffer')
      : undefined;
  const colorCyclePhase =
    layer.layerType === 'color-cycle'
      ? captureColorCycleSnapshotScalar(layer, {
          x: clampedMinX,
          y: clampedMinY,
          width: safeWidth,
          height: safeHeight,
        }, 'phaseBuffer')
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
    colorCycleIndices,
    colorCycleGradientIds,
    colorCycleGradientDefIds,
    colorCycleSpeed,
    colorCycleFlow,
    colorCyclePhase,
  };
};

export interface SelectionMaskCaptureRequest {
  mask: ImageData;
  maskBounds: { x: number; y: number; width: number; height: number };
  project: Project | null;
  layer: Layer | null;
  clearSource?: boolean;
}

export const captureSelectionBitmapFromMask = (
  request: SelectionMaskCaptureRequest
): SelectionCaptureResult | null => {
  const { mask, maskBounds, project, layer, clearSource = false } = request;
  if (!project || !layer) return null;
  const layerImageData = resolveLayerImageData(layer);
  if (!layerImageData) return null;

  const { x, y, width, height } = maskBounds;
  const layerWidth = layerImageData.width;
  const layerHeight = layerImageData.height;

  // Clamp mask bounds to project and layer
  const clampedX = Math.max(0, Math.min(project.width, x));
  const clampedY = Math.max(0, Math.min(project.height, y));
  const maxWidth = Math.min(
    width,
    project.width - clampedX,
    layerWidth - clampedX
  );
  const maxHeight = Math.min(
    height,
    project.height - clampedY,
    layerHeight - clampedY
  );

  const safeWidth = Math.max(0, Math.min(maxWidth, mask.width));
  const safeHeight = Math.max(0, Math.min(maxHeight, mask.height));

  if (safeWidth <= 0 || safeHeight <= 0) {
    return null;
  }

  const selectionBuffer = new Uint8ClampedArray(safeWidth * safeHeight * 4);
  const selectionMaskAlpha = new Uint8Array(safeWidth * safeHeight);
  const updatedLayerBuffer = clearSource ? new Uint8ClampedArray(layerImageData.data) : null;

  for (let sy = 0; sy < safeHeight; sy += 1) {
    const globalY = clampedY + sy;
    const maskRow = sy * mask.width;
    for (let sx = 0; sx < safeWidth; sx += 1) {
      const globalX = clampedX + sx;
      const maskAlpha = mask.data[(maskRow + sx) * 4 + 3];
      if (maskAlpha === 0) {
        continue;
      }

      const srcIndex = (globalY * layerWidth + globalX) * 4;
      const destIndex = (sy * safeWidth + sx) * 4;
      selectionMaskAlpha[sy * safeWidth + sx] = maskAlpha;

      selectionBuffer[destIndex] = layerImageData.data[srcIndex];
      selectionBuffer[destIndex + 1] = layerImageData.data[srcIndex + 1];
      selectionBuffer[destIndex + 2] = layerImageData.data[srcIndex + 2];
      // Preserve source alpha scaled by mask alpha to respect feathered masks.
      selectionBuffer[destIndex + 3] = Math.round(
        (layerImageData.data[srcIndex + 3] * maskAlpha) / 255
      );

      if (updatedLayerBuffer) {
        updatedLayerBuffer[srcIndex] = 0;
        updatedLayerBuffer[srcIndex + 1] = 0;
        updatedLayerBuffer[srcIndex + 2] = 0;
        updatedLayerBuffer[srcIndex + 3] = 0;
      }
    }
  }

  const selectionImageData = new ImageData(selectionBuffer, safeWidth, safeHeight);
  const updatedLayerImageData = updatedLayerBuffer
    ? new ImageData(updatedLayerBuffer, layerWidth, layerHeight)
    : undefined;

  let colorCycleIndices: Uint8Array | undefined;
  let colorCycleGradientIds: Uint8Array | undefined;
  let colorCycleGradientDefIds: Uint16Array | undefined;
  let colorCycleSpeed: Uint8Array | undefined;
  let colorCycleFlow: Uint8Array | undefined;
  let colorCyclePhase: Uint8Array | undefined;
  if (layer.layerType === 'color-cycle') {
    const indices = captureColorCycleIndices(layer, {
      x: clampedX,
      y: clampedY,
      width: safeWidth,
      height: safeHeight,
    });
    const gradientIds = captureColorCycleSnapshotScalar(layer, {
      x: clampedX,
      y: clampedY,
      width: safeWidth,
      height: safeHeight,
    }, 'gradientIdBuffer');
    const gradientDefIds = captureColorCycleGradientDefIds(layer, {
      x: clampedX,
      y: clampedY,
      width: safeWidth,
      height: safeHeight,
    });
    const shouldRetainColorCycleSample = (index: number): boolean => (
      selectionMaskAlpha[index] > 0 &&
      (
        selectionBuffer[(index * 4) + 3] > 0 ||
        (indices?.[index] ?? 0) !== 0 ||
        (gradientIds?.[index] ?? 0) !== 0 ||
        (gradientDefIds?.[index] ?? 0) !== 0
      )
    );
    if (indices) {
      colorCycleIndices = new Uint8Array(indices.length);
      for (let i = 0; i < indices.length; i += 1) {
        colorCycleIndices[i] = shouldRetainColorCycleSample(i) ? indices[i] : 0;
      }
    }

    if (gradientIds) {
      colorCycleGradientIds = new Uint8Array(gradientIds.length);
      for (let i = 0; i < gradientIds.length; i += 1) {
        colorCycleGradientIds[i] = shouldRetainColorCycleSample(i) ? gradientIds[i] : 0;
      }
    }

    if (gradientDefIds) {
      colorCycleGradientDefIds = new Uint16Array(gradientDefIds.length);
      for (let i = 0; i < gradientDefIds.length; i += 1) {
        colorCycleGradientDefIds[i] = shouldRetainColorCycleSample(i) ? gradientDefIds[i] : 0;
      }
    }

    const speed = captureColorCycleSnapshotScalar(layer, {
      x: clampedX,
      y: clampedY,
      width: safeWidth,
      height: safeHeight,
    }, 'speedBuffer');
    if (speed) {
      colorCycleSpeed = new Uint8Array(speed.length);
      for (let i = 0; i < speed.length; i += 1) {
        colorCycleSpeed[i] = shouldRetainColorCycleSample(i) ? speed[i] : 0;
      }
    }

    const flow = captureColorCycleSnapshotScalar(layer, {
      x: clampedX,
      y: clampedY,
      width: safeWidth,
      height: safeHeight,
    }, 'flowBuffer');
    if (flow) {
      colorCycleFlow = new Uint8Array(flow.length);
      for (let i = 0; i < flow.length; i += 1) {
        colorCycleFlow[i] = shouldRetainColorCycleSample(i) ? flow[i] : 0;
      }
    }

    const phase = captureColorCycleSnapshotScalar(layer, {
      x: clampedX,
      y: clampedY,
      width: safeWidth,
      height: safeHeight,
    }, 'phaseBuffer');
    if (phase) {
      colorCyclePhase = new Uint8Array(phase.length);
      for (let i = 0; i < phase.length; i += 1) {
        colorCyclePhase[i] = shouldRetainColorCycleSample(i) ? phase[i] : 0;
      }
    }
  }

  return {
    bounds: {
      x: clampedX,
      y: clampedY,
      width: safeWidth,
      height: safeHeight,
    },
    selectionImageData,
    updatedLayerImageData,
    colorCycleIndices,
    colorCycleGradientIds,
    colorCycleGradientDefIds,
    colorCycleSpeed,
    colorCycleFlow,
    colorCyclePhase,
  };
};
