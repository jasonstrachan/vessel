import type { StoreApi } from 'zustand';
import type { CanvasSnapshot } from '@/types';
import historyManager from '@/history/historyService';
import {
  createLayerStructureDelta,
  type LayerStructureSnapshot,
} from '@/history/deltas/layerStructureDelta';
import { logError } from '@/utils/debug';
import { createHistorySnapshotFromState } from './historyLifecycle';

type AppState = import('../useAppStore').AppState;

type StoreSet = StoreApi<AppState>['setState'];

export interface LayerHistorySnapshotOptions {
  actionType: CanvasSnapshot['actionType'];
  description: string;
  activeLayerId?: string | null;
  previousSnapshot?: LayerStructureSnapshot | null;
}

export const captureLayerStructureSnapshot = (
  state: AppState,
  { actionType, description, activeLayerId, previousSnapshot }: LayerHistorySnapshotOptions
): LayerStructureSnapshot => {
  const snapshot = createHistorySnapshotFromState(state, {
    actionType,
    description,
    activeLayerId: activeLayerId ?? undefined,
    previousSnapshot: previousSnapshot?.snapshot ?? undefined,
  });

  return {
    snapshot,
    selectedLayerIds: [...state.selectedLayerIds],
    referenceLayerId: state.referenceLayerId ?? null,
    layerGroups: state.layerGroups.map((group) => ({ ...group })),
  };
};

export interface CommitLayerStructureHistoryOptions {
  set: StoreSet;
  beforeSnapshot: LayerStructureSnapshot;
  afterSnapshot: LayerStructureSnapshot;
  label: string;
  metadata?: Record<string, unknown>;
}

export const commitLayerStructureHistory = ({
  set,
  beforeSnapshot,
  afterSnapshot,
  label,
  metadata,
}: CommitLayerStructureHistoryOptions): void => {
  try {
    const txn = historyManager.begin('layer-structure', metadata ?? {});
    txn.push(
      createLayerStructureDelta({
        before: beforeSnapshot,
        after: afterSnapshot,
      }),
    );
    txn.commit(label);

    set((state) => ({
      autosave: {
        ...state.autosave,
        hasUnsavedChanges: true,
        lastDirtyReason: 'layer-change',
        lastDirtyAt: new Date(),
      },
    }));
  } catch (error) {
    logError('[history] Failed to record layer structure change', error);
  }
};
