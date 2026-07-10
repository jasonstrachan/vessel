import {
  COLOR_CYCLE_CANONICAL_BYTES_PER_PIXEL,
  ColorCycleLayerDocument,
  getColorCycleCanonicalCopyMetrics,
  resetColorCycleCanonicalCopyMetrics,
  type ColorCycleLayerDocumentState,
} from '@/lib/colorCycle/document';

type BenchmarkSize = '2048-square' | '4k' | 'a4-portrait';

const WARMUP_SAMPLE_COUNT = 1;
const MEASURED_SAMPLE_COUNT = 5;

const BENCHMARKS: Record<BenchmarkSize, {
  width: number;
  height: number;
  maxPublicationMs: number;
}> = {
  '2048-square': { width: 2048, height: 2048, maxPublicationMs: 80 },
  '4k': { width: 3840, height: 2160, maxPublicationMs: 160 },
  'a4-portrait': { width: 2480, height: 3508, maxPublicationMs: 180 },
};

const makeState = (
  layerId: string,
  width: number,
  height: number,
  paintValue: number,
): ColorCycleLayerDocumentState => {
  const pixelCount = width * height;
  const paint = new Uint8Array(pixelCount);
  paint[0] = paintValue;
  return {
    layerId,
    width,
    height,
    paintBuffer: paint.buffer,
    gradientIdBuffer: new Uint8Array(pixelCount).buffer,
    gradientDefIdBuffer: new Uint16Array(pixelCount).buffer,
    speedBuffer: new Uint8Array(pixelCount).buffer,
    flowBuffer: new Uint8Array(pixelCount).buffer,
    phaseBuffer: new Uint8Array(pixelCount).buffer,
    hasContent: paintValue !== 0,
    sources: {
      brushStateSnapshot: false,
      topLevelBuffers: false,
      legacyStateRefs: false,
    },
  };
};

describe('color-cycle document publication benchmark', () => {
  const runBenchmark = process.env.CC_PUBLICATION_BENCHMARK_SIZE ? it : it.skip;

  runBenchmark('stays within the selected one-generation copy and p95 timing budget', () => {
    const sizeName = process.env.CC_PUBLICATION_BENCHMARK_SIZE as BenchmarkSize;
    const benchmark = BENCHMARKS[sizeName];
    if (!benchmark) {
      throw new Error(`Unknown CC_PUBLICATION_BENCHMARK_SIZE: ${sizeName}`);
    }
    const { width, height, maxPublicationMs } = benchmark;
    const expectedCanonicalBytes = width * height * COLOR_CYCLE_CANONICAL_BYTES_PER_PIXEL;
    const measuredDurationsMs: number[] = [];

    for (
      let sampleIndex = 0;
      sampleIndex < WARMUP_SAMPLE_COUNT + MEASURED_SAMPLE_COUNT;
      sampleIndex += 1
    ) {
      const layerId = `benchmark-${sizeName}-${sampleIndex}`;
      const document = new ColorCycleLayerDocument(makeState(layerId, width, height, 0));
      const publicationState = makeState(layerId, width, height, 1);
      resetColorCycleCanonicalCopyMetrics();

      const startedAt = performance.now();
      document.replaceState(publicationState, 'benchmark-publication', { pixelsChanged: true });
      const durationMs = performance.now() - startedAt;
      const metrics = getColorCycleCanonicalCopyMetrics();

      expect(metrics.totalGenerations).toBe(1);
      expect(metrics.totalBytes).toBe(expectedCanonicalBytes);
      if (sampleIndex >= WARMUP_SAMPLE_COUNT) {
        measuredDurationsMs.push(durationMs);
      }
    }

    const sortedDurationsMs = [...measuredDurationsMs].sort((a, b) => a - b);
    const medianMs = sortedDurationsMs[Math.floor(sortedDurationsMs.length / 2)];
    const p95Index = Math.ceil(sortedDurationsMs.length * 0.95) - 1;
    const p95Ms = sortedDurationsMs[p95Index];
    const result = {
      size: sizeName,
      width,
      height,
      warmupSamples: WARMUP_SAMPLE_COUNT,
      measuredSamples: MEASURED_SAMPLE_COUNT,
      medianMs: Number(medianMs.toFixed(3)),
      p95Ms: Number(p95Ms.toFixed(3)),
      canonicalBytesCopiedPerPublication: expectedCanonicalBytes,
      expectedCanonicalBytes,
      maxPublicationP95Ms: maxPublicationMs,
      environment: {
        node: process.version,
        platform: process.platform,
        architecture: process.arch,
      },
    };

    process.stdout.write(`CC_PUBLICATION_BENCHMARK ${JSON.stringify(result)}\n`);
    expect(p95Ms).toBeLessThanOrEqual(maxPublicationMs);
  });
});
