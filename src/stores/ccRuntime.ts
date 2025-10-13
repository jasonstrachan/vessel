import { getColorCycleBrushManager } from '@/stores/colorCycleBrushManager';
import type { Layer } from '@/types';

type RuntimeSnapshot = {
  gradientKey?: string;
  brushSpeed?: number;
  isAnimating?: boolean;
};

const lastRuntimeState = new Map<string, RuntimeSnapshot>();

const gradientKeyForStops = (
  stops: Array<{ position: number; color: string }>
): string => stops.map(stop => `${stop.position}:${stop.color}`).join('|');

const speedsAreEqual = (a: number | undefined, b: number | undefined): boolean => {
  if (a === undefined || b === undefined) {
    return a === b;
  }
  return Math.abs(a - b) < 0.0001;
};

/**
 * Synchronize color-cycle runtime state from layer data into live brush instances.
 * Centralizes gradient/speed/animation updates to avoid scattered mutations.
 */
export function syncCCRuntimes(layers: Layer[], _cause: string): void {
  if (!Array.isArray(layers) || layers.length === 0) {
    return;
  }

  const manager = getColorCycleBrushManager();
  let shouldRequestStart = false;
  let shouldNotifyFrameUpdate = false;

  for (const layer of layers) {
    if (!layer || layer.layerType !== 'color-cycle' || !layer.colorCycleData) {
      continue;
    }

    const brush = manager.getBrush(layer.id);
    if (!brush) {
      continue;
    }

    const { gradient, brushSpeed, isAnimating } = layer.colorCycleData;
    const previous = lastRuntimeState.get(layer.id) ?? {};
    const nextSnapshot: RuntimeSnapshot = { ...previous };

    if (Array.isArray(gradient) && gradient.length > 0) {
      const gradientKey = gradientKeyForStops(gradient);
      if (previous.gradientKey !== gradientKey) {
        try {
          brush.setGradient?.(gradient, layer.id);
          nextSnapshot.gradientKey = gradientKey;
          shouldNotifyFrameUpdate = true;
        } catch {}
      }
    }

    if (typeof brushSpeed === 'number') {
      const clampedSpeed = Math.max(0.02, Math.min(2, brushSpeed));
      if (!speedsAreEqual(previous.brushSpeed, clampedSpeed)) {
        try {
          brush.setSpeed?.(clampedSpeed);
          nextSnapshot.brushSpeed = clampedSpeed;
        } catch {}
      }
    }

    if (typeof isAnimating === 'boolean') {
      const wasAnimating = previous.isAnimating ?? false;
      if (wasAnimating !== isAnimating) {
        try {
          const isPlaying = typeof brush.isPlaying === 'function' ? brush.isPlaying() : undefined;
          if (isAnimating) {
            if (!isPlaying) {
              brush.startAnimation?.();
              shouldRequestStart = true;
            }
          } else if (isPlaying) {
            brush.stopAnimation?.();
          }
          nextSnapshot.isAnimating = isAnimating;
        } catch {}
      }
    }

    lastRuntimeState.set(layer.id, nextSnapshot);
  }

  if (typeof window !== 'undefined' && (shouldNotifyFrameUpdate || shouldRequestStart)) {
    try {
      if (shouldNotifyFrameUpdate) {
        window.dispatchEvent(new CustomEvent('colorCycleFrameUpdate'));
      }
      if (shouldRequestStart) {
        window.dispatchEvent(new CustomEvent('cc:request-start-raf'));
      }
    } catch {}
  }
}
