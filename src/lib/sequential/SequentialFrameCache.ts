import type { FrameTileSet, SequentialFrameCacheStats } from '@/lib/sequential/types';

interface CacheEntry {
  tileSet: FrameTileSet;
  lastAccessTick: number;
}

const keyFor = (layerId: string, frameIndex: number): string => `${layerId}:${frameIndex}`;

export class SequentialFrameCache {
  private readonly maxEntries: number;

  private readonly entries = new Map<string, CacheEntry>();

  private readonly dirtyFramesByLayer = new Map<string, Set<number>>();

  private hits = 0;

  private misses = 0;

  private accessTick = 0;

  constructor(options?: { maxEntries?: number }) {
    this.maxEntries = Math.max(1, options?.maxEntries ?? 64);
  }

  get(layerId: string, frameIndex: number): FrameTileSet | null {
    const dirty = this.dirtyFramesByLayer.get(layerId);
    if (dirty?.has(frameIndex)) {
      this.entries.delete(keyFor(layerId, frameIndex));
      this.misses += 1;
      return null;
    }

    const key = keyFor(layerId, frameIndex);
    const existing = this.entries.get(key);
    if (!existing) {
      this.misses += 1;
      return null;
    }
    this.hits += 1;
    this.accessTick += 1;
    existing.lastAccessTick = this.accessTick;
    return existing.tileSet;
  }

  peek(layerId: string, frameIndex: number): FrameTileSet | null {
    const dirty = this.dirtyFramesByLayer.get(layerId);
    if (dirty?.has(frameIndex)) {
      return null;
    }
    const existing = this.entries.get(keyFor(layerId, frameIndex));
    return existing ? existing.tileSet : null;
  }

  set(layerId: string, frameIndex: number, tileSet: FrameTileSet): void {
    const key = keyFor(layerId, frameIndex);
    this.accessTick += 1;
    this.entries.set(key, {
      tileSet,
      lastAccessTick: this.accessTick,
    });
    this.markClean(layerId, frameIndex);
    this.evictIfNeeded();
  }

  markDirty(layerId: string, frameIndex: number): void {
    const set = this.dirtyFramesByLayer.get(layerId) ?? new Set<number>();
    set.add(frameIndex);
    this.dirtyFramesByLayer.set(layerId, set);
  }

  markDirtyFrames(layerId: string, frameIndexes: ReadonlyArray<number>): void {
    for (let i = 0; i < frameIndexes.length; i += 1) {
      this.markDirty(layerId, frameIndexes[i]);
    }
  }

  getDirtyFrames(layerId: string): number[] {
    const dirty = this.dirtyFramesByLayer.get(layerId);
    if (!dirty) {
      return [];
    }
    return Array.from(dirty).sort((a, b) => a - b);
  }

  consumeDirtyFrames(layerId: string): number[] {
    const dirty = this.getDirtyFrames(layerId);
    this.dirtyFramesByLayer.delete(layerId);
    return dirty;
  }

  clearLayer(layerId: string): void {
    const prefix = `${layerId}:`;
    for (const key of Array.from(this.entries.keys())) {
      if (key.startsWith(prefix)) {
        this.entries.delete(key);
      }
    }
    this.dirtyFramesByLayer.delete(layerId);
  }

  clearAll(): void {
    this.entries.clear();
    this.dirtyFramesByLayer.clear();
    this.hits = 0;
    this.misses = 0;
    this.accessTick = 0;
  }

  getStats(): SequentialFrameCacheStats {
    let dirtyFrames = 0;
    this.dirtyFramesByLayer.forEach((set) => {
      dirtyFrames += set.size;
    });
    return {
      entries: this.entries.size,
      hits: this.hits,
      misses: this.misses,
      dirtyFrames,
    };
  }

  private markClean(layerId: string, frameIndex: number): void {
    const dirty = this.dirtyFramesByLayer.get(layerId);
    if (!dirty) {
      return;
    }
    dirty.delete(frameIndex);
    if (dirty.size === 0) {
      this.dirtyFramesByLayer.delete(layerId);
    }
  }

  private evictIfNeeded(): void {
    if (this.entries.size <= this.maxEntries) {
      return;
    }

    const candidates = Array.from(this.entries.entries()).sort(
      (a, b) => a[1].lastAccessTick - b[1].lastAccessTick
    );
    const overflowCount = this.entries.size - this.maxEntries;
    for (let i = 0; i < overflowCount; i += 1) {
      const [evictKey] = candidates[i];
      this.entries.delete(evictKey);
    }
  }
}
