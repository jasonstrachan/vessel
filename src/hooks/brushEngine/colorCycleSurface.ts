import { flushGradientApply, requestGradientApply } from '@/hooks/brushEngine/ccGradientApplyScheduler';
import type { ColorCycleBrushImplementation } from '@/hooks/brushEngine/ColorCycleBrushMigration';
import { useAppStore } from '@/stores/useAppStore';
import type { Layer } from '@/types';
import { isFgPending } from '@/utils/colorCycleGradients';

import { ensureCanvasPixelSize } from './engineShared';

export const bindBrushToCanvas = (
  brush: ColorCycleBrushImplementation | null | undefined,
  canvas: HTMLCanvasElement | null | undefined
): void => {
  if (!brush || !canvas) {
    return;
  }
  const brushWithTarget = brush as ColorCycleBrushImplementation & {
    setTargetCanvas?: (canvas: HTMLCanvasElement | null) => void;
  };
  if (typeof brushWithTarget.setTargetCanvas === 'function') {
    const isConnected =
      typeof (canvas as { isConnected?: unknown }).isConnected === 'boolean'
        ? Boolean((canvas as { isConnected?: unknown }).isConnected)
        : false;
    if (isConnected) {
      ensureCanvasPixelSize(canvas);
    }
    brushWithTarget.setTargetCanvas(canvas);
  }
};

export const refreshLayerCCSurface = (
  brush: ColorCycleBrushImplementation,
  layerId: string
): HTMLCanvasElement | null => {
  const state = useAppStore.getState();
  const layer = state.layers.find((candidate) => candidate.id === layerId);
  if (!layer) {
    return null;
  }

  const storedCanvas = layer.colorCycleData?.canvas as HTMLCanvasElement | undefined;
  const liveCanvas = brush.getCanvas?.() as HTMLCanvasElement | undefined;

  if (liveCanvas && (!storedCanvas || storedCanvas !== liveCanvas)) {
    try {
      state.updateLayer(layerId, {
        colorCycleData: {
          ...(layer.colorCycleData ?? {}),
          canvas: liveCanvas
        }
      } as Partial<Layer>);
      return liveCanvas;
    } catch {
      // fall through; return best-known surface
    }
  }

  return storedCanvas ?? liveCanvas ?? null;
};

export const renderBrushToLayerCanvas = (
  brush: ColorCycleBrushImplementation | null | undefined,
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
      console.warn('[ColorCycle] renderDirectToCanvas failed:', error);
    }
  }
};
