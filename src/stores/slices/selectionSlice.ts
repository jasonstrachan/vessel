import type { StateCreator } from 'zustand';
import type { Rectangle } from '@/types';
import { selectionSnapshotFromValues } from '@/history/selectionState';
import { cloneLayerImageData, commitLayerHistory } from '@/history/helpers/layerHistory';
import { captureColorCycleBrushState } from '@/history/helpers/colorCycle';
import { createSelectionPasteHelpers } from '@/stores/helpers/selectionPaste';

type AppState = import('../useAppStore').AppState;

export interface SelectionSlice {
  selectionStart: { x: number; y: number } | null;
  selectionEnd: { x: number; y: number } | null;
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
  } | null) => void;
  updateFloatingPastePosition: (position: { x: number; y: number }) => void;
  updateFloatingPasteRect: (rect: { x: number; y: number; width: number; height: number }) => void;
  commitFloatingPaste: () => Promise<void>;
  cancelFloatingPaste: () => void;
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
    captureCanvasToActiveLayer: (canvas, roi) => get().captureCanvasToActiveLayer(canvas, roi),
  });

  return {
    selectionStart: null,
    selectionEnd: null,
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
      if (!activeLayer || !activeLayer.imageData || !activeLayerId) {
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
          newImageData.data[index] = 0;
          newImageData.data[index + 1] = 0;
          newImageData.data[index + 2] = 0;
          newImageData.data[index + 3] = 0;
        }
      }

      state.updateLayer(activeLayerId, { imageData: newImageData });
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
      set({
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
            }
          : null,
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
  };
};
