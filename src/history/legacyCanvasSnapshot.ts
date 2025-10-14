import type { CanvasSnapshot } from '@/types';
import { applyLegacySnapshot } from './applyLegacySnapshot';

import type {
  HistoryActionId,
  HistoryDelta,
  HistoryDirection,
  HistoryEntry,
} from './actionTypes';

export const LEGACY_SNAPSHOT_TAG = 'legacy-canvas-snapshot';

export interface LegacySnapshotDeltaHandle extends HistoryDelta {
  getSnapshot(direction: HistoryDirection): CanvasSnapshot;
}

export interface LegacySnapshotDeltaOptions {
  forward: CanvasSnapshot;
  backward: CanvasSnapshot;
  applySnapshot?: (direction: HistoryDirection, snapshot: CanvasSnapshot) => Promise<void> | void;
  approxBytes?: number;
}

class LegacySnapshotDelta implements LegacySnapshotDeltaHandle {
  readonly _tag = LEGACY_SNAPSHOT_TAG;
  readonly approxBytes?: number;

  private readonly forward: CanvasSnapshot;
  private readonly backward: CanvasSnapshot;
  private readonly applySnapshot: LegacySnapshotDeltaOptions['applySnapshot'];

  constructor(options: LegacySnapshotDeltaOptions) {
    this.forward = options.forward;
    this.backward = options.backward;
    this.applySnapshot = options.applySnapshot ?? ((_direction, snapshot) => applyLegacySnapshot(snapshot));
    this.approxBytes = options.approxBytes;
  }

  apply(direction: HistoryDirection): Promise<void> | void {
    const snapshot = direction === 'forward' ? this.forward : this.backward;
    return this.applySnapshot(direction, snapshot);
  }

  getSnapshot(direction: HistoryDirection): CanvasSnapshot {
    return direction === 'forward' ? this.forward : this.backward;
  }
}

export interface LegacyEntryOptions {
  id: string;
  action: HistoryActionId;
  label: string;
  docId: string;
  forward: CanvasSnapshot;
  backward: CanvasSnapshot;
  applySnapshot?: LegacySnapshotDeltaOptions['applySnapshot'];
  meta?: Record<string, unknown>;
  approxBytes?: number;
}

export const createLegacySnapshotDelta = (options: LegacySnapshotDeltaOptions): LegacySnapshotDeltaHandle =>
  new LegacySnapshotDelta(options);

export const createLegacyHistoryEntry = (options: LegacyEntryOptions): HistoryEntry => {
  const delta: LegacySnapshotDeltaHandle = new LegacySnapshotDelta({
    forward: options.forward,
    backward: options.backward,
    applySnapshot: options.applySnapshot,
    approxBytes: options.approxBytes,
  });

  return {
    id: options.id,
    action: options.action,
    label: options.label,
    ts: Date.now(),
    docId: options.docId,
    deltas: [delta],
    meta: options.meta,
  };
};

export const isLegacySnapshotDelta = (delta: HistoryDelta): delta is LegacySnapshotDeltaHandle =>
  delta._tag === LEGACY_SNAPSHOT_TAG;
