import type { StateCreator } from 'zustand';

import type { Layer } from '@/types';
import type { LayerStructureSnapshot } from '@/history/deltas/layerStructureDelta';
import type {
  CommitLayerStructureHistoryOptions,
  LayerHistorySnapshotOptions,
} from '@/stores/helpers/layerStructureHistory';
import {
  generateLayerGroupName,
  sanitizeLayerGroups,
} from '@/stores/layers/layerGroupService';
import type { AppState } from '../useAppStore';

type StoreSet = Parameters<StateCreator<AppState, [], [], AppState>>[0];
type StoreGet = Parameters<StateCreator<AppState, [], [], AppState>>[1];

export interface LayerGroupActionDeps {
  set: StoreSet;
  get: StoreGet;
  captureLayerStructureSnapshot: (
    state: AppState,
    options: LayerHistorySnapshotOptions
  ) => LayerStructureSnapshot;
  commitLayerStructureHistory: (options: CommitLayerStructureHistoryOptions) => void;
  getGroupVisibilitySnapshot: (groupId: string) => Map<string, boolean> | undefined;
  setGroupVisibilitySnapshot: (groupId: string, snapshot: Map<string, boolean>) => void;
  pruneGroupVisibilitySnapshots: (validGroupIds: Set<string>) => void;
}

export const createLayerGroupFromSelectionAction = (
  layerIds: string[],
  deps: LayerGroupActionDeps,
): string | null => {
  const { set, get, captureLayerStructureSnapshot, commitLayerStructureHistory } = deps;
  const stateBeforeChange = get();
  const targetIds = Array.from(
    new Set(layerIds.filter((id) => stateBeforeChange.layers.some((layer) => layer.id === id)))
  );
  if (targetIds.length === 0) {
    return null;
  }

  const beforeSnapshot = captureLayerStructureSnapshot(stateBeforeChange, {
    actionType: 'layers',
    description: 'Create layer group',
  });

  const newGroupId = `group-${Date.now()}-${Math.random()}`;
  const nextGroupName = generateLayerGroupName(stateBeforeChange.layerGroups);

  set((state) => {
    const targetIdSet = new Set(targetIds);
    const nextLayers = state.layers.map((layer) => (
      targetIdSet.has(layer.id)
        ? { ...layer, groupId: newGroupId }
        : layer
    ));
    const nextGroups = [
      ...state.layerGroups,
      { id: newGroupId, name: nextGroupName },
    ];

    return {
      layers: nextLayers,
      layerGroups: sanitizeLayerGroups(nextLayers, nextGroups),
      hiddenLayerGroupIds: state.hiddenLayerGroupIds,
    };
  });

  const stateAfterChange = get();
  const afterSnapshot = captureLayerStructureSnapshot(stateAfterChange, {
    actionType: 'layers',
    description: 'Create layer group',
    previousSnapshot: beforeSnapshot,
  });

  commitLayerStructureHistory({
    set,
    beforeSnapshot,
    afterSnapshot,
    label: 'Create layer group',
    metadata: {
      operation: 'create-layer-group',
      groupId: newGroupId,
      layerIds: targetIds,
    },
  });

  return newGroupId;
};

export const removeLayerGroupAction = (
  groupId: string,
  deps: LayerGroupActionDeps,
): void => {
  const {
    set,
    get,
    captureLayerStructureSnapshot,
    commitLayerStructureHistory,
    pruneGroupVisibilitySnapshots,
  } = deps;
  const stateBeforeChange = get();
  if (!stateBeforeChange.layerGroups.some((group) => group.id === groupId)) {
    return;
  }

  const beforeSnapshot = captureLayerStructureSnapshot(stateBeforeChange, {
    actionType: 'layers',
    description: 'Remove layer group',
  });

  let didChange = false;
  set((state) => {
    const nextLayers = state.layers.map((layer) => {
      if (layer.groupId !== groupId) {
        return layer;
      }
      didChange = true;
      return { ...layer, groupId: undefined };
    });
    const nextGroups = state.layerGroups.filter((group) => group.id !== groupId);
    if (nextGroups.length !== state.layerGroups.length) {
      didChange = true;
    }
    if (!didChange) {
      return state;
    }
    return {
      layers: nextLayers,
      layerGroups: sanitizeLayerGroups(nextLayers, nextGroups),
      hiddenLayerGroupIds: state.hiddenLayerGroupIds.filter((id) => id !== groupId),
    };
  });

  if (!didChange) {
    return;
  }

  const stateAfterChange = get();
  const afterSnapshot = captureLayerStructureSnapshot(stateAfterChange, {
    actionType: 'layers',
    description: 'Remove layer group',
    previousSnapshot: beforeSnapshot,
  });

  commitLayerStructureHistory({
    set,
    beforeSnapshot,
    afterSnapshot,
    label: 'Remove layer group',
    metadata: {
      operation: 'remove-layer-group',
      groupId,
    },
  });
  pruneGroupVisibilitySnapshots(new Set(get().layerGroups.map((group) => group.id)));
};

export const renameLayerGroupAction = (
  groupId: string,
  name: string,
  deps: LayerGroupActionDeps,
): void => {
  const { set, get, captureLayerStructureSnapshot, commitLayerStructureHistory } = deps;
  const normalizedName = name.trim();
  if (!normalizedName) {
    return;
  }

  const stateBeforeChange = get();
  const targetGroup = stateBeforeChange.layerGroups.find((group) => group.id === groupId);
  if (!targetGroup || targetGroup.name === normalizedName) {
    return;
  }

  const beforeSnapshot = captureLayerStructureSnapshot(stateBeforeChange, {
    actionType: 'layers',
    description: 'Rename layer group',
  });

  set((state) => ({
    layerGroups: state.layerGroups.map((group) => (
      group.id === groupId
        ? { ...group, name: normalizedName }
        : group
    )),
  }));

  const stateAfterChange = get();
  const afterSnapshot = captureLayerStructureSnapshot(stateAfterChange, {
    actionType: 'layers',
    description: 'Rename layer group',
    previousSnapshot: beforeSnapshot,
  });

  commitLayerStructureHistory({
    set,
    beforeSnapshot,
    afterSnapshot,
    label: 'Rename layer group',
    metadata: {
      operation: 'rename-layer-group',
      groupId,
    },
  });
};

export const setLayerGroupVisibilityAction = (
  groupId: string,
  visible: boolean,
  deps: LayerGroupActionDeps,
): void => {
  const { set, get, getGroupVisibilitySnapshot, setGroupVisibilitySnapshot } = deps;
  const stateBeforeChange = get();
  if (!stateBeforeChange.layerGroups.some((group) => group.id === groupId)) {
    return;
  }

  const memberIds = stateBeforeChange.layers
    .filter((layer: Layer) => layer.groupId === groupId)
    .map((layer: Layer) => layer.id);
  if (memberIds.length === 0) {
    return;
  }

  let didChange = false;
  let didHiddenStateChange = false;
  set((state) => {
    const hiddenGroupIds = new Set(state.hiddenLayerGroupIds);
    const previousVisibilityByLayerId = getGroupVisibilitySnapshot(groupId) ?? new Map<string, boolean>();
    const nextVisibilityByLayerId = new Map<string, boolean>();
    const nextLayers = state.layers.map((layer) => {
      if (layer.groupId !== groupId) {
        return layer;
      }
      if (visible) {
        const restoredVisibility = previousVisibilityByLayerId.has(layer.id)
          ? Boolean(previousVisibilityByLayerId.get(layer.id))
          : layer.visible;
        nextVisibilityByLayerId.set(layer.id, restoredVisibility);
        if (layer.visible === restoredVisibility) {
          return layer;
        }
        didChange = true;
        return { ...layer, visible: restoredVisibility };
      }

      nextVisibilityByLayerId.set(layer.id, layer.visible);
      if (!layer.visible) {
        return layer;
      }
      didChange = true;
      return { ...layer, visible: false };
    });

    if (visible) {
      hiddenGroupIds.delete(groupId);
    } else {
      hiddenGroupIds.add(groupId);
    }
    const nextHiddenLayerGroupIds = Array.from(hiddenGroupIds);
    didHiddenStateChange = nextHiddenLayerGroupIds.length !== state.hiddenLayerGroupIds.length
      || nextHiddenLayerGroupIds.some((id, index) => id !== state.hiddenLayerGroupIds[index]);
    if (!didChange && nextHiddenLayerGroupIds.length === state.hiddenLayerGroupIds.length) {
      const didHiddenIdsChange = nextHiddenLayerGroupIds.some((id, index) => id !== state.hiddenLayerGroupIds[index]);
      if (!didHiddenIdsChange) {
        return state;
      }
    }

    setGroupVisibilitySnapshot(groupId, nextVisibilityByLayerId);

    return {
      layers: nextLayers,
      hiddenLayerGroupIds: nextHiddenLayerGroupIds,
      layersNeedRecomposition: true,
    };
  });

  if (!didChange && !didHiddenStateChange) {
    return;
  }
  if (didChange) {
    get().markCompositeSegmentsDirtyByLayerIds(memberIds);
  }
};
