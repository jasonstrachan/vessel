import historyManager from '@/history/historyService';
import { useAppStore } from '@/stores/useAppStore';
import { createSelectionDelta } from '@/history/deltas/selectionDelta';
import {
  cloneSelectionSnapshot,
  selectionSnapshotFromValues,
  type SelectionSnapshot,
} from '@/history/selectionState';

export const captureSelectionSnapshot = (): SelectionSnapshot =>
  selectionSnapshotFromValues(
    useAppStore.getState().selectionStart,
    useAppStore.getState().selectionEnd,
    useAppStore.getState().selectionLastAction,
  );

interface CommitSelectionHistoryOptions {
  before: SelectionSnapshot;
  description: string;
  meta?: Record<string, unknown>;
  after?: SelectionSnapshot;
}

export const commitSelectionHistory = ({
  before,
  description,
  meta,
  after,
}: CommitSelectionHistoryOptions): void => {
  if (historyManager.isReplaying) {
    return;
  }

  const resolvedAfter = after ? cloneSelectionSnapshot(after) : captureSelectionSnapshot();
  const delta = createSelectionDelta({
    before: cloneSelectionSnapshot(before),
    after: resolvedAfter,
  });

  if (!delta) {
    return;
  }

  const txn = historyManager.begin('selection-change', meta);
  txn.push(delta);
  txn.commit(description);
};

export { cloneSelectionSnapshot, selectionSnapshotFromValues } from '@/history/selectionState';
