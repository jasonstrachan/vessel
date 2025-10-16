import HistoryManager from '@/history/historyManager';
import type { HistoryDelta, HistoryDirection } from '@/history/actionTypes';

class FakeDelta implements HistoryDelta {
  readonly _tag: string;
  readonly approxBytes?: number;
  private readonly log: Array<{ direction: HistoryDirection }>;
  private readonly shouldReject: boolean;

  constructor(tag: string, log: Array<{ direction: HistoryDirection }>, options?: { reject?: boolean; approxBytes?: number }) {
    this._tag = tag;
    this.log = log;
    this.shouldReject = Boolean(options?.reject);
    this.approxBytes = options?.approxBytes;
  }

  async apply(direction: HistoryDirection): Promise<void> {
    this.log.push({ direction });
    if (this.shouldReject) {
      throw new Error(`Delta ${this._tag} rejected`);
    }
  }
}

describe('HistoryManager', () => {
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

  it('limits stack size to maxEntries', () => {
    const manager = new HistoryManager({ maxEntries: 2 });
    for (let i = 0; i < 3; i += 1) {
      const txn = manager.begin('brush-stroke');
      txn.push(new FakeDelta(`d${i}`, []));
      txn.commit(`Stroke ${i}`);
    }
    expect(manager.entries()).toHaveLength(2);
    expect(manager.entries()[0]?.label).toBe('Stroke 1');
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
    txn.push(new FakeDelta('fail', [], { reject: true }));
    txn.commit('Stroke');

    await expect(manager.undo()).rejects.toThrow('Delta fail rejected');
    expect(manager.isReplaying).toBe(false);
  });
});
