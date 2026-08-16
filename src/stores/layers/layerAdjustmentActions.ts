import type { StateCreator } from 'zustand';

import type { LayerStructureSnapshot } from '@/history/deltas/layerStructureDelta';
import { sanitizeAdjustmentEffect } from '@/lib/adjustmentLayers';
import type {
  CommitLayerStructureHistoryOptions,
  LayerHistorySnapshotOptions,
} from '@/stores/helpers/layerStructureHistory';
import type { LayersSlice } from '@/stores/layers/layersSliceTypes';
import type { AppState } from '@/stores/useAppStore';

type StoreSet = Parameters<StateCreator<AppState, [], [], AppState>>[0];
type StoreGet = Parameters<StateCreator<AppState, [], [], AppState>>[1];

type LayerAdjustmentActions = Pick<
  LayersSlice,
  'beginAdjustmentLayerEdit' | 'updateAdjustmentLayerEffect' | 'commitAdjustmentLayerEdit'
>;

interface LayerAdjustmentActionDeps {
  set: StoreSet;
  get: StoreGet;
  captureLayerStructureSnapshot: (
    state: AppState,
    options: LayerHistorySnapshotOptions,
  ) => LayerStructureSnapshot;
  commitLayerStructureHistory: (options: CommitLayerStructureHistoryOptions) => void;
}

export const createLayerAdjustmentActions = ({
  set,
  get,
  captureLayerStructureSnapshot,
  commitLayerStructureHistory,
}: LayerAdjustmentActionDeps): LayerAdjustmentActions => {
  const editStartByLayerId = new Map<string, LayerStructureSnapshot>();

  return {
    beginAdjustmentLayerEdit: (layerId) => {
      if (editStartByLayerId.has(layerId)) return;
      const state = get();
      const layer = state.layers.find((candidate) => candidate.id === layerId);
      if (layer?.layerType !== 'adjustment') return;
      editStartByLayerId.set(layerId, captureLayerStructureSnapshot(state, {
        actionType: 'layers',
        description: 'Edit adjustment layer',
        activeLayerId: layerId,
      }));
    },

    updateAdjustmentLayerEffect: (layerId, effect) => {
      const layer = get().layers.find((candidate) => candidate.id === layerId);
      if (layer?.layerType !== 'adjustment') return;
      get().updateLayer(layerId, {
        adjustmentData: { effect: sanitizeAdjustmentEffect(effect) },
      });
    },

    commitAdjustmentLayerEdit: (layerId) => {
      const beforeSnapshot = editStartByLayerId.get(layerId);
      if (!beforeSnapshot) return;
      editStartByLayerId.delete(layerId);
      const state = get();
      const layer = state.layers.find((candidate) => candidate.id === layerId);
      if (layer?.layerType !== 'adjustment') return;
      const afterSnapshot = captureLayerStructureSnapshot(state, {
        actionType: 'layers',
        description: 'Edit adjustment layer',
        activeLayerId: layerId,
        previousSnapshot: beforeSnapshot,
      });
      commitLayerStructureHistory({
        set,
        beforeSnapshot,
        afterSnapshot,
        label: 'Edit adjustment layer',
        metadata: {
          operation: 'edit-adjustment-layer',
          layerId,
          effectId: layer.adjustmentData?.effect.id,
        },
      });
    },
  };
};
