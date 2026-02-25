import { useAppStore } from '@/stores/useAppStore';
import type { HistoryDelta, HistoryDirection } from '../actionTypes';
import {
  cloneSelectionSnapshot,
  normalizeSelectionSnapshot,
  selectionSnapshotsEqual,
  type SelectionSnapshot,
} from '@/history/selectionState';

class SelectionBoundsDelta implements HistoryDelta {
  readonly _tag = 'selection-bounds';
  readonly approxBytes = 64;

  constructor(
    private readonly beforeSnapshot: SelectionSnapshot,
    private readonly afterSnapshot: SelectionSnapshot,
  ) {}

  apply(direction: HistoryDirection): void {
    const targetSnapshot =
      direction === 'forward'
        ? this.afterSnapshot
        : this.beforeSnapshot;
    const normalized = normalizeSelectionSnapshot(targetSnapshot);
    const store = useAppStore.getState();

    if (normalized.start && normalized.end) {
      store.setSelectionBounds(
        { x: normalized.start.x, y: normalized.start.y },
        { x: normalized.end.x, y: normalized.end.y },
      );
    } else {
      store.clearSelection();
    }
  }
}

interface SelectionDeltaOptions {
  before: SelectionSnapshot;
  after: SelectionSnapshot;
}

export const createSelectionDelta = (
  options: SelectionDeltaOptions,
): HistoryDelta | null => {
  const before = normalizeSelectionSnapshot(options.before);
  const after = normalizeSelectionSnapshot(options.after);
  if (selectionSnapshotsEqual(before, after)) {
    return null;
  }
  return new SelectionBoundsDelta(cloneSelectionSnapshot(before), cloneSelectionSnapshot(after));
};
