import { debugWarn } from '@/utils/debug';
import type {
  HistoryActionId,
  HistoryDelta,
  HistoryDirection,
  HistoryEntry,
  HistoryManagerHooks,
  ScopedTxn,
  ScopedTxnOptions,
  HistoryCoalesceOptions,
  HistoryRehydrationTargets,
  PreparedHistoryDelta,
} from './actionTypes';
import {
  HistoryReplayApplyError,
  HistoryReplayFaultedError,
  HistoryReplayInProgressError,
  HistoryReplayPreparationError,
  HistoryReplayRecoveryError,
} from './errors';
import { recordHistoryEntryMetrics, recordHistoryTrim } from './profiling';

type DocIdResolver = () => string;

type RehydrationModule = typeof import('./runtimeRehydration');

let rehydrationModulePromise: Promise<RehydrationModule> | null = null;

const loadRehydrationModule = async (): Promise<RehydrationModule> => {
  if (!rehydrationModulePromise) {
    rehydrationModulePromise = import('./runtimeRehydration').catch((error) => {
      rehydrationModulePromise = null;
      throw error;
    });
  }
  return rehydrationModulePromise;
};

export const preloadHistoryRehydrationModule = async (): Promise<void> => {
  await loadRehydrationModule();
};

interface HistoryManagerOptions {
  /**
   * Maximum number of history entries to retain per document.
   */
  maxEntries?: number;
  /**
   * Hook callbacks fired on commit/undo/redo.
   */
  hooks?: HistoryManagerHooks;
  /**
   * Resolver invoked to determine which document stack should be used when one is not explicitly provided.
   */
  docIdResolver?: DocIdResolver;
  /** Injectable runtime boundary used by replay tests and alternate hosts. */
  runtimeRehydration?: {
    createTargets(): HistoryRehydrationTargets;
    rehydrate(entry: HistoryEntry, direction: HistoryDirection, targets: HistoryRehydrationTargets): Promise<void>;
  };
}

const createHistoryId = (): string => {
  // Prefer crypto.randomUUID when available (browser + modern Node).
  try {
    const maybeCrypto = globalThis?.crypto as Crypto | undefined;
    if (maybeCrypto && typeof maybeCrypto.randomUUID === 'function') {
      return maybeCrypto.randomUUID();
    }
  } catch {
    // Ignore and fall back to Math.random-based ID.
  }
  return `hist_${Math.random().toString(36).slice(2, 10)}${Math.random()
    .toString(36)
    .slice(2, 10)}`;
};

class ScopedTxnImpl implements ScopedTxn {
  private readonly deltas: HistoryDelta[] = [];
  private closed = false;

  constructor(
    readonly id: string,
    private readonly manager: HistoryManager,
    readonly action: HistoryActionId,
    readonly docId: string,
    readonly meta?: Record<string, unknown>,
    readonly options?: ScopedTxnOptions,
  ) {}

  push(delta: HistoryDelta): void {
    if (this.closed) {
      throw new Error('Cannot push delta after transaction has been closed.');
    }
    this.deltas.push(delta);
  }

  commit(label: string): void {
    if (this.closed) {
      throw new Error('Transaction already closed.');
    }
    this.closed = true;
    this.manager.commitTxn(this, label, this.deltas);
  }

  cancel(): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.manager.cancelTxn(this, this.deltas);
  }
}

const DEFAULT_MAX_ENTRIES = 100;
const DEFAULT_DOC_ID = 'default-document';
const HISTORY_ENTRY_WARN_BYTES = 25 * 1024 * 1024;

export class HistoryManager {
  private readonly undoStacks = new Map<string, HistoryEntry[]>();
  private readonly redoStacks = new Map<string, HistoryEntry[]>();

  private activeTxn: ScopedTxnImpl | null = null;
  private readonly hooks: HistoryManagerHooks;
  private _isReplaying = false;
  private replayDirection: HistoryDirection | null = null;
  private replayFault: HistoryReplayRecoveryError | null = null;
  private replayFaultDocId: string | null = null;
  private _maxEntries: number;
  private docIdResolver: DocIdResolver;
  private readonly runtimeRehydration?: NonNullable<HistoryManagerOptions['runtimeRehydration']>;

  constructor(options: HistoryManagerOptions = {}) {
    this._maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
    this.hooks = options.hooks ?? {};
    this.docIdResolver = options.docIdResolver ?? (() => DEFAULT_DOC_ID);
    this.runtimeRehydration = options.runtimeRehydration;
  }

  get isReplaying(): boolean {
    return this._isReplaying;
  }

  get maxEntries(): number {
    return this._maxEntries;
  }

  get isFaulted(): boolean {
    return this.replayFault !== null;
  }

  get fault(): HistoryReplayRecoveryError | null {
    return this.replayFault;
  }

  assertDocumentReplacementAvailable(): void {
    if (this._isReplaying) {
      throw new HistoryReplayInProgressError(this.replayDirection ?? 'forward');
    }
    if (this.activeTxn) {
      throw new Error(
        'Cannot replace the document while a history transaction is in progress.',
      );
    }
  }

  setMaxEntries(size: number): void {
    if (!Number.isFinite(size) || size <= 0) {
      throw new Error('maxEntries must be a positive finite number.');
    }
    this._maxEntries = Math.floor(size);
    // Trim existing stacks if needed.
    for (const stack of this.undoStacks.values()) {
      while (stack.length > this._maxEntries) {
        const removed = stack.shift();
        if (removed) {
          recordHistoryTrim('max-entries-undo');
          this.disposeEntry(removed);
        }
      }
    }
    for (const stack of this.redoStacks.values()) {
      while (stack.length > this._maxEntries) {
        const removed = stack.shift();
        if (removed) {
          recordHistoryTrim('max-entries-redo');
          this.disposeEntry(removed);
        }
      }
    }
  }

  setDocIdResolver(resolver: DocIdResolver): void {
    this.docIdResolver = resolver;
  }

  begin(
    action: HistoryActionId,
    meta?: Record<string, unknown>,
    docId?: string,
    options?: ScopedTxnOptions,
  ): ScopedTxn {
    if (this.replayFault) {
      throw new HistoryReplayFaultedError('forward', this.replayFault);
    }
    if (this._isReplaying) {
      throw new Error('Cannot begin a history transaction while replay is in progress.');
    }
    if (this.activeTxn) {
      throw new Error('A history transaction is already in progress.');
    }
    const resolvedDoc = docId ?? this.resolveDocId();
    const txn = new ScopedTxnImpl(createHistoryId(), this, action, resolvedDoc, meta, options);
    this.activeTxn = txn;
    this.ensureStacks(resolvedDoc);
    return txn;
  }

  async undo(docId?: string): Promise<HistoryEntry | null> {
    const resolvedDoc = docId ?? this.resolveDocId();
    this.assertReplayAvailable('backward');
    const undoStack = this.undoStacks.get(resolvedDoc);
    if (!undoStack || undoStack.length === 0) {
      return null;
    }
    const entry = undoStack[undoStack.length - 1]!;
    this.ensureStacks(resolvedDoc);
    const redoStack = this.redoStacks.get(resolvedDoc)!;
    try {
      await this.applyEntry(entry, 'backward');
      undoStack.pop();
      redoStack.push(entry);
      this.hooks.onUndo?.(entry);
      return entry;
    } catch (error) {
      throw error;
    }
  }

  async redo(docId?: string): Promise<HistoryEntry | null> {
    const resolvedDoc = docId ?? this.resolveDocId();
    this.assertReplayAvailable('forward');
    const redoStack = this.redoStacks.get(resolvedDoc);
    if (!redoStack || redoStack.length === 0) {
      return null;
    }
    const entry = redoStack[redoStack.length - 1]!;
    this.ensureStacks(resolvedDoc);
    const undoStack = this.undoStacks.get(resolvedDoc)!;
    try {
      await this.applyEntry(entry, 'forward');
      redoStack.pop();
      undoStack.push(entry);
      this.hooks.onRedo?.(entry);
      return entry;
    } catch (error) {
      throw error;
    }
  }

  async apply(entry: HistoryEntry, direction: HistoryDirection): Promise<void> {
    this.assertReplayAvailable(direction);
    await this.applyEntry(entry, direction);
  }

  peekUndo(docId?: string): HistoryEntry | null {
    const resolvedDoc = docId ?? this.resolveDocId();
    const stack = this.undoStacks.get(resolvedDoc);
    return stack && stack.length > 0 ? stack[stack.length - 1] : null;
  }

  peekRedo(docId?: string): HistoryEntry | null {
    const resolvedDoc = docId ?? this.resolveDocId();
    const stack = this.redoStacks.get(resolvedDoc);
    return stack && stack.length > 0 ? stack[stack.length - 1] : null;
  }

  clear(docId?: string): void {
    this.assertDocumentReplacementAvailable();
    if (docId) {
      const undoStack = this.undoStacks.get(docId);
      const redoStack = this.redoStacks.get(docId);
      if (undoStack) {
        undoStack.forEach((entry) => this.disposeEntry(entry));
      }
      if (redoStack) {
        redoStack.forEach((entry) => this.disposeEntry(entry));
      }
      this.undoStacks.delete(docId);
      this.redoStacks.delete(docId);
    } else {
      for (const stack of this.undoStacks.values()) {
        stack.forEach((entry) => this.disposeEntry(entry));
      }
      for (const stack of this.redoStacks.values()) {
        stack.forEach((entry) => this.disposeEntry(entry));
      }
      this.undoStacks.clear();
      this.redoStacks.clear();
    }
    if (docId === undefined || this.replayFaultDocId === docId) {
      this.replayFault = null;
      this.replayFaultDocId = null;
    }
  }

  entries(docId?: string): readonly HistoryEntry[] {
    const resolvedDoc = docId ?? this.resolveDocId();
    return this.undoStacks.get(resolvedDoc) ?? [];
  }

  redoEntries(docId?: string): readonly HistoryEntry[] {
    const resolvedDoc = docId ?? this.resolveDocId();
    return this.redoStacks.get(resolvedDoc) ?? [];
  }

  private resolveDocId(): string {
    return this.docIdResolver();
  }

  private ensureStacks(docId: string): void {
    if (!this.undoStacks.has(docId)) {
      this.undoStacks.set(docId, []);
    }
    if (!this.redoStacks.has(docId)) {
      this.redoStacks.set(docId, []);
    }
  }

  commitTxn(txn: ScopedTxnImpl, label: string, deltas: HistoryDelta[]): void {
    if (this.activeTxn !== txn) {
      throw new Error('Attempted to commit a non-active history transaction.');
    }
    this.activeTxn = null;
    if (deltas.length === 0) {
      // No meaningful change; drop transaction.
      return;
    }
    const approxBytes = deltas.reduce(
      (sum, delta) => sum + (delta.approxBytes ?? 0),
      0,
    );
    if (
      approxBytes >= HISTORY_ENTRY_WARN_BYTES &&
      process.env.NODE_ENV !== 'production'
    ) {
      debugWarn('raw-console', '[history] Large history entry retained under blob spill policy', {
        action: txn.action,
        approxBytes,
      });
    }

    const coalesceOptions = txn.options?.coalesce;
    const timestamp = Date.now();
    const normalizedMeta = this.prepareEntryMeta(
      txn.meta,
      timestamp,
      coalesceOptions,
      approxBytes,
    );
    const entry: HistoryEntry = {
      id: txn.id,
      action: txn.action,
      label,
      ts: timestamp,
      docId: txn.docId,
      deltas,
      meta: normalizedMeta,
    };
    if (approxBytes > 0) {
      entry.meta = {
        ...(entry.meta ?? {}),
        approxBytes,
      };
    }
    const stack = this.undoStacks.get(txn.docId)!;
    const redoStack = this.redoStacks.get(txn.docId)!;
    if (redoStack.length > 0) {
      redoStack.forEach((redoEntry) => this.disposeEntry(redoEntry));
      redoStack.length = 0;
    }
    if (coalesceOptions && this.tryCoalesce(stack, entry, coalesceOptions)) {
      return;
    }
    stack.push(entry);
    while (stack.length > this._maxEntries) {
      const removed = stack.shift();
      if (removed) {
        recordHistoryTrim('max-entries-undo');
        this.disposeEntry(removed);
      }
    }
    this.hooks.onCommit?.(entry);
    recordHistoryEntryMetrics(entry);
  }

  cancelTxn(txn: ScopedTxnImpl, deltas: HistoryDelta[]): void {
    if (this.activeTxn === txn) {
      this.activeTxn = null;
      deltas.forEach((delta) => this.disposeDelta(delta));
    }
  }

  private assertReplayAvailable(direction: HistoryDirection): void {
    if (this.replayFault) {
      throw new HistoryReplayFaultedError(direction, this.replayFault);
    }
    if (this._isReplaying) {
      throw new HistoryReplayInProgressError(direction);
    }
  }

  private async applyEntry(entry: HistoryEntry, direction: HistoryDirection): Promise<void> {
    this.assertReplayAvailable(direction);
    this._isReplaying = true;
    this.replayDirection = direction;
    try {
      const deltas =
        direction === 'forward' ? entry.deltas : [...entry.deltas].reverse();
      const prepared: PreparedHistoryDelta[] = [];
      let runtime: NonNullable<HistoryManagerOptions['runtimeRehydration']>;
      let targets: HistoryRehydrationTargets;
      try {
        runtime = await this.getRuntimeRehydration();
        targets = runtime.createTargets();
        for (const delta of deltas) {
          try {
            prepared.push(await delta.prepare(direction));
          } catch (error) {
            throw new HistoryReplayPreparationError({
              deltaTag: delta._tag,
              direction,
              reason: error instanceof Error ? error.message : String(error),
              entryId: entry.id,
              action: entry.action,
              phase: 'prepare',
            }, error);
          }
        }
      } catch (error) {
        if (error instanceof HistoryReplayPreparationError) {
          throw error;
        }
        throw new HistoryReplayPreparationError({
          deltaTag: 'history-entry',
          direction,
          reason: error instanceof Error ? error.message : String(error),
          entryId: entry.id,
          action: entry.action,
          phase: 'prepare',
        }, error);
      }
      const applied: PreparedHistoryDelta[] = [];
      let phase: 'apply' | 'rehydrate' = 'apply';
      let failingDeltaTag = 'runtime-rehydration';
      try {
        for (const delta of prepared) {
          failingDeltaTag = delta.deltaTag;
          try {
            await delta.apply();
          } catch (error) {
            if (delta.requiresCompensation()) {
              applied.push(delta);
            }
            throw error;
          }
          if (delta.requiresCompensation()) {
            applied.push(delta);
            delta.collectRehydrationTargets?.(targets);
          }
        }
        phase = 'rehydrate';
        failingDeltaTag = 'runtime-rehydration';
        await runtime.rehydrate(entry, direction, targets);
        return;
      } catch (error) {
        const recoveryTargets = runtime.createTargets();
        let recoveryPhase: 'compensate' | 'recovery-rehydrate' = 'compensate';
        let failedCompensationTag = 'runtime-rehydration';
        try {
          let didCompensate = false;
          for (const delta of [...applied].reverse()) {
            if (!delta.requiresCompensation()) {
              continue;
            }
            delta.collectRehydrationTargets?.(recoveryTargets);
            failedCompensationTag = delta.deltaTag;
            await delta.compensate();
            didCompensate = true;
          }
          if (phase === 'rehydrate' || didCompensate) {
            recoveryPhase = 'recovery-rehydrate';
            failedCompensationTag = 'runtime-rehydration';
            await runtime.rehydrate(entry, direction === 'forward' ? 'backward' : 'forward', recoveryTargets);
          }
        } catch (recoveryError) {
          const fault = new HistoryReplayRecoveryError({
            deltaTag: failedCompensationTag,
            direction,
            reason: error instanceof Error ? error.message : String(error),
            entryId: entry.id,
            action: entry.action,
            phase: recoveryPhase,
            appliedDeltaTags: applied.map((delta) => delta.deltaTag),
            compensationSucceeded: false,
          }, error, recoveryError);
          this.replayFault = fault;
          this.replayFaultDocId = entry.docId;
          throw fault;
        }
        throw new HistoryReplayApplyError({
          deltaTag: failingDeltaTag,
          direction,
          reason: error instanceof Error ? error.message : String(error),
          entryId: entry.id,
          action: entry.action,
          phase,
          appliedDeltaTags: applied.map((delta) => delta.deltaTag),
          compensationSucceeded: true,
        }, error);
      }
    } finally {
      this._isReplaying = false;
      this.replayDirection = null;
    }
  }

  private async getRuntimeRehydration(): Promise<NonNullable<HistoryManagerOptions['runtimeRehydration']>> {
    if (this.runtimeRehydration) {
      return this.runtimeRehydration;
    }
    const rehydrationModule = await loadRehydrationModule();
    return {
      createTargets: rehydrationModule.createRehydrationTargets,
      rehydrate: rehydrationModule.rehydrateEntryResources,
    };
  }

  private disposeEntry(entry: HistoryEntry): void {
    for (const delta of entry.deltas) {
      this.disposeDelta(delta);
    }
  }

  private disposeDelta(delta: HistoryDelta): void {
    try {
      delta.dispose?.();
    } catch (error) {
      if (process.env.NODE_ENV !== 'production') {
        debugWarn('raw-console', '[history] Failed to dispose delta', error);
      }
    }
  }

  private prepareEntryMeta(
    meta: Record<string, unknown> | undefined,
    ts: number,
    options?: HistoryCoalesceOptions,
    approxBytes?: number,
  ): Record<string, unknown> | undefined {
    if (!options) {
      if (approxBytes && approxBytes > 0) {
        return {
          ...(meta ?? {}),
          approxBytes,
        };
      }
      return meta;
    }
    const nextMeta: Record<string, unknown> = { ...(meta ?? {}) };
    nextMeta['__coalesceKey'] = options.key;
    nextMeta['__lastCoalesceTs'] = ts;
    const count =
      typeof nextMeta['coalescedCount'] === 'number'
        ? (nextMeta['coalescedCount'] as number)
        : 1;
    nextMeta['coalescedCount'] = count;
    if (approxBytes && approxBytes > 0) {
      nextMeta['approxBytes'] = approxBytes;
    }
    return nextMeta;
  }

  private tryCoalesce(
    stack: HistoryEntry[],
    entry: HistoryEntry,
    options: HistoryCoalesceOptions,
  ): boolean {
    if (stack.length === 0) {
      return false;
    }
    const prev = stack[stack.length - 1];
    if (prev.action !== entry.action) {
      return false;
    }
    const prevMeta = prev.meta as Record<string, unknown> | undefined;
    const entryMeta = entry.meta as Record<string, unknown> | undefined;
    const prevKey =
      typeof prevMeta?.['__coalesceKey'] === 'string'
        ? (prevMeta['__coalesceKey'] as string)
        : null;
    if (!prevKey || prevKey !== options.key) {
      return false;
    }
    const windowMs = options.maxIntervalMs ?? 200;
    const lastCommitTs =
      typeof prevMeta?.['__lastCoalesceTs'] === 'number'
        ? (prevMeta['__lastCoalesceTs'] as number)
        : prev.ts;
    if (Number.isFinite(windowMs) && windowMs >= 0 && entry.ts - lastCommitTs > windowMs) {
      return false;
    }

    prev.deltas.push(...entry.deltas);
    prev.ts = entry.ts;
    if (options.mergeLabel) {
      prev.label = entry.label;
    }

    const mergedMeta: Record<string, unknown> = {
      ...(prevMeta ?? {}),
      ...(entryMeta ?? {}),
    };
    const prevCount =
      typeof mergedMeta['coalescedCount'] === 'number'
        ? (mergedMeta['coalescedCount'] as number)
        : 1;
    mergedMeta['coalescedCount'] = prevCount + 1;
    mergedMeta['__coalesceKey'] = options.key;
    mergedMeta['__lastCoalesceTs'] = entry.ts;
    prev.meta = mergedMeta;

    this.hooks.onCommit?.(prev);
    return true;
  }
}

export default HistoryManager;
