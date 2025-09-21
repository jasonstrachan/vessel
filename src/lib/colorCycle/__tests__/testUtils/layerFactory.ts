import type { Layer } from '@/types';
import { createDefaultLayerAlignment } from '@/utils/layoutDefaults';

/**
 * Lightweight helper for building Layer objects inside tests without
 * duplicating the entire application state shape. Ensures we always
 * provide the required fields that the runtime logic expects.
 */
export const createMockLayer = (overrides: Partial<Layer> = {}): Layer => {
  const resolvedCanvas = (() => {
    if (overrides.colorCycleData?.canvas) {
      return overrides.colorCycleData.canvas;
    }
    if (overrides.framebuffer instanceof HTMLCanvasElement) {
      return overrides.framebuffer;
    }
    const canvas = document.createElement('canvas');
    canvas.width = overrides.imageData?.width ?? 256;
    canvas.height = overrides.imageData?.height ?? 256;
    return canvas;
  })();

  if (resolvedCanvas instanceof HTMLCanvasElement && resolvedCanvas.width === 0) {
    resolvedCanvas.width = overrides.imageData?.width ?? 256;
    resolvedCanvas.height = overrides.imageData?.height ?? 256;
  }

  const colorCycleData =
    'colorCycleData' in overrides
      ? overrides.colorCycleData
      : {
          mode: 'brush' as const,
          canvas: resolvedCanvas instanceof HTMLCanvasElement ? resolvedCanvas : undefined,
        };

  const layer: Layer = {
    id: overrides.id ?? `test-layer-${Math.random().toString(36).slice(2)}`,
    name: overrides.name ?? 'Test Layer',
    visible: overrides.visible ?? true,
    opacity: overrides.opacity ?? 1,
    blendMode: overrides.blendMode ?? 'source-over',
    locked: overrides.locked ?? false,
    order: overrides.order ?? 0,
    imageData: overrides.imageData ?? null,
    framebuffer: overrides.framebuffer ?? resolvedCanvas,
    alignment: overrides.alignment ?? createDefaultLayerAlignment(),
    layerType: overrides.layerType ?? 'color-cycle',
    colorCycleData,
    version: overrides.version,
  };

  if (
    layer.colorCycleData &&
    !layer.colorCycleData.canvas &&
    resolvedCanvas instanceof HTMLCanvasElement
  ) {
    layer.colorCycleData.canvas = resolvedCanvas;
  }

  return layer;
};
