export type HistoryDirection = 'forward' | 'backward';

export type HistoryActionId =
  | 'brush-stroke'
  | 'cc-stroke'
  | 'eraser-stroke'
  | 'fill'
  | 'layer-structure'
  | 'layer-bitmap'
  | 'project-transform'
  | 'shape-session'
  | 'shape-commit'
  | 'selection-change'
  | 'view-state'
  | 'floating-paste'
  | 'crop'
  | 'settings-change';

export interface HistoryDelta {
  /**
   * Discriminant used to route apply/rollback logic.
   */
  readonly _tag: string;
  /**
   * Best-effort byte size used for heuristic limits.
   */
  readonly approxBytes?: number;
  /**
   * Apply the delta in the given direction. Implementations should be idempotent and
   * must NOT enqueue new history entries while `HistoryManager.isReplaying === true`.
   */
  apply(direction: HistoryDirection): Promise<void> | void;
  /**
   * Optional cleanup hook called when the history entry that owns this delta is discarded.
   */
  dispose?(): void;
  /**
   * Optional hook allowing a delta to describe which runtime resources require rehydration
   * once the entry finishes applying. Mutate the provided accumulator instead of creating
   * a new object to avoid allocations in hot paths.
   */
  collectRehydrationTargets?(targets: HistoryRehydrationTargets): void;
}

export interface HistoryEntry {
  id: string;
  action: HistoryActionId;
  label: string;
  ts: number;
  docId: string;
  deltas: HistoryDelta[];
  meta?: Record<string, unknown>;
}

export interface HistoryCoalesceOptions {
  key: string;
  /**
   * Maximum interval (ms) between commits that are allowed to merge.
   * When omitted, a sensible default should be applied by the caller.
   */
  maxIntervalMs?: number;
  /**
   * When true, the label from the new commit replaces the existing entry label.
   */
  mergeLabel?: boolean;
}

export interface ScopedTxnOptions {
  coalesce?: HistoryCoalesceOptions;
}

export interface ScopedTxn {
  readonly id: string;
  push(delta: HistoryDelta): void;
  commit(label: string): void;
  cancel(): void;
}

export interface HistoryManagerHooks {
  onCommit?(entry: HistoryEntry): void;
  onUndo?(entry: HistoryEntry): void;
  onRedo?(entry: HistoryEntry): void;
}

export type HistoryWorkerScope = 'color-cycle-gradient';

export interface HistoryRehydrationTargets {
  /**
   * Layers with bitmap updates requiring framebuffer re-sync.
   */
  layerIds: Set<string>;
  /**
   * Color cycle layers requiring runtime restoration.
   */
  colorCycleLayerIds: Set<string>;
  /**
   * Workers or background services that need state refresh after replay.
   */
  workerScopes: Set<HistoryWorkerScope>;
}
