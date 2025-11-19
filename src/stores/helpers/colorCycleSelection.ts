import { getColorCycleBrushManager } from '@/stores/colorCycleBrushManager';
import { copyScalarRegion } from '@/stores/helpers/selectionCapture';
import type { Layer, Project, Rectangle } from '@/types';
import type { AppState } from '@/stores/useAppStore';

const colorCycleBrushManager = getColorCycleBrushManager();

type BufferMutator = (buffer: Uint8Array, width: number, height: number) => boolean;

const getCanvasForLayer = (layer: Layer, fallbackWidth: number, fallbackHeight: number) => {
  if (layer.colorCycleData?.canvas) {
    return layer.colorCycleData.canvas;
  }
  const brush = colorCycleBrushManager.getLayerColorCycleBrush(layer.id);
  if (brush && typeof brush.getCanvas === 'function') {
    const brushCanvas = brush.getCanvas();
    if (brushCanvas) {
      return brushCanvas;
    }
  }
  if (typeof document === 'undefined') {
    return null;
  }
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, fallbackWidth);
  canvas.height = Math.max(1, fallbackHeight);
  return canvas;
};

const mutateColorCycleLayer = (
  state: AppState,
  layer: Layer,
  project: Project,
  mutator: BufferMutator
): boolean => {
  if (layer.layerType !== 'color-cycle') {
    return false;
  }

  const brush = colorCycleBrushManager.getLayerColorCycleBrush(layer.id);
  if (!brush?.getLayerSnapshot || !brush.applyLayerSnapshot) {
    return false;
  }

  const snapshot = brush.getLayerSnapshot(layer.id);
  if (!snapshot) {
    if (process.env.NODE_ENV !== 'production') {
      console.warn('[cc] no snapshot in mutateColorCycleLayer', { layerId: layer.id });
    }
    return false;
  }

  const fallbackWidth = layer.imageData?.width ?? project.width ?? 0;
  const fallbackHeight = layer.imageData?.height ?? project.height ?? 0;
  const canvas = getCanvasForLayer(layer, fallbackWidth, fallbackHeight);
  if (!canvas?.width || !canvas.height) {
    if (process.env.NODE_ENV !== 'production') {
      console.warn('[cc] invalid canvas in mutateColorCycleLayer', {
        layerId: layer.id,
        canvasWidth: canvas?.width,
        canvasHeight: canvas?.height,
      });
    }
    return false;
  }

  const bufferLength = canvas.width * canvas.height;
  if (bufferLength <= 0) {
    if (process.env.NODE_ENV !== 'production') {
      console.warn('[cc] zero bufferLength in mutateColorCycleLayer', {
        layerId: layer.id,
        canvasWidth: canvas.width,
        canvasHeight: canvas.height,
      });
    }
    return false;
  }

  const incoming = snapshot.paintBuffer ? new Uint8Array(snapshot.paintBuffer) : null;
  if (!incoming && process.env.NODE_ENV !== 'production') {
    console.warn('[cc] no paintBuffer in snapshot', { layerId: layer.id });
  }
  const working = new Uint8Array(bufferLength);
  if (incoming && incoming.length) {
    if (incoming.length !== bufferLength && process.env.NODE_ENV !== 'production') {
      console.warn('[cc] paintBuffer/canvas mismatch in mutateColorCycleLayer', {
        layerId: layer.id,
        incoming: incoming.length,
        bufferLength,
        canvasWidth: canvas.width,
        canvasHeight: canvas.height,
      });
    }
    working.set(incoming.subarray(0, Math.min(incoming.length, working.length)));
  }

  const mutated = mutator(working, canvas.width, canvas.height);
  if (!mutated) {
    return false;
  }

  const hasContent = working.some((value) => value !== 0);

  brush.applyLayerSnapshot(layer.id, {
    paintBuffer: working.buffer,
    hasContent,
    strokeCounter: snapshot.strokeCounter,
  });

  try {
    brush.renderDirectToCanvas?.(canvas, layer.id);
  } catch {
    // ignore render errors; state will sync via canvas snapshot
  }

  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const syncedImage =
    ctx?.getImageData(0, 0, canvas.width, canvas.height) ?? layer.colorCycleData?.canvasImageData ?? undefined;
  const resolvedImageData = syncedImage ?? layer.imageData ?? undefined;

  const nextColorCycleData: NonNullable<Layer['colorCycleData']> | undefined = (() => {
    const base = layer.colorCycleData ?? {};
    const update: Partial<NonNullable<Layer['colorCycleData']>> = {};

    if (base.colorCycleBrush !== brush) {
      update.colorCycleBrush = brush;
    }

    // Always persist the canvas we rendered into so composites read fresh pixels.
    if (canvas && base.canvas !== canvas) {
      update.canvas = canvas;
    }

    if (syncedImage) {
      update.canvasImageData = syncedImage;
    }

    const hasUpdates = Object.keys(update).length > 0;
    return hasUpdates ? { ...base, ...update } : base;
  })();

  state.updateLayer(
    layer.id,
    {
      imageData: resolvedImageData,
      colorCycleData: nextColorCycleData,
    },
    { skipColorCycleSync: true }
  );

  // Invalidate composites so the new CC pixels show up immediately.
  state.setCurrentCompositeBitmap?.(null);
  state.setLayersNeedRecomposition?.(true);
  state.markCompositeSegmentsDirtyByLayerIds?.([layer.id]);

  return true;
};

const clampRect = (rect: Rectangle, width: number, height: number) => {
  const startX = Math.max(0, Math.floor(rect.x));
  const startY = Math.max(0, Math.floor(rect.y));
  const endX = Math.min(width, Math.ceil(rect.x + rect.width));
  const endY = Math.min(height, Math.ceil(rect.y + rect.height));
  return { startX, startY, endX, endY };
};

export const clearColorCycleRegion = (
  state: AppState,
  layer: Layer,
  project: Project,
  rect: Rectangle
): boolean =>
  mutateColorCycleLayer(state, layer, project, (buffer, bufferWidth, bufferHeight) => {
    const { startX, startY, endX, endY } = clampRect(rect, bufferWidth, bufferHeight);
    if (startX >= endX || startY >= endY) {
      return false;
    }

    let changed = false;
    for (let y = startY; y < endY; y += 1) {
      const rowOffset = y * bufferWidth;
      for (let x = startX; x < endX; x += 1) {
        const index = rowOffset + x;
        if (buffer[index] !== 0) {
          buffer[index] = 0;
          changed = true;
        }
      }
    }
    return changed;
  });

export const writeColorCycleRegion = (
  state: AppState,
  layer: Layer,
  project: Project,
  rect: Rectangle,
  source: Uint8Array,
  sourceWidth: number,
  sourceHeight: number,
  options?: { offsetX?: number; offsetY?: number }
): boolean =>
  mutateColorCycleLayer(state, layer, project, (buffer, bufferWidth, bufferHeight) => {
    const { startX, startY, endX, endY } = clampRect(rect, bufferWidth, bufferHeight);
    if (startX >= endX || startY >= endY) {
      return false;
    }

    const offsetX = Math.max(0, options?.offsetX ?? 0);
    const offsetY = Math.max(0, options?.offsetY ?? 0);
    let changed = false;
    for (let y = startY; y < endY; y += 1) {
      const destRowOffset = y * bufferWidth;
      const srcY = y - startY + offsetY;
      if (srcY < 0 || srcY >= sourceHeight) {
        continue;
      }
      for (let x = startX; x < endX; x += 1) {
        const srcX = x - startX + offsetX;
        if (srcX < 0 || srcX >= sourceWidth) {
          continue;
        }
        const srcIndex = srcY * sourceWidth + srcX;
        const destIndex = destRowOffset + x;
        const value = source[srcIndex];
        if (buffer[destIndex] !== value) {
          buffer[destIndex] = value;
          changed = true;
        }
      }
    }
    return changed;
  });

export const hasColorCycleIndices = (payload?: { colorCycleIndices?: Uint8Array | null }): payload is {
  colorCycleIndices: Uint8Array;
} => Boolean(payload?.colorCycleIndices && payload.colorCycleIndices.length);

export const debugCaptureColorCycleScalarRegion = (
  layer: Layer,
  project: Project,
  rect: Rectangle
): Uint8Array | null => {
  const brush = colorCycleBrushManager.getLayerColorCycleBrush(layer.id);
  if (!brush?.getLayerSnapshot) {
    return null;
  }

  const snapshot = brush.getLayerSnapshot(layer.id);
  if (!snapshot?.paintBuffer) {
    return null;
  }

  const canvas =
    layer.colorCycleData?.canvas ??
    (typeof brush.getCanvas === 'function' ? brush.getCanvas() : null);
  const canvasWidth = canvas?.width ?? layer.imageData?.width ?? project.width;
  const canvasHeight = canvas?.height ?? layer.imageData?.height ?? project.height;
  if (!canvasWidth || !canvasHeight) {
    return null;
  }

  const incoming = new Uint8Array(snapshot.paintBuffer);
  if (incoming.length !== canvasWidth * canvasHeight) {
    return null;
  }

  const normRect = {
    x: Math.max(0, Math.floor(rect.x)),
    y: Math.max(0, Math.floor(rect.y)),
    width: Math.max(0, Math.floor(rect.width)),
    height: Math.max(0, Math.floor(rect.height)),
  };

  if (!normRect.width || !normRect.height) {
    return new Uint8Array(0);
  }

  return copyScalarRegion(incoming, canvasWidth, canvasHeight, normRect);
};
