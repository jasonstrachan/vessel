import type { StoreApi } from 'zustand';
import type { CanvasSnapshot } from '@/types';
import historyManager from '@/history/historyService';
import {
  createLayerStructureDelta,
  type LayerStructureSnapshot,
} from '@/history/deltas/layerStructureDelta';
import { logError } from '@/utils/debug';
import { cloneUiShapes } from '@/utils/uiShape';
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
    referenceSamplingSource: state.project?.referenceSamplingSource,
    layerGroups: state.layerGroups.map((group) => ({
      ...group,
      interlace: group.interlace ? { ...group.interlace } : undefined,
    })),
    txtShapes: state.project?.txtShapes?.map((shape) => ({
      ...shape,
      colorRanges: shape.colorRanges?.map((range) => ({ ...range })),
      regionPath: shape.regionPath?.map((point) => ({ ...point })),
      selections: shape.selections.map((selection) => ({ ...selection })),
    })) ?? [],
    uiShapes: cloneUiShapes(state.project?.uiShapes ?? []),
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

  } catch (error) {
    logError('[history] Failed to record layer structure change', error);
  }
};
