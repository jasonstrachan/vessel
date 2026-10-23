import { useAppStore } from '@/stores/useAppStore';
import type { HistoryDelta, HistoryDirection, PreparedHistoryDelta } from '../actionTypes';
import { prepareAppStoreHistoryDelta } from '@/history/storeStateCompensation';
import {
  cloneSelectionSnapshot,
  normalizeSelectionSnapshot,
  selectionSnapshotsEqual,
  type SelectionSnapshot,
} from '@/history/selectionState';

class SelectionBoundsDelta implements HistoryDelta {
  readonly _tag = 'selection-bounds';
  readonly approxBytes: number;

  constructor(
    private readonly beforeSnapshot: SelectionSnapshot,
    private readonly afterSnapshot: SelectionSnapshot,
  ) {
    const snapshotBytes = (snapshot: SelectionSnapshot): number =>
      (snapshot.mask?.data.byteLength ?? 0) + (snapshot.vectorPath?.points.length ?? 0) * 16 +
      (snapshot.maskLayerId?.length ?? 0) * 2 + JSON.stringify(snapshot.provenance ?? null).length * 2;
    this.approxBytes = 64 + snapshotBytes(beforeSnapshot) + snapshotBytes(afterSnapshot);
  }

  prepare(direction: HistoryDirection): PreparedHistoryDelta {
    return prepareAppStoreHistoryDelta(
      this._tag,
      direction,
      (nextDirection) => this.applyReplay(nextDirection),
      [
        'selectionStart',
        'selectionEnd',
        'selectionVectorPath',
        'selectionMask',
        'selectionMaskBounds',
        'selectionMaskLayerId',
        'selectionLastAction',
      ],
    );
  }

  applyReplay(direction: HistoryDirection): void {
    const targetSnapshot =
      direction === 'forward'
        ? this.afterSnapshot
        : this.beforeSnapshot;
    const normalized = normalizeSelectionSnapshot(targetSnapshot);
    const store = useAppStore.getState();

    if (normalized.start && normalized.end) {
      const historySource = `history-selection-${direction}`;
      const restoredOwnerKind = normalized.provenance?.ownerKind === 'history-restored'
        ? normalized.provenance.restoredOwnerKind
        : normalized.provenance?.ownerKind;
      const mask = normalized.mask;
      const selectionMask = mask ? new ImageData(mask.width, mask.height) : null;
      if (mask && selectionMask) selectionMask.data.set(mask.data);
      useAppStore.setState({
        selectionStart: normalized.start,
        selectionEnd: normalized.end,
        selectionMask,
        selectionMaskBounds: normalized.maskBounds ?? null,
        selectionMaskLayerId: normalized.maskLayerId ?? null,
        selectionVectorPath: normalized.vectorPath ?? null,
        selectionLastAction: {
          ...(normalized.provenance ?? {}),
          action: normalized.provenance?.action ?? 'set-bounds',
          source: historySource,
          ownerKind: 'history-restored',
          restoredFromHistory: true,
          ...(restoredOwnerKind ? { restoredOwnerKind } : {}),
          t: normalized.provenance?.t ?? Date.now(),
          activeLayerId: normalized.provenance?.activeLayerId ?? null,
          maskLayerId: normalized.provenance?.maskLayerId ?? normalized.maskLayerId ?? null,
          bounds: normalized.provenance?.bounds ?? {
            x: Math.min(normalized.start.x, normalized.end.x),
            y: Math.min(normalized.start.y, normalized.end.y),
            width: Math.abs(normalized.end.x - normalized.start.x),
            height: Math.abs(normalized.end.y - normalized.start.y),
          },
        },
      });
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
  const before = options.before;
  const after = options.after;
  if (selectionSnapshotsEqual(before, after)) {
    return null;
  }
  return new SelectionBoundsDelta(cloneSelectionSnapshot(before), cloneSelectionSnapshot(after));
};
