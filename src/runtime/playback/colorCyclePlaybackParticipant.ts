import { debugLog } from '@/utils/debug';
import { getColorCycleBrushManager } from '@/stores/colorCycleBrushManager';
import type { AppState } from '@/stores/useAppStore';
import type { Layer } from '@/types';
import type { PlaybackParticipant } from '@/runtime/playback/playbackParticipants';

type RuntimeSnapshot = {
  isAnimating?: boolean;
  flowMode?: 'forward' | 'reverse' | 'pingpong';
  brushRef?: unknown;
};

const lastRuntimeState = new Map<string, RuntimeSnapshot>();

export const resetColorCyclePlaybackParticipantForTests = (): void => {
  lastRuntimeState.clear();
};

const getColorCycleLayers = (layers: Layer[]): Layer[] =>
  layers.filter((layer) => layer.layerType === 'color-cycle' && !!layer.colorCycleData);

export const colorCyclePlaybackParticipant: PlaybackParticipant = {
  id: 'color-cycle',

  hasWork(state: AppState): boolean {
    return getColorCycleLayers(state.layers).some((layer) => layer.visible !== false);
  },

  sync({ state, cause, requestColorCycleRuntimeStart }): void {
    void cause;
    const layers = getColorCycleLayers(state.layers);
    const layerIds = layers.map((layer) => layer.id);
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
      debugLog('raw-console', '[colorCyclePlaybackParticipant] sync', {
        cause,
        layerIds,
        count: layerIds.length,
      });
    }

    try {
      const scope = globalThis as { __TB_DEBUG?: { disableCCRuntime?: boolean } };
      if (scope.__TB_DEBUG?.disableCCRuntime) {
        if (process.env.NODE_ENV !== 'production') {
          debugLog('raw-console', '[colorCyclePlaybackParticipant] sync disabled via __TB_DEBUG');
        }
        return;
      }
    } catch {}

    if (layers.length === 0) {
      return;
    }

    const manager = getColorCycleBrushManager();
    const playbackActive =
      state.colorCyclePlayback?.desiredPlaying === true &&
      (state.colorCyclePlayback?.suspendDepth ?? 0) === 0;
    let shouldRequestStart = false;

    for (const layer of layers) {
      if (!layer.colorCycleData) {
        continue;
      }

      if (logCC) {
        debugLog('raw-console', '[colorCyclePlaybackParticipant] sync layer', {
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

      const requestedAnimating = layer.colorCycleData.mode !== 'recolor';
      const isAnimating = playbackActive && requestedAnimating;
      const previous = lastRuntimeState.get(layer.id) ?? {};
      const nextSnapshot: RuntimeSnapshot = { ...previous };
      const brushChanged = previous.brushRef !== brush;
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

      const flowMode: RuntimeSnapshot['flowMode'] = 'forward';
      if (previous.flowMode !== flowMode) {
        try {
          const legacyBrush = brush as {
            setLegacyFlowMode?: (mode: typeof flowMode) => void;
          };
          if (typeof legacyBrush.setLegacyFlowMode === 'function') {
            legacyBrush.setLegacyFlowMode(flowMode);
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

    if (typeof window !== 'undefined' && shouldRequestStart && playbackActive) {
      requestColorCycleRuntimeStart();
    }
  },
};
