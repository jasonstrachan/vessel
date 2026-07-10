import HistoryManager from '@/history/historyManager';
import type { HistoryDelta, HistoryDirection, PreparedHistoryDelta } from '@/history/actionTypes';
import { createSelectionDelta } from '@/history/deltas/selectionDelta';
import {
  HistoryReplayApplyError,
  HistoryReplayFaultedError,
  HistoryReplayInProgressError,
  HistoryReplayRecoveryError,
} from '@/history/errors';
import { clearBlobStore, getHistoryBlobMetrics } from '@/history/blobStore';
import { useAppStore } from '@/stores/useAppStore';

class FakeDelta implements HistoryDelta {
  readonly _tag: string;
  readonly approxBytes?: number;
  private readonly log: Array<{ direction: HistoryDirection }>;
  private readonly shouldReject: boolean;
  private rejectCount = 0;

  constructor(tag: string, log: Array<{ direction: HistoryDirection }>, options?: { reject?: boolean; rejectCount?: number; approxBytes?: number }) {
    this._tag = tag;
    this.log = log;
    this.shouldReject = Boolean(options?.reject);
    this.rejectCount = options?.rejectCount ?? (this.shouldReject ? Number.POSITIVE_INFINITY : 0);
    this.approxBytes = options?.approxBytes;
  }

  async apply(direction: HistoryDirection): Promise<void> {
    this.log.push({ direction });
    if (this.rejectCount > 0) {
      this.rejectCount -= 1;
      throw new Error(`Delta ${this._tag} rejected`);
    }
  }

  prepare(direction: HistoryDirection): PreparedHistoryDelta {
    let mutated = false;
    return {
      deltaTag: this._tag,
      apply: async () => {
        mutated = true;
        await this.apply(direction);
      },
      requiresCompensation: () => mutated,
      compensate: () => this.apply(direction === 'forward' ? 'backward' : 'forward'),
    };
  }
}

class StatefulDelta implements HistoryDelta {
  readonly _tag: string;

  constructor(
    tag: string,
    private readonly state: Record<string, number>,
    private readonly key: string,
    private readonly before: number,
    private readonly after: number,
    private readonly failAfterMutation = false,
  ) {
    this._tag = tag;
  }

  apply(direction: HistoryDirection): void {
    this.state[this.key] = direction === 'forward' ? this.after : this.before;
    if (this.failAfterMutation && direction === 'backward') {
      throw new Error(`${this._tag} failed after mutation`);
    }
  }

  prepare(direction: HistoryDirection): PreparedHistoryDelta {
    const beforeApply = this.state[this.key];
    return {
      deltaTag: this._tag,
      apply: () => this.apply(direction),
      requiresCompensation: () => this.state[this.key] !== beforeApply,
      compensate: () => this.apply(direction === 'forward' ? 'backward' : 'forward'),
    };
  }
}

class ForwardFailingStatefulDelta extends StatefulDelta {
  override apply(direction: HistoryDirection): void {
    super.apply(direction);
    if (direction === 'forward') {
      throw new Error('Forward replay failed after mutation');
    }
  }
}

class PreparationFailureDelta implements HistoryDelta {
  readonly _tag = 'preparation-failure';

  apply(): void {
    throw new Error('Preparation failure delta must never apply');
  }

  prepare(): PreparedHistoryDelta {
    throw new Error('Preparation failed');
  }
}

describe('HistoryManager', () => {
  beforeEach(() => {
    clearBlobStore();
    useAppStore.getState().clearSelection();
  });

  it('commits transactions and clears redo stack', () => {
    const manager = new HistoryManager({ maxEntries: 5 });
    const log: Array<{ direction: HistoryDirection }> = [];

    const txn = manager.begin('brush-stroke', { layerId: 'layer-1' });
    txn.push(new FakeDelta('d1', log));
    txn.commit('Brush Stroke');

    expect(manager.entries()).toHaveLength(1);
    expect(manager.redoEntries()).toHaveLength(0);
    expect(manager.peekUndo()?.label).toBe('Brush Stroke');
  });

  it('drops empty transactions without touching stacks', () => {
    const manager = new HistoryManager();
    const txn = manager.begin('layer-structure');
    txn.commit('No Change');
    expect(manager.entries()).toHaveLength(0);
  });

  it('disposes canceled transaction deltas and permits the next transaction', () => {
    const manager = new HistoryManager();
    const dispose = jest.fn();
    const laterDispose = jest.fn();
    const txn = manager.begin('brush-stroke');
    txn.push({
      _tag: 'cancelled',
      apply: jest.fn(),
      dispose,
    });
    txn.push({
      _tag: 'cancelled-with-dispose-failure',
      apply: jest.fn(),
      dispose: jest.fn(() => {
        throw new Error('dispose failed');
      }),
    });
    txn.push({
      _tag: 'cancelled-after-dispose-failure',
      apply: jest.fn(),
      dispose: laterDispose,
    });

    txn.cancel();

    expect(dispose).toHaveBeenCalledTimes(1);
    expect(laterDispose).toHaveBeenCalledTimes(1);
    expect(() => manager.begin('brush-stroke')).not.toThrow();
  });

  it('blocks document replacement while a transaction is active', () => {
    const manager = new HistoryManager();
    const txn = manager.begin('brush-stroke');

    expect(() => manager.assertDocumentReplacementAvailable()).toThrow(
      'Cannot replace the document while a history transaction is in progress.',
    );

    txn.cancel();
    expect(() => manager.assertDocumentReplacementAvailable()).not.toThrow();
  });

  it('limits stack size to maxEntries', () => {
    const manager = new HistoryManager({ maxEntries: 2 });
    for (let i = 0; i < 3; i += 1) {
      const txn = manager.begin('brush-stroke');
      txn.push(new FakeDelta(`d${i}`, []));
      txn.commit(`Stroke ${i}`);
    }
    expect(manager.entries()).toHaveLength(2);
    expect(manager.entries()[0]?.label).toBe('Stroke 1');
    expect(getHistoryBlobMetrics().lastTrimReason).toBe('max-entries-undo');
  });

  it('retains entries over the old hard cap for blob-backed replay', () => {
    const manager = new HistoryManager({ maxEntries: 5 });
    const txn = manager.begin('cc-stroke');
    txn.push(new FakeDelta('large', [], { approxBytes: 60 * 1024 * 1024 }));

    txn.commit('Large CC State');

    expect(manager.entries()).toHaveLength(1);
    expect(manager.peekUndo()?.meta?.approxBytes).toBe(60 * 1024 * 1024);
  });

  it('tracks redo entries independently per document', async () => {
    const manager = new HistoryManager({
      docIdResolver: () => 'doc-A',
    });

    const txnA = manager.begin('brush-stroke', undefined, 'doc-A');
    txnA.push(
      new FakeDelta('a', [], { approxBytes: 4 }),
    );
    txnA.commit('A1');

    const txnB = manager.begin('brush-stroke', undefined, 'doc-B');
    txnB.push(
      new FakeDelta('b', [], { approxBytes: 4 }),
    );
    txnB.commit('B1');

    expect(manager.entries('doc-A')).toHaveLength(1);
    expect(manager.entries('doc-B')).toHaveLength(1);

    await manager.undo('doc-A');
    expect(manager.redoEntries('doc-A')).toHaveLength(1);
    expect(manager.redoEntries('doc-B')).toHaveLength(0);

    await manager.redo('doc-A');
    expect(manager.redoEntries('doc-A')).toHaveLength(0);
  });

  it('prevents nested transactions', () => {
    const manager = new HistoryManager();
    const txn = manager.begin('brush-stroke');
    expect(() => manager.begin('brush-stroke')).toThrow('transaction is already in progress');
    txn.cancel();
  });

  it('sets replay flag during undo/redo and clears afterwards', async () => {
    const manager = new HistoryManager();
    const log: Array<{ direction: HistoryDirection }> = [];
    const txn = manager.begin('brush-stroke');
    txn.push(new FakeDelta('d1', log, { approxBytes: 1 }));
    txn.push(new FakeDelta('d2', log, { approxBytes: 1 }));
    txn.commit('Stroke');

    expect(manager.isReplaying).toBe(false);

    await manager.undo();
    expect(manager.isReplaying).toBe(false);
    expect(log.map((item) => item.direction)).toEqual(['backward', 'backward']);

    const redoPromise = manager.redo();
    expect(manager.isReplaying).toBe(true);
    await redoPromise;
    expect(manager.isReplaying).toBe(false);
    expect(log.map((item) => item.direction)).toEqual([
      'backward',
      'backward',
      'forward',
      'forward',
    ]);
  });

  it('handles asynchronous delta failures without leaving replay flag set', async () => {
    const manager = new HistoryManager();
    const txn = manager.begin('brush-stroke');
    txn.push(new FakeDelta('ok', []));
    txn.push(new FakeDelta('fail', [], { rejectCount: 1 }));
    txn.commit('Stroke');

    await expect(manager.undo()).rejects.toBeInstanceOf(HistoryReplayApplyError);
    expect(manager.isReplaying).toBe(false);
    expect(manager.entries()).toHaveLength(1);
    expect(manager.redoEntries()).toHaveLength(0);
  });

  it('compensates applied deltas in reverse order when a later delta fails', async () => {
    const manager = new HistoryManager();
    const log: Array<{ direction: HistoryDirection }> = [];
    const txn = manager.begin('brush-stroke');
    txn.push(new FakeDelta('second', log, { rejectCount: 1 }));
    txn.push(new FakeDelta('first', log));
    txn.commit('Atomic stroke');

    await expect(manager.undo()).rejects.toBeInstanceOf(HistoryReplayApplyError);
    expect(log.map((entry) => entry.direction)).toEqual([
      'backward',
      'backward',
      'forward',
      'forward',
    ]);
    expect(manager.entries()).toHaveLength(1);
    expect(manager.redoEntries()).toHaveLength(0);
  });

  it('does not compensate a throwing step that reports no mutation', async () => {
    const state = { applied: 1 };
    const failingCompensation = jest.fn();
    class PreMutationFailureDelta implements HistoryDelta {
      readonly _tag = 'pre-mutation-failure';

      prepare(): PreparedHistoryDelta {
        return {
          deltaTag: this._tag,
          apply: () => {
            throw new Error('Rejected before mutation');
          },
          requiresCompensation: () => false,
          compensate: failingCompensation,
        };
      }
    }
    const rehydrate = jest.fn().mockResolvedValue(undefined);
    const manager = new HistoryManager({
      runtimeRehydration: {
        createTargets: () => ({ layerIds: new Set(), colorCycleLayerIds: new Set(), sequentialLayerIds: new Set(), workerScopes: new Set() }),
        rehydrate,
      },
    });
    const txn = manager.begin('brush-stroke');
    txn.push(new PreMutationFailureDelta());
    txn.push(new StatefulDelta('applied', state, 'applied', 0, 1));
    txn.commit('Pre-mutation failure');

    await expect(manager.undo()).rejects.toBeInstanceOf(HistoryReplayApplyError);

    expect(state.applied).toBe(1);
    expect(failingCompensation).not.toHaveBeenCalled();
    expect(rehydrate).toHaveBeenCalledTimes(1);
    expect(manager.isFaulted).toBe(false);
  });

  it('skips recovery rehydration when apply failed before any mutation', async () => {
    const rehydrate = jest.fn().mockRejectedValue(new Error('must not run'));
    const manager = new HistoryManager({
      runtimeRehydration: {
        createTargets: () => ({ layerIds: new Set(), colorCycleLayerIds: new Set(), sequentialLayerIds: new Set(), workerScopes: new Set() }),
        rehydrate,
      },
    });
    const txn = manager.begin('brush-stroke');
    txn.push({
      _tag: 'pre-mutation-only',
      prepare: () => ({
        deltaTag: 'pre-mutation-only',
        apply: () => {
          throw new Error('Rejected before mutation');
        },
        requiresCompensation: () => false,
        compensate: () => {
          throw new Error('must not compensate');
        },
      }),
    });
    txn.commit('No mutation');

    await expect(manager.undo()).rejects.toBeInstanceOf(HistoryReplayApplyError);

    expect(rehydrate).not.toHaveBeenCalled();
    expect(manager.isFaulted).toBe(false);
  });

  it('restores exact document state and leaves stacks/hooks untouched after a late undo failure', async () => {
    const state = { first: 1, second: 1 };
    const onUndo = jest.fn();
    const manager = new HistoryManager({ hooks: { onUndo } });
    const txn = manager.begin('brush-stroke');
    txn.push(new StatefulDelta('second', state, 'second', 0, 1, true));
    txn.push(new StatefulDelta('first', state, 'first', 0, 1));
    txn.commit('Atomic stateful stroke');

    await expect(manager.undo()).rejects.toBeInstanceOf(HistoryReplayApplyError);
    expect(state).toEqual({ first: 1, second: 1 });
    expect(manager.entries()).toHaveLength(1);
    expect(manager.redoEntries()).toHaveLength(0);
    expect(manager.isReplaying).toBe(false);
    expect(onUndo).not.toHaveBeenCalled();
  });

  it('performs zero mutations when preparation fails', async () => {
    const state = { first: 1 };
    const manager = new HistoryManager();
    const txn = manager.begin('brush-stroke');
    txn.push(new PreparationFailureDelta());
    txn.push(new StatefulDelta('first', state, 'first', 0, 1));
    txn.commit('Preparation failure');

    await expect(manager.undo()).rejects.toMatchObject({
      code: 'history-replay-preparation-failed',
      deltaTag: 'preparation-failure',
    });
    expect(state).toEqual({ first: 1 });
    expect(manager.entries()).toHaveLength(1);
    expect(manager.redoEntries()).toHaveLength(0);
  });

  it('restores an actual selection surface when a later entry delta fails', async () => {
    const selectionDelta = createSelectionDelta({
      before: { start: { x: 1, y: 1 }, end: { x: 4, y: 4 } },
      after: { start: { x: 8, y: 8 }, end: { x: 12, y: 12 } },
    });
    expect(selectionDelta).not.toBeNull();
    useAppStore.getState().setSelectionBounds({ x: 8, y: 8 }, { x: 12, y: 12 });

    const manager = new HistoryManager();
    const txn = manager.begin('selection-change');
    txn.push(new FakeDelta('late-failure', [], { rejectCount: 1 }));
    txn.push(selectionDelta!);
    txn.commit('Selection and layer intent');

    await expect(manager.undo()).rejects.toBeInstanceOf(HistoryReplayApplyError);
    const state = useAppStore.getState();
    expect(state.selectionStart).toEqual({ x: 8, y: 8 });
    expect(state.selectionEnd).toEqual({ x: 12, y: 12 });
    expect(manager.entries()).toHaveLength(1);
    expect(manager.redoEntries()).toHaveLength(0);
  });

  it('restores exact document state and leaves stacks/hooks untouched after a late redo failure', async () => {
    const state = { first: 1, second: 1 };
    const onRedo = jest.fn();
    const manager = new HistoryManager({ hooks: { onRedo } });
    const txn = manager.begin('brush-stroke');
    txn.push(new StatefulDelta('first', state, 'first', 0, 1));
    txn.push(new ForwardFailingStatefulDelta('second', state, 'second', 0, 1));
    txn.commit('Atomic redo stateful stroke');

    await manager.undo();
    expect(state).toEqual({ first: 0, second: 0 });
    await expect(manager.redo()).rejects.toBeInstanceOf(HistoryReplayApplyError);
    expect(state).toEqual({ first: 0, second: 0 });
    expect(manager.entries()).toHaveLength(0);
    expect(manager.redoEntries()).toHaveLength(1);
    expect(manager.isReplaying).toBe(false);
    expect(onRedo).not.toHaveBeenCalled();
  });

  it('compensates the entry when runtime rehydration fails', async () => {
    const log: Array<{ direction: HistoryDirection }> = [];
    const manager = new HistoryManager({
      runtimeRehydration: {
        createTargets: () => ({ layerIds: new Set(), colorCycleLayerIds: new Set(), sequentialLayerIds: new Set(), workerScopes: new Set() }),
        rehydrate: async (_entry, direction) => {
          if (direction === 'backward') {
            throw new Error('rehydration failed');
          }
        },
      },
    });
    const txn = manager.begin('brush-stroke');
    txn.push(new FakeDelta('first', log));
    txn.push(new FakeDelta('second', log));
    txn.commit('Atomic stroke');

    await expect(manager.undo()).rejects.toBeInstanceOf(HistoryReplayApplyError);
    expect(log.map((entry) => entry.direction)).toEqual([
      'backward',
      'backward',
      'forward',
      'forward',
    ]);
    expect(manager.entries()).toHaveLength(1);
  });

  it('preserves unrelated store updates made before recovery compensation', async () => {
    const current = useAppStore.getState();
    useAppStore.setState({
      selectionStart: { x: 2, y: 2 },
      selectionEnd: { x: 4, y: 4 },
      selectionLastAction: null,
      autosave: {
        ...current.autosave,
        interval: 2,
      },
    });
    let rehydrationCalls = 0;
    const manager = new HistoryManager({
      runtimeRehydration: {
        createTargets: () => ({ layerIds: new Set(), colorCycleLayerIds: new Set(), sequentialLayerIds: new Set(), workerScopes: new Set() }),
        rehydrate: async () => {
          rehydrationCalls += 1;
          if (rehydrationCalls === 1) {
            useAppStore.setState((state) => ({
              autosave: {
                ...state.autosave,
                interval: 17,
              },
            }));
            throw new Error('rehydration failed after unrelated update');
          }
        },
      },
    });
    const delta = createSelectionDelta({
      before: { start: null, end: null, provenance: null },
      after: {
        start: { x: 2, y: 2 },
        end: { x: 4, y: 4 },
        provenance: null,
      },
    });
    expect(delta).not.toBeNull();
    const txn = manager.begin('selection-change');
    txn.push(delta!);
    txn.commit('Scoped selection recovery');

    await expect(manager.undo()).rejects.toBeInstanceOf(HistoryReplayApplyError);

    expect(useAppStore.getState().selectionStart).toEqual({ x: 2, y: 2 });
    expect(useAppStore.getState().selectionEnd).toEqual({ x: 4, y: 4 });
    expect(useAppStore.getState().autosave.interval).toBe(17);
  });

  it('faults and blocks replay when compensation fails', async () => {
    const manager = new HistoryManager();
    class FailOnCompensationDelta extends FakeDelta {
      override async apply(direction: HistoryDirection): Promise<void> {
        if (direction === 'forward') {
          throw new Error('Compensation rejected');
        }
        await super.apply(direction);
      }
    }
    const txn = manager.begin('brush-stroke');
    txn.push(new FakeDelta('second', [], { rejectCount: 1 }));
    txn.push(new FailOnCompensationDelta('first', []));
    txn.commit('Broken recovery');

    await expect(manager.undo()).rejects.toBeInstanceOf(HistoryReplayRecoveryError);
    expect(manager.isFaulted).toBe(true);
    await expect(manager.undo()).rejects.toBeInstanceOf(HistoryReplayFaultedError);
    expect(() => manager.begin('brush-stroke')).toThrow(HistoryReplayFaultedError);
    manager.clear();
    expect(manager.isFaulted).toBe(false);
  });

  it('keeps a document replay fault locked when another document is cleared', async () => {
    const manager = new HistoryManager();
    class FailOnCompensationDelta extends FakeDelta {
      override async apply(direction: HistoryDirection): Promise<void> {
        if (direction === 'forward') {
          throw new Error('Compensation rejected');
        }
        await super.apply(direction);
      }
    }
    const txnB = manager.begin('brush-stroke', undefined, 'doc-B');
    txnB.push(new FakeDelta('b', []));
    txnB.commit('B1');
    const txnA = manager.begin('brush-stroke', undefined, 'doc-A');
    txnA.push(new FakeDelta('second', [], { rejectCount: 1 }));
    txnA.push(new FailOnCompensationDelta('first', []));
    txnA.commit('Broken recovery');

    await expect(manager.undo('doc-A')).rejects.toBeInstanceOf(HistoryReplayRecoveryError);
    manager.clear('doc-B');

    expect(manager.isFaulted).toBe(true);
    await expect(manager.undo('doc-A')).rejects.toBeInstanceOf(HistoryReplayFaultedError);
    expect(() => manager.begin('brush-stroke', undefined, 'doc-A')).toThrow(
      HistoryReplayFaultedError,
    );

    manager.clear('doc-A');
    expect(manager.isFaulted).toBe(false);
  });

  it('faults and blocks replay when recovery rehydration fails', async () => {
    let rehydrationCalls = 0;
    const manager = new HistoryManager({
      runtimeRehydration: {
        createTargets: () => ({ layerIds: new Set(), colorCycleLayerIds: new Set(), sequentialLayerIds: new Set(), workerScopes: new Set() }),
        rehydrate: async () => {
          rehydrationCalls += 1;
          throw new Error('runtime rehydration rejected');
        },
      },
    });
    const txn = manager.begin('brush-stroke');
    txn.push(new FakeDelta('first', []));
    txn.commit('Broken recovery rehydration');

    await expect(manager.undo()).rejects.toMatchObject({
      code: 'history-replay-recovery-failed',
      phase: 'recovery-rehydrate',
    });
    expect(rehydrationCalls).toBe(2);
    expect(manager.isFaulted).toBe(true);
    await expect(manager.undo()).rejects.toBeInstanceOf(HistoryReplayFaultedError);
  });

  it('rejects concurrent replays without moving stacks twice', async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    class DeferredDelta extends FakeDelta {
      override async apply(direction: HistoryDirection): Promise<void> {
        await gate;
        await super.apply(direction);
      }
    }
    const manager = new HistoryManager();
    const txn = manager.begin('brush-stroke');
    txn.push(new DeferredDelta('deferred', []));
    txn.commit('Deferred stroke');

    const first = manager.undo();
    await expect(manager.undo()).rejects.toBeInstanceOf(HistoryReplayInProgressError);
    expect(() => manager.clear()).toThrow(HistoryReplayInProgressError);
    release?.();
    await first;
    expect(manager.entries()).toHaveLength(0);
    expect(manager.redoEntries()).toHaveLength(1);
    expect(() => manager.clear()).not.toThrow();
  });
});
