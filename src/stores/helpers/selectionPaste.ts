import type { StoreApi } from 'zustand';
import type { AppState, CaptureROI } from '@/stores/useAppStore';
import type { Rectangle } from '@/types';
import { captureColorCycleBrushState } from '@/history/helpers/colorCycle';
import type { ColorCycleSerializedState } from '@/history/helpers/colorCycle';
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

const getRotatedBoundingRect = (rect: FloatRect, rotation: number): FloatRect => {
  if (!rotation) {
    return rect;
  }
  const radians = (rotation * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const bboxWidth = Math.abs(rect.width * cos) + Math.abs(rect.height * sin);
  const bboxHeight = Math.abs(rect.width * sin) + Math.abs(rect.height * cos);
  const centerX = rect.x + rect.width / 2;
  const centerY = rect.y + rect.height / 2;
  return {
    x: centerX - bboxWidth / 2,
    y: centerY - bboxHeight / 2,
    width: bboxWidth,
    height: bboxHeight,
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

const roundRect = (rect: FloatRect): Rectangle => {
  const x = Math.floor(rect.x);
  const y = Math.floor(rect.y);
  const right = Math.ceil(rect.x + rect.width);
  const bottom = Math.ceil(rect.y + rect.height);
  return {
    x,
    y,
    width: Math.max(0, right - x),
    height: Math.max(0, bottom - y),
  };
};

const unionWithProjectBounds = (
  a: Rectangle,
  b: Rectangle,
  project: { width: number; height: number }
): Rectangle | null => {
  const minX = Math.max(0, Math.min(a.x, b.x));
  const minY = Math.max(0, Math.min(a.y, b.y));
  const maxX = Math.min(project.width, Math.max(a.x + a.width, b.x + b.width));
  const maxY = Math.min(project.height, Math.max(a.y + a.height, b.y + b.height));
  const width = maxX - minX;
  const height = maxY - minY;
  if (width <= 0 || height <= 0) {
    return null;
  }
  return { x: minX, y: minY, width, height };
};

const extractImageDataRoi = (
  imageData: ImageData,
  roi: Rectangle
): ImageData | null => {
  if (roi.width <= 0 || roi.height <= 0) {
    return null;
  }
  if (
    roi.x < 0 ||
    roi.y < 0 ||
    roi.x + roi.width > imageData.width ||
    roi.y + roi.height > imageData.height
  ) {
    return null;
  }

  const result = new Uint8ClampedArray(roi.width * roi.height * 4);
  for (let y = 0; y < roi.height; y += 1) {
    const srcStart = ((roi.y + y) * imageData.width + roi.x) * 4;
    const srcEnd = srcStart + roi.width * 4;
    result.set(imageData.data.slice(srcStart, srcEnd), y * roi.width * 4);
  }

  return new ImageData(result, roi.width, roi.height);
};

const synthesizeMoveBeforeImage = ({
  roi,
  sourceBounds,
  sourceImage,
  context2d,
}: {
  roi: Rectangle;
  sourceBounds: Rectangle;
  sourceImage: ImageData;
  context2d: CanvasRenderingContext2D;
}): ImageData | null => {
  if (roi.width <= 0 || roi.height <= 0) {
    return null;
  }

  let composed: ImageData;
  try {
    composed = context2d.getImageData(roi.x, roi.y, roi.width, roi.height);
  } catch {
    return null;
  }

  const sourceX = Math.floor(sourceBounds.x);
  const sourceY = Math.floor(sourceBounds.y);
  const sourceWidth = Math.min(Math.ceil(sourceBounds.width), sourceImage.width);
  const sourceHeight = Math.min(Math.ceil(sourceBounds.height), sourceImage.height);
  const overlayStartX = Math.max(sourceX, roi.x);
  const overlayStartY = Math.max(sourceY, roi.y);
  const overlayEndX = Math.min(sourceX + sourceWidth, roi.x + roi.width);
  const overlayEndY = Math.min(sourceY + sourceHeight, roi.y + roi.height);

  if (overlayEndX <= overlayStartX || overlayEndY <= overlayStartY) {
    return composed;
  }

  for (let y = overlayStartY; y < overlayEndY; y += 1) {
    const sourceRow = (y - sourceY) * sourceImage.width;
    const composedRow = (y - roi.y) * composed.width;
    for (let x = overlayStartX; x < overlayEndX; x += 1) {
      const sourceIndex = (sourceRow + (x - sourceX)) * 4;
      const destIndex = (composedRow + (x - roi.x)) * 4;
      composed.data[destIndex] = sourceImage.data[sourceIndex] ?? 0;
      composed.data[destIndex + 1] = sourceImage.data[sourceIndex + 1] ?? 0;
      composed.data[destIndex + 2] = sourceImage.data[sourceIndex + 2] ?? 0;
      composed.data[destIndex + 3] = sourceImage.data[sourceIndex + 3] ?? 0;
    }
  }

  return composed;
};

const rebuildMoveBeforeColorState = ({
  currentState,
  sourceBounds,
  sourceIndices,
  sourceGradientIds,
  sourceSpeed,
  sourceFlow,
  sourceWidth,
  sourceHeight,
  canvasWidth,
  canvasHeight,
}: {
  currentState: ColorCycleSerializedState;
  sourceBounds: Rectangle;
  sourceIndices: Uint8Array;
  sourceGradientIds?: Uint8Array | null;
  sourceSpeed?: Uint8Array | null;
  sourceFlow?: Uint8Array | null;
  sourceWidth: number;
  sourceHeight: number;
  canvasWidth: number;
  canvasHeight: number;
}): ColorCycleSerializedState => {
  if (!currentState?.layers?.length) {
    return currentState;
  }
  const layer0 = currentState.layers[0];
  const paintBuffer = layer0?.strokeData?.paintBuffer
    ? new Uint8Array(layer0.strokeData.paintBuffer)
    : null;
  const gradientBuffer = layer0?.strokeData?.gradientIdBuffer
    ? new Uint8Array(layer0.strokeData.gradientIdBuffer)
    : null;
  const speedBuffer = layer0?.strokeData?.speedBuffer
    ? new Uint8Array(layer0.strokeData.speedBuffer)
    : null;
  const flowBuffer = layer0?.strokeData?.flowBuffer
    ? new Uint8Array(layer0.strokeData.flowBuffer)
    : null;
  if (!paintBuffer || paintBuffer.length !== canvasWidth * canvasHeight) {
    return currentState;
  }

  const restored = paintBuffer.slice();
  const startX = Math.max(0, Math.floor(sourceBounds.x));
  const startY = Math.max(0, Math.floor(sourceBounds.y));
  const endX = Math.min(canvasWidth, Math.ceil(sourceBounds.x + sourceBounds.width));
  const endY = Math.min(canvasHeight, Math.ceil(sourceBounds.y + sourceBounds.height));

  for (let y = startY; y < endY; y += 1) {
    for (let x = startX; x < endX; x += 1) {
      const localX = x - startX;
      const localY = y - startY;
      if (localX < 0 || localY < 0 || localX >= sourceWidth || localY >= sourceHeight) {
        continue;
      }
      const srcIndex = localY * sourceWidth + localX;
      const dstIndex = y * canvasWidth + x;
      restored[dstIndex] = sourceIndices[srcIndex] ?? 0;
      if (gradientBuffer && gradientBuffer.length === canvasWidth * canvasHeight) {
        gradientBuffer[dstIndex] = sourceGradientIds?.[srcIndex] ?? 0;
      }
      if (speedBuffer && speedBuffer.length === canvasWidth * canvasHeight) {
        speedBuffer[dstIndex] = sourceSpeed?.[srcIndex] ?? 0;
      }
      if (flowBuffer && flowBuffer.length === canvasWidth * canvasHeight) {
        flowBuffer[dstIndex] = sourceFlow?.[srcIndex] ?? 0;
      }
    }
  }

  const nextLayer0 = {
    ...layer0,
    strokeData: layer0.strokeData
      ? {
          ...layer0.strokeData,
          paintBuffer: restored.buffer,
          gradientIdBuffer: gradientBuffer?.buffer ?? layer0.strokeData.gradientIdBuffer,
          speedBuffer: speedBuffer?.buffer ?? layer0.strokeData.speedBuffer,
          flowBuffer: flowBuffer?.buffer ?? layer0.strokeData.flowBuffer,
        }
      : layer0.strokeData,
  };

  return {
    ...currentState,
    layers: [nextLayer0, ...currentState.layers.slice(1)],
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

    const beforeColorState =
      activeLayer.layerType === 'color-cycle'
        ? captureColorCycleBrushState(activeLayer.id)
        : null;
    const floatingPasteHistoryContext = state.floatingPasteHistoryContext;
    const useMoveHistoryContext = Boolean(
      floatingPasteHistoryContext &&
      floatingPaste.sourceLayerId &&
      floatingPasteHistoryContext.sourceLayerId === floatingPaste.sourceLayerId &&
      activeLayer.id === floatingPasteHistoryContext.sourceLayerId
    );
    const historyBeforeColorState = (() => {
      if (!useMoveHistoryContext) {
        return beforeColorState;
      }
      const contextState = floatingPasteHistoryContext?.beforeColorState;
      if (contextState) {
        return contextState;
      }
      if (
        activeLayer.layerType === 'color-cycle' &&
        floatingPasteHistoryContext &&
        floatingPaste.colorCycleIndices &&
        project
      ) {
        return rebuildMoveBeforeColorState({
          currentState: beforeColorState,
          sourceBounds: floatingPasteHistoryContext.sourceBounds,
          sourceIndices: floatingPaste.colorCycleIndices,
          sourceGradientIds: floatingPasteHistoryContext.sourceGradientIds,
          sourceSpeed: floatingPasteHistoryContext.sourceSpeed,
          sourceFlow: floatingPasteHistoryContext.sourceFlow,
          sourceWidth: floatingPaste.width,
          sourceHeight: floatingPaste.height,
          canvasWidth: project.width,
          canvasHeight: project.height,
        });
      }
      return beforeColorState;
    })();
    const addNotification = state.addNotification;
    let beforeImage: ImageData | null = null;
    let moveHistoryRoi: Rectangle | null = null;

    try {
      const destinationRect = getDestinationRect(floatingPaste);
      const rotation = floatingPaste.rotation ?? 0;
      const rotatedBounds = getRotatedBoundingRect(destinationRect, rotation);
      if (useMoveHistoryContext && floatingPasteHistoryContext) {
        const sourceRect = floatingPasteHistoryContext.sourceBounds;
        const destRect = roundRect(rotatedBounds);
        moveHistoryRoi = unionWithProjectBounds(sourceRect, destRect, project);
        if (moveHistoryRoi && floatingPasteHistoryContext.beforeImage) {
          const extractedBeforeImage = extractImageDataRoi(
            floatingPasteHistoryContext.beforeImage,
            moveHistoryRoi
          );
          if (extractedBeforeImage) {
            beforeImage = extractedBeforeImage;
          }
        }
      }
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

      if (activeLayer.layerType === 'color-cycle' && !hasColorCycleData) {
        if (process.env.NODE_ENV !== 'production') {
          console.warn('[floatingPaste] Missing color cycle indices for paste commit', {
            layerId: activeLayer.id,
          });
        }
        addNotification?.({
          type: 'warning',
          title: 'Paste blocked',
          message: 'Color-cycle paste requires color-cycle data. Copy from a color-cycle layer or paste onto a normal layer.',
          timestamp: new Date(),
        });
        return;
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
          {
            offsetX: 0,
            offsetY: 0,
            alphaData: floatingPaste.imageData?.data ?? null,
            alphaStride: 4,
            alphaChannelOffset: 3,
            alphaThreshold: 0,
          }
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
            beforeColorState: historyBeforeColorState,
            bitmapRoi: moveHistoryRoi ?? colorCycleDestRect,
            actionType: 'paste',
            description: 'Committed paste',
            tool: 'paste',
            selectionBefore: useMoveHistoryContext ? floatingPasteHistoryContext?.selectionBefore : undefined,
          });

          set({ floatingPaste: null, floatingPasteHistoryContext: null });
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

      const captureArea = intersectWithProject(rotatedBounds, project);
      if (!captureArea) {
        set({ floatingPaste: null, floatingPasteHistoryContext: null });
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

      const roundedDestRect = {
        x: Math.round(destinationRect.x),
        y: Math.round(destinationRect.y),
        width: Math.round(destinationRect.width),
        height: Math.round(destinationRect.height),
      };
      const roiX = clamp(roundedDestRect.x, 0, project.width);
      const roiY = clamp(roundedDestRect.y, 0, project.height);
      const roiWidth = clamp(roundedDestRect.width, 0, project.width - roiX);
      const roiHeight = clamp(roundedDestRect.height, 0, project.height - roiY);
      const bitmapRoi =
        roiWidth > 0 && roiHeight > 0
          ? {
              x: roiX,
              y: roiY,
              width: roiWidth,
              height: roiHeight,
            }
          : null;
      if (
        !beforeImage &&
        useMoveHistoryContext &&
        moveHistoryRoi &&
        floatingPasteHistoryContext &&
        (floatingPasteHistoryContext.sourceBeforeImage || floatingPaste.imageData)
      ) {
        beforeImage = synthesizeMoveBeforeImage({
          roi: moveHistoryRoi,
          sourceBounds: floatingPasteHistoryContext.sourceBounds,
          sourceImage: floatingPasteHistoryContext.sourceBeforeImage ?? floatingPaste.imageData!,
          context2d: tempCtx,
        });
      }
      if (!beforeImage) {
        beforeImage = bitmapRoi
          ? tempCtx.getImageData(bitmapRoi.x, bitmapRoi.y, bitmapRoi.width, bitmapRoi.height)
          : null;
      }

      const pasteCanvas = document.createElement('canvas');
      pasteCanvas.width = floatingPaste.width;
      pasteCanvas.height = floatingPaste.height;
      const pasteCtx = pasteCanvas.getContext('2d', { willReadFrequently: true });
      if (pasteCtx) {
        try {
          pasteCtx.putImageData(floatingPaste.imageData, 0, 0);
        } catch {}

        // Selection scale/transform should preserve exact pixel alpha values.
        tempCtx.imageSmoothingEnabled = false;

        if (rotation) {
          const centerX = destinationRect.x + destinationRect.width / 2;
          const centerY = destinationRect.y + destinationRect.height / 2;
          const radians = (rotation * Math.PI) / 180;
          tempCtx.save();
          tempCtx.translate(centerX, centerY);
          tempCtx.rotate(radians);
          tempCtx.drawImage(
            pasteCanvas,
            -destinationRect.width / 2,
            -destinationRect.height / 2,
            destinationRect.width,
            destinationRect.height
          );
          tempCtx.restore();
        } else {
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
      }

      await captureCanvasToActiveLayer(tempCanvas, captureArea);

      await commitLayerHistory({
        layerId: activeLayer.id,
        beforeImage,
        beforeColorState: historyBeforeColorState,
        bitmapRoi: moveHistoryRoi ?? bitmapRoi ?? undefined,
        actionType: 'paste',
        description: 'Committed paste',
        tool: 'paste',
        selectionBefore: useMoveHistoryContext ? floatingPasteHistoryContext?.selectionBefore : undefined,
      });

      set({ floatingPaste: null, floatingPasteHistoryContext: null });
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
        set({ floatingPaste: null, floatingPasteHistoryContext: null });
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
        const targetFramebuffer = targetLayer?.framebuffer ?? null;
        if (targetFramebuffer) {
          try {
            if (
              targetFramebuffer.width !== restoredImage.width ||
              targetFramebuffer.height !== restoredImage.height
            ) {
              targetFramebuffer.width = restoredImage.width;
              targetFramebuffer.height = restoredImage.height;
            }
            const fbCtx = targetFramebuffer.getContext('2d', { willReadFrequently: true }) as
              | CanvasRenderingContext2D
              | OffscreenCanvasRenderingContext2D
              | null;
            if (fbCtx && 'putImageData' in fbCtx) {
              fbCtx.putImageData(restoredImage, 0, 0);
            }
          } catch {
            // Fall back to imageData-only restore if framebuffer sync fails.
          }
        }

        state.updateLayer(
          floatingPaste.sourceLayerId,
          targetFramebuffer
            ? { imageData: restoredImage, framebuffer: targetFramebuffer }
            : { imageData: restoredImage }
        );
        state.setLayersNeedRecomposition(true);
        set({ floatingPaste: null, floatingPasteHistoryContext: null });
        return;
      }
    }

    set({ floatingPaste: null, floatingPasteHistoryContext: null });
  };

  return {
    commitFloatingPaste,
    cancelFloatingPaste,
  };
};
