import type { StoreApi } from 'zustand';
import type { CanvasSnapshot } from '@/types';
import historyManager from '@/history/historyService';
import { createLegacySnapshotDelta } from '@/history/legacyCanvasSnapshot';
import { logError } from '@/utils/debug';
import { createHistorySnapshotFromState } from './historyLifecycle';

type AppState = import('../useAppStore').AppState;

type StoreSet = StoreApi<AppState>['setState'];

export interface LayerHistorySnapshotOptions {
  actionType: CanvasSnapshot['actionType'];
  description: string;
  activeLayerId?: string | null;
  previousSnapshot?: CanvasSnapshot | null;
}

export const captureLayerStructureSnapshot = (
  state: AppState,
  { actionType, description, activeLayerId, previousSnapshot }: LayerHistorySnapshotOptions
): CanvasSnapshot => {
  return createHistorySnapshotFromState(state, {
    actionType,
    description,
    activeLayerId: activeLayerId ?? undefined,
    previousSnapshot: previousSnapshot ?? undefined,
  });
};

export interface CommitLayerStructureHistoryOptions {
  set: StoreSet;
  beforeSnapshot: CanvasSnapshot;
  afterSnapshot: CanvasSnapshot;
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
      createLegacySnapshotDelta({
        forward: afterSnapshot,
        backward: beforeSnapshot,
      })
    );
    txn.commit(label);

    set((state) => ({
      autosave: {
        ...state.autosave,
        hasUnsavedChanges: true,
        lastSaveTime: new Date(),
      },
    }));
  } catch (error) {
    logError('[history] Failed to record layer structure change', error);
  }
};
