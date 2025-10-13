import { getColorCycleBrushManager } from '@/stores/colorCycleBrushManager';
import type { Layer } from '@/types';

/**
 * Synchronize color-cycle runtime state from layer data into live brush instances.
 * Centralizes gradient/speed/animation updates to avoid scattered mutations.
 */
export function syncCCRuntimes(layers: Layer[], cause: string): void {
  if (!Array.isArray(layers) || layers.length === 0) {
    return;
  }

  const manager = getColorCycleBrushManager();
  let shouldRequestStart = false;

  for (const layer of layers) {
    if (!layer || layer.layerType !== 'color-cycle' || !layer.colorCycleData) {
      continue;
    }

    const brush = manager.getBrush(layer.id);
    if (!brush) {
      continue;
    }

    const { gradient, brushSpeed, isAnimating } = layer.colorCycleData;

    if (Array.isArray(gradient)) {
      try {
        brush.setGradient?.(gradient, layer.id);
      } catch {}
    }

    if (typeof brushSpeed === 'number') {
      const clampedSpeed = Math.max(0.02, Math.min(2, brushSpeed));
      try {
        brush.setSpeed?.(clampedSpeed);
      } catch {}
    }

    if (typeof isAnimating === 'boolean') {
      try {
        if (isAnimating) {
          brush.startAnimation?.();
          shouldRequestStart = true;
        } else {
          brush.stopAnimation?.();
        }
      } catch {}
    }
  }

  if (typeof window !== 'undefined') {
    try {
      window.dispatchEvent(new CustomEvent('colorCycleFrameUpdate'));
      if (shouldRequestStart) {
        window.dispatchEvent(new CustomEvent('cc:request-start-raf'));
      }
    } catch {}
  }
}
