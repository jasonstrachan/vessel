import type { HistoryDelta, HistoryDirection, PreparedHistoryDelta } from '@/history/actionTypes';
import {
  HISTORY_BLOB_DEFAULT_RESIDENT_BUDGET_BYTES,
  HISTORY_BLOB_DEFAULT_SPILL_THRESHOLD_BYTES,
  clearBlobStore,
  configureHistoryBlobStore,
  releaseBlob,
  storeBlob,
} from '@/history/blobStore';
import HistoryManager from '@/history/historyManager';
import { getHistoryMemoryMetrics } from '@/history/profiling';

const CANVAS_SIZE = 4096;
const PIXELS = CANVAS_SIZE * CANVAS_SIZE;
const ONE_BYTE_CANONICAL_BUFFER_BYTES = PIXELS;
const TWO_BYTE_CANONICAL_BUFFER_BYTES = PIXELS * Uint16Array.BYTES_PER_ELEMENT;
const CANONICAL_ONE_BYTE_BUFFER_COUNT = 5;
const CANONICAL_TWO_BYTE_BUFFER_COUNT = 1;
const LOGICAL_CC_LAYER_COUNT = 2;
const HISTORY_INTENT_DEPTH = 50;

const LOGICAL_FULL_STATE_BYTES_PER_LAYER =
  ONE_BYTE_CANONICAL_BUFFER_BYTES * CANONICAL_ONE_BYTE_BUFFER_COUNT +
  TWO_BYTE_CANONICAL_BUFFER_BYTES * CANONICAL_TWO_BYTE_BUFFER_COUNT;
const LOGICAL_ENTRY_BYTES =
  LOGICAL_FULL_STATE_BYTES_PER_LAYER * LOGICAL_CC_LAYER_COUNT * 2;

const installIndexedDbMock = (): (() => void) => {
  const previousIndexedDb = globalThis.indexedDB;
  const stored = new Map<string, Uint8Array>();
  const schedule = (callback: () => void): void => {
    queueMicrotask(callback);
  };
  const db = {
    createObjectStore: jest.fn(),
    close: jest.fn(),
    transaction: jest.fn(() => {
      const tx = {
        oncomplete: null as ((event: Event) => void) | null,
        onerror: null as ((event: Event) => void) | null,
        objectStore: jest.fn(() => ({
          put: (bytes: Uint8Array | ArrayBuffer, id: string) => {
            const request = {
              onsuccess: null as ((event: Event) => void) | null,
              onerror: null as ((event: Event) => void) | null,
            };
            schedule(() => {
              stored.set(id, bytes instanceof Uint8Array ? bytes.slice() : new Uint8Array(bytes).slice());
              request.onsuccess?.(new Event('success'));
              tx.oncomplete?.(new Event('complete'));
            });
            return request as unknown as IDBRequest<IDBValidKey>;
          },
          get: (id: string) => {
            const request = {
              result: undefined as Uint8Array | undefined,
              onsuccess: null as ((event: Event) => void) | null,
              onerror: null as ((event: Event) => void) | null,
            };
            schedule(() => {
              request.result = stored.get(id)?.slice();
              request.onsuccess?.(new Event('success'));
              tx.oncomplete?.(new Event('complete'));
            });
            return request as unknown as IDBRequest<Uint8Array | undefined>;
          },
          delete: (id: string) => {
            const request = {
              onsuccess: null as ((event: Event) => void) | null,
              onerror: null as ((event: Event) => void) | null,
            };
            schedule(() => {
              stored.delete(id);
              request.onsuccess?.(new Event('success'));
              tx.oncomplete?.(new Event('complete'));
            });
            return request as unknown as IDBRequest<undefined>;
          },
        })),
      };
      return tx as unknown as IDBTransaction;
    }),
  };

  const indexedDb = {
    open: jest.fn(() => {
      const request = {
        result: db,
        onupgradeneeded: null as ((event: IDBVersionChangeEvent) => void) | null,
        onsuccess: null as ((event: Event) => void) | null,
        onerror: null as ((event: Event) => void) | null,
        onblocked: null as ((event: Event) => void) | null,
      };
      schedule(() => {
        request.onupgradeneeded?.(new Event('upgradeneeded') as IDBVersionChangeEvent);
        request.onsuccess?.(new Event('success'));
      });
      return request as unknown as IDBOpenDBRequest;
    }),
  } as unknown as IDBFactory;

  Object.defineProperty(globalThis, 'indexedDB', {
    configurable: true,
    value: indexedDb,
  });

  return () => {
    Object.defineProperty(globalThis, 'indexedDB', {
      configurable: true,
      value: previousIndexedDb,
    });
  };
};

class LargeColorCycleHistoryDelta implements HistoryDelta {
  readonly _tag = 'color-cycle-stroke';
  readonly approxBytes = LOGICAL_ENTRY_BYTES;
  private readonly blobIds: string[];

  private constructor(blobIds: string[]) {
    this.blobIds = blobIds;
  }

  static async create(oneByteBuffer: ArrayBuffer, twoByteBuffer: ArrayBuffer): Promise<LargeColorCycleHistoryDelta> {
    return new LargeColorCycleHistoryDelta([
      await storeBlob(oneByteBuffer),
      await storeBlob(twoByteBuffer),
    ]);
  }

  apply(): void {}

  prepare(_direction: HistoryDirection): PreparedHistoryDelta {
    return {
      deltaTag: this._tag,
      apply: () => this.apply(),
      requiresCompensation: () => false,
      compensate: () => this.apply(),
    };
  }

  dispose(): void {
    this.blobIds.forEach((id) => releaseBlob(id));
  }
}

describe('large history spill depth', () => {
  let restoreIndexedDb: (() => void) | null = null;

  beforeEach(() => {
    restoreIndexedDb = installIndexedDbMock();
    clearBlobStore();
    configureHistoryBlobStore({
      residentBudgetBytes: HISTORY_BLOB_DEFAULT_RESIDENT_BUDGET_BYTES,
      spillThresholdBytes: HISTORY_BLOB_DEFAULT_SPILL_THRESHOLD_BYTES,
    });
  });

  afterEach(() => {
    clearBlobStore();
    configureHistoryBlobStore({
      residentBudgetBytes: HISTORY_BLOB_DEFAULT_RESIDENT_BUDGET_BYTES,
      spillThresholdBytes: HISTORY_BLOB_DEFAULT_SPILL_THRESHOLD_BYTES,
    });
    restoreIndexedDb?.();
    restoreIndexedDb = null;
  });

  it('keeps 50 logical 4096-square multi-layer CC intents by spilling and deduping blob payloads', async () => {
    const manager = new HistoryManager({ maxEntries: HISTORY_INTENT_DEPTH });
    const oneByteBuffer = new ArrayBuffer(ONE_BYTE_CANONICAL_BUFFER_BYTES);
    const twoByteBuffer = new ArrayBuffer(TWO_BYTE_CANONICAL_BUFFER_BYTES);
    new Uint8Array(oneByteBuffer)[0] = 7;
    new Uint8Array(twoByteBuffer)[0] = 11;

    for (let index = 0; index < HISTORY_INTENT_DEPTH; index += 1) {
      const txn = manager.begin('cc-stroke', {
        layerId: `cc-layer-${index % LOGICAL_CC_LAYER_COUNT}`,
        canvasSize: CANVAS_SIZE,
        logicalLayerCount: LOGICAL_CC_LAYER_COUNT,
      });
      txn.push(await LargeColorCycleHistoryDelta.create(oneByteBuffer, twoByteBuffer));
      txn.commit(`4096-square CC intent ${index + 1}`);
    }

    const entries = manager.entries();
    const metrics = getHistoryMemoryMetrics();

    expect(entries).toHaveLength(HISTORY_INTENT_DEPTH);
    expect(entries.every((entry) => entry.action === 'cc-stroke')).toBe(true);
    expect(entries.every((entry) => entry.meta?.approxBytes === LOGICAL_ENTRY_BYTES)).toBe(true);
    expect(LOGICAL_ENTRY_BYTES).toBeGreaterThan(HISTORY_BLOB_DEFAULT_SPILL_THRESHOLD_BYTES);
    expect(metrics.residentBytes).toBeLessThanOrEqual(HISTORY_BLOB_DEFAULT_RESIDENT_BUDGET_BYTES);
    expect(metrics.spilledBytes).toBe(
      ONE_BYTE_CANONICAL_BUFFER_BYTES + TWO_BYTE_CANONICAL_BUFFER_BYTES,
    );
    expect(metrics.spilledFallbackBytes).toBe(0);
    expect(metrics.residentBytes).toBe(0);
    expect(metrics.spilledBlobCount).toBe(2);
    expect(metrics.blobCount).toBe(2);
    expect(metrics.refCount).toBe(HISTORY_INTENT_DEPTH * 2);
    expect(metrics.dedupeCount).toBe(HISTORY_INTENT_DEPTH * 2 - 2);
    expect(metrics.spillCount).toBe(2);

    manager.clear();
    expect(getHistoryMemoryMetrics().blobCount).toBe(0);
  });
});
