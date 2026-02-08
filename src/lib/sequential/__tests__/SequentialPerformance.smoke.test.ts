import { performance } from 'perf_hooks';
import { BrushShape, type SequentialStrokeEvent } from '@/types';
import { SequentialFrameCache } from '@/lib/sequential/SequentialFrameCache';
import { SequentialCpuMaterializer } from '@/lib/sequential/materializer/SequentialCpuMaterializer';

type PerfScenario = {
  name: string;
  width: number;
  height: number;
  frameCount: number;
  stampsPerFrame: number;
  warmupFrames: number;
  measureFrames: number;
  cacheEntries: number;
};

type PerfResult = {
  name: string;
  avgMs: number;
  p95Ms: number;
  maxMs: number;
  fpsApprox: number;
  cacheEntries: number;
  cacheHitRate: number;
  cacheHits: number;
  cacheMisses: number;
};

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

const createRng = (seed: number) => {
  let state = seed >>> 0;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 0x100000000;
  };
};

const percentile = (values: number[], p: number): number => {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const index = clamp(Math.ceil((p / 100) * sorted.length) - 1, 0, sorted.length - 1);
  return sorted[index];
};

const buildEvents = ({
  layerId,
  scenario,
}: {
  layerId: string;
  scenario: PerfScenario;
}): SequentialStrokeEvent[] => {
  const rng = createRng(0xBEEF ^ scenario.width ^ scenario.height ^ scenario.frameCount);
  const events: SequentialStrokeEvent[] = [];

  for (let frameIndex = 0; frameIndex < scenario.frameCount; frameIndex += 1) {
    const stamps = [];
    for (let stampIndex = 0; stampIndex < scenario.stampsPerFrame; stampIndex += 1) {
      const x = clamp(rng() * scenario.width, 0, scenario.width - 1);
      const y = clamp(rng() * scenario.height, 0, scenario.height - 1);
      const alpha = clamp(0.4 + rng() * 0.6, 0.1, 1);
      const size = clamp(2 + rng() * 20, 1, 32);
      stamps.push({
        x,
        y,
        pressure: clamp(0.4 + rng() * 0.6, 0.1, 1),
        rotation: rng() * Math.PI * 2,
        size,
        alpha,
      });
    }

    events.push({
      id: `${layerId}-f${frameIndex}`,
      layerId,
      strokeId: `${layerId}-stroke-${Math.floor(frameIndex / 3)}`,
      timestampMs: Math.round((frameIndex * 1000) / 24),
      frameIndex,
      brush: {
        tool: 'brush',
        brushShape: BrushShape.ROUND,
        size: 10,
        opacity: 1,
        blendMode: 'source-over',
        rotation: 0,
        spacing: 1,
        color: frameIndex % 2 === 0 ? '#FF5A36' : '#2F8DFF',
        customStampId: null,
      },
      stamps,
    });
  }

  return events;
};

const runScenario = (scenario: PerfScenario): PerfResult => {
  const layerId = `perf-${scenario.name}`;
  const events = buildEvents({ layerId, scenario });
  const cache = new SequentialFrameCache({ maxEntries: scenario.cacheEntries });
  const materializer = new SequentialCpuMaterializer({ tileSize: 128 });

  for (let i = 0; i < scenario.warmupFrames; i += 1) {
    const frameIndex = i % scenario.frameCount;
    const tileSet = materializer.materializeFrame({
      width: scenario.width,
      height: scenario.height,
      frameIndex,
      events,
    });
    cache.set(layerId, frameIndex, tileSet);
  }

  const samples: number[] = [];
  let cacheHits = 0;
  let cacheMisses = 0;

  for (let i = 0; i < scenario.measureFrames; i += 1) {
    const frameIndex = i % scenario.frameCount;
    const t0 = performance.now();
    const cached = cache.get(layerId, frameIndex);
    if (cached) {
      cacheHits += 1;
    } else {
      cacheMisses += 1;
      const tileSet = materializer.materializeFrame({
        width: scenario.width,
        height: scenario.height,
        frameIndex,
        events,
      });
      cache.set(layerId, frameIndex, tileSet);
    }
    samples.push(performance.now() - t0);
  }

  const avgMs = samples.reduce((sum, value) => sum + value, 0) / samples.length;
  const p95Ms = percentile(samples, 95);
  const maxMs = Math.max(...samples);
  const stats = cache.getStats();
  const total = cacheHits + cacheMisses;
  const cacheHitRate = total > 0 ? (cacheHits / total) * 100 : 0;

  return {
    name: scenario.name,
    avgMs,
    p95Ms,
    maxMs,
    fpsApprox: avgMs > 0 ? 1000 / avgMs : 0,
    cacheEntries: stats.entries,
    cacheHitRate,
    cacheHits,
    cacheMisses,
  };
};

describe('SequentialPerformance.smoke', () => {
  const scenarios: PerfScenario[] = [
    {
      name: 'baseline-1024',
      width: 1024,
      height: 1024,
      frameCount: 24,
      stampsPerFrame: 36,
      warmupFrames: 24,
      measureFrames: 180,
      cacheEntries: 128,
    },
    {
      name: 'stress-2048x1536',
      width: 2048,
      height: 1536,
      frameCount: 32,
      stampsPerFrame: 48,
      warmupFrames: 32,
      measureFrames: 180,
      cacheEntries: 128,
    },
    {
      name: 'cold-miss-1024',
      width: 1024,
      height: 1024,
      frameCount: 240,
      stampsPerFrame: 18,
      warmupFrames: 0,
      measureFrames: 180,
      cacheEntries: 8,
    },
  ];

  it('reports sequential materialization perf-smoke metrics with bounded cache growth', () => {
    const results = scenarios.map((scenario) => runScenario(scenario));

    const printable = results.map((result) => ({
      scenario: result.name,
      avgMs: Number(result.avgMs.toFixed(3)),
      p95Ms: Number(result.p95Ms.toFixed(3)),
      maxMs: Number(result.maxMs.toFixed(3)),
      fpsApprox: Number(result.fpsApprox.toFixed(2)),
      cacheEntries: result.cacheEntries,
      cacheHitRatePct: Number(result.cacheHitRate.toFixed(2)),
      cacheHits: result.cacheHits,
      cacheMisses: result.cacheMisses,
    }));

    console.log('[SequentialPerfSmoke]', JSON.stringify(printable));

    for (const result of results) {
      expect(Number.isFinite(result.avgMs)).toBe(true);
      expect(Number.isFinite(result.p95Ms)).toBe(true);
      expect(result.cacheEntries).toBeLessThanOrEqual(128);
      expect(result.avgMs).toBeLessThan(33.333);
      expect(result.p95Ms).toBeLessThan(50);
    }

    const hotScenarios = results.filter((result) => result.name !== 'cold-miss-1024');
    for (const result of hotScenarios) {
      expect(result.cacheHitRate).toBeGreaterThanOrEqual(80);
    }

    const coldScenario = results.find((result) => result.name === 'cold-miss-1024');
    expect(coldScenario).toBeDefined();
    if (coldScenario) {
      expect(coldScenario.cacheMisses).toBeGreaterThan(0);
      expect(coldScenario.cacheHitRate).toBeLessThan(20);
    }
  });
});
