import { GradientPalette } from '@/lib/GradientPalette';
import {
  clearPaletteCache,
  ensurePalette,
  getPaletteCacheStats,
  invalidatePalette,
  subscribeToPaletteMetrics,
} from '@/lib/colorCycle/paletteService';

describe('paletteService', () => {
  afterEach(() => {
    clearPaletteCache();
  });

  it('returns the same handle for identical gradients', () => {
    const stops = [
      { position: 0, color: '#ff0000' },
      { position: 1, color: '#00ff00' },
    ];

    const first = ensurePalette({ stops });
    const second = ensurePalette({ stops: [...stops] });

    expect(second).toBe(first);
    expect(second.key).toBe(first.key);
  });

  it('packs RGBA data into Uint32 entries for CPU rendering', () => {
    const palette = new GradientPalette([
      { position: 0, color: '#ff0000' },
      { position: 1, color: '#0000ff' },
    ]);

    const handle = ensurePalette({ palette });

    expect(handle.rgbaByteLength).toBe(handle.rgba.byteLength);
    expect(handle.uint32[0]).toBe(0xff0000ff);
  });

  it('invalidates cached handles for updated gradients', () => {
    const stops = [
      { position: 0, color: '#000000' },
      { position: 1, color: '#ffffff' },
    ];

    const initial = ensurePalette({ stops });
    invalidatePalette({ stops });
    const refreshed = ensurePalette({ stops });

    expect(refreshed).not.toBe(initial);
    expect(refreshed.key).toBe(initial.key);
  });

  it('tracks hits/misses and notifies subscribers', () => {
    const stops = [
      { position: 0, color: '#123456' },
      { position: 1, color: '#abcdef' },
    ];

    const events: string[] = [];
    const unsubscribe = subscribeToPaletteMetrics((event) => {
      events.push(event.type);
    });

    clearPaletteCache();
    ensurePalette({ stops }); // miss
    ensurePalette({ stops }); // hit
    unsubscribe();

    const stats = getPaletteCacheStats();
    expect(stats.misses).toBeGreaterThanOrEqual(1);
    expect(stats.hits).toBeGreaterThanOrEqual(1);
    expect(events).toEqual(['miss', 'hit']);

    clearPaletteCache();
    const resetStats = getPaletteCacheStats();
    expect(resetStats.hits).toBe(0);
    expect(resetStats.misses).toBe(0);
    expect(resetStats.lastEvent).toBeUndefined();
  });
});
