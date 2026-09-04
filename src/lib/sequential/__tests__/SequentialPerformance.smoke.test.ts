import { performance } from 'perf_hooks';

import { SequentialFrameCache } from '@/lib/sequential/SequentialFrameCache';
import { SequentialCpuMaterializer } from '@/lib/sequential/materializer/SequentialCpuMaterializer';
import { BrushShape, type SequentialStrokeEvent } from '@/types';

const WIDTH = 512;
const HEIGHT = 512;
const FRAME_COUNT = 24;
const CACHE_BUDGET_BYTES = 16 * 1024 * 1024;

const createEvents = (): SequentialStrokeEvent[] => Array.from(
  { length: FRAME_COUNT },
  (_, frameIndex) => ({
    id: `perf-event-${frameIndex}`,
    layerId: 'perf-layer',
    strokeId: `perf-stroke-${frameIndex}`,
    timestampMs: Math.round((frameIndex * 1000) / 12),
    frameIndex,
    brush: {
      tool: 'brush',
      brushShape: BrushShape.ROUND,
      size: 12,
      opacity: 1,
      blendMode: 'source-over',
      rotation: 0,
      spacing: 1,
      color: frameIndex % 2 === 0 ? '#ff5a36' : '#2f8dff',
      customStampId: null,
    },
    stamps: Array.from({ length: 24 }, (_, stampIndex) => ({
      x: 20 + ((stampIndex * 19 + frameIndex * 7) % (WIDTH - 40)),
      y: 20 + ((stampIndex * 31 + frameIndex * 11) % (HEIGHT - 40)),
      pressure: 1,
      rotation: 0,
      size: 12,
      alpha: 1,
    })),
  }),
);

describe('SequentialPerformance.smoke', () => {
  it('keeps materialized playback within time and byte budgets', () => {
    const events = createEvents();
    const materializer = new SequentialCpuMaterializer({ tileSize: 128 });
    const cache = new SequentialFrameCache({
      maxEntries: FRAME_COUNT,
      maxBytes: CACHE_BUDGET_BYTES,
    });

    const samples: number[] = [];
    for (let iteration = 0; iteration < 3; iteration += 1) {
      for (let frameIndex = 0; frameIndex < FRAME_COUNT; frameIndex += 1) {
        const startedAt = performance.now();
        let tileSet = cache.get('perf-layer', frameIndex);
        if (!tileSet) {
          tileSet = materializer.materializeFrame({
            width: WIDTH,
            height: HEIGHT,
            frameIndex,
            events,
          });
          cache.set('perf-layer', frameIndex, tileSet);
        }
        samples.push(performance.now() - startedAt);
      }
    }

    const sorted = [...samples].sort((a, b) => a - b);
    const p95Ms = sorted[Math.ceil(sorted.length * 0.95) - 1] ?? 0;
    const stats = cache.getStats();
    console.log('[SequentialPerfSmoke]', JSON.stringify({
      p95Ms: Number(p95Ms.toFixed(3)),
      entries: stats.entries,
      bytes: stats.bytes,
      maxBytes: stats.maxBytes,
    }));

    expect(p95Ms).toBeLessThan(50);
    expect(stats.entries).toBeLessThanOrEqual(FRAME_COUNT);
    expect(stats.bytes).toBeLessThanOrEqual(CACHE_BUDGET_BYTES);
    expect(stats.maxBytes).toBe(CACHE_BUDGET_BYTES);
  });
});
