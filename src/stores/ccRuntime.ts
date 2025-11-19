import { getColorCycleBrushManager } from '@/stores/colorCycleBrushManager';
import { useAppStore } from '@/stores/useAppStore';
import type { Layer } from '@/types';
import {
  MAX_RECOLOR_COLOR_CYCLE_SPEED,
  MIN_RECOLOR_COLOR_CYCLE_SPEED,
} from '@/constants/colorCycle';

type RuntimeSnapshot = {
  gradientKey?: string;
  brushSpeed?: number;
  isAnimating?: boolean;
  flowMode?: 'forward' | 'reverse' | 'pingpong';
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
export function syncCCRuntimes(layers: Layer[], cause?: string): void {
  void cause; // Quiets lint when tracing cause is unnecessary
  if (!Array.isArray(layers) || layers.length === 0) {
    return;
  }

  const manager = getColorCycleBrushManager();
  const storeSnapshot = useAppStore.getState();
  let shouldRequestStart = false;
  let shouldNotifyFrameUpdate = false;

  for (const layer of layers) {
    if (!layer || layer.layerType !== 'color-cycle' || !layer.colorCycleData) {
      continue;
    }

    if (process.env.NODE_ENV !== 'production') {
      console.log('[ccRuntime] syncCCRuntimes', {
        cause,
        layerId: layer.id,
        gradientStops: layer.colorCycleData.gradient?.length ?? 0,
        brushSpeed: layer.colorCycleData.brushSpeed,
        isAnimating: layer.colorCycleData.isAnimating,
      });
    }

    const brush = manager.getBrush(layer.id);
    if (!brush) {
      continue;
    }

    const { gradient, brushSpeed, isAnimating, flowMode } = layer.colorCycleData;
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
      const clampedSpeed = Math.max(
        MIN_RECOLOR_COLOR_CYCLE_SPEED,
        Math.min(MAX_RECOLOR_COLOR_CYCLE_SPEED, brushSpeed)
      );
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

    const desiredFlowMode =
      flowMode ??
      storeSnapshot.tools?.brushSettings?.colorCycleFlowMode ??
      'forward';
    if (previous.flowMode !== desiredFlowMode) {
      try {
        if (typeof brush.setFlowMode === 'function') {
          brush.setFlowMode(desiredFlowMode);
        } else if (typeof brush.setFlowDirection === 'function') {
          brush.setFlowDirection(desiredFlowMode === 'reverse' ? 'backward' : 'forward');
        }
        nextSnapshot.flowMode = desiredFlowMode;
      } catch {}
    }

    lastRuntimeState.set(layer.id, nextSnapshot);
  }

  if (typeof window !== 'undefined' && (shouldNotifyFrameUpdate || shouldRequestStart)) {
    try {
      if (shouldNotifyFrameUpdate) {
        window.dispatchEvent(new CustomEvent('colorCycleFrameUpdate'));
      }
      if (shouldRequestStart) {
        useAppStore.getState().colorCycleRuntimeHandlers.start?.('cc-runtime');
      }
    } catch {}
  }
}
