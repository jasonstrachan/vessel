import type { QuadExpandResult } from './QuadExpander';
import type { StrokeMeshLayout } from '../types';

type MeshCacheEntry = {
  key: string;
  generation: number;
  buffer: GPUBuffer;
  vertexCount: number;
  quadCount: number;
  layout: StrokeMeshLayout;
  vertexStride: number;
  winding: 'ccw' | 'cw';
  releaseUnderlying: () => void;
  sizeBytes: number;
  refCount: number;
  lastUsed: number;
};

const TARGET_LIMIT_BYTES = 96 * 1024 * 1024;

const now = (): number => (
  typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now()
);

const isFiniteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

const stableStringify = (value: unknown, depth = 0): string => {
  if (depth > 8) {
    return '"[max-depth]"';
  }

  if (value === null) {
    return 'null';
  }

  const valueType = typeof value;

  if (valueType === 'number') {
    if (!Number.isFinite(value as number)) {
      return '"[non-finite]"';
    }
    return Number(value).toString();
  }

  if (valueType === 'boolean') {
    return (value as boolean) ? 'true' : 'false';
  }

  if (valueType === 'string') {
    return JSON.stringify(value as string);
  }

  if (valueType === 'bigint') {
    return (value as bigint).toString();
  }

  if (valueType === 'undefined') {
    return '"[undefined]"';
  }

  if (valueType === 'function') {
    return '"[function]"';
  }

  if (Array.isArray(value)) {
    const maxLength = depth > 6 ? 32 : value.length;
    const parts = [] as string[];
    for (let index = 0; index < maxLength; index += 1) {
      parts.push(stableStringify(value[index], depth + 1));
    }
    if (value.length > maxLength) {
      parts.push('"..."');
    }
    return `[${parts.join(',')}]`;
  }

  if (valueType === 'object') {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    const parts: string[] = [];
    for (const key of keys) {
      const candidate = record[key];
      if (candidate === undefined || typeof candidate === 'function') {
        continue;
      }
      parts.push(`${JSON.stringify(key)}:${stableStringify(candidate, depth + 1)}`);
    }
    return `{${parts.join(',')}}`;
  }

  return JSON.stringify(String(value));
};

const fnv1a32 = (input: string): number => {
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
};

export const hashStructuredValue = (value: unknown): string => {
  const serialised = stableStringify(value);
  return fnv1a32(serialised).toString(16).padStart(8, '0');
};

class ShapeFillMeshCache {
  private readonly entries = new Map<string, MeshCacheEntry>();

  private currentBytes = 0;

  get(key: string, generation: number): QuadExpandResult | null {
    this.sweepStaleGenerations(generation);
    const entry = this.entries.get(key);
    if (!entry || entry.generation !== generation) {
      return null;
    }
    entry.lastUsed = now();
    return this.createHandle(entry);
  }

  store(key: string, generation: number, result: QuadExpandResult): QuadExpandResult {
    this.sweepStaleGenerations(generation);

    const sizeBytes = result.vertexCount * result.vertexStride;
    if (!isFiniteNumber(sizeBytes) || sizeBytes <= 0 || sizeBytes >= TARGET_LIMIT_BYTES) {
      return result;
    }

    const existing = this.entries.get(key);
    if (existing) {
      if (existing.generation === generation) {
        return this.createHandle(existing);
      }
      if (existing.refCount === 0) {
        this.removeEntry(existing);
      } else {
        return result;
      }
    }

    const entry: MeshCacheEntry = {
      key,
      generation,
      buffer: result.buffer,
      vertexCount: result.vertexCount,
      quadCount: result.quadCount,
      layout: result.layout,
      vertexStride: result.vertexStride,
      winding: result.winding,
      releaseUnderlying: result.release,
      sizeBytes,
      refCount: 0,
      lastUsed: now(),
    };

    this.entries.set(key, entry);
    this.currentBytes += sizeBytes;

    const handle = this.createHandle(entry);
    this.evictToLimit(TARGET_LIMIT_BYTES);
    return handle;
  }

  private createHandle(entry: MeshCacheEntry): QuadExpandResult {
    entry.refCount += 1;
    entry.lastUsed = now();
    return {
      buffer: entry.buffer,
      vertexCount: entry.vertexCount,
      quadCount: entry.quadCount,
      layout: entry.layout,
      vertexStride: entry.vertexStride,
      winding: entry.winding,
      release: () => {
        this.releaseHandle(entry.key);
      },
    };
  }

  private releaseHandle(key: string): void {
    const entry = this.entries.get(key);
    if (!entry) {
      return;
    }
    if (entry.refCount > 0) {
      entry.refCount -= 1;
    }
    entry.lastUsed = now();
    if (entry.refCount === 0) {
      this.evictToLimit(TARGET_LIMIT_BYTES);
    }
  }

  private removeEntry(entry: MeshCacheEntry): void {
    if (!this.entries.delete(entry.key)) {
      return;
    }
    this.currentBytes = Math.max(0, this.currentBytes - entry.sizeBytes);
    try {
      entry.releaseUnderlying();
    } catch {
      // Ignore GPU buffer release errors; device loss will clear remaining resources.
    }
  }

  private evictToLimit(limitBytes: number): void {
    if (this.currentBytes <= limitBytes) {
      return;
    }

    const candidates = Array.from(this.entries.values())
      .filter((entry) => entry.refCount === 0)
      .sort((a, b) => a.lastUsed - b.lastUsed);

    for (const entry of candidates) {
      if (this.currentBytes <= limitBytes) {
        break;
      }
      this.removeEntry(entry);
    }
  }

  private sweepStaleGenerations(currentGeneration: number): void {
    for (const entry of Array.from(this.entries.values())) {
      if (entry.generation !== currentGeneration && entry.refCount === 0) {
        this.removeEntry(entry);
      }
    }
  }

  clear(): void {
    for (const entry of Array.from(this.entries.values())) {
      this.removeEntry(entry);
    }
    this.entries.clear();
    this.currentBytes = 0;
  }
}

let meshCacheInstance: ShapeFillMeshCache | null = null;

export const getShapeFillMeshCache = (): ShapeFillMeshCache => {
  if (!meshCacheInstance) {
    meshCacheInstance = new ShapeFillMeshCache();
  }
  return meshCacheInstance;
};

export const resetShapeFillMeshCache = (): void => {
  if (meshCacheInstance) {
    meshCacheInstance.clear();
    meshCacheInstance = null;
  }
};
