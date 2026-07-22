import type { CumulativeThresholdPatternDefinition } from './cumulativeThresholdPattern';

const DB_NAME = 'vessel-local-pattern-library';
const DB_VERSION = 1;
const PACK_STORE = 'packs';

export type StoredLocalPattern = Readonly<{
  definition: CumulativeThresholdPatternDefinition;
  thresholds: Uint8Array;
}>;

export type StoredLocalPatternPack = Readonly<{
  packId: string;
  name: string;
  contentHash: string;
  archiveBytes: Uint8Array;
  patterns: readonly StoredLocalPattern[];
}>;

export type LocalPatternLibraryStorage = Readonly<{
  list: () => Promise<readonly StoredLocalPatternPack[]>;
  get: (packId: string) => Promise<StoredLocalPatternPack | null>;
  put: (pack: StoredLocalPatternPack) => Promise<void>;
  remove: (packId: string) => Promise<void>;
}>;

const requestResult = <T>(request: IDBRequest<T>): Promise<T> => new Promise((resolve, reject) => {
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed.'));
});

const transactionComplete = (transaction: IDBTransaction): Promise<void> => new Promise((resolve, reject) => {
  transaction.oncomplete = () => resolve();
  transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB transaction aborted.'));
  transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB transaction failed.'));
});

const openDatabase = (): Promise<IDBDatabase> => {
  if (typeof indexedDB === 'undefined') {
    return Promise.reject(new Error('IndexedDB is unavailable in this browser.'));
  }
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(PACK_STORE)) {
        db.createObjectStore(PACK_STORE, { keyPath: 'packId' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Unable to open local pattern library.'));
  });
};

export const createIndexedDbLocalPatternStorage = (): LocalPatternLibraryStorage => ({
  list: async () => {
    const db = await openDatabase();
    try {
      const transaction = db.transaction(PACK_STORE, 'readonly');
      return await requestResult(transaction.objectStore(PACK_STORE).getAll()) as StoredLocalPatternPack[];
    } finally {
      db.close();
    }
  },
  get: async (packId) => {
    const db = await openDatabase();
    try {
      const transaction = db.transaction(PACK_STORE, 'readonly');
      const result = await requestResult(transaction.objectStore(PACK_STORE).get(packId));
      return (result as StoredLocalPatternPack | undefined) ?? null;
    } finally {
      db.close();
    }
  },
  put: async (pack) => {
    const db = await openDatabase();
    try {
      const transaction = db.transaction(PACK_STORE, 'readwrite');
      transaction.objectStore(PACK_STORE).put(pack);
      await transactionComplete(transaction);
    } finally {
      db.close();
    }
  },
  remove: async (packId) => {
    const db = await openDatabase();
    try {
      const transaction = db.transaction(PACK_STORE, 'readwrite');
      transaction.objectStore(PACK_STORE).delete(packId);
      await transactionComplete(transaction);
    } finally {
      db.close();
    }
  },
});
