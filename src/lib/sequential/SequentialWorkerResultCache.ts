import type { FrameTileSet } from '@/lib/sequential/types';

interface WorkerResultCacheEntry {
  tileSet: FrameTileSet;
  bytes: number;
}

export class SequentialWorkerResultCache {
  private readonly entries = new Map<string, WorkerResultCacheEntry>();

  private readonly maxEntries: number;

  private readonly maxBytes: number;

  private bytes = 0;

  constructor({
    maxEntries = 64,
    maxBytes = 32 * 1024 * 1024,
  }: {
    maxEntries?: number;
    maxBytes?: number;
  } = {}) {
    this.maxEntries = Math.max(1, Math.round(maxEntries));
    this.maxBytes = Math.max(1, Math.round(maxBytes));
  }

  has(key: string): boolean {
    return this.entries.has(key);
  }

  take(key: string): FrameTileSet | null {
    const entry = this.entries.get(key);
    if (!entry) {
      return null;
    }
    this.entries.delete(key);
    this.bytes = Math.max(0, this.bytes - entry.bytes);
    return entry.tileSet;
  }

  set(key: string, tileSet: FrameTileSet): boolean {
    this.take(key);
    const bytes = tileSet.tiles.reduce((total, tile) => total + tile.data.byteLength, 0);
    if (bytes > this.maxBytes) {
      return false;
    }
    this.entries.set(key, { tileSet, bytes });
    this.bytes += bytes;

    while (this.entries.size > this.maxEntries || this.bytes > this.maxBytes) {
      const oldestKey = this.entries.keys().next().value as string | undefined;
      if (!oldestKey) {
        break;
      }
      this.take(oldestKey);
    }
    return true;
  }

  clear(): void {
    this.entries.clear();
    this.bytes = 0;
  }

  getStats(): { entries: number; bytes: number; maxBytes: number } {
    return {
      entries: this.entries.size,
      bytes: this.bytes,
      maxBytes: this.maxBytes,
    };
  }
}
