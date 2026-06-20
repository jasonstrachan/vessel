import type { StateCreator } from 'zustand';

import type { Layer, Project } from '@/types';
import { computeLayerPercentOffset } from '@/utils/layerMetrics';
import { debugWarn, logError } from '@/utils/debug';
import {
  normalizeImageDataDimensions,
  snapshotFramebufferRegion,
} from '@/stores/layers/layerCloneService';
import {
  alphaCompositeImageDataRegion,
  normalizeCaptureROI,
  type CompositeMode,
} from '@/stores/layers/layerCanvasCapture';
import type { AppState, CaptureROI } from '../useAppStore';

type StoreSet = Parameters<StateCreator<AppState, [], [], AppState>>[0];
type StoreGet = Parameters<StateCreator<AppState, [], [], AppState>>[1];

export interface LayerCaptureActionDeps {
  set: StoreSet;
  get: StoreGet;
  syncPercentOffsetsFromPixels: (layers: Layer[], project: Project | null) => Layer[];
  createLayerTransferCanvas: (width: number, height: number) => HTMLCanvasElement | OffscreenCanvas | null;
  hasValidFramebuffer: (
    framebuffer: HTMLCanvasElement | OffscreenCanvas | null | undefined
  ) => framebuffer is HTMLCanvasElement | OffscreenCanvas;
}

export const captureCanvasToActiveLayerAction = async (
  sourceCanvas: HTMLCanvasElement | undefined,
  roi: CaptureROI | undefined,
  options: { mode?: CompositeMode } | undefined,
  deps: LayerCaptureActionDeps,
): Promise<void> => {
  const { set, get, syncPercentOffsetsFromPixels, createLayerTransferCanvas, hasValidFramebuffer } = deps;
  const state = get();

  if (state.history.isCapturing) {
    return;
  }
  if (!state.project || state.layers.length === 0) {
    return;
  }
  if (!sourceCanvas) {
    return;
  }

  const ctx = sourceCanvas.getContext(
    '2d',
    { willReadFrequently: true } as CanvasRenderingContext2DSettings
  ) as CanvasRenderingContext2D | null;
  if (!ctx) {
    return;
  }

  try {
    const projectWidth = state.project.width;
    const projectHeight = state.project.height;
    const captureWidth = Math.min(projectWidth, sourceCanvas.width);
    const captureHeight = Math.min(projectHeight, sourceCanvas.height);

    const normalizedRoi = normalizeCaptureROI(roi, captureWidth, captureHeight);
    const captureX = normalizedRoi ? normalizedRoi.x : 0;
    const captureY = normalizedRoi ? normalizedRoi.y : 0;
    const regionWidth = normalizedRoi ? normalizedRoi.width : captureWidth;
    const regionHeight = normalizedRoi ? normalizedRoi.height : captureHeight;

    const capturedImageData = ctx.getImageData(captureX, captureY, regionWidth, regionHeight);

    const { selectionMask, selectionMaskBounds, selectionStart, selectionEnd } = state;
    if (selectionMask && selectionMaskBounds) {
      const maskData = selectionMask.data;
      const mb = selectionMaskBounds;
      const stride = regionWidth * 4;
      for (let y = 0; y < regionHeight; y += 1) {
        const globalY = captureY + y;
        const localY = globalY - mb.y;
        const rowOffset = y * stride;
        if (localY < 0 || localY >= mb.height) {
          for (let x = 0; x < regionWidth; x += 1) {
            const idx = rowOffset + x * 4;
            capturedImageData.data[idx] = 0;
            capturedImageData.data[idx + 1] = 0;
            capturedImageData.data[idx + 2] = 0;
            capturedImageData.data[idx + 3] = 0;
          }
          continue;
        }
        for (let x = 0; x < regionWidth; x += 1) {
          const globalX = captureX + x;
          const localX = globalX - mb.x;
          const destIdx = rowOffset + x * 4;
          if (localX < 0 || localX >= mb.width) {
            capturedImageData.data[destIdx] = 0;
            capturedImageData.data[destIdx + 1] = 0;
            capturedImageData.data[destIdx + 2] = 0;
            capturedImageData.data[destIdx + 3] = 0;
            continue;
          }
          const maskIdx = (Math.floor(localY) * mb.width + Math.floor(localX)) * 4 + 3;
          if (maskData[maskIdx] === 0) {
            capturedImageData.data[destIdx] = 0;
            capturedImageData.data[destIdx + 1] = 0;
            capturedImageData.data[destIdx + 2] = 0;
            capturedImageData.data[destIdx + 3] = 0;
          }
        }
      }
    } else if (selectionStart && selectionEnd) {
      const minX = Math.min(selectionStart.x, selectionEnd.x);
      const maxX = Math.max(selectionStart.x, selectionEnd.x);
      const minY = Math.min(selectionStart.y, selectionEnd.y);
      const maxY = Math.max(selectionStart.y, selectionEnd.y);

      const stride = regionWidth * 4;
      for (let y = 0; y < regionHeight; y += 1) {
        const globalY = captureY + y;
        const rowOffset = y * stride;
        for (let x = 0; x < regionWidth; x += 1) {
          const globalX = captureX + x;
          const destIdx = rowOffset + x * 4;
          const inside =
            globalX >= minX && globalX < maxX && globalY >= minY && globalY < maxY;
          if (!inside) {
            capturedImageData.data[destIdx] = 0;
            capturedImageData.data[destIdx + 1] = 0;
            capturedImageData.data[destIdx + 2] = 0;
            capturedImageData.data[destIdx + 3] = 0;
          }
        }
      }
    }

    const activeLayerId = state.activeLayerId || state.layers[0]?.id;
    if (!activeLayerId) {
      return;
    }

    const activeLayer = state.layers.find((layer) => layer.id === activeLayerId);
    if (!activeLayer) {
      return;
    }

    if (activeLayer.layerType === 'color-cycle') {
      get().setLayersNeedRecomposition(true);
      return;
    }

    set((currentState) => {
      const updatedLayers = currentState.layers.map((layer) => {
        if (layer.id !== activeLayerId) {
          return layer;
        }

        const framebufferInitial = hasValidFramebuffer(layer.framebuffer)
          ? layer.framebuffer
          : createLayerTransferCanvas(captureWidth, captureHeight) ?? null;
        const matchedImageData =
          layer.imageData &&
          layer.imageData.width === captureWidth &&
          layer.imageData.height === captureHeight
            ? layer.imageData
            : null;
        const framebufferSnapshot = snapshotFramebufferRegion(
          framebufferInitial,
          captureWidth,
          captureHeight
        );

        const baseImageDataRaw =
          framebufferSnapshot ?? matchedImageData;

        const baseImageData =
          baseImageDataRaw &&
          (baseImageDataRaw.width !== captureWidth || baseImageDataRaw.height !== captureHeight)
            ? normalizeImageDataDimensions(baseImageDataRaw, captureWidth, captureHeight)
            : baseImageDataRaw;

        const targetWidth = baseImageData?.width ?? captureWidth;
        const targetHeight = baseImageData?.height ?? captureHeight;

        const compositeMode = options?.mode ?? 'alpha';
        const mergedImageData = alphaCompositeImageDataRegion(
          baseImageData,
          capturedImageData,
          captureX,
          captureY,
          targetWidth,
          targetHeight,
          compositeMode
        );

        let framebuffer = framebufferInitial;
        if (!framebuffer) {
          framebuffer = createLayerTransferCanvas(mergedImageData.width, mergedImageData.height) ?? null;
        }

        if (framebuffer) {
          if (framebuffer.width !== targetWidth || framebuffer.height !== targetHeight) {
            framebuffer.width = targetWidth;
            framebuffer.height = targetHeight;
          }

          const framebufferCtx = framebuffer.getContext(
            '2d',
            { willReadFrequently: true } as CanvasRenderingContext2DSettings
          ) as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
          framebufferCtx?.putImageData(mergedImageData, 0, 0);
        }

        let nextAlignment = layer.alignment;
        const project = currentState.project;
        if (project && nextAlignment && nextAlignment.positioning === 'auto') {
          try {
            const layerForMetrics: Layer = {
              ...layer,
              imageData: mergedImageData,
              alignment: {
                ...nextAlignment,
                offsetPercent: undefined,
                offsetPx: undefined,
              },
            };
            const percentOffset = computeLayerPercentOffset(layerForMetrics, project);
            const safeWidth = Math.max(1, project.width);
            const safeHeight = Math.max(1, project.height);
            nextAlignment = {
              ...nextAlignment,
              offsetPercent: percentOffset,
              offsetPx: {
                x: Math.round((percentOffset.x / 100) * safeWidth),
                y: Math.round((percentOffset.y / 100) * safeHeight),
              },
            };
          } catch (error) {
            debugWarn('raw-console', '[captureCanvasToActiveLayer] Failed to sync percent alignment', error);
          }
        }

        const updatedLayer: Layer = {
          ...layer,
          imageData: mergedImageData,
          framebuffer: framebuffer ?? layer.framebuffer,
          alignment: nextAlignment,
          version: (layer.version || 0) + 1,
        };

        if (updatedLayer.layerType !== layer.layerType) {
          logError('Layer type corruption detected in captureCanvasToActiveLayer', {
            layerId: layer.id?.substring(0, 20),
            originalType: layer.layerType,
            corruptedType: updatedLayer.layerType,
          });
          updatedLayer.layerType = layer.layerType;
        }

        return updatedLayer;
      });

      const syncedLayers = syncPercentOffsetsFromPixels(updatedLayers, currentState.project ?? null);
      return {
        layers: syncedLayers,
      };
    });

    get().setLayersNeedRecomposition(true);
  } catch (error) {
    if (error instanceof DOMException && error.name === 'SecurityError') {
      debugWarn('raw-console', '[captureCanvasToActiveLayer] Canvas capture blocked by CORS/security policy');
      return;
    }
    logError('[captureCanvasToActiveLayer] Failed', error);
    throw error;
  }
};

export const captureCanvasToLayerAction = async (
  sourceCanvas: HTMLCanvasElement,
  targetLayerId: string | null,
  deps: LayerCaptureActionDeps,
): Promise<void> => {
  const { set, get, syncPercentOffsetsFromPixels } = deps;
  const state = get();
  if (state.history.isCapturing) {
    return;
  }
  if (!state.project || state.layers.length === 0) {
    return;
  }
  if (!targetLayerId) {
    return;
  }

  const ctx = sourceCanvas.getContext(
    '2d',
    { willReadFrequently: true } as CanvasRenderingContext2DSettings
  ) as CanvasRenderingContext2D | null;
  if (!ctx) {
    return;
  }

  try {
    const captureWidth = Math.min(state.project.width, sourceCanvas.width);
    const captureHeight = Math.min(state.project.height, sourceCanvas.height);
    const imageData = ctx.getImageData(0, 0, captureWidth, captureHeight);

    const targetLayer = state.layers.find((layer) => layer.id === targetLayerId);
    if (!targetLayer) {
      return;
    }

    set((currentState) => {
      const updatedLayers = currentState.layers.map((layer) => {
        if (layer.id !== targetLayerId) {
          return layer;
        }

        const fb = layer.framebuffer;
        if (fb.width !== imageData.width || fb.height !== imageData.height) {
          fb.width = imageData.width;
          fb.height = imageData.height;
        }

        const ctx2 = fb.getContext(
          '2d',
          { willReadFrequently: true } as CanvasRenderingContext2DSettings
        ) as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
        if (ctx2) {
          ctx2.clearRect(0, 0, fb.width, fb.height);
          ctx2.putImageData(imageData, 0, 0);
        }

        return {
          ...layer,
          imageData,
        };
      });

      const syncedLayers = syncPercentOffsetsFromPixels(updatedLayers, currentState.project ?? null);
      return {
        layers: syncedLayers,
      };
    });

    get().setLayersNeedRecomposition(true);
  } catch (error) {
    logError('Capture to specific layer failed', error);
  }
};
