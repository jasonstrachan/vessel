import type { Layer } from '@/types';
import { debugWarn } from '@/utils/debug';
import { captureCanvasImageData } from '@/utils/canvas/canvasImage';
import {
  normalizeColorCycleLayerDocumentState,
  type ColorCycleLayerDocumentState,
} from './documentState';

export type EnsureColorCycleLayerRuntimeTarget = 'warm' | 'active';

export type ColorCycleRuntimeBrush = {
  getCanvas?: () => HTMLCanvasElement | OffscreenCanvas | null;
  getColorCycleDerivedSurface?: (layerId: string) => unknown | null;
  renderDirectToCanvas?: (canvas: HTMLCanvasElement, layerId: string) => void;
};

export type ColorCycleCanonicalContentExpectation =
  | { kind: 'populated' }
  | { kind: 'empty' }
  | { kind: 'invalid'; reason: string };

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

export const classifyColorCycleCanonicalContent = (
  state: Readonly<ColorCycleLayerDocumentState>,
): ColorCycleCanonicalContentExpectation => {
  if (
    !Number.isInteger(state.width) ||
    !Number.isInteger(state.height) ||
    state.width <= 0 ||
    state.height <= 0
  ) {
    return { kind: 'invalid', reason: `invalid-dimensions-${state.width}x${state.height}` };
  }
  const expectedBytes = state.width * state.height;
  if (!(state.paintBuffer instanceof ArrayBuffer)) {
    return { kind: 'invalid', reason: 'missing-paint-buffer' };
  }
  if (state.paintBuffer.byteLength !== expectedBytes) {
    return {
      kind: 'invalid',
      reason: `paintBuffer byteLength ${state.paintBuffer.byteLength} does not match ${expectedBytes} for ${state.width}x${state.height}`,
    };
  }

  const hasPaint = new Uint8Array(state.paintBuffer).some((value) => value !== 0);
  if (hasPaint) {
    return { kind: 'populated' };
  }
  if (state.hasContent) {
    return { kind: 'invalid', reason: 'empty-paint-buffer-contradicts-content-marker' };
  }
  return { kind: 'empty' };
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
  expectedContent: ColorCycleCanonicalContentExpectation,
): boolean => {
  const colorCycleData = layer.colorCycleData;
  const canvas = colorCycleData?.canvas ?? null;
  if (!colorCycleData || !canvas || typeof brush.renderDirectToCanvas !== 'function') {
    return false;
  }

  if (expectedContent.kind === 'invalid') {
    debugWarn(
      'raw-console',
      '[ColorCycleMaterializer] Refused to materialize from invalid canonical state:',
      expectedContent.reason,
    );
    return false;
  }

  const scratchCanvas = canvas.ownerDocument?.createElement('canvas');
  if (!scratchCanvas) {
    return false;
  }
  scratchCanvas.width = canvas.width;
  scratchCanvas.height = canvas.height;

  try {
    brush.renderDirectToCanvas(scratchCanvas, layer.id);
  } catch (error) {
    debugWarn('raw-console', '[ColorCycleMaterializer] Failed to materialize restored color cycle surface:', error);
    return false;
  }

  if (
    typeof brush.getColorCycleDerivedSurface === 'function' &&
    !brush.getColorCycleDerivedSurface(layer.id)
  ) {
    return false;
  }

  const renderedImageData = captureCanvasImageData(scratchCanvas) ?? undefined;
  if (!renderedImageData) {
    return false;
  }
  const hasVisiblePixels = imageDataHasVisiblePixels(renderedImageData);
  if (expectedContent.kind === 'empty' && hasVisiblePixels) {
    return false;
  }

  if (expectedContent.kind === 'populated' && !hasVisiblePixels) {
    colorCycleData.hasContent = true;
    return true;
  }

  const context = canvas.getContext('2d');
  if (!context) {
    return false;
  }
  try {
    context.putImageData(renderedImageData, 0, 0);
  } catch (error) {
    debugWarn('raw-console', '[ColorCycleMaterializer] Failed to commit restored color cycle surface:', error);
    return false;
  }
  colorCycleData.hasContent = expectedContent.kind === 'populated';
  return true;
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
