import type { StateCreator } from 'zustand';
import type { Rectangle } from '@/types';
import { selectionSnapshotFromValues } from '@/history/selectionState';
import { cloneLayerImageData, commitLayerHistory } from '@/history/helpers/layerHistory';
import { captureColorCycleBrushState } from '@/history/helpers/colorCycle';
import { clearColorCycleRegion } from '@/stores/helpers/colorCycleSelection';
import { createSelectionPasteHelpers } from '@/stores/helpers/selectionPaste';
import { captureSelectionBitmap } from '@/stores/helpers/selectionCapture';

type AppState = import('../useAppStore').AppState;

export interface SelectionSlice {
  selectionStart: { x: number; y: number } | null;
  selectionEnd: { x: number; y: number } | null;
  selectionClipboard: SelectionClipboardPayload | null;
  setSelectionBounds: (
    start: { x: number; y: number } | null,
    end: { x: number; y: number } | null
  ) => void;
  clearSelection: () => void;
  selectAllActiveLayerPixels: () => void;
  deleteSelectedPixels: () => void;
  floatingPaste: {
    active: boolean;
    imageData: ImageData | null;
    position: { x: number; y: number };
    originalPosition: { x: number; y: number };
    width: number;
    height: number;
    displayWidth: number;
    displayHeight: number;
    sourceLayerId?: string | null;
    colorCycleIndices?: Uint8Array | null;
  } | null;
  setFloatingPaste: (paste: {
    imageData: ImageData;
    position: { x: number; y: number };
    width: number;
    height: number;
    displayWidth?: number;
    displayHeight?: number;
    originalPosition?: { x: number; y: number };
    sourceLayerId?: string | null;
    colorCycleIndices?: Uint8Array | null;
  } | null) => void;
  updateFloatingPastePosition: (position: { x: number; y: number }) => void;
  updateFloatingPasteRect: (rect: { x: number; y: number; width: number; height: number }) => void;
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
  colorCycleSourceLayerId?: string | null;
}

const computeBoundsFromSelection = (
  start: { x: number; y: number },
  end: { x: number; y: number }
): Rectangle => ({
  x: Math.min(start.x, end.x),
  y: Math.min(start.y, end.y),
  width: Math.abs(end.x - start.x),
  height: Math.abs(end.y - start.y),
});

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
    setSelectionBounds: (start, end) => set({ selectionStart: start, selectionEnd: end }),
    clearSelection: () => set({ selectionStart: null, selectionEnd: null }),
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
      });
    },
    deleteSelectedPixels: () => {
      const state = get();
      const { selectionStart, selectionEnd, layers, activeLayerId, project } = state;

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

      if (activeLayer.layerType === 'color-cycle') {
        const cleared = clearColorCycleRegion(state, activeLayer, project, { x, y, width, height });
        if (cleared) {
          const eraseMask = activeLayer.colorCycleData?.eraseMask;
          const eraseMaskCtx = eraseMask?.getContext('2d', { willReadFrequently: true });
          eraseMaskCtx?.clearRect(x, y, width, height);
        }
      } else {
        const framebuffer = activeLayer.framebuffer;
        if (framebuffer) {
          const fbCtx = framebuffer.getContext('2d', { willReadFrequently: true });
          if (fbCtx) {
            fbCtx.clearRect(x, y, width, height);
            const syncedImage = fbCtx.getImageData(0, 0, framebuffer.width, framebuffer.height);
            state.updateLayer(activeLayerId, { imageData: syncedImage });
          }
        } else if (activeLayer.imageData) {
          const newImageData = new ImageData(
            new Uint8ClampedArray(activeLayer.imageData.data),
            activeLayer.imageData.width,
            activeLayer.imageData.height
          );

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

          state.updateLayer(activeLayerId, { imageData: newImageData });
        }
      }

      state.setCurrentCompositeBitmap(null);
      state.setLayersNeedRecomposition(true);
      state.clearSelection();

      void commitLayerHistory({
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
    },

    floatingPaste: null,
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
                sourceLayerId: paste.sourceLayerId ?? null,
                colorCycleIndices: paste.colorCycleIndices ?? null,
              }
            : null,
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
          const capture = captureSelectionBitmap({
            selectionStart,
            selectionEnd,
            project,
            layer: activeLayer,
            clearSource: mode === 'cut',
          });

          if (capture) {
            clipboardPayload = {
              imageData: capture.selectionImageData,
              position: { x: capture.bounds.x, y: capture.bounds.y },
              width: capture.bounds.width,
              height: capture.bounds.height,
              mode,
              colorCycleIndices: capture.colorCycleIndices ?? null,
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
                });
                if (skipImageUpdate) {
                  const eraseMask = activeLayer.colorCycleData?.eraseMask;
                  const eraseMaskCtx = eraseMask?.getContext('2d', { willReadFrequently: true });
                  eraseMaskCtx?.clearRect(capture.bounds.x, capture.bounds.y, capture.bounds.width, capture.bounds.height);
                }
              }
              if (!skipImageUpdate) {
                state.updateLayer(activeLayerId, { imageData: capture.updatedLayerImageData });
              }
              state.setLayersNeedRecomposition(true);
              state.setCurrentCompositeBitmap(null);

              void commitLayerHistory({
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
            }
          }
        }
      }

      if (!clipboardPayload && floatingPaste?.imageData) {
        clipboardPayload = createClipboardPayloadFromFloatingPaste(floatingPaste, mode);
        if (mode === 'cut') {
          set({ floatingPaste: null });
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
    colorCycleSourceLayerId: floatingPaste.sourceLayerId ?? null,
  };
};
