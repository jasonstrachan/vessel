import type { ColorCycleSerializedState } from '@/history/helpers/colorCycle';
import {
  readColorCycleBrushSerializedStateFromRuntime,
  resolveColorCyclePaintCoverageFromSerializedState,
  type ColorCycleBrushSerializedStateRuntimeReader,
} from '@/lib/colorCycle/document';
import type { ColorCycleSoftEdgeCoverage } from '@/utils/colorCycleSoftEdgeMask';
import type { Layer } from '@/types';

export const applyColorCycleEraseMask = (
  layer: Layer,
  targetCanvas: HTMLCanvasElement | OffscreenCanvas
): void => {
  const eraseMask = layer.colorCycleData?.eraseMask;
  if (!eraseMask) {
    return;
  }
  const canvasCtx = targetCanvas.getContext(
    '2d',
    { willReadFrequently: true } as CanvasRenderingContext2DSettings
  ) as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
  if (!canvasCtx) {
    return;
  }

  canvasCtx.save();
  canvasCtx.globalCompositeOperation = 'destination-out';
  canvasCtx.globalAlpha = 1;
  try {
    canvasCtx.drawImage(eraseMask as CanvasImageSource, 0, 0);
  } catch {
    // ignore transient erase-mask draw failures
  } finally {
    canvasCtx.restore();
  }
};

export const applyColorCycleSoftEdgeMaskToCanvas = (
  layer: Layer,
  targetCanvas: HTMLCanvasElement | OffscreenCanvas
): void => {
  const softEdgeMask = layer.colorCycleData?.softEdgeMask;
  if (!softEdgeMask || layer.colorCycleData?.softEdgeMaskEnabled === false) {
    return;
  }
  const canvasCtx = targetCanvas.getContext(
    '2d',
    { willReadFrequently: true } as CanvasRenderingContext2DSettings
  ) as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
  if (!canvasCtx) {
    return;
  }

  canvasCtx.save();
  canvasCtx.globalCompositeOperation = 'destination-in';
  canvasCtx.globalAlpha = 1;
  try {
    canvasCtx.drawImage(softEdgeMask as CanvasImageSource, 0, 0);
  } catch {
    // ignore transient soft-edge-mask draw failures
  } finally {
    canvasCtx.restore();
  }
};

export const prepareColorCycleCompositeSource = (
  layer: Layer,
  sourceCanvas: HTMLCanvasElement | OffscreenCanvas,
  createCanvas: (width: number, height: number) => HTMLCanvasElement | OffscreenCanvas | null,
): HTMLCanvasElement | OffscreenCanvas => {
  const hasEraseMask = Boolean(layer.colorCycleData?.eraseMask);
  const hasSoftEdgeMask = Boolean(layer.colorCycleData?.softEdgeMask)
    && layer.colorCycleData?.softEdgeMaskEnabled !== false;
  if (!hasEraseMask && !hasSoftEdgeMask) {
    return sourceCanvas;
  }

  const maskedCanvas = createCanvas(sourceCanvas.width, sourceCanvas.height);
  const maskedCtx = maskedCanvas?.getContext(
    '2d',
    { willReadFrequently: true } as CanvasRenderingContext2DSettings
  ) as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
  if (!maskedCanvas || !maskedCtx) {
    return sourceCanvas;
  }

  maskedCtx.clearRect(0, 0, maskedCanvas.width, maskedCanvas.height);
  try {
    maskedCtx.drawImage(sourceCanvas as CanvasImageSource, 0, 0);
  } catch {
    return sourceCanvas;
  }
  applyColorCycleEraseMask(layer, maskedCanvas);
  applyColorCycleSoftEdgeMaskToCanvas(layer, maskedCanvas);
  return maskedCanvas;
};

export const captureSoftEdgeMaskOnlyState = (layer: Layer): ColorCycleSerializedState => {
  const toState = (
    snapshot?: NonNullable<ColorCycleSerializedState>['layers'][number]['softEdgeMaskSnapshot'],
  ): ColorCycleSerializedState => ({
    layers: [{
      layerId: layer.id,
      softEdgeMaskSnapshot: snapshot,
    } as NonNullable<ColorCycleSerializedState>['layers'][number]],
  } as ColorCycleSerializedState);
  const mask = layer.colorCycleData?.softEdgeMask;
  const imageData = layer.colorCycleData?.softEdgeMaskImageData;
  const version = layer.colorCycleData?.softEdgeMaskVersion ?? 0;
  if (!mask && !imageData) {
    return toState();
  }
  try {
    const sourceImage = (() => {
      if (imageData) {
        return imageData;
      }
      if (!mask || mask.width <= 0 || mask.height <= 0) {
        return null;
      }
      const ctx = mask.getContext('2d', { willReadFrequently: true });
      if (!ctx) {
        return null;
      }
      return ctx.getImageData(0, 0, mask.width, mask.height);
    })();
    if (!sourceImage || sourceImage.width <= 0 || sourceImage.height <= 0) {
      return toState();
    }
    const alpha = new Uint8ClampedArray(sourceImage.width * sourceImage.height);
    for (let src = 3, dst = 0; src < sourceImage.data.length; src += 4, dst += 1) {
      alpha[dst] = sourceImage.data[src] ?? 0;
    }
    return toState({
      width: sourceImage.width,
      height: sourceImage.height,
      alpha,
      enabled: layer.colorCycleData?.softEdgeMaskEnabled !== false,
      version,
    });
  } catch {
    return toState();
  }
};

export const removeColorCycleSoftEdgeMaskFromLayer = (layer: Layer, nextVersion: number): Layer => {
  if (!layer.colorCycleData) {
    return layer;
  }
  const colorCycleData = { ...layer.colorCycleData };
  delete colorCycleData.softEdgeMask;
  delete colorCycleData.softEdgeMaskImageData;
  return {
    ...layer,
    colorCycleData: {
      ...colorCycleData,
      softEdgeMaskEnabled: undefined,
      softEdgeMaskVersion: nextVersion,
    },
  };
};

export const resolveSoftEdgeCoverageFromBrush = (
  layer: Layer,
  brush: ColorCycleBrushSerializedStateRuntimeReader | null | undefined,
): ColorCycleSoftEdgeCoverage | null => {
  if (!brush) {
    return null;
  }
  try {
    return resolveColorCyclePaintCoverageFromSerializedState(
      readColorCycleBrushSerializedStateFromRuntime(brush),
      layer.id,
      {
        width: layer.colorCycleData?.canvasWidth
          || layer.colorCycleData?.canvas?.width
          || layer.imageData?.width
          || 0,
        height: layer.colorCycleData?.canvasHeight
          || layer.colorCycleData?.canvas?.height
          || layer.imageData?.height
          || 0,
      },
    );
  } catch {
    return null;
  }
};
