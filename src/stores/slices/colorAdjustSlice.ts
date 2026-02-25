import type { StateCreator } from 'zustand';
import type { ColorAdjustParams, ColorAdjustState, Layer } from '@/types';
import { clampSelectionBounds } from '@/stores/helpers/selectionRoi';
import { cloneLayerImageData, commitLayerHistory } from '@/history/helpers/layerHistory';
import { selectionSnapshotFromValues } from '@/history/selectionState';
import { applyColorAdjustments } from '@/utils/imageProcessing';

type AppState = import('../useAppStore').AppState;

let colorAdjustPreviewHandle: number | null = null;

// Per-layer working buffers to avoid reallocations during slider drags
const workingImageCache = new Map<string, ImageData>();
const scratchCache = new Map<string, ImageData>();

const snapshotLayerImageData = (layer: Layer | undefined): ImageData | null => {
  if (!layer) {
    return null;
  }
  if (layer.imageData) {
    return cloneLayerImageData(layer.imageData);
  }

  // Fallback: read from framebuffer when imageData hasn't been synced yet.
  const framebuffer = layer.framebuffer;
  if (!framebuffer) {
    return null;
  }

  try {
    const fbCtx = framebuffer.getContext(
      '2d',
      { willReadFrequently: true } as CanvasRenderingContext2DSettings
    ) as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
    if (!fbCtx) {
      return null;
    }
    return fbCtx.getImageData(0, 0, framebuffer.width, framebuffer.height);
  } catch {
    return null;
  }
};

const getWorkingImage = (layerId: string, width: number, height: number): ImageData => {
  const cacheKey = layerId;
  const existing = workingImageCache.get(cacheKey);
  if (existing && existing.width === width && existing.height === height) {
    return existing;
  }
  const fresh = new ImageData(new Uint8ClampedArray(width * height * 4), width, height);
  workingImageCache.set(cacheKey, fresh);
  return fresh;
};

const getScratchImage = (layerId: string, width: number, height: number): ImageData => {
  const cacheKey = `${layerId}-${width}x${height}`;
  const existing = scratchCache.get(cacheKey);
  if (existing && existing.width === width && existing.height === height) {
    return existing;
  }
  const fresh = new ImageData(new Uint8ClampedArray(width * height * 4), width, height);
  scratchCache.set(cacheKey, fresh);
  return fresh;
};

// Copy a rectangular region from source into target (same pixel format)
const copyRegion = (
  source: ImageData,
  target: ImageData,
  bounds: { x: number; y: number; width: number; height: number }
): void => {
  const { x, y, width, height } = bounds;
  for (let row = 0; row < height; row += 1) {
    const srcStart = ((y + row) * source.width + x) * 4;
    const tgtStart = ((y + row) * target.width + x) * 4;
    target.data.set(
      source.data.subarray(srcStart, srcStart + width * 4),
      tgtStart
    );
  }
};

  const pasteRegionAt = (
    source: ImageData,
    target: ImageData,
    destX: number,
    destY: number
  ): void => {
    const srcStride = source.width * 4;
    for (let row = 0; row < source.height; row += 1) {
      const srcStart = row * srcStride;
      const tgtStart = ((destY + row) * target.width + destX) * 4;
      target.data.set(
        source.data.subarray(srcStart, srcStart + source.width * 4),
      tgtStart
    );
  }
};

// Keep the framebuffer in sync with ImageData updates so compositing uses the adjusted pixels.
const syncFramebufferFromImageData = (layer: Layer | undefined, imageData: ImageData): void => {
  if (!layer?.framebuffer) {
    return;
  }

  try {
    const framebuffer = layer.framebuffer;
    if (framebuffer.width !== imageData.width || framebuffer.height !== imageData.height) {
      framebuffer.width = imageData.width;
      framebuffer.height = imageData.height;
    }

    const fbCtx = framebuffer.getContext(
      '2d',
      { willReadFrequently: true } as CanvasRenderingContext2DSettings
    ) as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;

    if (!fbCtx) {
      return;
    }

    fbCtx.clearRect(0, 0, framebuffer.width, framebuffer.height);
    fbCtx.putImageData(imageData, 0, 0);
  } catch (error) {
    if (process.env.NODE_ENV !== 'production') {
      console.warn('[colorAdjust] Failed to sync framebuffer', error);
    }
  }
};

const cancelScheduledColorAdjustPreview = (): void => {
  if (typeof window !== 'undefined' && colorAdjustPreviewHandle !== null) {
    cancelAnimationFrame(colorAdjustPreviewHandle);
  }
  colorAdjustPreviewHandle = null;
};

const scheduleColorAdjustPreview = (getState: () => AppState): void => {
  if (typeof window === 'undefined') {
    getState().previewColorAdjust();
    return;
  }

  cancelScheduledColorAdjustPreview();
  colorAdjustPreviewHandle = requestAnimationFrame(() => {
    colorAdjustPreviewHandle = null;
    getState().previewColorAdjust();
  });
};

export const defaultColorAdjustParams: ColorAdjustParams = {
  hue: 0,
  saturation: 0,
  lightness: 0,
  contrast: 0,
  red: 0,
  green: 0,
  blue: 0,
};

export const createDefaultColorAdjustState = (): ColorAdjustState => ({
  active: false,
  params: { ...defaultColorAdjustParams },
  originalImageData: null,
  selectionBounds: null,
  targetLayerId: null,
});

export interface ColorAdjustSlice {
  colorAdjust: ColorAdjustState;
  startColorAdjustSession: () => void;
  updateColorAdjustParams: (params: Partial<ColorAdjustParams>) => void;
  previewColorAdjust: () => void;
  applyColorAdjust: () => Promise<void>;
  cancelColorAdjust: () => void;
  resetColorAdjustParams: () => void;
}

export const createColorAdjustSlice: StateCreator<AppState, [], [], ColorAdjustSlice> = (set, get) => ({
  colorAdjust: createDefaultColorAdjustState(),
  startColorAdjustSession: () => {
    const state = get();
    const { activeLayerId, layers } = state;
    if (!activeLayerId) {
      set({ colorAdjust: createDefaultColorAdjustState() });
      return;
    }

    const layer = layers.find((l) => l.id === activeLayerId);
    if (!layer || layer.layerType !== 'normal') {
      set({ colorAdjust: createDefaultColorAdjustState() });
      return;
    }

    const originalImageData = snapshotLayerImageData(layer);
    if (!originalImageData) {
      set({ colorAdjust: createDefaultColorAdjustState() });
      return;
    }

    const selectionFromBounds =
      state.selectionStart && state.selectionEnd
        ? {
            x: Math.min(state.selectionStart.x, state.selectionEnd.x),
            y: Math.min(state.selectionStart.y, state.selectionEnd.y),
            width: Math.abs(state.selectionEnd.x - state.selectionStart.x),
            height: Math.abs(state.selectionEnd.y - state.selectionStart.y),
          }
        : null;
    const canvasSelection = state.canvas.selection;
    const rawBounds =
      selectionFromBounds && selectionFromBounds.width > 0 && selectionFromBounds.height > 0
        ? selectionFromBounds
        : canvasSelection?.active
          ? canvasSelection.bounds
          : null;
    const selectionBounds = clampSelectionBounds(
      rawBounds,
      originalImageData.width,
      originalImageData.height
    );

    set({
      colorAdjust: {
        active: true,
        targetLayerId: layer.id,
        originalImageData,
        selectionBounds,
        params: { ...defaultColorAdjustParams },
      },
    });
    scheduleColorAdjustPreview(get);
  },
  updateColorAdjustParams: (params) => {
    let didUpdate = false;
    set((state) => {
      if (!state.colorAdjust.active) {
        return state;
      }

      didUpdate = true;
      return {
        colorAdjust: {
          ...state.colorAdjust,
          params: {
            ...state.colorAdjust.params,
            ...params,
          },
        },
      };
    });

    if (didUpdate) {
      scheduleColorAdjustPreview(get);
    }
  },
  previewColorAdjust: () => {
    const state = get();
    const { colorAdjust } = state;
    if (!colorAdjust.active || !colorAdjust.targetLayerId || !colorAdjust.originalImageData) {
      return;
    }

    const layer = state.layers.find((l) => l.id === colorAdjust.targetLayerId);
    if (!layer || layer.layerType !== 'normal') {
      return;
    }

    const { params, selectionBounds, originalImageData, targetLayerId } = colorAdjust;
    const hasAdjustments =
      params.hue !== 0 ||
      params.saturation !== 0 ||
      params.lightness !== 0 ||
      params.contrast !== 0 ||
      params.red !== 0 ||
      params.green !== 0 ||
      params.blue !== 0;

    const working = getWorkingImage(targetLayerId, originalImageData.width, originalImageData.height);

    if (!selectionBounds) {
      // Full-layer adjustment; copy baseline then adjust
      working.data.set(originalImageData.data);
      const adjusted = hasAdjustments
        ? applyColorAdjustments(working, params)
        : cloneLayerImageData(working) ?? working;
      state.updateLayer(layer.id, { imageData: adjusted });
      syncFramebufferFromImageData(layer, adjusted);
    state.setLayersNeedRecomposition(true);
    return;
  }

  // ROI path: keep baseline elsewhere intact, only touch the selection bounds
  copyRegion(originalImageData, working, selectionBounds); // restore baseline for ROI

    const { width, height, x, y } = selectionBounds;
    const scratch = getScratchImage(targetLayerId, width, height);
    const targetStride = scratch.width * 4;
    for (let row = 0; row < height; row += 1) {
      const srcStart = ((y + row) * originalImageData.width + x) * 4;
      const tgtStart = row * targetStride;
      scratch.data.set(
        originalImageData.data.subarray(srcStart, srcStart + width * 4),
        tgtStart
      );
    }

    const adjustedRegion = hasAdjustments
      ? applyColorAdjustments(scratch, params)
      : scratch;

    pasteRegionAt(adjustedRegion, working, selectionBounds.x, selectionBounds.y);

    syncFramebufferFromImageData(layer, working);
    state.updateLayer(layer.id, { imageData: working });
    state.setLayersNeedRecomposition(true);
    return;

  },
  applyColorAdjust: async () => {
    const state = get();
    const { colorAdjust } = state;
    if (!colorAdjust.active || !colorAdjust.targetLayerId || !colorAdjust.originalImageData) {
      return;
    }

    cancelScheduledColorAdjustPreview();

    const layer = state.layers.find((l) => l.id === colorAdjust.targetLayerId);
    if (!layer || layer.layerType !== 'normal') {
      set({ colorAdjust: createDefaultColorAdjustState() });
      return;
    }

    const beforeImage = cloneLayerImageData(colorAdjust.originalImageData);
    if (!beforeImage) {
      set({ colorAdjust: createDefaultColorAdjustState() });
      return;
    }

    get().previewColorAdjust();

    const selectionSnapshot =
      state.selectionStart && state.selectionEnd
        ? selectionSnapshotFromValues(state.selectionStart, state.selectionEnd)
        : null;

    await commitLayerHistory({
      layerId: layer.id,
      beforeImage,
      beforeColorState: null,
      actionType: 'color-adjust',
      description: 'Color adjust',
      tool: 'color-adjust',
      selectionBefore: selectionSnapshot ?? undefined,
      bitmapRoi: colorAdjust.selectionBounds ?? undefined,
    }).catch((error) => {
      if (process.env.NODE_ENV !== 'production') {
        console.warn('[history] Failed to record color adjust', error);
      }
    });

    const refreshedLayer = get().layers.find((l) => l.id === layer.id);
    const updatedBaseline = refreshedLayer?.imageData
      ? cloneLayerImageData(refreshedLayer.imageData)
      : null;

    if (updatedBaseline) {
      set((prev) => ({
        colorAdjust: {
          active: true,
          targetLayerId: layer.id,
          originalImageData: updatedBaseline,
          selectionBounds: prev.colorAdjust.selectionBounds,
          params: { ...defaultColorAdjustParams },
        },
      }));
    } else {
      set({ colorAdjust: createDefaultColorAdjustState() });
    }
  },
  cancelColorAdjust: () => {
    const state = get();
    const { colorAdjust } = state;
    if (!colorAdjust.active || !colorAdjust.targetLayerId || !colorAdjust.originalImageData) {
      set({ colorAdjust: createDefaultColorAdjustState() });
      return;
    }

    cancelScheduledColorAdjustPreview();

    const layer = state.layers.find((l) => l.id === colorAdjust.targetLayerId);
    if (layer && layer.layerType === 'normal') {
      const restoredImage = cloneLayerImageData(colorAdjust.originalImageData);
      if (restoredImage) {
        syncFramebufferFromImageData(layer, restoredImage);
        state.updateLayer(layer.id, { imageData: restoredImage });
        state.setLayersNeedRecomposition(true);
      }
    }

    set({ colorAdjust: createDefaultColorAdjustState() });
  },
  resetColorAdjustParams: () => {
    let didReset = false;
    set((state) => {
      if (!state.colorAdjust.active) {
        return state;
      }

      didReset = true;
      return {
        colorAdjust: {
          ...state.colorAdjust,
          params: { ...defaultColorAdjustParams },
        },
      };
    });

    if (didReset) {
      scheduleColorAdjustPreview(get);
    }
  },
});

export { cancelScheduledColorAdjustPreview };
