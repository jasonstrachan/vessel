import { getColorCycleBrushManager } from '@/stores/colorCycleBrushManager';
import { useAppStore } from '@/stores/useAppStore';
import type { Layer } from '@/types';

type RuntimeSnapshot = {
  isAnimating?: boolean;
  flowMode?: 'forward' | 'reverse' | 'pingpong';
  brushRef?: unknown;
};

const lastRuntimeState = new Map<string, RuntimeSnapshot>();

export function resetCCRuntimesForTests(): void {
  lastRuntimeState.clear();
}

/**
 * Synchronize color-cycle runtime state from layer data into live brush instances.
 * Centralizes gradient/speed/animation updates to avoid scattered mutations.
 */
export function syncCCRuntimes(layers: Layer[], cause?: string): void {
  void cause; // Quiets lint when tracing cause is unnecessary
  const layerIds = Array.isArray(layers) ? layers.map(layer => layer.id) : [];
  const logCC =
    process.env.NODE_ENV !== 'production' &&
    (() => {
      try {
        return Boolean((globalThis as { __TB_DEBUG?: { logCC?: boolean } }).__TB_DEBUG?.logCC);
      } catch {
        return false;
      }
    })();

  if (logCC) {
    console.log('[ccRuntime] syncCCRuntimes', { cause, layerIds, count: layerIds.length });
  }

  try {
    const scope = globalThis as { __TB_DEBUG?: { disableCCRuntime?: boolean } };
    if (scope.__TB_DEBUG?.disableCCRuntime) {
      if (process.env.NODE_ENV !== 'production') {
        console.log('[ccRuntime] syncCCRuntimes disabled via __TB_DEBUG');
      }
      return;
    }
  } catch {}

  // TEMP: disable CC sync entirely to test downstream subsystems.
  // if (layerIds.includes('layer-...')) return;

  if (!Array.isArray(layers) || layers.length === 0) {
    return;
  }

  const manager = getColorCycleBrushManager();
  let shouldRequestStart = false;

  for (const layer of layers) {
    if (!layer || layer.layerType !== 'color-cycle' || !layer.colorCycleData) {
      continue;
    }

      if (logCC) {
        console.log('[ccRuntime] syncCCRuntimes', {
          cause,
          layerId: layer.id,
          gradientStops: layer.colorCycleData.gradient?.length ?? 0,
          isAnimating: layer.colorCycleData.isAnimating,
        });
      }

    const brush = manager.getBrush(layer.id);
    if (!brush) {
      continue;
    }

    if (!layer.visible) {
      try {
        const isPlaying = typeof brush.isPlaying === 'function' ? brush.isPlaying() : undefined;
        if (isPlaying) {
          brush.stopAnimation?.();
        }
      } catch {}
      continue;
    }

    const { isAnimating } = layer.colorCycleData;
    const previous = lastRuntimeState.get(layer.id) ?? {};
    const nextSnapshot: RuntimeSnapshot = { ...previous };
    const brushChanged = previous.brushRef !== brush;

    if (typeof isAnimating === 'boolean') {
      const wasAnimating = previous.isAnimating ?? false;
      if (brushChanged || wasAnimating !== isAnimating) {
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

    const flowMode: RuntimeSnapshot['flowMode'] = 'forward';
    if (previous.flowMode !== flowMode) {
      try {
        if (typeof (brush as { setLegacyFlowMode?: (mode: typeof flowMode) => void }).setLegacyFlowMode === 'function') {
          (brush as { setLegacyFlowMode: (mode: typeof flowMode) => void }).setLegacyFlowMode(flowMode);
        } else if (typeof brush.setFlowMode === 'function') {
          brush.setFlowMode(flowMode);
        } else if (typeof brush.setFlowDirection === 'function') {
          brush.setFlowDirection('forward');
        }
        nextSnapshot.flowMode = flowMode;
      } catch {}
    }

    nextSnapshot.brushRef = brush;
    lastRuntimeState.set(layer.id, nextSnapshot);
  }

  if (typeof window !== 'undefined' && shouldRequestStart) {
    try {
      if (shouldRequestStart) {
        useAppStore.getState().colorCycleRuntimeHandlers.start?.('cc-runtime');
      }
    } catch {}
  }
}
