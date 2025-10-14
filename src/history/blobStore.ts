const memoryStore = new Map<string, { data: Uint8Array; refCount: number; size: number }>();

const textEncoder = new TextEncoder();

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

const hashBytes = async (bytes: Uint8Array): Promise<string> => {
  try {
    const subtle = globalThis.crypto?.subtle;
    if (subtle && typeof subtle.digest === 'function') {
      const digest = await subtle.digest('SHA-256', bytes);
      return toBase64(new Uint8Array(digest));
    }
  } catch {
    // fallthrough to fallback hash
  }

  // Fallback: simple FNV-1a 64-bit hash rendered in base36
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

export type BlobEncoding = 'raw' | 'rle';

export interface StoredBlob {
  id: string;
  size: number;
  encoding: BlobEncoding;
  data: Uint8Array;
}

export const storeBlob = async (buffer: ArrayBufferLike): Promise<string> => {
  const bytes = fromArrayBuffer(buffer);
  const id = await hashBytes(bytes);
  const existing = memoryStore.get(id);
  if (existing) {
    existing.refCount += 1;
    return id;
  }
  memoryStore.set(id, { data: bytes, refCount: 1, size: bytes.byteLength });
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
    memoryStore.delete(id);
  }
};

export const readBlob = async (id: string): Promise<StoredBlob | null> => {
  const entry = memoryStore.get(id);
  if (!entry) {
    return null;
  }
  return {
    id,
    size: entry.size,
    encoding: 'raw',
    data: entry.data
  };
};

export const clearBlobStore = (): void => {
  memoryStore.clear();
};
