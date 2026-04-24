import { useEffect, type MutableRefObject } from 'react';
import {
  selectEffectiveColorCyclePlaying,
  type AppState,
  useAppStore,
} from '@/stores/useAppStore';
import type { Layer } from '@/types';

interface UseDrawingPlaybackStoreTraceEffectOptions {
  storeRef: MutableRefObject<AppState>;
  ccLog: (label: string, payload?: Record<string, unknown>) => void;
}

export const useDrawingPlaybackStoreTraceEffect = ({
  storeRef,
  ccLog,
}: UseDrawingPlaybackStoreTraceEffectOptions) => {
  useEffect(() => {
    type LayerSnapshot = {
      id: string;
      mode: string | null;
      isAnimating: boolean | null;
    };

    const buildSnapshot = (layers: Layer[]): Record<string, LayerSnapshot> =>
      layers.reduce<Record<string, LayerSnapshot>>((acc, layer) => {
        acc[layer.id] = {
          id: layer.id,
          mode: (layer.colorCycleData?.mode ?? null) as LayerSnapshot['mode'],
          isAnimating: (layer.colorCycleData?.isAnimating ?? null) as LayerSnapshot['isAnimating'],
        };
        return acc;
      }, {});

    const summarizeLayers = (layers: Layer[]) =>
      layers
        .filter((layer) => layer.layerType === 'color-cycle')
        .map((layer) => ({
          id: layer.id.slice(-6),
          mode: layer.colorCycleData?.mode ?? null,
          isAnimating: layer.colorCycleData?.isAnimating ?? null,
        }));

    let previousSnapshots = buildSnapshot(storeRef.current.layers);
    let previousPlayback = {
      desiredPlaying: storeRef.current.colorCyclePlayback.desiredPlaying,
      suspendDepth: storeRef.current.colorCyclePlayback.suspendDepth,
      lastReason: storeRef.current.colorCyclePlayback.lastReason ?? null,
      effectivePlaying: selectEffectiveColorCyclePlaying(storeRef.current),
    };

    const unsubscribe = useAppStore.subscribe((state: AppState) => {
      const nextSnapshots = buildSnapshot(state.layers);
      const nextPlayback = {
        desiredPlaying: state.colorCyclePlayback.desiredPlaying,
        suspendDepth: state.colorCyclePlayback.suspendDepth,
        lastReason: state.colorCyclePlayback.lastReason ?? null,
        effectivePlaying: selectEffectiveColorCyclePlaying(state),
      };

      Object.values(nextSnapshots).forEach((entry) => {
        const prevEntry = previousSnapshots[entry.id];
        if (!prevEntry) {
          return;
        }
        if (prevEntry.isAnimating !== entry.isAnimating) {
          ccLog('STORE isAnimating flip', {
            id: entry.id.slice(-6),
            mode: entry.mode,
            prev: prevEntry.isAnimating,
            next: entry.isAnimating,
          });
        }
      });

      if (
        previousPlayback.desiredPlaying !== nextPlayback.desiredPlaying ||
        previousPlayback.suspendDepth !== nextPlayback.suspendDepth ||
        previousPlayback.lastReason !== nextPlayback.lastReason ||
        previousPlayback.effectivePlaying !== nextPlayback.effectivePlaying
      ) {
        ccLog('STORE playback flip', {
          prev: previousPlayback,
          next: nextPlayback,
          layers: summarizeLayers(state.layers),
        });
      }

      previousSnapshots = nextSnapshots;
      previousPlayback = nextPlayback;
    });

    return () => {
      unsubscribe();
    };
  }, [storeRef, ccLog]);
};
