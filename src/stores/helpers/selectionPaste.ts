import type { StoreApi } from 'zustand';
import type { AppState, CaptureROI } from '@/stores/useAppStore';
import type { Rectangle } from '@/types';
import { cloneImageDataForHistory } from '@/stores/helpers/historyLifecycle';
import { captureColorCycleBrushState } from '@/history/helpers/colorCycle';
import { commitLayerHistory } from '@/history/helpers/layerHistory';
import { logError } from '@/utils/debug';
import {
  debugCaptureColorCycleScalarRegion,
  hasColorCycleIndices,
  writeColorCycleRegion,
} from '@/stores/helpers/colorCycleSelection';

type StoreGet = StoreApi<AppState>['getState'];
type StoreSet = StoreApi<AppState>['setState'];

type CaptureFn = AppState['captureCanvasToActiveLayer'];

const clamp = (value: number, min: number, max: number) => {
  return Math.max(min, Math.min(max, value));
};

type FloatRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

const getDestinationRect = (
  floatingPaste: NonNullable<AppState['floatingPaste']>
): FloatRect => {
  const width = Math.max(1, floatingPaste.displayWidth ?? floatingPaste.width);
  const height = Math.max(1, floatingPaste.displayHeight ?? floatingPaste.height);
  return {
    x: floatingPaste.position.x,
    y: floatingPaste.position.y,
    width,
    height,
  };
};

const intersectWithProject = (rect: FloatRect, project: { width: number; height: number }): CaptureROI | null => {
  const x = Math.max(rect.x, 0);
  const y = Math.max(rect.y, 0);
  const maxX = Math.min(rect.x + rect.width, project.width);
  const maxY = Math.min(rect.y + rect.height, project.height);
  const width = maxX - x;
  const height = maxY - y;
  if (width <= 0 || height <= 0) {
    return null;
  }
  return { x, y, width, height };
};

const deriveSourceCrop = (
  visibleRect: FloatRect,
  destRect: FloatRect,
  intrinsicWidth: number,
  intrinsicHeight: number
): FloatRect | null => {
  const safeSourceWidth = Math.max(1, intrinsicWidth);
  const safeSourceHeight = Math.max(1, intrinsicHeight);
  const scaleX = destRect.width / safeSourceWidth;
  const scaleY = destRect.height / safeSourceHeight;
  const safeScaleX = Number.isFinite(scaleX) && scaleX !== 0 ? scaleX : 1;
  const safeScaleY = Number.isFinite(scaleY) && scaleY !== 0 ? scaleY : 1;

  const sourceX = (visibleRect.x - destRect.x) / safeScaleX;
  const sourceY = (visibleRect.y - destRect.y) / safeScaleY;
  const sourceWidth = visibleRect.width / safeScaleX;
  const sourceHeight = visibleRect.height / safeScaleY;

  if (sourceWidth <= 0 || sourceHeight <= 0) {
    return null;
  }

  const clampToSource = (value: number, max: number) => clamp(value, 0, max);

  const clampedX = clampToSource(sourceX, safeSourceWidth);
  const clampedY = clampToSource(sourceY, safeSourceHeight);
  const maxWidth = safeSourceWidth - clampedX;
  const maxHeight = safeSourceHeight - clampedY;

  return {
    x: clampedX,
    y: clampedY,
    width: Math.min(sourceWidth, maxWidth),
    height: Math.min(sourceHeight, maxHeight),
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

    if (!floatingPaste || !project) {
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
      const destinationRect = getDestinationRect(floatingPaste);
      const colorCycleDestRect: Rectangle = {
        x: Math.round(floatingPaste.position.x),
        y: Math.round(floatingPaste.position.y),
        width: floatingPaste.width,
        height: floatingPaste.height,
      };

      if (process.env.NODE_ENV !== 'production' && activeLayer.layerType === 'color-cycle') {
        console.log('[floatingPaste] CC destRect', {
          layerId: activeLayer.id,
          rect: colorCycleDestRect,
          indicesLen: floatingPaste.colorCycleIndices?.length ?? 0,
        });
      }

      const hasColorCycleData = hasColorCycleIndices(floatingPaste);

      if (process.env.NODE_ENV !== 'production') {
        console.log('[floatingPaste] committing', {
          layerId: activeLayer.id,
          layerType: activeLayer.layerType,
          hasIndices: hasColorCycleData,
          indicesLen: floatingPaste.colorCycleIndices?.length ?? 0,
        });
      }

      if (activeLayer.layerType === 'color-cycle' && hasColorCycleData) {
        const beforeRegion = debugCaptureColorCycleScalarRegion(activeLayer, project, colorCycleDestRect);
        const applied = writeColorCycleRegion(
          state,
          activeLayer,
          project,
          colorCycleDestRect,
          floatingPaste.colorCycleIndices!,
          floatingPaste.width,
          floatingPaste.height,
          { offsetX: 0, offsetY: 0 }
        );
        const afterRegion = debugCaptureColorCycleScalarRegion(activeLayer, project, colorCycleDestRect);

        if (process.env.NODE_ENV !== 'production') {
          const beforeNonZero = beforeRegion ? beforeRegion.some((value) => value !== 0) : null;
          const afterNonZero = afterRegion ? afterRegion.some((value) => value !== 0) : null;
          console.log('[floatingPaste] CC region diff', {
            applied,
            beforeNonZero,
            afterNonZero,
            firstBefore: beforeRegion ? beforeRegion.slice(0, 16) : null,
            firstAfter: afterRegion ? afterRegion.slice(0, 16) : null,
          });
        }

        if (applied) {
          const eraseMask = activeLayer.colorCycleData?.eraseMask;
          const eraseMaskCtx = eraseMask?.getContext('2d', { willReadFrequently: true });
          if (eraseMaskCtx) {
            eraseMaskCtx.clearRect(
              colorCycleDestRect.x,
              colorCycleDestRect.y,
              colorCycleDestRect.width,
              colorCycleDestRect.height
            );
            state.updateLayer(
              activeLayer.id,
              {
                colorCycleData: {
                  ...(activeLayer.colorCycleData ?? {}),
                  eraseMask,
                },
              },
              { skipColorCycleSync: true }
            );
          }
          state.setLayersNeedRecomposition(true);
          state.setCurrentCompositeBitmap(null);

          await commitLayerHistory({
            layerId: activeLayer.id,
            beforeImage,
            beforeColorState,
            actionType: 'paste',
            description: 'Committed paste',
            tool: 'paste',
          });

          set({ floatingPaste: null });
          return;
        }

        if (process.env.NODE_ENV !== 'production') {
          console.warn('[floatingPaste] Failed to write color-cycle paste region', {
            layerId: activeLayer.id,
            rect: colorCycleDestRect,
          });
        }
        return;
      }

      if (!floatingPaste.imageData) {
        if (process.env.NODE_ENV !== 'production') {
          console.warn('[floatingPaste] Missing bitmap data for paste operation.');
        }
        return;
      }

      const captureArea = intersectWithProject(destinationRect, project);
      if (!captureArea) {
        set({ floatingPaste: null });
        return;
      }

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
        const sourceCrop = deriveSourceCrop(
          captureArea,
          destinationRect,
          floatingPaste.width,
          floatingPaste.height
        );
        if (!sourceCrop) {
          set({ floatingPaste: null });
          return;
        }

        tempCtx.drawImage(
          pasteCanvas,
          sourceCrop.x,
          sourceCrop.y,
          sourceCrop.width,
          sourceCrop.height,
          captureArea.x,
          captureArea.y,
          captureArea.width,
          captureArea.height
        );
      }

      await captureCanvasToActiveLayer(tempCanvas, captureArea);

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
    const project = state.project;

    if (
      floatingPaste &&
      hasColorCycleIndices(floatingPaste) &&
      floatingPaste.sourceLayerId &&
      project
    ) {
      const targetLayer = state.layers.find((layer) => layer.id === floatingPaste.sourceLayerId);
      if (targetLayer && targetLayer.layerType === 'color-cycle') {
        writeColorCycleRegion(
          state,
          targetLayer,
          project,
          {
            x: floatingPaste.originalPosition.x,
            y: floatingPaste.originalPosition.y,
            width: floatingPaste.width,
            height: floatingPaste.height,
          },
          floatingPaste.colorCycleIndices,
          floatingPaste.width,
          floatingPaste.height
        );
        state.setLayersNeedRecomposition(true);
        state.setCurrentCompositeBitmap(null);
        set({ floatingPaste: null });
        return;
      }
    }

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
