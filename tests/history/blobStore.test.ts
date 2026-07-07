import {
  clearBlobStore,
  configureHistoryBlobStore,
  getHistoryBlobMetrics,
  HISTORY_BLOB_DEFAULT_RESIDENT_BUDGET_BYTES,
  HISTORY_BLOB_DEFAULT_SPILL_THRESHOLD_BYTES,
  readBlob,
  releaseBlob,
  storeBlob,
} from '@/history/blobStore';
import { getHistoryMemoryMetrics } from '@/history/profiling';

const originalIndexedDb = globalThis.indexedDB;

const wait = (ms: number): Promise<void> => new Promise((resolve) => {
  setTimeout(resolve, ms);
});

const waitFor = async (predicate: () => boolean): Promise<void> => {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (predicate()) {
      return;
    }
    await wait(1);
  }
  throw new Error('Timed out waiting for IndexedDB mock state');
};

const installIndexedDbMock = (indexedDb: unknown): void => {
  Object.defineProperty(globalThis, 'indexedDB', {
    configurable: true,
    writable: true,
    value: indexedDb,
  });
};

const restoreIndexedDb = (): void => {
  Object.defineProperty(globalThis, 'indexedDB', {
    configurable: true,
    writable: true,
    value: originalIndexedDb,
  });
};

const createIndexedDbMock = (options: {
  abortNextPutAfterSuccess?: boolean;
  holdDeletes?: boolean;
} = {}) => {
  const rows = new Map<string, Uint8Array>();
  const heldDeletes: Array<() => void> = [];
  let abortNextPutAfterSuccess = options.abortNextPutAfterSuccess === true;

  const createTransaction = () => {
    const tx: {
      oncomplete: ((event?: unknown) => void) | null;
      onerror: ((event?: unknown) => void) | null;
      onabort: ((event?: unknown) => void) | null;
      objectStore: () => {
        put: (bytes: Uint8Array, id: string) => Record<string, unknown>;
        get: (id: string) => Record<string, unknown>;
        delete: (id: string) => Record<string, unknown>;
      };
    } = {
      oncomplete: null,
      onerror: null,
      onabort: null,
      objectStore: () => ({
        put: (bytes: Uint8Array, id: string) => {
          const request: { result?: unknown; onsuccess?: (event?: unknown) => void; onerror?: (event?: unknown) => void } = {};
          setTimeout(() => {
            request.onsuccess?.();
            if (abortNextPutAfterSuccess) {
              abortNextPutAfterSuccess = false;
              tx.onabort?.();
              return;
            }
            rows.set(id, bytes.slice());
            tx.oncomplete?.();
          }, 0);
          return request;
        },
        get: (id: string) => {
          const request: { result?: unknown; onsuccess?: (event?: unknown) => void; onerror?: (event?: unknown) => void } = {};
          setTimeout(() => {
            request.result = rows.get(id);
            request.onsuccess?.();
            tx.oncomplete?.();
          }, 0);
          return request;
        },
        delete: (id: string) => {
          const request: { onsuccess?: (event?: unknown) => void; onerror?: (event?: unknown) => void } = {};
          const completeDelete = (): void => {
            rows.delete(id);
            request.onsuccess?.();
            tx.oncomplete?.();
          };
          if (options.holdDeletes) {
            heldDeletes.push(completeDelete);
          } else {
            setTimeout(completeDelete, 0);
          }
          return request;
        },
      }),
    };
    return tx;
  };

  const open = jest.fn(() => {
    const db = {
      close: jest.fn(),
      createObjectStore: jest.fn(),
      transaction: jest.fn(() => createTransaction()),
    };
    const request: {
      result: typeof db;
      onsuccess?: (event?: unknown) => void;
      onerror?: (event?: unknown) => void;
      onblocked?: (event?: unknown) => void;
      onupgradeneeded?: (event?: unknown) => void;
    } = {
      result: db,
    };
    setTimeout(() => request.onsuccess?.(), 0);
    return request;
  });

  return {
    indexedDb: { open },
    rows,
    releaseNextDelete: () => {
      const release = heldDeletes.shift();
      if (!release) {
        throw new Error('No held delete to release');
      }
      release();
    },
    heldDeleteCount: () => heldDeletes.length,
  };
};

describe('history blob store', () => {
  beforeEach(() => {
    clearBlobStore();
    configureHistoryBlobStore({
      residentBudgetBytes: 16,
      spillThresholdBytes: 8,
    });
  });

  afterEach(() => {
    clearBlobStore();
    configureHistoryBlobStore({
      residentBudgetBytes: HISTORY_BLOB_DEFAULT_RESIDENT_BUDGET_BYTES,
      spillThresholdBytes: HISTORY_BLOB_DEFAULT_SPILL_THRESHOLD_BYTES,
    });
    restoreIndexedDb();
  });

  it('keeps small blobs resident and reports resident bytes', async () => {
    const id = await storeBlob(Uint8Array.from([1, 2, 3, 4]).buffer);

    expect(getHistoryBlobMetrics()).toMatchObject({
      residentBytes: 4,
      spilledBytes: 0,
      blobCount: 1,
      residentBlobCount: 1,
      spilledBlobCount: 0,
      refCount: 1,
    });

    const blob = await readBlob(id);
    expect(blob?.tier).toBe('resident');
    expect(Array.from(blob?.data ?? [])).toEqual([1, 2, 3, 4]);
  });

  it('spills blobs over the threshold and records restore reads', async () => {
    const id = await storeBlob(Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8]).buffer);

    expect(getHistoryBlobMetrics()).toMatchObject({
      residentBytes: 0,
      spilledBytes: 8,
      blobCount: 1,
      residentBlobCount: 0,
      spilledBlobCount: 1,
      spillCount: 1,
    });

    const blob = await readBlob(id);
    expect(blob?.tier).toBe('spilled');
    expect(Array.from(blob?.data ?? [])).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(getHistoryBlobMetrics().restoreCount).toBe(1);
    expect(getHistoryMemoryMetrics()).toMatchObject({
      residentBytes: 0,
      spilledBytes: 8,
      restoreCount: 1,
      residentBudgetBytes: 16,
      spillThresholdBytes: 8,
    });
  });

  it('spills new blobs when retaining them would exceed the resident budget', async () => {
    configureHistoryBlobStore({
      residentBudgetBytes: 6,
      spillThresholdBytes: 32,
    });

    await storeBlob(Uint8Array.from([1, 1, 1, 1]).buffer);
    await storeBlob(Uint8Array.from([2, 2, 2, 2]).buffer);

    expect(getHistoryBlobMetrics()).toMatchObject({
      residentBytes: 4,
      spilledBytes: 4,
      residentBlobCount: 1,
      spilledBlobCount: 1,
      spillCount: 1,
    });
  });

  it('dedupes identical blobs and releases each retained ref', async () => {
    const bytes = Uint8Array.from([9, 9, 9, 9]).buffer;
    const first = await storeBlob(bytes);
    const second = await storeBlob(bytes);

    expect(second).toBe(first);
    expect(getHistoryBlobMetrics()).toMatchObject({
      blobCount: 1,
      refCount: 2,
      dedupeCount: 1,
      residentBytes: 4,
    });

    releaseBlob(first);
    expect(getHistoryBlobMetrics()).toMatchObject({
      blobCount: 1,
      refCount: 1,
      residentBytes: 4,
    });

    releaseBlob(second);
    expect(getHistoryBlobMetrics()).toMatchObject({
      blobCount: 0,
      refCount: 0,
      residentBytes: 0,
      releaseCount: 1,
    });
  });

  it('keeps fallback bytes when an IndexedDB put request succeeds but its transaction aborts', async () => {
    const idb = createIndexedDbMock({ abortNextPutAfterSuccess: true });
    installIndexedDbMock(idb.indexedDb);
    const bytes = Uint8Array.from([7, 7, 7, 7, 7, 7, 7, 7]);

    const id = await storeBlob(bytes.buffer);

    expect(getHistoryBlobMetrics()).toMatchObject({
      spilledBytes: bytes.byteLength,
      spilledFallbackBytes: bytes.byteLength,
    });
    const blob = await readBlob(id);
    expect(Array.from(blob?.data ?? [])).toEqual(Array.from(bytes));
  });

  it('waits for a pending IndexedDB delete before reusing the same content hash', async () => {
    const idb = createIndexedDbMock({ holdDeletes: true });
    installIndexedDbMock(idb.indexedDb);
    const bytes = Uint8Array.from([8, 8, 8, 8, 8, 8, 8, 8]);

    const first = await storeBlob(bytes.buffer);
    expect(idb.rows.has(first)).toBe(true);

    releaseBlob(first);
    await waitFor(() => idb.heldDeleteCount() === 1);

    let resolved = false;
    const secondPromise = storeBlob(bytes.buffer).then((id) => {
      resolved = true;
      return id;
    });
    await wait(5);
    expect(resolved).toBe(false);

    idb.releaseNextDelete();
    const second = await secondPromise;

    expect(second).toBe(first);
    expect(idb.rows.has(second)).toBe(true);
    const blob = await readBlob(second);
    expect(Array.from(blob?.data ?? [])).toEqual(Array.from(bytes));
  });
});
