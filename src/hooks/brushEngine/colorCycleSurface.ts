import { getAppStoreState } from '@/stores/appStoreAccess';
import { debugWarn } from '@/utils/debug';
import { flushGradientApply, requestGradientApply } from '@/hooks/brushEngine/ccGradientApplyScheduler';
import { resolveColorCycleRuntimeSurface } from '@/lib/colorCycle/materializeColorCycleLayer';
import type { Layer } from '@/types';
import { isFgPending } from '@/utils/colorCycleGradients';

import { ensureCanvasPixelSize } from './engineShared';

export type ColorCycleSurfaceSource = {
  getCanvas?: () => HTMLCanvasElement | OffscreenCanvas | null;
};

export type ColorCycleSurfaceBrush = ColorCycleSurfaceSource & {
  setTargetCanvas?: (canvas: HTMLCanvasElement | null) => void;
};

export type ColorCycleLayerRenderBrush = ColorCycleSurfaceBrush & {
  renderDirectToCanvas?: (canvas: HTMLCanvasElement, layerId: string) => void;
  presentCurrentFrameToCanvas?: (canvas: HTMLCanvasElement, layerId: string) => void;
};

export const bindBrushToCanvas = (
  brush: ColorCycleSurfaceBrush | null | undefined,
  canvas: HTMLCanvasElement | null | undefined
): void => {
  if (!brush || !canvas) {
    return;
  }
  if (typeof brush.setTargetCanvas === 'function') {
    const isConnected =
      typeof (canvas as { isConnected?: unknown }).isConnected === 'boolean'
        ? Boolean((canvas as { isConnected?: unknown }).isConnected)
        : false;
    if (isConnected) {
      ensureCanvasPixelSize(canvas);
    }
    brush.setTargetCanvas(canvas);
  }
};

export const refreshLayerCCSurface = (
  brush: ColorCycleSurfaceSource,
  layerId: string
): HTMLCanvasElement | null => {
  const state = getAppStoreState();
  const layer = state.layers.find((candidate) => candidate.id === layerId);
  if (!layer) {
    return null;
  }

  try {
    return resolveColorCycleRuntimeSurface({
      layer,
      brush,
      publishSurface: (canvas) => {
        state.updateLayer(layerId, {
          colorCycleData: {
            ...(layer.colorCycleData ?? {}),
            canvas,
          },
        } as Partial<Layer>, { skipColorCycleSync: true });
      },
    });
  } catch {
    return layer.colorCycleData?.canvas ?? null;
  }
};

export const renderBrushToLayerCanvas = (
  brush: ColorCycleLayerRenderBrush | null | undefined,
  layerId: string | null | undefined
): void => {
  if (!brush || !layerId) {
    return;
  }
  try {
    if (isFgPending(layerId)) {
      return;
    }
    requestGradientApply(layerId, 'render-cc-layer');
  } catch {}
  const layerCanvas = refreshLayerCCSurface(brush, layerId);
  if (!layerCanvas) {
    return;
  }
  bindBrushToCanvas(brush, layerCanvas);
  if (layerCanvas.isConnected) {
    ensureCanvasPixelSize(layerCanvas);
  }
  flushGradientApply(layerId);
  if (typeof brush.renderDirectToCanvas === 'function') {
    try {
      brush.renderDirectToCanvas(layerCanvas, layerId);
    } catch (error) {
      debugWarn('raw-console', '[ColorCycle] renderDirectToCanvas failed:', error);
    }
  }
};
