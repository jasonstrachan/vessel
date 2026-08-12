import type { StateCreator } from 'zustand';

import type { InterlaceGroupSettings, Layer } from '@/types';
import type { LayerStructureSnapshot } from '@/history/deltas/layerStructureDelta';
import {
  DEFAULT_INTERLACE_SETTINGS,
  sanitizeInterlaceSettings,
} from '@/lib/interlace/interlaceSettings';
import type {
  CommitLayerStructureHistoryOptions,
  LayerHistorySnapshotOptions,
} from '@/stores/helpers/layerStructureHistory';
import {
  generateLayerGroupName,
  sanitizeHiddenLayerGroupIds,
  sanitizeLayerGroups,
} from '@/stores/layers/layerGroupService';
import {
  normalizeLayerOrder,
  reorderLayerBlock,
} from '@/stores/layers/layerCrudService';
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

export const createInterlaceGroupFromSelectionAction = (
  layerIds: string[],
  deps: LayerGroupActionDeps,
): string | null => {
  const { set, get, captureLayerStructureSnapshot, commitLayerStructureHistory } = deps;
  const stateBeforeChange = get();
  const targetIds = stateBeforeChange.layers
    .filter((layer) => (
      layerIds.includes(layer.id)
      && layer.layerType !== 'sequential'
    ))
    .map((layer) => layer.id);
  if (targetIds.length < 2) {
    return null;
  }

  const beforeSnapshot = captureLayerStructureSnapshot(stateBeforeChange, {
    actionType: 'layers',
    description: 'Create interlace group',
  });
  const newGroupId = `interlace-${Date.now()}-${Math.random()}`;
  const nextGroupName = `Interlace ${stateBeforeChange.layerGroups.filter(
    (group) => group.kind === 'interlace',
  ).length + 1}`;
  const destinationIndex = Math.min(...targetIds.map((id) => (
    stateBeforeChange.layers.findIndex((layer) => layer.id === id)
  )));

  set((state) => {
    const reordered = reorderLayerBlock(state.layers, targetIds, destinationIndex).layers;
    const targetIdSet = new Set(targetIds);
    const nextLayers = normalizeLayerOrder(reordered.map((layer) => (
      targetIdSet.has(layer.id) ? { ...layer, groupId: newGroupId } : layer
    )));
    const nextGroups = sanitizeLayerGroups(nextLayers, [
      ...state.layerGroups,
      {
        id: newGroupId,
        name: nextGroupName,
        kind: 'interlace',
        interlace: { ...DEFAULT_INTERLACE_SETTINGS },
      },
    ]);
    return {
      layers: nextLayers,
      layerGroups: nextGroups,
      hiddenLayerGroupIds: sanitizeHiddenLayerGroupIds(state.hiddenLayerGroupIds, nextGroups),
      layersNeedRecomposition: true,
    };
  });

  const afterSnapshot = captureLayerStructureSnapshot(get(), {
    actionType: 'layers',
    description: 'Create interlace group',
    previousSnapshot: beforeSnapshot,
  });
  commitLayerStructureHistory({
    set,
    beforeSnapshot,
    afterSnapshot,
    label: 'Create interlace group',
    metadata: {
      operation: 'create-interlace-group',
      groupId: newGroupId,
      layerIds: targetIds,
    },
  });
  get().markAllCompositeSegmentsDirty();
  return newGroupId;
};

export const updateInterlaceGroupAction = (
  groupId: string,
  updates: Partial<InterlaceGroupSettings>,
  deps: LayerGroupActionDeps,
  options: {
    recordHistory?: boolean;
    previousSettings?: InterlaceGroupSettings;
  } = {},
): void => {
  const { set, get, captureLayerStructureSnapshot, commitLayerStructureHistory } = deps;
  const stateBeforeChange = get();
  const target = stateBeforeChange.layerGroups.find((group) => (
    group.id === groupId && group.kind === 'interlace'
  ));
  if (!target) {
    return;
  }
  const currentSettings = sanitizeInterlaceSettings(target.interlace);
  const nextSettings = sanitizeInterlaceSettings({ ...currentSettings, ...updates });
  const previousSettings = options.previousSettings
    ? sanitizeInterlaceSettings(options.previousSettings)
    : currentSettings;
  const didSettingsChange = JSON.stringify(nextSettings) !== JSON.stringify(currentSettings);
  const shouldRecordHistory = options.recordHistory !== false
    && JSON.stringify(nextSettings) !== JSON.stringify(previousSettings);
  if (!didSettingsChange && !shouldRecordHistory) {
    return;
  }

  const stateAtHistoryStart = options.previousSettings
    ? {
      ...stateBeforeChange,
      layerGroups: stateBeforeChange.layerGroups.map((group) => (
        group.id === groupId ? { ...group, interlace: previousSettings } : group
      )),
    }
    : stateBeforeChange;
  const beforeSnapshot = shouldRecordHistory
    ? captureLayerStructureSnapshot(stateAtHistoryStart, {
      actionType: 'layers',
      description: 'Update interlace group',
    })
    : null;

  if (didSettingsChange) {
    set((state) => ({
      layerGroups: state.layerGroups.map((group) => (
        group.id === groupId ? { ...group, interlace: nextSettings } : group
      )),
      layersNeedRecomposition: true,
    }));
    if (options.recordHistory !== false) {
      get().markAllCompositeSegmentsDirty();
    }
  }

  if (!beforeSnapshot) {
    return;
  }
  const afterSnapshot = captureLayerStructureSnapshot(get(), {
    actionType: 'layers',
    description: 'Update interlace group',
    previousSnapshot: beforeSnapshot,
  });
  commitLayerStructureHistory({
    set,
    beforeSnapshot,
    afterSnapshot,
    label: 'Update interlace group',
    metadata: { operation: 'update-interlace-group', groupId },
  });
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

export const moveLayersToGroupAction = (
  layerIds: string[],
  groupId: string | undefined,
  destinationIndex: number,
  deps: LayerGroupActionDeps,
): void => {
  const {
    set,
    get,
    captureLayerStructureSnapshot,
    commitLayerStructureHistory,
    getGroupVisibilitySnapshot,
    setGroupVisibilitySnapshot,
    pruneGroupVisibilitySnapshots,
  } = deps;
  const stateBeforeChange = get();
  if (
    !Number.isInteger(destinationIndex)
    || destinationIndex < 0
    || destinationIndex > stateBeforeChange.layers.length
    || (groupId !== undefined && !stateBeforeChange.layerGroups.some((group) => group.id === groupId))
  ) {
    return;
  }

  const targetLayerIds = Array.from(new Set(layerIds)).filter((layerId) => (
    stateBeforeChange.layers.some((layer) => layer.id === layerId)
  ));
  if (targetLayerIds.length === 0) {
    return;
  }

  const hiddenGroupIdSet = new Set(stateBeforeChange.hiddenLayerGroupIds);
  const visibilityBeforeGroupHideByLayerId = new Map<string, boolean>();
  const nextVisibilitySnapshots = new Map<string, Map<string, boolean>>();
  const getNextVisibilitySnapshot = (targetGroupId: string): Map<string, boolean> => {
    const existing = nextVisibilitySnapshots.get(targetGroupId);
    if (existing) {
      return existing;
    }
    const next = new Map(getGroupVisibilitySnapshot(targetGroupId));
    nextVisibilitySnapshots.set(targetGroupId, next);
    return next;
  };

  targetLayerIds.forEach((layerId) => {
    const layer = stateBeforeChange.layers.find((candidate) => candidate.id === layerId);
    if (!layer || layer.groupId === groupId) {
      return;
    }
    const sourceGroupId = layer.groupId;
    const sourceVisibilitySnapshot = sourceGroupId && hiddenGroupIdSet.has(sourceGroupId)
      ? getGroupVisibilitySnapshot(sourceGroupId)
      : undefined;
    const visibilityBeforeGroupHide = sourceVisibilitySnapshot?.has(layer.id)
      ? Boolean(sourceVisibilitySnapshot.get(layer.id))
      : layer.visible;
    visibilityBeforeGroupHideByLayerId.set(layer.id, visibilityBeforeGroupHide);

    if (groupId && hiddenGroupIdSet.has(groupId)) {
      getNextVisibilitySnapshot(groupId).set(layer.id, visibilityBeforeGroupHide);
    }
  });

  const beforeSnapshot = captureLayerStructureSnapshot(stateBeforeChange, {
    actionType: 'layer-reorder',
    description: groupId ? 'Move layers into group' : 'Move layers out of group',
  });
  let didChange = false;

  set((state) => {
    const reorderResult = reorderLayerBlock(state.layers, targetLayerIds, destinationIndex);
    const targetLayerIdSet = new Set(targetLayerIds);
    const nextLayers = normalizeLayerOrder(reorderResult.layers.map((layer) => {
      if (!targetLayerIdSet.has(layer.id) || layer.groupId === groupId) {
        return layer;
      }
      didChange = true;
      return {
        ...layer,
        groupId,
        visible: groupId && hiddenGroupIdSet.has(groupId)
          ? false
          : (visibilityBeforeGroupHideByLayerId.get(layer.id) ?? layer.visible),
      };
    }));

    if (!didChange && !reorderResult.didReorder) {
      return state;
    }
    didChange = true;
    const nextLayerGroups = sanitizeLayerGroups(nextLayers, state.layerGroups);

    return {
      layers: nextLayers,
      layerGroups: nextLayerGroups,
      hiddenLayerGroupIds: sanitizeHiddenLayerGroupIds(
        state.hiddenLayerGroupIds,
        nextLayerGroups,
      ),
      layersNeedRecomposition: true,
    };
  });

  if (!didChange) {
    return;
  }

  const stateAfterChange = get();
  const validGroupIds = new Set(stateAfterChange.layerGroups.map((group) => group.id));
  nextVisibilitySnapshots.forEach((snapshot, snapshotGroupId) => {
    if (validGroupIds.has(snapshotGroupId)) {
      setGroupVisibilitySnapshot(snapshotGroupId, snapshot);
    }
  });
  const afterSnapshot = captureLayerStructureSnapshot(stateAfterChange, {
    actionType: 'layer-reorder',
    description: groupId ? 'Move layers into group' : 'Move layers out of group',
    previousSnapshot: beforeSnapshot,
  });
  commitLayerStructureHistory({
    set,
    beforeSnapshot,
    afterSnapshot,
    label: groupId ? 'Move layers into group' : 'Move layers out of group',
    metadata: {
      operation: 'move-layers-to-group',
      groupId: groupId ?? null,
      layerIds: targetLayerIds,
    },
  });
  pruneGroupVisibilitySnapshots(validGroupIds);
  get().markAllCompositeSegmentsDirty();
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
