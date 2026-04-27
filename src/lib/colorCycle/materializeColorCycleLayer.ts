import type { Layer } from '@/types';
import { debugWarn } from '@/utils/debug';
import { captureCanvasImageData } from '@/utils/canvas/canvasImage';
import {
  normalizeColorCycleLayerDocumentState,
  type ColorCycleLayerDocumentState,
} from '@/lib/colorCycle/documentState';

export type EnsureColorCycleLayerRuntimeTarget = 'warm' | 'active';

export type ColorCycleRuntimeBrush = {
  getCanvas?: () => HTMLCanvasElement | OffscreenCanvas | null;
  getLayerSnapshot?: (layerId: string) => {
    paintBuffer?: ArrayBuffer;
    gradientIdBuffer?: ArrayBuffer;
    hasContent?: boolean;
  } | null;
  renderDirectToCanvas?: (canvas: HTMLCanvasElement, layerId: string) => void;
};

export type ResolveColorCycleRuntimeSurfaceOptions = {
  layer: Layer;
  brush: ColorCycleRuntimeBrush | null | undefined;
  publishSurface?: (canvas: HTMLCanvasElement) => void;
};

export type MaterializeColorCycleLayerResult =
  | {
      ok: true;
      state: EnsureColorCycleLayerRuntimeTarget;
      layer: Layer;
      documentState: ColorCycleLayerDocumentState;
      brush: ColorCycleRuntimeBrush | null;
      surface: HTMLCanvasElement | null;
      materialized: boolean;
    }
  | {
      ok: false;
      state: 'failed';
      layer: Layer;
      reason: string;
    };

export interface MaterializeColorCycleLayerOptions {
  layer: Layer;
  target: EnsureColorCycleLayerRuntimeTarget;
  hydrateRuntime: (layer: Layer) => Promise<void>;
  setHydrationState: (
    colorCycleData: NonNullable<Layer['colorCycleData']>,
    target: EnsureColorCycleLayerRuntimeTarget,
  ) => NonNullable<Layer['colorCycleData']>;
  restoreRuntime: (
    layer: Layer,
    documentState: ColorCycleLayerDocumentState,
  ) => Promise<{
    brush: ColorCycleRuntimeBrush | null;
    materialized?: boolean;
  }>;
}

const imageDataHasVisiblePixels = (imageData: ImageData | null | undefined): boolean => {
  if (!imageData) {
    return false;
  }
  const data = imageData.data;
  for (let index = 3; index < data.length; index += 4) {
    if (data[index] !== 0) {
      return true;
    }
  }
  return false;
};

const materializeSnapshotPreviewToCanvas = (
  layer: Layer,
  brush: ColorCycleRuntimeBrush,
  canvas: HTMLCanvasElement,
): boolean => {
  const snapshot = brush.getLayerSnapshot?.(layer.id);
  const paintBuffer = snapshot?.paintBuffer;
  if (!paintBuffer || paintBuffer.byteLength === 0) {
    return false;
  }

  const width = Math.max(1, canvas.width);
  const height = Math.max(1, canvas.height);
  const pixelCount = width * height;
  const paint = new Uint8Array(paintBuffer);
  const imageData = new ImageData(width, height);
  let hasVisiblePixel = false;
  for (let index = 0; index < pixelCount && index < paint.length; index += 1) {
    if (paint[index] === 0) {
      continue;
    }
    const offset = index * 4;
    imageData.data[offset] = 255;
    imageData.data[offset + 1] = 255;
    imageData.data[offset + 2] = 255;
    imageData.data[offset + 3] = 255;
    hasVisiblePixel = true;
  }
  if (!hasVisiblePixel) {
    return false;
  }

  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) {
    return false;
  }
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.putImageData(imageData, 0, 0);
  layer.colorCycleData!.hasContent = true;
  return true;
};

const isHtmlCanvas = (
  canvas: HTMLCanvasElement | OffscreenCanvas | null | undefined,
): canvas is HTMLCanvasElement => (
  typeof HTMLCanvasElement !== 'undefined' && canvas instanceof HTMLCanvasElement
);

export const resolveColorCycleRuntimeSurface = ({
  layer,
  brush,
  publishSurface,
}: ResolveColorCycleRuntimeSurfaceOptions): HTMLCanvasElement | null => {
  const storedCanvas = layer.colorCycleData?.canvas ?? null;
  const liveCanvas = brush?.getCanvas?.() ?? null;
  const liveHtmlCanvas = isHtmlCanvas(liveCanvas) ? liveCanvas : null;

  if (liveHtmlCanvas && liveHtmlCanvas !== storedCanvas) {
    publishSurface?.(liveHtmlCanvas);
    return liveHtmlCanvas;
  }

  return storedCanvas ?? liveHtmlCanvas;
};

export const materializeRestoredColorCycleSurface = (
  layer: Layer,
  brush: ColorCycleRuntimeBrush,
): boolean => {
  const colorCycleData = layer.colorCycleData;
  const canvas = colorCycleData?.canvas ?? null;
  if (!colorCycleData || !canvas || typeof brush.renderDirectToCanvas !== 'function') {
    return false;
  }

  try {
    brush.renderDirectToCanvas(canvas, layer.id);
  } catch (error) {
    debugWarn('raw-console', '[ColorCycleMaterializer] Failed to materialize restored color cycle surface:', error);
    return false;
  }

  const renderedImageData = captureCanvasImageData(canvas) ?? undefined;
  if (imageDataHasVisiblePixels(renderedImageData)) {
    colorCycleData.hasContent = true;
    return true;
  }

  const compatibilitySnapshot = colorCycleData.canvasImageData;
  if (imageDataHasVisiblePixels(compatibilitySnapshot) && compatibilitySnapshot) {
    try {
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx?.clearRect(0, 0, canvas.width, canvas.height);
      ctx?.putImageData(compatibilitySnapshot, 0, 0);
      colorCycleData.hasContent = true;
    } catch {}
  }

  if (materializeSnapshotPreviewToCanvas(layer, brush, canvas)) {
    return true;
  }

  return false;
};

export const materializeColorCycleLayer = async ({
  layer,
  target,
  hydrateRuntime,
  setHydrationState,
  restoreRuntime,
}: MaterializeColorCycleLayerOptions): Promise<MaterializeColorCycleLayerResult> => {
  if (layer.layerType !== 'color-cycle' || !layer.colorCycleData) {
    return {
      ok: false,
      state: 'failed',
      layer,
      reason: 'not-color-cycle',
    };
  }

  try {
    await hydrateRuntime(layer);
    const documentStateResult = normalizeColorCycleLayerDocumentState(layer, {
      fallbackWidth: layer.colorCycleData.canvas?.width,
      fallbackHeight: layer.colorCycleData.canvas?.height,
    });
    if (!documentStateResult.ok) {
      return {
        ok: false,
        state: 'failed',
        layer,
        reason: documentStateResult.reason,
      };
    }
    if (!documentStateResult.state.paintBuffer) {
      return {
        ok: false,
        state: 'failed',
        layer,
        reason: 'missing-paint-buffer',
      };
    }

    layer.colorCycleData = setHydrationState(layer.colorCycleData, target);
    const restored = await restoreRuntime(layer, documentStateResult.state);
    const surface = layer.colorCycleData.canvas ?? null;
    return {
      ok: true,
      state: target,
      layer,
      documentState: documentStateResult.state,
      brush: restored.brush,
      surface,
      materialized: restored.materialized ?? false,
    };
  } catch (error) {
    return {
      ok: false,
      state: 'failed',
      layer,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
};
