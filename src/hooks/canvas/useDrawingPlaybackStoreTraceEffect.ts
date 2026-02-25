import { useEffect, type MutableRefObject } from 'react';
import { type AppState, useAppStore } from '@/stores/useAppStore';
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

    let previousSnapshots = buildSnapshot(storeRef.current.layers);

    const unsubscribe = useAppStore.subscribe((state: AppState) => {
      const nextSnapshots = buildSnapshot(state.layers);

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

      previousSnapshots = nextSnapshots;
    });

    return () => {
      unsubscribe();
    };
  }, [storeRef, ccLog]);
};
