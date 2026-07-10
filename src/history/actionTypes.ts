export type HistoryDirection = 'forward' | 'backward';

export type HistoryActionId =
  | 'brush-stroke'
  | 'sequential-stroke'
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
   * Resolve all data needed to replay this delta before any delta in the entry mutates
   * the document. The returned compensation must restore the exact pre-replay state
   * without fetching or decoding additional history data.
   */
  prepare(direction: HistoryDirection): Promise<PreparedHistoryDelta> | PreparedHistoryDelta;
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

/**
 * A fully prepared replay step. HistoryManager applies these sequentially and invokes
 * exact-state compensation in reverse order if application or runtime rehydration fails.
 */
export interface PreparedHistoryDelta {
  readonly deltaTag: string;
  apply(): Promise<void> | void;
  requiresCompensation(): boolean;
  compensate(): Promise<void> | void;
  collectRehydrationTargets?(targets: HistoryRehydrationTargets): void;
}

export interface HistoryMutationTracker {
  markMutated(): void;
  requiresCompensation(): boolean;
}

export const createHistoryMutationTracker = (): HistoryMutationTracker => {
  let mutated = false;
  return {
    markMutated: () => {
      mutated = true;
    },
    requiresCompensation: () => mutated,
  };
};

/**
 * Small adapter for already-prepared apply and compensation closures. Store-backed
 * deltas must capture their compensation from the actual pre-replay state; replaying
 * the nominal opposite direction is not guaranteed to be an exact inverse.
 */
export const prepareHistoryDelta = (
  deltaTag: string,
  apply: () => Promise<void> | void,
  requiresCompensation: () => boolean,
  compensate: () => Promise<void> | void,
  collectRehydrationTargets?: (targets: HistoryRehydrationTargets) => void,
): PreparedHistoryDelta => ({
  deltaTag,
  apply,
  requiresCompensation,
  compensate,
  collectRehydrationTargets,
});

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
  /** Sequential layers whose materialized frame caches must be invalidated. */
  sequentialLayerIds: Set<string>;
  /**
   * Workers or background services that need state refresh after replay.
   */
  workerScopes: Set<HistoryWorkerScope>;
}
