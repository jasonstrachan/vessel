import {
  COLOR_CYCLE_CANONICAL_BYTES_PER_PIXEL,
  ColorCycleLayerDocument,
  getColorCycleCanonicalCopyMetrics,
  resetColorCycleCanonicalCopyMetrics,
  type ColorCycleLayerDocumentState,
} from '@/lib/colorCycle/document';

type BenchmarkSize = '2048-square' | '4k' | 'a4-portrait';

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

  runBenchmark('stays within the selected one-generation copy and timing budget', () => {
    const sizeName = process.env.CC_PUBLICATION_BENCHMARK_SIZE as BenchmarkSize;
    const benchmark = BENCHMARKS[sizeName];
    if (!benchmark) {
      throw new Error(`Unknown CC_PUBLICATION_BENCHMARK_SIZE: ${sizeName}`);
    }
    const { width, height, maxPublicationMs } = benchmark;
    const layerId = `benchmark-${sizeName}`;
    const document = new ColorCycleLayerDocument(makeState(layerId, width, height, 0));
    const publicationState = makeState(layerId, width, height, 1);
    resetColorCycleCanonicalCopyMetrics();

    const startedAt = performance.now();
    document.replaceState(publicationState, 'benchmark-publication', { pixelsChanged: true });
    const durationMs = performance.now() - startedAt;
    const metrics = getColorCycleCanonicalCopyMetrics();
    const expectedCanonicalBytes = width * height * COLOR_CYCLE_CANONICAL_BYTES_PER_PIXEL;
    const result = {
      size: sizeName,
      width,
      height,
      durationMs: Number(durationMs.toFixed(3)),
      canonicalBytesCopied: metrics.totalBytes,
      expectedCanonicalBytes,
      maxPublicationMs,
    };

    process.stdout.write(`CC_PUBLICATION_BENCHMARK ${JSON.stringify(result)}\n`);
    expect(metrics.totalGenerations).toBe(1);
    expect(metrics.totalBytes).toBe(expectedCanonicalBytes);
    expect(durationMs).toBeLessThanOrEqual(maxPublicationMs);
  });
});
