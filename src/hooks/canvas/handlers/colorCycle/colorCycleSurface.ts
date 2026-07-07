import type { AppState } from '@/stores/useAppStore';
import {
  resolveColorCycleRuntimeSurface,
  type ColorCycleRuntimeBrush,
} from '@/lib/colorCycle/materializeColorCycleLayer';

export type ColorCycleSurfaceBrush = ColorCycleRuntimeBrush & {
  setTargetCanvas?: (canvas: HTMLCanvasElement | null) => void;
};

const ensureCanvasPixelSize = (canvas: HTMLCanvasElement): void => {
  if (
    !canvas ||
    typeof window === 'undefined' ||
    typeof canvas.getBoundingClientRect !== 'function'
  ) {
    return;
  }
  const isConnected =
    typeof (canvas as { isConnected?: unknown }).isConnected === 'boolean'
      ? Boolean((canvas as { isConnected?: unknown }).isConnected)
      : true;
  if (!isConnected) {
    return;
  }
  const rect = canvas.getBoundingClientRect();
  if (!rect.width && !rect.height) {
    return;
  }
  const dpr = window.devicePixelRatio || 1;
  const targetWidth = Math.max(1, Math.round(rect.width * dpr));
  const targetHeight = Math.max(1, Math.round(rect.height * dpr));
  if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
    canvas.width = targetWidth;
    canvas.height = targetHeight;
  }
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
  brush: ColorCycleRuntimeBrush,
  layerId: string,
  state: AppState
): HTMLCanvasElement | null => {
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
        });
      },
    });
  } catch {
    return layer.colorCycleData?.canvas ?? null;
  }
};
