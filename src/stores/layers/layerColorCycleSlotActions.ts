import type { StateCreator } from 'zustand';

import { requestGradientApply } from '@/hooks/brushEngine/ccGradientApplyScheduler';
import { syncPlaybackColorCycleLayers } from '@/stores/ccRuntime';
import type { LayersSlice } from '@/stores/layers/layersSliceTypes';
import type { AppState } from '@/stores/useAppStore';
import type { Layer, Project } from '@/types';
import { logError } from '@/utils/debug';
import {
  buildDefaultReservedSlots,
  rebuildGradientSlotUsageAndGC,
} from '@/utils/colorCycleSlotGC';

type StoreSet = Parameters<StateCreator<AppState, [], [], AppState>>[0];
type StoreGet = Parameters<StateCreator<AppState, [], [], AppState>>[1];

type LayerColorCycleSlotActions = Pick<
  LayersSlice,
  'scheduleColorCycleSlotRebuild' | 'runColorCycleSlotRebuild'
>;

export interface LayerColorCycleSlotActionDeps {
  set: StoreSet;
  get: StoreGet;
  syncPercentOffsetsFromPixels: (layers: Layer[], project: Project | null) => Layer[];
}

export const createLayerColorCycleSlotActions = ({
  set,
  get,
  syncPercentOffsetsFromPixels,
}: LayerColorCycleSlotActionDeps): LayerColorCycleSlotActions => {
    let slotRebuildTimer: ReturnType<typeof setTimeout> | null = null;
    const SLOT_REBUILD_DEBOUNCE_MS = 250;
    const runColorCycleSlotRebuild = (reason: string) => {
      const state = get();
      const result = rebuildGradientSlotUsageAndGC({
        layers: state.layers,
        scope: 'project',
        reservedSlots: buildDefaultReservedSlots(),
      });
      if (!result) {
        return;
      }
      if (result.missingDefLayers && result.missingDefLayers.length > 0) {
        if (process.env.NODE_ENV !== 'production') {
          logError('[CC] Slot GC aborted due to missing defs', {
            reason,
            missingDefLayers: result.missingDefLayers,
          });
        }
        return;
      }
      if (result.updates.length === 0) {
        return;
      }
      const updateMap = new Map(result.updates.map((entry) => [entry.layerId, entry.colorCycleData]));
      set((current) => {
        const nextLayers = current.layers.map((layer) => {
          const nextData = updateMap.get(layer.id);
          if (!nextData) {
            return layer;
          }
          return { ...layer, colorCycleData: nextData };
        });
        const syncedLayers = syncPercentOffsetsFromPixels(nextLayers, current.project ?? null);
        return { layers: syncedLayers };
      });
      try {
        const refreshed = get();
        const updatedLayers = refreshed.layers.filter((layer) => updateMap.has(layer.id));
        syncPlaybackColorCycleLayers(updatedLayers, 'slot-gc');
        updatedLayers.forEach((layer) => {
          if (layer.layerType === 'color-cycle') {
            requestGradientApply(layer.id, 'slot-gc');
          }
        });
      } catch (error) {
        logError('[slot-gc] Failed to sync CC runtimes after rebuild', error);
      }
      return result;
    };

  const scheduleColorCycleSlotRebuild = (reason: string) => {
    if (typeof setTimeout === 'undefined') {
      return;
    }
    if (slotRebuildTimer) {
      clearTimeout(slotRebuildTimer);
    }
    slotRebuildTimer = setTimeout(() => {
      slotRebuildTimer = null;
      runColorCycleSlotRebuild(reason);
    }, SLOT_REBUILD_DEBOUNCE_MS);
  };

  return {
    scheduleColorCycleSlotRebuild,
    runColorCycleSlotRebuild,
  };
};
