import type { StateCreator } from 'zustand';
import type { ColorAdjustParams, ColorAdjustState } from '@/types';
import { clampSelectionBounds, copyRegionIntoTarget } from '@/stores/helpers/selectionRoi';
import { cloneLayerImageData, commitLayerHistory } from '@/history/helpers/layerHistory';
import { selectionSnapshotFromValues } from '@/history/selectionState';
import { applyColorAdjustments } from '@/utils/imageProcessing';

type AppState = import('../useAppStore').AppState;

let colorAdjustPreviewHandle: number | null = null;

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
    if (!layer || layer.layerType !== 'normal' || !layer.imageData) {
      set({ colorAdjust: createDefaultColorAdjustState() });
      return;
    }

    const originalImageData = cloneLayerImageData(layer.imageData);
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

    const { params, selectionBounds, originalImageData } = colorAdjust;
    const hasAdjustments =
      params.hue !== 0 || params.saturation !== 0 || params.lightness !== 0 || params.contrast !== 0;

    let finalImageData: ImageData;
    if (!hasAdjustments) {
      const baselineImage = cloneLayerImageData(originalImageData) ?? originalImageData;
      finalImageData = baselineImage;
    } else {
      const adjustedImage = applyColorAdjustments(originalImageData, params);
      if (selectionBounds) {
        const compositeImage = cloneLayerImageData(originalImageData);
        if (!compositeImage) {
          return;
        }
        copyRegionIntoTarget(adjustedImage, compositeImage, selectionBounds);
        finalImageData = compositeImage;
      } else {
        finalImageData = adjustedImage;
      }
    }

    state.updateLayer(layer.id, { imageData: finalImageData });
    state.setLayersNeedRecomposition(true);
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
