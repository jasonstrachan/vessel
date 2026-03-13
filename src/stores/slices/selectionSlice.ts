import type { StateCreator } from 'zustand';
import type { Layer, Rectangle } from '@/types';
import { selectionSnapshotFromValues } from '@/history/selectionState';
import type { SelectionSnapshot } from '@/history/selectionState';
import { cloneLayerImageData, commitLayerHistory } from '@/history/helpers/layerHistory';
import { trackPendingHistoryCommit } from '@/history/pendingHistoryCommits';
import {
  captureColorCycleBrushState,
  type ColorCycleSerializedState,
} from '@/history/helpers/colorCycle';
import { clearColorCycleRegion } from '@/stores/helpers/colorCycleSelection';
import { createSelectionPasteHelpers } from '@/stores/helpers/selectionPaste';
import {
  captureSelectionBitmap,
  captureSelectionBitmapFromMask,
  copyScalarRegion,
  resolveLayerImageData,
} from '@/stores/helpers/selectionCapture';
import {
  appendSequentialEvent,
  buildSequentialDestinationOutEvent,
  createSequentialSelectionMask,
} from '@/lib/sequential/sequentialEdit';
import { commitSequentialLayerHistory } from '@/history/helpers/sequentialLayerHistory';
import { cloneSequentialLayerData } from '@/history/deltas/sequentialFrameDelta';
import {
  cloneTransferredColorCycleSlotPalettes,
  cloneTransferredColorCycleGradientDefs,
  extractTransferredColorCycleSlotPalettes,
  extractTransferredColorCycleGradientDefs,
  type TransferredColorCycleGradientDef,
  type TransferredColorCycleSlotPalette,
} from '@/stores/helpers/colorCycleGradientDefTransfer';

type AppState = import('../useAppStore').AppState;

export interface FloatingPasteHistoryContext {
  sourceLayerId: string;
  sourceBounds: Rectangle;
  sourceBeforeImage?: ImageData | null;
  sourceGradientIds?: Uint8Array | null;
  sourceGradientDefIds?: Uint16Array | null;
  sourceSpeed?: Uint8Array | null;
  sourceFlow?: Uint8Array | null;
  beforeImage: ImageData | null;
  beforeColorState: ColorCycleSerializedState | null;
  selectionBefore: SelectionSnapshot;
}

export interface SelectionSlice {
  selectionStart: { x: number; y: number } | null;
  selectionEnd: { x: number; y: number } | null;
  selectionClipboard: SelectionClipboardPayload | null;
  selectionVectorPath: {
    mode: 'freehand' | 'click-line';
    points: Array<{ x: number; y: number }>;
  } | null;
  selectionMask: ImageData | null;
  selectionMaskBounds: Rectangle | null;
  selectionMaskLayerId: string | null;
  setSelectionBounds: (
    start: { x: number; y: number } | null,
    end: { x: number; y: number } | null
  ) => void;
  clearSelection: () => void;
  selectAllActiveLayerPixels: () => void;
  selectLayerAlpha: (layerId?: string | null) => void;
  invertSelection: () => void;
  deleteSelectedPixels: () => void;
  extractSelectionToFloatingPaste: () => boolean;
  floatingPaste: {
    active: boolean;
    imageData: ImageData | null;
    position: { x: number; y: number };
    originalPosition: { x: number; y: number };
    width: number;
    height: number;
    displayWidth: number;
    displayHeight: number;
    rotation: number;
    sourceLayerId?: string | null;
    colorCycleIndices?: Uint8Array | null;
    colorCycleGradientIds?: Uint8Array | null;
    colorCycleSlotPalettes?: TransferredColorCycleSlotPalette[] | null;
    colorCycleGradientDefIds?: Uint16Array | null;
    colorCycleGradientDefs?: TransferredColorCycleGradientDef[] | null;
    colorCycleSpeed?: Uint8Array | null;
    colorCycleFlow?: Uint8Array | null;
    vectorPath?: {
      mode: 'freehand' | 'click-line';
      points: Array<{ x: number; y: number }>;
    } | null;
    } | null;
  floatingPasteHistoryContext: FloatingPasteHistoryContext | null;
  setFloatingPaste: (paste: {
    imageData: ImageData;
    position: { x: number; y: number };
    width: number;
    height: number;
    displayWidth?: number;
    displayHeight?: number;
    rotation?: number;
    originalPosition?: { x: number; y: number };
    sourceLayerId?: string | null;
    colorCycleIndices?: Uint8Array | null;
    colorCycleGradientIds?: Uint8Array | null;
    colorCycleSlotPalettes?: TransferredColorCycleSlotPalette[] | null;
    colorCycleGradientDefIds?: Uint16Array | null;
    colorCycleGradientDefs?: TransferredColorCycleGradientDef[] | null;
    colorCycleSpeed?: Uint8Array | null;
    colorCycleFlow?: Uint8Array | null;
    vectorPath?: {
      mode: 'freehand' | 'click-line';
      points: Array<{ x: number; y: number }>;
    } | null;
  } | null) => void;
  updateFloatingPastePosition: (position: { x: number; y: number }) => void;
  updateFloatingPasteRect: (rect: { x: number; y: number; width: number; height: number }) => void;
  updateFloatingPasteRotation: (rotation: number) => void;
  flipFloatingPasteHorizontal: () => void;
  flipFloatingPasteVertical: () => void;
  commitFloatingPaste: () => Promise<void>;
  cancelFloatingPaste: () => void;
  copySelectionToClipboard: (options?: { mode?: 'copy' | 'cut' }) => Promise<boolean>;
  clearSelectionClipboard: () => void;
}

export interface SelectionClipboardPayload {
  imageData: ImageData;
  position: { x: number; y: number };
  width: number;
  height: number;
  mode: 'copy' | 'cut';
  colorCycleIndices?: Uint8Array | null;
  colorCycleGradientIds?: Uint8Array | null;
  colorCycleSlotPalettes?: TransferredColorCycleSlotPalette[] | null;
  colorCycleGradientDefIds?: Uint16Array | null;
  colorCycleGradientDefs?: TransferredColorCycleGradientDef[] | null;
  colorCycleSpeed?: Uint8Array | null;
  colorCycleFlow?: Uint8Array | null;
  colorCycleSourceLayerId?: string | null;
}

const buildTransferredColorCyclePayload = (
  layer: Layer,
  capture: {
    colorCycleIndices?: Uint8Array | null;
    colorCycleGradientIds?: Uint8Array | null;
    colorCycleGradientDefIds?: Uint16Array | null;
    colorCycleSpeed?: Uint8Array | null;
    colorCycleFlow?: Uint8Array | null;
  }
) => ({
  colorCycleIndices: capture.colorCycleIndices ?? null,
  colorCycleGradientIds: capture.colorCycleGradientIds ?? null,
  colorCycleSlotPalettes: extractTransferredColorCycleSlotPalettes(
    layer,
    capture.colorCycleGradientIds ?? null,
    capture.colorCycleGradientDefIds ?? null
  ),
  colorCycleGradientDefIds: capture.colorCycleGradientDefIds ?? null,
  colorCycleGradientDefs: extractTransferredColorCycleGradientDefs(
    layer,
    capture.colorCycleGradientDefIds ?? null
  ),
  colorCycleSpeed: capture.colorCycleSpeed ?? null,
  colorCycleFlow: capture.colorCycleFlow ?? null,
});

const computeBoundsFromSelection = (
  start: { x: number; y: number },
  end: { x: number; y: number }
): Rectangle => ({
  x: Math.min(start.x, end.x),
  y: Math.min(start.y, end.y),
  width: Math.abs(end.x - start.x),
  height: Math.abs(end.y - start.y),
});

const findOpaquePixelBounds = (imageData: ImageData): Rectangle | null => {
  const { width, height, data } = imageData;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < height; y += 1) {
    const rowOffset = y * width * 4;
    for (let x = 0; x < width; x += 1) {
      const alphaIndex = rowOffset + x * 4 + 3;
      if (data[alphaIndex] > 0) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }

  if (maxX === -1 || maxY === -1) {
    return null;
  }

  return {
    x: minX,
    y: minY,
    width: maxX - minX + 1,
    height: maxY - minY + 1,
  };
};

const resolveSelectionInvertDimensions = (state: Pick<
  AppState,
  'project' | 'layers' | 'activeLayerId' | 'selectionEnd' | 'selectionMaskBounds'
>): { width: number; height: number } | null => {
  const activeLayer = state.activeLayerId
    ? state.layers.find((layer) => layer.id === state.activeLayerId) ?? null
    : null;

  const maskMaxX = state.selectionMaskBounds
    ? state.selectionMaskBounds.x + state.selectionMaskBounds.width
    : undefined;
  const maskMaxY = state.selectionMaskBounds
    ? state.selectionMaskBounds.y + state.selectionMaskBounds.height
    : undefined;

  const resolvedWidth =
    activeLayer?.imageData?.width ??
    activeLayer?.framebuffer?.width ??
    state.project?.width ??
    maskMaxX ??
    state.selectionEnd?.x;
  const resolvedHeight =
    activeLayer?.imageData?.height ??
    activeLayer?.framebuffer?.height ??
    state.project?.height ??
    maskMaxY ??
    state.selectionEnd?.y;

  const width = Math.max(0, Math.floor(resolvedWidth ?? 0));
  const height = Math.max(0, Math.floor(resolvedHeight ?? 0));

  if (!width || !height) {
    return null;
  }

  return { width, height };
};

const cropMaskToBounds = (mask: ImageData, bounds: Rectangle): ImageData => {
  const cropped = new ImageData(bounds.width, bounds.height);
  const source = mask.data;
  const target = cropped.data;

  for (let y = 0; y < bounds.height; y += 1) {
    const sourceStart = ((bounds.y + y) * mask.width + bounds.x) * 4;
    const sourceEnd = sourceStart + bounds.width * 4;
    target.set(source.subarray(sourceStart, sourceEnd), y * bounds.width * 4);
  }

  return cropped;
};

const cloneOptionalImageData = (imageData: ImageData | null): ImageData | null => {
  if (!imageData) {
    return null;
  }
  return new ImageData(new Uint8ClampedArray(imageData.data), imageData.width, imageData.height);
};

const extractImageDataRegion = (imageData: ImageData | null, bounds: Rectangle): ImageData | null => {
  if (!imageData || bounds.width <= 0 || bounds.height <= 0) {
    return null;
  }

  const x = Math.max(0, Math.floor(bounds.x));
  const y = Math.max(0, Math.floor(bounds.y));
  const right = Math.min(imageData.width, Math.ceil(bounds.x + bounds.width));
  const bottom = Math.min(imageData.height, Math.ceil(bounds.y + bounds.height));
  const width = right - x;
  const height = bottom - y;

  if (width <= 0 || height <= 0) {
    return null;
  }

  const data = new Uint8ClampedArray(width * height * 4);
  for (let row = 0; row < height; row += 1) {
    const srcStart = ((y + row) * imageData.width + x) * 4;
    const srcEnd = srcStart + width * 4;
    data.set(imageData.data.subarray(srcStart, srcEnd), row * width * 4);
  }

  return new ImageData(data, width, height);
};

const extractColorCycleRegion = (
  state: ColorCycleSerializedState | null,
  bounds: Rectangle,
  field: 'gradientIdBuffer' | 'speedBuffer' | 'flowBuffer'
): Uint8Array | null => {
  const layer = state?.layers?.[0];
  if (!layer?.strokeData) {
    return null;
  }
  const source = layer.strokeData[field];
  if (!source) {
    return null;
  }
  const bytes = new Uint8Array(source);
  const width = layer.data?.indexBuffer?.width ?? 0;
  const height = layer.data?.indexBuffer?.height ?? 0;
  if (!width || !height || bytes.length < width * height) {
    return null;
  }
  return copyScalarRegion(bytes, width, height, {
    x: Math.floor(bounds.x),
    y: Math.floor(bounds.y),
    width: Math.max(1, Math.ceil(bounds.width)),
    height: Math.max(1, Math.ceil(bounds.height)),
  });
};

const extractColorCycleDefRegion = (
  state: ColorCycleSerializedState | null,
  bounds: Rectangle
): Uint16Array | null => {
  const layer = state?.layers?.[0];
  const source = layer?.strokeData?.gradientDefIdBuffer;
  if (!source) {
    return null;
  }
  const values = new Uint16Array(source);
  const width = layer.data?.indexBuffer?.width ?? 0;
  const height = layer.data?.indexBuffer?.height ?? 0;
  if (!width || !height || values.length < width * height) {
    return null;
  }

  const rect = {
    x: Math.floor(bounds.x),
    y: Math.floor(bounds.y),
    width: Math.max(1, Math.ceil(bounds.width)),
    height: Math.max(1, Math.ceil(bounds.height)),
  };
  const destination = new Uint16Array(rect.width * rect.height);
  const startX = Math.max(0, Math.min(width, rect.x));
  const startY = Math.max(0, Math.min(height, rect.y));
  const endX = Math.max(0, Math.min(width, rect.x + rect.width));
  const endY = Math.max(0, Math.min(height, rect.y + rect.height));

  for (let row = startY; row < endY; row += 1) {
    for (let col = startX; col < endX; col += 1) {
      const srcIndex = row * width + col;
      const destIndex = (row - startY) * rect.width + (col - startX);
      destination[destIndex] = values[srcIndex];
    }
  }

  return destination;
};

type ColorCycleMaskClearOptions = NonNullable<Parameters<typeof clearColorCycleRegion>[4]>;

const buildColorCycleMaskClearOptions = (
  bounds: Rectangle,
  selectionMask: ImageData | null,
  selectionMaskBounds: Rectangle | null
): ColorCycleMaskClearOptions | undefined => {
  if (!selectionMask || !selectionMaskBounds) {
    return undefined;
  }

  return {
    alphaData: selectionMask.data,
    alphaWidth: selectionMask.width,
    alphaHeight: selectionMask.height,
    offsetX: bounds.x - selectionMaskBounds.x,
    offsetY: bounds.y - selectionMaskBounds.y,
    alphaStride: 4,
    alphaChannelOffset: 3,
    alphaThreshold: 0,
  };
};

const clearColorCycleEraseMask = (
  eraseMask: HTMLCanvasElement | OffscreenCanvas | undefined,
  bounds: Rectangle,
  selectionMask: ImageData | null,
  selectionMaskBounds: Rectangle | null
) => {
  const ctxRaw = eraseMask?.getContext('2d', { willReadFrequently: true } as CanvasRenderingContext2DSettings);
  if (
    !ctxRaw ||
    !('clearRect' in ctxRaw) ||
    !('getImageData' in ctxRaw) ||
    !('putImageData' in ctxRaw)
  ) {
    return;
  }
  const ctx = ctxRaw;

  const x = Math.floor(bounds.x);
  const y = Math.floor(bounds.y);
  const right = Math.ceil(bounds.x + bounds.width);
  const bottom = Math.ceil(bounds.y + bounds.height);
  const width = Math.max(0, right - x);
  const height = Math.max(0, bottom - y);
  if (width <= 0 || height <= 0) {
    return;
  }

  if (!selectionMask || !selectionMaskBounds) {
    ctx.clearRect(x, y, width, height);
    return;
  }

  try {
    const region = ctx.getImageData(x, y, width, height);
    const regionData = region.data;
    const maskData = selectionMask.data;
    const maskX = Math.floor(selectionMaskBounds.x);
    const maskY = Math.floor(selectionMaskBounds.y);

    let changed = false;
    for (let py = 0; py < height; py += 1) {
      const targetY = y + py;
      const localMaskY = targetY - maskY;
      if (localMaskY < 0 || localMaskY >= selectionMask.height) {
        continue;
      }
      for (let px = 0; px < width; px += 1) {
        const targetX = x + px;
        const localMaskX = targetX - maskX;
        if (localMaskX < 0 || localMaskX >= selectionMask.width) {
          continue;
        }
        const maskAlpha = maskData[(localMaskY * selectionMask.width + localMaskX) * 4 + 3];
        if (maskAlpha === 0) {
          continue;
        }
        const index = (py * width + px) * 4;
        if (regionData[index] === 0 && regionData[index + 1] === 0 && regionData[index + 2] === 0 && regionData[index + 3] === 0) {
          continue;
        }
        regionData[index] = 0;
        regionData[index + 1] = 0;
        regionData[index + 2] = 0;
        regionData[index + 3] = 0;
        changed = true;
      }
    }

    if (changed) {
      ctx.putImageData(region, x, y);
    }
  } catch {
    ctx.clearRect(x, y, width, height);
  }
};

const flipImageData = (imageData: ImageData, axis: 'horizontal' | 'vertical'): ImageData => {
  const { width, height, data } = imageData;
  const source = data;
  const next = new Uint8ClampedArray(source.length);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const sourceX = axis === 'horizontal' ? width - 1 - x : x;
      const sourceY = axis === 'vertical' ? height - 1 - y : y;
      const sourceIndex = (sourceY * width + sourceX) * 4;
      const destIndex = (y * width + x) * 4;

      next[destIndex] = source[sourceIndex];
      next[destIndex + 1] = source[sourceIndex + 1];
      next[destIndex + 2] = source[sourceIndex + 2];
      next[destIndex + 3] = source[sourceIndex + 3];
    }
  }

  return new ImageData(next, width, height);
};

const flipColorCycleIndices = (
  indices: Uint8Array,
  width: number,
  height: number,
  axis: 'horizontal' | 'vertical'
): Uint8Array => {
  const expectedLength = width * height;
  if (indices.length !== expectedLength) {
    return indices.slice();
  }

  const next = new Uint8Array(indices.length);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const sourceX = axis === 'horizontal' ? width - 1 - x : x;
      const sourceY = axis === 'vertical' ? height - 1 - y : y;
      const sourceIndex = sourceY * width + sourceX;
      const destIndex = y * width + x;
      next[destIndex] = indices[sourceIndex];
    }
  }

  return next;
};

const flipColorCycleValues16 = (
  values: Uint16Array,
  width: number,
  height: number,
  axis: 'horizontal' | 'vertical'
): Uint16Array => {
  const expectedLength = width * height;
  if (values.length !== expectedLength) {
    return values.slice();
  }

  const next = new Uint16Array(values.length);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const sourceX = axis === 'horizontal' ? width - 1 - x : x;
      const sourceY = axis === 'vertical' ? height - 1 - y : y;
      const sourceIndex = sourceY * width + sourceX;
      const destIndex = y * width + x;
      next[destIndex] = values[sourceIndex];
    }
  }

  return next;
};

const flipVectorPath = (
  vectorPath: NonNullable<SelectionSlice['floatingPaste']>['vectorPath'],
  width: number,
  height: number,
  axis: 'horizontal' | 'vertical'
) => {
  if (!vectorPath || vectorPath.points.length === 0) {
    return vectorPath;
  }

  const flippedPoints = vectorPath.points.map((point) => ({
    x: axis === 'horizontal' ? width - point.x : point.x,
    y: axis === 'vertical' ? height - point.y : point.y,
  }));

  return {
    mode: vectorPath.mode,
    points: flippedPoints,
  };
};

export const createSelectionSlice: StateCreator<AppState, [], [], SelectionSlice> = (set, get, store) => {
  const selectionPasteHelpers = createSelectionPasteHelpers({
    get: store.getState,
    set: store.setState,
    captureCanvasToActiveLayer: (canvas, roi, options) =>
      get().captureCanvasToActiveLayer(canvas, roi, options),
  });

  return {
    selectionStart: null,
    selectionEnd: null,
    selectionClipboard: null,
    selectionVectorPath: null,
    selectionMask: null,
    selectionMaskBounds: null,
    selectionMaskLayerId: null,
    setSelectionBounds: (start, end) =>
      set({
        selectionStart: start,
        selectionEnd: end,
        selectionVectorPath: null,
        selectionMask: null,
        selectionMaskBounds: null,
        selectionMaskLayerId: null,
      }),
    clearSelection: () =>
      set({
        selectionStart: null,
        selectionEnd: null,
        selectionVectorPath: null,
        selectionMask: null,
        selectionMaskBounds: null,
        selectionMaskLayerId: null,
      }),
    selectAllActiveLayerPixels: () => {
      const state = get();
      const { project, layers, activeLayerId } = state;

      const activeLayer = activeLayerId
        ? layers.find((layer) => layer.id === activeLayerId) ?? null
        : null;

      const width =
        activeLayer?.imageData?.width ?? activeLayer?.framebuffer?.width ?? project?.width;
      const height =
        activeLayer?.imageData?.height ?? activeLayer?.framebuffer?.height ?? project?.height;

      if (!width || !height) {
        return;
      }

      set({
        selectionStart: { x: 0, y: 0 },
        selectionEnd: { x: width, y: height },
        selectionVectorPath: null,
        selectionMask: null,
        selectionMaskBounds: null,
        selectionMaskLayerId: null,
      });
    },
    selectLayerAlpha: (layerId) => {
      const state = get();
      const targetLayerId = layerId ?? state.activeLayerId;
      if (!targetLayerId) {
        return;
      }

      const layer = state.layers.find((l) => l.id === targetLayerId) ?? null;
      if (!layer) {
        return;
      }

      const imageData = resolveLayerImageData(layer);
      if (!imageData) {
        return;
      }

      const bounds = findOpaquePixelBounds(imageData);
      if (!bounds) {
        set({
          selectionStart: null,
          selectionEnd: null,
          selectionVectorPath: null,
          selectionMask: null,
          selectionMaskBounds: null,
          selectionMaskLayerId: null,
        });
        return;
      }

      const maxWidth = state.project?.width ?? imageData.width;
      const maxHeight = state.project?.height ?? imageData.height;

      const clampedX = Math.max(0, Math.min(maxWidth, bounds.x));
      const clampedY = Math.max(0, Math.min(maxHeight, bounds.y));
      const clampedWidth = Math.max(0, Math.min(bounds.width, maxWidth - clampedX));
      const clampedHeight = Math.max(0, Math.min(bounds.height, maxHeight - clampedY));

      if (clampedWidth <= 0 || clampedHeight <= 0) {
        set({
          selectionStart: null,
          selectionEnd: null,
          selectionVectorPath: null,
          selectionMask: null,
          selectionMaskBounds: null,
          selectionMaskLayerId: null,
        });
        return;
      }

      const maskData = new ImageData(clampedWidth, clampedHeight);
      const maskBuffer = maskData.data;

      for (let y = 0; y < clampedHeight; y += 1) {
        const sourceY = clampedY + y;
        const srcRow = sourceY * imageData.width * 4;
        const destRow = y * clampedWidth * 4;
        for (let x = 0; x < clampedWidth; x += 1) {
          const sourceX = clampedX + x;
          const srcIdx = srcRow + sourceX * 4;
          const destIdx = destRow + x * 4;
          const alpha = imageData.data[srcIdx + 3];
          if (alpha > 0) {
            maskBuffer[destIdx] = 255;
            maskBuffer[destIdx + 1] = 255;
            maskBuffer[destIdx + 2] = 255;
            maskBuffer[destIdx + 3] = 255;
          }
        }
      }

      set({
        selectionStart: { x: clampedX, y: clampedY },
        selectionEnd: { x: clampedX + clampedWidth, y: clampedY + clampedHeight },
        selectionVectorPath: null,
        selectionMask: maskData,
        selectionMaskBounds: { x: clampedX, y: clampedY, width: clampedWidth, height: clampedHeight },
        selectionMaskLayerId: targetLayerId,
      });
    },
    invertSelection: () => {
      const state = get();
      const { selectionStart, selectionEnd, selectionMask, selectionMaskBounds } = state;
      const hasSelection = Boolean(
        (selectionStart && selectionEnd) || (selectionMask && selectionMaskBounds),
      );
      if (!hasSelection) {
        return;
      }

      const dimensions = resolveSelectionInvertDimensions(state);
      if (!dimensions) {
        return;
      }

      const { width, height } = dimensions;
      const selectedCoverage = new Uint8Array(width * height);
      const markSelected = (x: number, y: number) => {
        if (x < 0 || y < 0 || x >= width || y >= height) {
          return;
        }
        selectedCoverage[y * width + x] = 1;
      };

      if (selectionMask && selectionMaskBounds) {
        for (let y = 0; y < selectionMask.height; y += 1) {
          const sourceRow = y * selectionMask.width * 4;
          for (let x = 0; x < selectionMask.width; x += 1) {
            const alpha = selectionMask.data[sourceRow + x * 4 + 3];
            if (alpha <= 0) {
              continue;
            }
            markSelected(selectionMaskBounds.x + x, selectionMaskBounds.y + y);
          }
        }
      } else if (selectionStart && selectionEnd) {
        const bounds = computeBoundsFromSelection(selectionStart, selectionEnd);
        const minX = Math.max(0, Math.floor(bounds.x));
        const minY = Math.max(0, Math.floor(bounds.y));
        const maxX = Math.min(width, Math.ceil(bounds.x + bounds.width));
        const maxY = Math.min(height, Math.ceil(bounds.y + bounds.height));

        for (let y = minY; y < maxY; y += 1) {
          for (let x = minX; x < maxX; x += 1) {
            markSelected(x, y);
          }
        }
      }

      const invertedMask = new ImageData(width, height);
      let hasInvertedPixels = false;
      for (let i = 0; i < selectedCoverage.length; i += 1) {
        if (selectedCoverage[i] === 1) {
          continue;
        }
        const pixel = i * 4;
        invertedMask.data[pixel] = 255;
        invertedMask.data[pixel + 1] = 255;
        invertedMask.data[pixel + 2] = 255;
        invertedMask.data[pixel + 3] = 255;
        hasInvertedPixels = true;
      }

      if (!hasInvertedPixels) {
        set({
          selectionStart: null,
          selectionEnd: null,
          selectionVectorPath: null,
          selectionMask: null,
          selectionMaskBounds: null,
          selectionMaskLayerId: null,
        });
        return;
      }

      const invertedBounds = findOpaquePixelBounds(invertedMask);
      if (!invertedBounds) {
        set({
          selectionStart: null,
          selectionEnd: null,
          selectionVectorPath: null,
          selectionMask: null,
          selectionMaskBounds: null,
          selectionMaskLayerId: null,
        });
        return;
      }

      const croppedMask = cropMaskToBounds(invertedMask, invertedBounds);
      set({
        selectionStart: { x: invertedBounds.x, y: invertedBounds.y },
        selectionEnd: {
          x: invertedBounds.x + invertedBounds.width,
          y: invertedBounds.y + invertedBounds.height,
        },
        selectionVectorPath: null,
        selectionMask: croppedMask,
        selectionMaskBounds: invertedBounds,
        selectionMaskLayerId: state.activeLayerId ?? state.selectionMaskLayerId ?? null,
      });
    },
    deleteSelectedPixels: () => {
      const state = get();
      const {
        selectionStart,
        selectionEnd,
        selectionMask,
        selectionMaskBounds,
        layers,
        activeLayerId,
        project,
      } = state;

      if (!selectionStart || !selectionEnd || !project) {
        return;
      }

      const activeLayer = layers.find((layer) => layer.id === activeLayerId);
      if (!activeLayer || !activeLayerId) {
        return;
      }

      const { x, y, width, height } = computeBoundsFromSelection(selectionStart, selectionEnd);
      if (width <= 0 || height <= 0) {
        return;
      }

      const selectionBefore = selectionSnapshotFromValues(selectionStart, selectionEnd);

      const beforeImage = cloneLayerImageData(activeLayer.imageData);
      const beforeColorState =
        activeLayer.layerType === 'color-cycle'
          ? captureColorCycleBrushState(activeLayer.id)
          : null;

      if (activeLayer.layerType === 'sequential' && activeLayer.sequentialData) {
        const selectionMaskImage = createSequentialSelectionMask({
          bounds: { x, y, width, height },
          selectionMask,
          selectionMaskBounds,
        });
        if (!selectionMaskImage) {
          return;
        }

        const beforeSequentialData = cloneSequentialLayerData(activeLayer.sequentialData);
        const frameCount = Math.max(1, Math.round(activeLayer.sequentialData.frameCount));
        const frameIndex =
          ((Math.round(state.sequentialRecord.currentFrame) % frameCount) + frameCount) % frameCount;
        const timestampMs = Date.now();
        const strokeId = `seq-delete-${timestampMs}`;
        const event = buildSequentialDestinationOutEvent({
          layer: activeLayer,
          frameIndex,
          maskImageData: selectionMaskImage,
          maskBounds: { x, y, width, height },
          eraserSettings: {
            ...state.tools.brushSettings,
            ...state.tools.eraserSettings,
            opacity: 1,
            blendMode: 'destination-out',
          },
          timestampMs,
          id: `${strokeId}-0`,
          strokeId,
        });
        const afterSequentialData = appendSequentialEvent(beforeSequentialData, event);

        state.updateLayer(
          activeLayerId,
          { sequentialData: afterSequentialData },
          { skipColorCycleSync: true }
        );
        state.setCurrentCompositeBitmap(null);
        state.setLayersNeedRecomposition(true);
        state.clearSelection();

        const deleteHistoryCommit = commitSequentialLayerHistory({
          layerId: activeLayerId,
          beforeSequentialData,
          afterSequentialData,
          actionType: 'delete',
          description: 'Delete selected pixels',
          tool: 'selection',
          coalesce: {
            key: `selection-delete:${activeLayerId}:${frameIndex}`,
            maxIntervalMs: 250,
          },
        }).catch((error) => {
          if (process.env.NODE_ENV !== 'production') {
            console.warn('[history] Failed to record sequential selection delete', error);
          }
        });
        trackPendingHistoryCommit(deleteHistoryCommit);
        return;
      }

      if (activeLayer.layerType === 'color-cycle') {
        const cleared = clearColorCycleRegion(
          state,
          activeLayer,
          project,
          { x, y, width, height },
          buildColorCycleMaskClearOptions({ x, y, width, height }, selectionMask, selectionMaskBounds)
        );
        if (cleared) {
          const eraseMask = activeLayer.colorCycleData?.eraseMask;
          clearColorCycleEraseMask(eraseMask, { x, y, width, height }, selectionMask, selectionMaskBounds);
          state.scheduleColorCycleSlotRebuild?.('delete-selected');
        }
      } else {
        const useMask = selectionMask && selectionMaskBounds;

        const framebuffer = activeLayer.framebuffer;
        const sourceImage = (() => {
          if (framebuffer) {
            const fbCtx = framebuffer.getContext('2d', { willReadFrequently: true }) as
              | CanvasRenderingContext2D
              | OffscreenCanvasRenderingContext2D
              | null;
            try {
              if (fbCtx && 'getImageData' in fbCtx) {
                return fbCtx.getImageData(0, 0, framebuffer.width, framebuffer.height);
              }
            } catch {
              return null;
            }
          }
          return activeLayer.imageData ? cloneLayerImageData(activeLayer.imageData) : null;
        })();

        if (!sourceImage) {
          return;
        }

        const newImageData = cloneLayerImageData(sourceImage);
        if (!newImageData) {
          return;
        }

        if (useMask) {
          const { x: mx, y: my, width: mw, height: mh } = selectionMaskBounds!;
          const maskBuffer = selectionMask!.data;
          for (let py = 0; py < mh; py += 1) {
            const maskRow = py * mw * 4;
            const targetY = my + py;
            if (targetY < 0 || targetY >= newImageData.height) continue;
            for (let px = 0; px < mw; px += 1) {
              const alphaIdx = maskRow + px * 4 + 3;
              if (maskBuffer[alphaIdx] === 0) {
                continue;
              }
              const targetX = mx + px;
              if (targetX < 0 || targetX >= newImageData.width) continue;
              const destIdx = (targetY * newImageData.width + targetX) * 4;
              newImageData.data[destIdx] = 0;
              newImageData.data[destIdx + 1] = 0;
              newImageData.data[destIdx + 2] = 0;
              newImageData.data[destIdx + 3] = 0;
            }
          }
        } else {
          const startY = Math.max(0, Math.floor(y));
          const endY = Math.min(newImageData.height, Math.ceil(y + height));
          const startX = Math.max(0, Math.floor(x));
          const endX = Math.min(newImageData.width, Math.ceil(x + width));

          for (let py = startY; py < endY; py++) {
            for (let px = startX; px < endX; px++) {
              const index = (py * newImageData.width + px) * 4;
              newImageData.data[index + 3] = 0;
              newImageData.data[index] = 0;
              newImageData.data[index + 1] = 0;
              newImageData.data[index + 2] = 0;
            }
          }
        }

        if (framebuffer) {
          const fbCtx = framebuffer.getContext('2d', { willReadFrequently: true }) as
            | CanvasRenderingContext2D
            | OffscreenCanvasRenderingContext2D
            | null;
          if (fbCtx && 'putImageData' in fbCtx) {
            fbCtx.putImageData(newImageData, 0, 0);
          }
        }

        state.updateLayer(activeLayerId, { imageData: newImageData });
      }

      state.setCurrentCompositeBitmap(null);
      state.setLayersNeedRecomposition(true);
      state.clearSelection();

      const deleteHistoryCommit = commitLayerHistory({
        layerId: activeLayerId,
        beforeImage,
        beforeColorState,
        actionType: 'delete',
        description: 'Delete selected pixels',
        tool: 'selection',
        selectionBefore,
      }).catch((error) => {
        if (process.env.NODE_ENV !== 'production') {
          console.warn('[history] Failed to record selection delete', error);
        }
      });
      trackPendingHistoryCommit(deleteHistoryCommit);
    },
    extractSelectionToFloatingPaste: () => {
      const state = get();
      const {
        selectionStart,
        selectionEnd,
        selectionMask,
        selectionMaskBounds,
        selectionVectorPath,
        project,
        layers,
        activeLayerId,
      } = state;

      if (!selectionStart || !selectionEnd || !project || !activeLayerId) {
        return false;
      }

      const activeLayer = layers.find((layer) => layer.id === activeLayerId) ?? null;
      if (!activeLayer) {
        return false;
      }

      const selectionBefore = selectionSnapshotFromValues(selectionStart, selectionEnd);
      const sourceImageData = resolveLayerImageData(activeLayer);
      const beforeImage = activeLayer.layerType === 'color-cycle'
        ? null
        : cloneOptionalImageData(sourceImageData);
      const beforeColorState = activeLayer.layerType === 'color-cycle'
        ? captureColorCycleBrushState(activeLayer.id)
        : null;

      const capture = selectionMask && selectionMaskBounds
        ? captureSelectionBitmapFromMask({
            mask: selectionMask,
            maskBounds: selectionMaskBounds,
            project,
            layer: activeLayer,
            clearSource: true,
          })
        : captureSelectionBitmap({
            selectionStart,
            selectionEnd,
            project,
            layer: activeLayer,
            clearSource: true,
          });

      if (!capture || !capture.updatedLayerImageData) {
        return false;
      }

      if (activeLayer.layerType === 'color-cycle') {
        const cleared = clearColorCycleRegion(state, activeLayer, project, {
          x: capture.bounds.x,
          y: capture.bounds.y,
          width: capture.bounds.width,
          height: capture.bounds.height,
        }, buildColorCycleMaskClearOptions(capture.bounds, selectionMask, selectionMaskBounds));
        if (cleared) {
          const eraseMask = activeLayer.colorCycleData?.eraseMask;
          clearColorCycleEraseMask(eraseMask, capture.bounds, selectionMask, selectionMaskBounds);
          state.scheduleColorCycleSlotRebuild?.('extract-selection-transform');
        }
      } else {
        const updatedImageData = capture.updatedLayerImageData;
        const framebuffer = activeLayer.framebuffer;
        if (framebuffer) {
          try {
            if (framebuffer.width !== updatedImageData.width || framebuffer.height !== updatedImageData.height) {
              framebuffer.width = updatedImageData.width;
              framebuffer.height = updatedImageData.height;
            }
            const fbCtx = framebuffer.getContext('2d', { willReadFrequently: true }) as
              | CanvasRenderingContext2D
              | OffscreenCanvasRenderingContext2D
              | null;
            if (fbCtx && 'putImageData' in fbCtx) {
              fbCtx.putImageData(updatedImageData, 0, 0);
            }
          } catch {
            // If framebuffer sync fails, imageData update still preserves correctness.
          }
          state.updateLayer(activeLayerId, { imageData: updatedImageData, framebuffer });
        } else {
          state.updateLayer(activeLayerId, { imageData: updatedImageData });
        }
      }

      state.setCurrentCompositeBitmap(null);
      state.setLayersNeedRecomposition(true);
      const floatingVectorPath =
        selectionVectorPath && selectionVectorPath.points.length >= 2
          ? {
              mode: selectionVectorPath.mode,
              points: selectionVectorPath.points.map((point) => ({
                x: point.x - capture.bounds.x,
                y: point.y - capture.bounds.y,
              })),
            }
          : null;
      const colorCyclePayload = buildTransferredColorCyclePayload(activeLayer, capture);
      set({
        selectionStart: null,
        selectionEnd: null,
        selectionVectorPath: null,
        selectionMask: null,
        selectionMaskBounds: null,
        selectionMaskLayerId: null,
        floatingPaste: {
          active: true,
          imageData: capture.selectionImageData,
          position: { x: capture.bounds.x, y: capture.bounds.y },
          originalPosition: { x: capture.bounds.x, y: capture.bounds.y },
          width: capture.bounds.width,
          height: capture.bounds.height,
          displayWidth: capture.bounds.width,
          displayHeight: capture.bounds.height,
          rotation: 0,
          sourceLayerId: activeLayerId,
          ...colorCyclePayload,
          vectorPath: floatingVectorPath,
        },
        floatingPasteHistoryContext: {
          sourceLayerId: activeLayerId,
          sourceBounds: {
            x: capture.bounds.x,
            y: capture.bounds.y,
            width: capture.bounds.width,
            height: capture.bounds.height,
          },
          sourceBeforeImage: extractImageDataRegion(sourceImageData, capture.bounds),
          sourceGradientIds: extractColorCycleRegion(beforeColorState, capture.bounds, 'gradientIdBuffer'),
          sourceGradientDefIds: extractColorCycleDefRegion(beforeColorState, capture.bounds),
          sourceSpeed: extractColorCycleRegion(beforeColorState, capture.bounds, 'speedBuffer'),
          sourceFlow: extractColorCycleRegion(beforeColorState, capture.bounds, 'flowBuffer'),
          beforeImage,
          beforeColorState,
          selectionBefore,
        },
      });

      return true;
    },

    floatingPaste: null,
    floatingPasteHistoryContext: null,
    setFloatingPaste: (paste) =>
      set((state) => {
        if (
          process.env.NODE_ENV !== 'production' &&
          paste &&
          !paste.colorCycleIndices &&
          state.layers.find((layer) => layer.id === state.activeLayerId)?.layerType === 'color-cycle'
        ) {
          console.warn('[floatingPaste] Missing colorCycleIndices in setFloatingPaste', {
            activeLayerId: state.activeLayerId,
            sourceLayerId: paste.sourceLayerId,
            hasImageData: Boolean(paste.imageData),
          });
        }

        return {
          floatingPaste: paste
              ? {
                  active: true,
                  imageData: paste.imageData,
                  position: paste.position,
                  originalPosition: paste.originalPosition ?? paste.position,
                  width: paste.width,
                  height: paste.height,
                  displayWidth: paste.displayWidth ?? paste.width,
                  displayHeight: paste.displayHeight ?? paste.height,
                  rotation: paste.colorCycleIndices ? 0 : (paste.rotation ?? 0),
                  sourceLayerId: paste.sourceLayerId ?? null,
                  colorCycleIndices: paste.colorCycleIndices ?? null,
                  colorCycleGradientIds: paste.colorCycleGradientIds ?? null,
                  colorCycleSlotPalettes: cloneTransferredColorCycleSlotPalettes(paste.colorCycleSlotPalettes),
                  colorCycleGradientDefIds: paste.colorCycleGradientDefIds ?? null,
                  colorCycleGradientDefs: cloneTransferredColorCycleGradientDefs(paste.colorCycleGradientDefs),
                  colorCycleSpeed: paste.colorCycleSpeed ?? null,
                  colorCycleFlow: paste.colorCycleFlow ?? null,
                  vectorPath: paste.vectorPath ?? null,
                }
              : null,
          floatingPasteHistoryContext: null,
        };
      }),
    updateFloatingPastePosition: (position) =>
      set((state) => ({
        floatingPaste: state.floatingPaste
          ? {
              ...state.floatingPaste,
              position,
            }
          : null,
      })),
    updateFloatingPasteRect: (rect) =>
      set((state) => ({
        floatingPaste: state.floatingPaste
          ? {
              ...state.floatingPaste,
              position: { x: rect.x, y: rect.y },
              displayWidth: rect.width,
              displayHeight: rect.height,
            }
          : null,
      })),
    updateFloatingPasteRotation: (rotation) =>
      set((state) => ({
        floatingPaste: state.floatingPaste
          ? {
              ...state.floatingPaste,
              rotation,
            }
          : null,
      })),
    flipFloatingPasteHorizontal: () =>
      set((state) => {
        const floatingPaste = state.floatingPaste;
        if (!floatingPaste || !floatingPaste.imageData) {
          return { floatingPaste };
        }

        const imageData = floatingPaste.imageData;
        return {
          floatingPaste: {
            ...floatingPaste,
            imageData: flipImageData(imageData, 'horizontal'),
            colorCycleIndices: floatingPaste.colorCycleIndices
              ? flipColorCycleIndices(
                  floatingPaste.colorCycleIndices,
                  floatingPaste.width,
                  floatingPaste.height,
                  'horizontal'
                )
              : floatingPaste.colorCycleIndices,
            colorCycleGradientIds: floatingPaste.colorCycleGradientIds
              ? flipColorCycleIndices(
                  floatingPaste.colorCycleGradientIds,
                  floatingPaste.width,
                  floatingPaste.height,
                  'horizontal'
                )
              : floatingPaste.colorCycleGradientIds,
            colorCycleGradientDefIds: floatingPaste.colorCycleGradientDefIds
              ? flipColorCycleValues16(
                  floatingPaste.colorCycleGradientDefIds,
                  floatingPaste.width,
                  floatingPaste.height,
                  'horizontal'
                )
              : floatingPaste.colorCycleGradientDefIds,
            colorCycleSpeed: floatingPaste.colorCycleSpeed
              ? flipColorCycleIndices(
                  floatingPaste.colorCycleSpeed,
                  floatingPaste.width,
                  floatingPaste.height,
                  'horizontal'
                )
              : floatingPaste.colorCycleSpeed,
            colorCycleFlow: floatingPaste.colorCycleFlow
              ? flipColorCycleIndices(
                  floatingPaste.colorCycleFlow,
                  floatingPaste.width,
                  floatingPaste.height,
                  'horizontal'
                )
              : floatingPaste.colorCycleFlow,
            vectorPath: flipVectorPath(
              floatingPaste.vectorPath ?? null,
              floatingPaste.width,
              floatingPaste.height,
              'horizontal'
            ),
          },
        };
      }),
    flipFloatingPasteVertical: () =>
      set((state) => {
        const floatingPaste = state.floatingPaste;
        if (!floatingPaste || !floatingPaste.imageData) {
          return { floatingPaste };
        }

        const imageData = floatingPaste.imageData;
        return {
          floatingPaste: {
            ...floatingPaste,
            imageData: flipImageData(imageData, 'vertical'),
            colorCycleIndices: floatingPaste.colorCycleIndices
              ? flipColorCycleIndices(
                  floatingPaste.colorCycleIndices,
                  floatingPaste.width,
                  floatingPaste.height,
                  'vertical'
                )
              : floatingPaste.colorCycleIndices,
            colorCycleGradientIds: floatingPaste.colorCycleGradientIds
              ? flipColorCycleIndices(
                  floatingPaste.colorCycleGradientIds,
                  floatingPaste.width,
                  floatingPaste.height,
                  'vertical'
                )
              : floatingPaste.colorCycleGradientIds,
            colorCycleGradientDefIds: floatingPaste.colorCycleGradientDefIds
              ? flipColorCycleValues16(
                  floatingPaste.colorCycleGradientDefIds,
                  floatingPaste.width,
                  floatingPaste.height,
                  'vertical'
                )
              : floatingPaste.colorCycleGradientDefIds,
            colorCycleSpeed: floatingPaste.colorCycleSpeed
              ? flipColorCycleIndices(
                  floatingPaste.colorCycleSpeed,
                  floatingPaste.width,
                  floatingPaste.height,
                  'vertical'
                )
              : floatingPaste.colorCycleSpeed,
            colorCycleFlow: floatingPaste.colorCycleFlow
              ? flipColorCycleIndices(
                  floatingPaste.colorCycleFlow,
                  floatingPaste.width,
                  floatingPaste.height,
                  'vertical'
                )
              : floatingPaste.colorCycleFlow,
            vectorPath: flipVectorPath(
              floatingPaste.vectorPath ?? null,
              floatingPaste.width,
              floatingPaste.height,
              'vertical'
            ),
          },
        };
      }),
    commitFloatingPaste: () => selectionPasteHelpers.commitFloatingPaste(),
    cancelFloatingPaste: () => selectionPasteHelpers.cancelFloatingPaste(),
    copySelectionToClipboard: async (options) => {
      const mode = options?.mode ?? 'copy';
      const state = get();
      const { selectionStart, selectionEnd, project, layers, activeLayerId, floatingPaste } = state;

      let clipboardPayload: SelectionClipboardPayload | null = null;

      if (selectionStart && selectionEnd && project && activeLayerId) {
        const activeLayer = layers.find((layer) => layer.id === activeLayerId) ?? null;
        if (activeLayer) {
          const capture = state.selectionMask && state.selectionMaskBounds
            ? captureSelectionBitmapFromMask({
                mask: state.selectionMask,
                maskBounds: state.selectionMaskBounds,
                project,
                layer: activeLayer,
                clearSource: mode === 'cut',
              })
            : captureSelectionBitmap({
                selectionStart,
                selectionEnd,
                project,
                layer: activeLayer,
                clearSource: mode === 'cut',
              });

          if (capture) {
            const colorCyclePayload = buildTransferredColorCyclePayload(activeLayer, capture);
            clipboardPayload = {
              imageData: capture.selectionImageData,
              position: { x: capture.bounds.x, y: capture.bounds.y },
              width: capture.bounds.width,
              height: capture.bounds.height,
              mode,
              ...colorCyclePayload,
              colorCycleSourceLayerId: capture.colorCycleIndices ? activeLayerId : null,
            };

            if (mode === 'cut' && capture.updatedLayerImageData) {
              const selectionBefore = selectionSnapshotFromValues(selectionStart, selectionEnd);
              const beforeImage = activeLayer.imageData ? cloneLayerImageData(activeLayer.imageData) : null;
              const beforeColorState =
                activeLayer.layerType === 'color-cycle'
                  ? captureColorCycleBrushState(activeLayer.id)
                  : null;

              let skipImageUpdate = false;
              if (activeLayer.layerType === 'color-cycle' && project) {
                skipImageUpdate = clearColorCycleRegion(state, activeLayer, project, {
                  x: capture.bounds.x,
                  y: capture.bounds.y,
                  width: capture.bounds.width,
                  height: capture.bounds.height,
                }, buildColorCycleMaskClearOptions(capture.bounds, state.selectionMask, state.selectionMaskBounds));
                if (skipImageUpdate) {
                  const eraseMask = activeLayer.colorCycleData?.eraseMask;
                  clearColorCycleEraseMask(eraseMask, capture.bounds, state.selectionMask, state.selectionMaskBounds);
                  state.scheduleColorCycleSlotRebuild?.('cut-selection');
                }
              }
              if (!skipImageUpdate) {
                state.updateLayer(activeLayerId, { imageData: capture.updatedLayerImageData });
              }
              state.setLayersNeedRecomposition(true);
              state.setCurrentCompositeBitmap(null);

              const cutHistoryCommit = commitLayerHistory({
                layerId: activeLayerId,
                beforeImage,
                beforeColorState,
                actionType: 'selection',
                description: 'Cut selection to clipboard',
                tool: 'selection',
                selectionBefore,
              }).catch((error) => {
                if (process.env.NODE_ENV !== 'production') {
                  console.warn('[history] Failed to record selection cut', error);
                }
              });
              trackPendingHistoryCommit(cutHistoryCommit);
            }
          }
        }
      }

      if (!clipboardPayload && floatingPaste?.imageData) {
        clipboardPayload = createClipboardPayloadFromFloatingPaste(floatingPaste, mode);
        if (mode === 'cut') {
          set({ floatingPaste: null, floatingPasteHistoryContext: null });
        }
      }

      if (!clipboardPayload) {
        return false;
      }

      set({ selectionClipboard: clipboardPayload });
      void writeImageDataToClipboard(clipboardPayload.imageData);
      return true;
    },
    clearSelectionClipboard: () => set({ selectionClipboard: null }),
  };
};

const writeImageDataToClipboard = async (imageData: ImageData): Promise<void> => {
  if (typeof navigator === 'undefined' || !navigator.clipboard) {
    return;
  }

  const clipboardCtor = (globalThis as { ClipboardItem?: typeof ClipboardItem }).ClipboardItem;
  if (typeof clipboardCtor !== 'function') {
    return;
  }

  const blob = await imageDataToBlob(imageData);
  if (!blob) {
    return;
  }

  try {
    await navigator.clipboard.write([new clipboardCtor({ [blob.type]: blob })]);
  } catch (error) {
    if (process.env.NODE_ENV !== 'production') {
      console.warn('[selectionClipboard] Failed to write image to clipboard', error);
    }
  }
};

const imageDataToBlob = async (imageData: ImageData): Promise<Blob | null> => {
  if (typeof document === 'undefined') {
    return null;
  }

  const canvas = document.createElement('canvas');
  canvas.width = imageData.width;
  canvas.height = imageData.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return null;
  }
  ctx.putImageData(imageData, 0, 0);

  return new Promise((resolve) => {
    canvas.toBlob((blob) => {
      resolve(blob ?? null);
    }, 'image/png');
  });
};

const cloneImageData = (imageData: ImageData): ImageData =>
  new ImageData(new Uint8ClampedArray(imageData.data), imageData.width, imageData.height);

const createClipboardPayloadFromFloatingPaste = (
  floatingPaste: NonNullable<AppState['floatingPaste']>,
  mode: 'copy' | 'cut'
): SelectionClipboardPayload => {
  if (!floatingPaste.imageData) {
    throw new Error('Floating paste is missing image data.');
  }

  return {
    imageData: cloneImageData(floatingPaste.imageData),
    position: {
      x: Math.round(floatingPaste.position.x),
      y: Math.round(floatingPaste.position.y),
    },
    width: floatingPaste.imageData.width,
    height: floatingPaste.imageData.height,
    mode,
    colorCycleIndices: floatingPaste.colorCycleIndices
      ? new Uint8Array(floatingPaste.colorCycleIndices)
      : null,
    colorCycleGradientIds: floatingPaste.colorCycleGradientIds
      ? new Uint8Array(floatingPaste.colorCycleGradientIds)
      : null,
    colorCycleSlotPalettes: cloneTransferredColorCycleSlotPalettes(floatingPaste.colorCycleSlotPalettes),
    colorCycleGradientDefIds: floatingPaste.colorCycleGradientDefIds
      ? new Uint16Array(floatingPaste.colorCycleGradientDefIds)
      : null,
    colorCycleGradientDefs: cloneTransferredColorCycleGradientDefs(floatingPaste.colorCycleGradientDefs),
    colorCycleSpeed: floatingPaste.colorCycleSpeed
      ? new Uint8Array(floatingPaste.colorCycleSpeed)
      : null,
    colorCycleFlow: floatingPaste.colorCycleFlow
      ? new Uint8Array(floatingPaste.colorCycleFlow)
      : null,
    colorCycleSourceLayerId: floatingPaste.sourceLayerId ?? null,
  };
};
