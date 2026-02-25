import { SequentialFrameCache } from '@/lib/sequential/SequentialFrameCache';
import type { FrameTileSet } from '@/lib/sequential/types';

const createTileSet = (frameIndex: number): FrameTileSet => ({
  frameIndex,
  tileSize: 128,
  pixelFormat: 'rgba8',
  premultipliedAlpha: true,
  colorSpace: 'srgb',
  tiles: [
    {
      x: 0,
      y: 0,
      width: 1,
      height: 1,
      data: new Uint8ClampedArray([255, 0, 0, 255]),
    },
  ],
});

describe('SequentialFrameCache', () => {
  it('tracks dirty frames and clears dirty state on set', () => {
    const cache = new SequentialFrameCache({ maxEntries: 4 });
    cache.markDirtyFrames('layer-1', [2, 1, 2]);

    expect(cache.getDirtyFrames('layer-1')).toEqual([1, 2]);

    cache.set('layer-1', 1, createTileSet(1));
    expect(cache.getDirtyFrames('layer-1')).toEqual([2]);
  });

  it('evicts least recently used entries', () => {
    const cache = new SequentialFrameCache({ maxEntries: 2 });
    cache.set('layer-1', 0, createTileSet(0));
    cache.set('layer-1', 1, createTileSet(1));
    void cache.get('layer-1', 0); // keep frame 0 as most-recently-used
    cache.set('layer-1', 2, createTileSet(2));

    expect(cache.get('layer-1', 1)).toBeNull();
    expect(cache.get('layer-1', 0)?.frameIndex).toBe(0);
    expect(cache.get('layer-1', 2)?.frameIndex).toBe(2);
  });

  it('reports hit/miss stats', () => {
    const cache = new SequentialFrameCache({ maxEntries: 2 });
    cache.set('layer-1', 0, createTileSet(0));
    expect(cache.get('layer-1', 0)).not.toBeNull();
    expect(cache.get('layer-1', 9)).toBeNull();

    const stats = cache.getStats();
    expect(stats.entries).toBe(1);
    expect(stats.hits).toBe(1);
    expect(stats.misses).toBe(1);
  });
});
