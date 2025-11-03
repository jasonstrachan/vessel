import type { StoreApi } from 'zustand';
import type { AppState, CaptureROI } from '@/stores/useAppStore';
import { cloneImageDataForHistory } from '@/stores/helpers/historyLifecycle';
import { captureColorCycleBrushState } from '@/history/helpers/colorCycle';
import { commitLayerHistory } from '@/history/helpers/layerHistory';
import { logError } from '@/utils/debug';

type StoreGet = StoreApi<AppState>['getState'];
type StoreSet = StoreApi<AppState>['setState'];

type CaptureFn = AppState['captureCanvasToActiveLayer'];

const clamp = (value: number, min: number, max: number) => {
  return Math.max(min, Math.min(max, value));
};

const normalizePasteROI = (
  floatingPaste: NonNullable<AppState['floatingPaste']>,
  project: { width: number; height: number }
): CaptureROI => {
  const width = Math.max(1, Math.round(floatingPaste.displayWidth ?? floatingPaste.width));
  const height = Math.max(1, Math.round(floatingPaste.displayHeight ?? floatingPaste.height));
  const x = clamp(Math.round(floatingPaste.position.x), 0, Math.max(0, project.width - width));
  const y = clamp(Math.round(floatingPaste.position.y), 0, Math.max(0, project.height - height));
  return {
    x,
    y,
    width: Math.min(width, project.width - x),
    height: Math.min(height, project.height - y),
  };
};

export const createSelectionPasteHelpers = ({
  get,
  captureCanvasToActiveLayer,
  set,
}: {
  get: StoreGet;
  set: StoreSet;
  captureCanvasToActiveLayer: CaptureFn;
}) => {
  const commitFloatingPaste = async (): Promise<void> => {
    const state = get();
    const { floatingPaste, layers, activeLayerId, project } = state;

    if (!floatingPaste || !floatingPaste.imageData || !project) {
      return;
    }

    const targetLayerId = activeLayerId ?? layers[0]?.id;
    if (!targetLayerId) {
      return;
    }

    const activeLayer = layers.find((layer) => layer.id === targetLayerId);
    if (!activeLayer) {
      return;
    }

    const beforeImage = activeLayer.imageData ? cloneImageDataForHistory(activeLayer.imageData) ?? null : null;
    const beforeColorState =
      activeLayer.layerType === 'color-cycle'
        ? captureColorCycleBrushState(activeLayer.id)
        : null;

    try {
      const roi = normalizePasteROI(floatingPaste, project);
      const tempCanvas = document.createElement('canvas');
      tempCanvas.width = project.width;
      tempCanvas.height = project.height;
      const tempCtx = tempCanvas.getContext('2d', { willReadFrequently: true });
      if (!tempCtx) {
        return;
      }

      if (activeLayer.imageData) {
        try {
          tempCtx.putImageData(activeLayer.imageData, 0, 0);
        } catch {}
      } else if (activeLayer.framebuffer) {
        try {
          tempCtx.drawImage(activeLayer.framebuffer, 0, 0);
        } catch {}
      }

      const pasteCanvas = document.createElement('canvas');
      pasteCanvas.width = floatingPaste.width;
      pasteCanvas.height = floatingPaste.height;
      const pasteCtx = pasteCanvas.getContext('2d', { willReadFrequently: true });
      if (pasteCtx) {
        try {
          pasteCtx.putImageData(floatingPaste.imageData, 0, 0);
        } catch {}
        tempCtx.drawImage(
          pasteCanvas,
          roi.x,
          roi.y,
          roi.width,
          roi.height
        );
      }

      await captureCanvasToActiveLayer(tempCanvas, roi);

      await commitLayerHistory({
        layerId: activeLayer.id,
        beforeImage,
        beforeColorState,
        actionType: 'paste',
        description: 'Committed paste',
        tool: 'paste',
      });

      set({ floatingPaste: null });
    } catch (error) {
      logError('[floatingPaste] Failed to commit paste', error);
    }
  };

  const cancelFloatingPaste = (): void => {
    const state = get();
    const floatingPaste = state.floatingPaste;

    if (floatingPaste && floatingPaste.imageData && floatingPaste.sourceLayerId) {
      const targetLayer = state.layers.find((layer) => layer.id === floatingPaste.sourceLayerId);
      let layerImageData = targetLayer?.imageData || null;

      if (!layerImageData && targetLayer?.framebuffer) {
        try {
          const tempCanvas = document.createElement('canvas');
          tempCanvas.width = targetLayer.framebuffer.width;
          tempCanvas.height = targetLayer.framebuffer.height;
          const tempCtx = tempCanvas.getContext('2d', { willReadFrequently: true });
          if (tempCtx) {
            tempCtx.drawImage(targetLayer.framebuffer, 0, 0);
            layerImageData = tempCtx.getImageData(0, 0, tempCanvas.width, tempCanvas.height);
          }
        } catch {
          layerImageData = null;
        }
      }

      if (layerImageData) {
        const restoredLayerData = new Uint8ClampedArray(layerImageData.data);
        const pasteData = floatingPaste.imageData.data;
        const pasteWidth = floatingPaste.imageData.width;
        const pasteHeight = floatingPaste.imageData.height;
        const baseX = clamp(Math.round(floatingPaste.originalPosition.x), 0, layerImageData.width);
        const baseY = clamp(Math.round(floatingPaste.originalPosition.y), 0, layerImageData.height);

        for (let y = 0; y < pasteHeight; y++) {
          const targetY = baseY + y;
          if (targetY < 0 || targetY >= layerImageData.height) continue;

          for (let x = 0; x < pasteWidth; x++) {
            const targetX = baseX + x;
            if (targetX < 0 || targetX >= layerImageData.width) continue;

            const destIndex = (targetY * layerImageData.width + targetX) * 4;
            const srcIndex = (y * pasteWidth + x) * 4;

            restoredLayerData[destIndex] = pasteData[srcIndex];
            restoredLayerData[destIndex + 1] = pasteData[srcIndex + 1];
            restoredLayerData[destIndex + 2] = pasteData[srcIndex + 2];
            restoredLayerData[destIndex + 3] = pasteData[srcIndex + 3];
          }
        }

        const restoredImage = new ImageData(restoredLayerData, layerImageData.width, layerImageData.height);
        state.updateLayer(floatingPaste.sourceLayerId, { imageData: restoredImage });
        state.setLayersNeedRecomposition(true);
        set({ floatingPaste: null });
        return;
      }
    }

    set({ floatingPaste: null });
  };

  return {
    commitFloatingPaste,
    cancelFloatingPaste,
  };
};
