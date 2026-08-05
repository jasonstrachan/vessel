import type { StateCreator } from 'zustand';

import type { LayerStructureSnapshot } from '@/history/deltas/layerStructureDelta';
import type {
  CommitLayerStructureHistoryOptions,
  LayerHistorySnapshotOptions,
} from '@/stores/helpers/layerStructureHistory';
import {
  normalizeLayerOrder,
  reorderLayerAtIndex,
  reorderLayerBlock as reorderLayerBlockPlan,
} from '@/stores/layers/layerCrudService';
import type { LayersSlice } from '@/stores/layers/layersSliceTypes';
import type { AppState } from '@/stores/useAppStore';
import type { Layer, Project } from '@/types';
import { debugWarn } from '@/utils/debug';
import { cloneLayerAlignment } from '@/utils/layoutDefaults';
import { computeLayerPercentOffset } from '@/utils/layerMetrics';

type StoreSet = Parameters<StateCreator<AppState, [], [], AppState>>[0];
type StoreGet = Parameters<StateCreator<AppState, [], [], AppState>>[1];

type LayerOrderingActions = Pick<
  LayersSlice,
  'updateLayerAlignment' | 'reorderLayers' | 'reorderLayerBlock'
>;

export interface LayerOrderingActionDeps {
  set: StoreSet;
  get: StoreGet;
  syncPercentOffsetsFromPixels: (layers: Layer[], project: Project | null) => Layer[];
  captureLayerStructureSnapshot: (
    state: AppState,
    options: LayerHistorySnapshotOptions,
  ) => LayerStructureSnapshot;
  commitLayerStructureHistory: (options: CommitLayerStructureHistoryOptions) => void;
}

export const createLayerOrderingActions = ({
  set,
  get,
  syncPercentOffsetsFromPixels,
  captureLayerStructureSnapshot,
  commitLayerStructureHistory,
}: LayerOrderingActionDeps): LayerOrderingActions => ({
  updateLayerAlignment: (layerId, alignment) => {
    set((state) => {
    const targetLayer = state.layers.find(layer => layer.id === layerId);

    if (!targetLayer) {
      return { layers: state.layers };
    }

    let nextAlignment = cloneLayerAlignment(alignment);

    const previousAlignment = targetLayer.alignment;
    const becameAuto = nextAlignment.positioning === 'auto' && previousAlignment.positioning !== 'auto';
    const previousPercent = previousAlignment.offsetPercent ?? { x: 0, y: 0 };
    const nextPercent = nextAlignment.offsetPercent ?? { x: 0, y: 0 };
    const offsetPercentChanged = previousPercent.x !== nextPercent.x || previousPercent.y !== nextPercent.y;

    if (state.project) {
      if (becameAuto && !offsetPercentChanged) {
        try {
          const percentOffset = computeLayerPercentOffset(targetLayer, state.project);
          nextAlignment = {
            ...nextAlignment,
            offsetPercent: percentOffset
          };
        } catch (error) {
          debugWarn('raw-console', '[useAppStore] Failed to compute percent offset during alignment update', error);
        }
      }

      if (nextAlignment.positioning === 'auto') {
        const percent = nextAlignment.offsetPercent ?? { x: 0, y: 0 };
        const width = Math.max(1, state.project.width);
        const height = Math.max(1, state.project.height);
        nextAlignment = {
          ...nextAlignment,
          offsetPercent: percent,
          offsetPx: {
            x: Math.round((percent.x / 100) * width),
            y: Math.round((percent.y / 100) * height)
          }
        };
      } else {
        nextAlignment = {
          ...nextAlignment,
          offsetPercent: undefined
        };
      }
    } else if (nextAlignment.positioning !== 'auto') {
      nextAlignment = {
        ...nextAlignment,
        offsetPercent: undefined
      };
    }

    const updatedLayers = state.layers.map(layer => (
      layer.id === layerId
        ? { ...layer, alignment: nextAlignment }
        : layer
    ));

    const syncedLayers = syncPercentOffsetsFromPixels(updatedLayers, state.project ?? null);

    return {
      layers: syncedLayers,
      layersNeedRecomposition: true
    };
  });
    get().markCompositeSegmentsDirtyByLayerIds([layerId]);
  },
  reorderLayers: (sourceIndex, destinationIndex) => {
    const stateBeforeReorder = get();
    const beforeSnapshot = captureLayerStructureSnapshot(stateBeforeReorder, {
      actionType: 'layer-reorder',
      description: 'Reorder layers',
    });

    set((state) => {
      const newLayers = reorderLayerAtIndex(state.layers, sourceIndex, destinationIndex);
      const updatedLayers = normalizeLayerOrder(newLayers);

      // Layer order changed - triggering recomposition

      const syncedLayers = syncPercentOffsetsFromPixels(updatedLayers, state.project ?? null);

      return {
        layers: syncedLayers,
        layersNeedRecomposition: true
        // Remove the project update entirely - only update top-level layers
      };
    });

    const stateAfterReorder = get();
    const afterSnapshot = captureLayerStructureSnapshot(stateAfterReorder, {
      actionType: 'layer-reorder',
      description: 'Reorder layers',
      previousSnapshot: beforeSnapshot,
    });

    commitLayerStructureHistory({
      set,
      beforeSnapshot,
      afterSnapshot,
      label: 'Reorder layers',
      metadata: { operation: 'reorder' },
    });
    get().markAllCompositeSegmentsDirty();
  },
  reorderLayerBlock: (layerIds, destinationIndex) => {
    const uniqueLayerIds = Array.from(new Set(layerIds));
    if (uniqueLayerIds.length === 0) {
      return;
    }

    const stateBeforeReorder = get();
    const beforeSnapshot = captureLayerStructureSnapshot(stateBeforeReorder, {
      actionType: 'layer-reorder',
      description: 'Reorder layer block',
    });

    let didReorder = false;

    set((state) => {
      const reorderResult = reorderLayerBlockPlan(state.layers, uniqueLayerIds, destinationIndex);
      if (!reorderResult.didReorder) {
        return {};
      }

      didReorder = true;
      const normalizedLayers = normalizeLayerOrder(reorderResult.layers);
      const syncedLayers = syncPercentOffsetsFromPixels(normalizedLayers, state.project ?? null);

      return {
        layers: syncedLayers,
        layersNeedRecomposition: true,
      };
    });

    if (!didReorder) {
      return;
    }

    const stateAfterReorder = get();
    const afterSnapshot = captureLayerStructureSnapshot(stateAfterReorder, {
      actionType: 'layer-reorder',
      description: 'Reorder layer block',
      previousSnapshot: beforeSnapshot,
    });

    commitLayerStructureHistory({
      set,
      beforeSnapshot,
      afterSnapshot,
      label: 'Reorder layer block',
      metadata: { operation: 'reorder-block' },
    });
    get().markAllCompositeSegmentsDirty();
  },
});
