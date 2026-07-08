import { strokeFinalizeProbeTime } from '@/utils/strokeFinalizeProbe';

export const HISTORY_BLOB_DEFAULT_RESIDENT_BUDGET_BYTES = 64 * 1024 * 1024;
export const HISTORY_BLOB_DEFAULT_SPILL_THRESHOLD_BYTES = 8 * 1024 * 1024;

type BlobTier = 'resident' | 'spilled';

interface BlobStorePolicy {
  residentBudgetBytes: number;
  spillThresholdBytes: number;
}

interface BlobEntry {
  id: string;
  refCount: number;
  size: number;
  tier: BlobTier;
  residentData?: Uint8Array;
  spilledData?: Uint8Array;
  idbStored?: boolean;
}

const DB_NAME = 'vessel-history-blobs';
const STORE_NAME = 'blobs';

let policy: BlobStorePolicy = {
  residentBudgetBytes: HISTORY_BLOB_DEFAULT_RESIDENT_BUDGET_BYTES,
  spillThresholdBytes: HISTORY_BLOB_DEFAULT_SPILL_THRESHOLD_BYTES,
};

const memoryStore = new Map<string, BlobEntry>();
const pendingIndexedDbDeletes = new Map<string, Promise<void>>();

const metrics = {
  residentBytes: 0,
  spilledBytes: 0,
  spillCount: 0,
  restoreCount: 0,
  dedupeCount: 0,
  releaseCount: 0,
  spilledFallbackBytes: 0,
  lastTrimReason: null as string | null,
};

const toBase64 = (bytes: Uint8Array): string => {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes).toString('base64');
  }
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return typeof btoa === 'function' ? btoa(binary) : binary;
};

const fromArrayBuffer = (buffer: ArrayBufferLike): Uint8Array =>
  buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);

const hashBytesSync = (bytes: Uint8Array): string => {
  let hashHigh = 0x811c9dc5;
  let hashLow = 0x811c9dc5;
  const primeHigh = 0x01000193;
  const primeLow = 0x01000193;

  for (let i = 0; i < bytes.length; i += 1) {
    hashLow ^= bytes[i]!;
    const low = hashLow * primeLow;
    const high = hashHigh * primeLow + hashLow * primeHigh + ((low / 0x100000000) >>> 0);
    hashLow = low >>> 0;
    hashHigh = high >>> 0;
  }

  const combined = new Uint8Array(8);
  const view = new DataView(combined.buffer);
  view.setUint32(0, hashHigh >>> 0);
  view.setUint32(4, hashLow >>> 0);
  return toBase64(combined);
};

const hashBytes = async (bytes: Uint8Array): Promise<string> => hashBytesSync(bytes);

export type BlobEncoding = 'raw' | 'rle';

export interface StoredBlob {
  id: string;
  size: number;
  tier: BlobTier;
  data: Uint8Array;
}

export interface HistoryBlobMetrics {
  residentBytes: number;
  spilledBytes: number;
  totalBytes: number;
  blobCount: number;
  residentBlobCount: number;
  spilledBlobCount: number;
  spilledFallbackBytes: number;
  refCount: number;
  spillCount: number;
  restoreCount: number;
  dedupeCount: number;
  releaseCount: number;
  lastTrimReason: string | null;
  residentBudgetBytes: number;
  spillThresholdBytes: number;
}

const copyBytes = (bytes: Uint8Array): Uint8Array => bytes.slice();

const shouldSpill = (size: number): boolean =>
  size >= policy.spillThresholdBytes ||
  metrics.residentBytes + size > policy.residentBudgetBytes;

const hasIndexedDb = (): boolean =>
  typeof indexedDB !== 'undefined' &&
  Boolean(indexedDB?.open);

const openHistoryBlobDb = (): Promise<IDBDatabase | null> => {
  if (!hasIndexedDb()) {
    return Promise.resolve(null);
  }
  return new Promise((resolve) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      try {
        request.result.createObjectStore(STORE_NAME);
      } catch {
        // Store can already exist after a racing upgrade; fall through to success/error.
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
  });
};

const putIndexedDbBlob = async (id: string, bytes: Uint8Array): Promise<boolean> => {
  const db = await openHistoryBlobDb();
  if (!db) {
    return false;
  }
  return new Promise((resolve) => {
    let settled = false;
    const finish = (stored: boolean): void => {
      if (settled) {
        return;
      }
      settled = true;
      try { db.close(); } catch {}
      resolve(stored);
    };
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const request = tx.objectStore(STORE_NAME).put(bytes, id);
    request.onerror = () => finish(false);
    tx.oncomplete = () => finish(true);
    tx.onerror = () => finish(false);
    tx.onabort = () => finish(false);
  });
};

const getIndexedDbBlob = async (id: string): Promise<Uint8Array | null> => {
  const db = await openHistoryBlobDb();
  if (!db) {
    return null;
  }
  return new Promise((resolve) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const request = tx.objectStore(STORE_NAME).get(id);
    request.onsuccess = () => {
      const result = request.result;
      if (result instanceof Uint8Array) {
        resolve(result);
        return;
      }
      if (result instanceof ArrayBuffer) {
        resolve(new Uint8Array(result));
        return;
      }
      resolve(null);
    };
    request.onerror = () => resolve(null);
    tx.oncomplete = () => db.close();
    tx.onerror = () => {
      try { db.close(); } catch {}
      resolve(null);
    };
  });
};

const deleteIndexedDbBlob = async (id: string): Promise<void> => {
  const db = await openHistoryBlobDb();
  if (!db) {
    return;
  }
  await new Promise<void>((resolve) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(id);
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      try { db.close(); } catch {}
      resolve();
    };
  });
};

const insertBlob = async (
  id: string,
  bytes: Uint8Array,
  options: { allowIndexedDb: boolean }
): Promise<string> => {
  const pendingDelete = pendingIndexedDbDeletes.get(id);
  if (pendingDelete) {
    await pendingDelete;
  }

  const existing = memoryStore.get(id);
  if (existing) {
    existing.refCount += 1;
    metrics.dedupeCount += 1;
    return id;
  }

  const ownedBytes = copyBytes(bytes);
  if (shouldSpill(ownedBytes.byteLength)) {
    const idbStored = options.allowIndexedDb
      ? await putIndexedDbBlob(id, ownedBytes)
      : false;
    memoryStore.set(id, {
      id,
      refCount: 1,
      size: ownedBytes.byteLength,
      tier: 'spilled',
      spilledData: idbStored ? undefined : ownedBytes,
      idbStored,
    });
    metrics.spilledBytes += ownedBytes.byteLength;
    if (!idbStored) {
      metrics.spilledFallbackBytes += ownedBytes.byteLength;
    }
    metrics.spillCount += 1;
    return id;
  }

  memoryStore.set(id, {
    id,
    refCount: 1,
    size: ownedBytes.byteLength,
    tier: 'resident',
    residentData: ownedBytes,
  });
  metrics.residentBytes += ownedBytes.byteLength;
  return id;
};

export const storeBlob = async (buffer: ArrayBufferLike): Promise<string> => {
  const bytes = fromArrayBuffer(buffer);
  const meta = { byteLength: bytes.byteLength };
  const id = await strokeFinalizeProbeTime('blobStore:hashBytes', () => hashBytes(bytes), meta);
  return strokeFinalizeProbeTime(
    'blobStore:insertBlob',
    () => insertBlob(id, bytes, { allowIndexedDb: true }),
    meta
  );
};

export const storeBlobSync = (buffer: ArrayBufferLike): string => {
  const bytes = fromArrayBuffer(buffer);
  const id = hashBytesSync(bytes);
  const existing = memoryStore.get(id);
  if (existing) {
    existing.refCount += 1;
    metrics.dedupeCount += 1;
    return id;
  }
  const ownedBytes = copyBytes(bytes);
  if (shouldSpill(ownedBytes.byteLength)) {
    memoryStore.set(id, {
      id,
      refCount: 1,
      size: ownedBytes.byteLength,
      tier: 'spilled',
      spilledData: ownedBytes,
      idbStored: false,
    });
    metrics.spilledBytes += ownedBytes.byteLength;
    metrics.spilledFallbackBytes += ownedBytes.byteLength;
    metrics.spillCount += 1;
    return id;
  }
  memoryStore.set(id, {
    id,
    refCount: 1,
    size: ownedBytes.byteLength,
    tier: 'resident',
    residentData: ownedBytes,
  });
  metrics.residentBytes += ownedBytes.byteLength;
  return id;
};

export const retainBlob = (id: string): void => {
  const entry = memoryStore.get(id);
  if (entry) {
    entry.refCount += 1;
  }
};

export const releaseBlob = (id: string): void => {
  const entry = memoryStore.get(id);
  if (!entry) {
    return;
  }
  entry.refCount -= 1;
  if (entry.refCount <= 0) {
    metrics.releaseCount += 1;
    if (entry.tier === 'resident') {
      metrics.residentBytes = Math.max(0, metrics.residentBytes - entry.size);
    } else {
      metrics.spilledBytes = Math.max(0, metrics.spilledBytes - entry.size);
      if (!entry.idbStored) {
        metrics.spilledFallbackBytes = Math.max(0, metrics.spilledFallbackBytes - entry.size);
      }
      if (entry.idbStored) {
        const pendingDelete = deleteIndexedDbBlob(id);
        pendingIndexedDbDeletes.set(id, pendingDelete);
        void pendingDelete.finally(() => {
          if (pendingIndexedDbDeletes.get(id) === pendingDelete) {
            pendingIndexedDbDeletes.delete(id);
          }
        });
      }
    }
    memoryStore.delete(id);
  }
};

export const readBlob = async (id: string): Promise<StoredBlob | null> => {
  const entry = memoryStore.get(id);
  if (!entry) {
    return null;
  }
  let data = entry.residentData;
  if (!data && entry.tier === 'spilled') {
    metrics.restoreCount += 1;
    data = entry.spilledData ?? (entry.idbStored ? await getIndexedDbBlob(id) ?? undefined : undefined);
  }
  if (!data) {
    return null;
  }
  return {
    id,
    size: entry.size,
    tier: entry.tier,
    data,
  };
};

export const getHistoryBlobMetrics = (): HistoryBlobMetrics => {
  let residentBlobCount = 0;
  let spilledBlobCount = 0;
  let refCount = 0;
  for (const entry of memoryStore.values()) {
    if (entry.tier === 'resident') {
      residentBlobCount += 1;
    } else {
      spilledBlobCount += 1;
    }
    refCount += entry.refCount;
  }
  return {
    residentBytes: metrics.residentBytes,
    spilledBytes: metrics.spilledBytes,
    totalBytes: metrics.residentBytes + metrics.spilledBytes,
    blobCount: memoryStore.size,
    residentBlobCount,
    spilledBlobCount,
    spilledFallbackBytes: metrics.spilledFallbackBytes,
    refCount,
    spillCount: metrics.spillCount,
    restoreCount: metrics.restoreCount,
    dedupeCount: metrics.dedupeCount,
    releaseCount: metrics.releaseCount,
    lastTrimReason: metrics.lastTrimReason,
    residentBudgetBytes: policy.residentBudgetBytes,
    spillThresholdBytes: policy.spillThresholdBytes,
  };
};

export const configureHistoryBlobStore = (nextPolicy: Partial<BlobStorePolicy>): void => {
  if (
    typeof nextPolicy.residentBudgetBytes === 'number' &&
    Number.isFinite(nextPolicy.residentBudgetBytes) &&
    nextPolicy.residentBudgetBytes > 0
  ) {
    policy = { ...policy, residentBudgetBytes: Math.floor(nextPolicy.residentBudgetBytes) };
  }
  if (
    typeof nextPolicy.spillThresholdBytes === 'number' &&
    Number.isFinite(nextPolicy.spillThresholdBytes) &&
    nextPolicy.spillThresholdBytes > 0
  ) {
    policy = { ...policy, spillThresholdBytes: Math.floor(nextPolicy.spillThresholdBytes) };
  }
};

export const recordHistoryBlobTrim = (reason: string): void => {
  metrics.lastTrimReason = reason;
};

export const clearBlobStore = (): void => {
  memoryStore.clear();
  pendingIndexedDbDeletes.clear();
  metrics.residentBytes = 0;
  metrics.spilledBytes = 0;
  metrics.spillCount = 0;
  metrics.restoreCount = 0;
  metrics.dedupeCount = 0;
  metrics.releaseCount = 0;
  metrics.spilledFallbackBytes = 0;
  metrics.lastTrimReason = null;
};
