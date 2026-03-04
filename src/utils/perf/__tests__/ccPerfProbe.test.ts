/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  CC_PERF,
  getPerfSnapshot,
  recordColorCycleFillPerf,
  recordColorCycleLayerRenderPerf,
  recordCanvasDrawPerf,
  resetPerfCounters,
  timeSync,
  timeAsync,
  wrapAppHotspots,
  enableCCPerfProbe,
} from '../ccPerfProbe';

describe('ccPerfProbe utilities', () => {
  beforeEach(() => {
    CC_PERF.on = true;
    CC_PERF.verbose = false;
    Object.keys(CC_PERF.counters).forEach((key) => {
      // @ts-expect-error dynamic reset
      CC_PERF.counters[key] = 0;
    });
  });

  it('records color-cycle fill perf counters', () => {
    recordColorCycleFillPerf({ path: 'cpu', mode: 'concentric', durationMs: 12 });
    expect(CC_PERF.counters.ccFillCpuCount).toBe(1);
    expect(CC_PERF.counters.ccFillCpuMs).toBe(12);
  });

  it('records render and draw perf snapshots', () => {
    recordColorCycleLayerRenderPerf({
      durationMs: 6,
      visibleLayerCount: 3,
      onlyActiveLayer: false,
    });
    recordColorCycleLayerRenderPerf({
      durationMs: 4,
      visibleLayerCount: 1,
      onlyActiveLayer: true,
    });
    recordCanvasDrawPerf({ durationMs: 5, reason: 'main' });

    const snapshot = getPerfSnapshot();
    expect(snapshot.ccLayerRenderTicks).toBe(2);
    expect(snapshot.ccLayerRenderMs).toBe(10);
    expect(snapshot.ccLayerRenderAvgMs).toBe(5);
    expect(snapshot.ccLayerRenderAvgVisibleLayers).toBe(2);
    expect(snapshot.canvasDrawCalls).toBe(1);
    expect(snapshot.canvasDrawAvgMs).toBe(5);
  });

  it('wraps commit/capture and accumulates timings', async () => {
    const globals = wrapAppHotspots({
      captureColorCycleBrushState: jest.fn(() => 'ok'),
      commitLayerHistory: jest.fn(async () => 'done'),
    });

    const captureResult = (globals.captureColorCycleBrushState as any)('layer-1');
    expect(captureResult).toBe('ok');

    const commitResult = await (globals.commitLayerHistory as any)({ id: 'layer-1' });
    expect(commitResult).toBe('done');
    expect(CC_PERF.counters.commits).toBe(1);
  });

  it('times sync/async blocks when performance is available', async () => {
    const original = (global as any).performance;
    (global as any).performance = {
      now: () => 0,
      mark: jest.fn(),
      measure: jest.fn(),
    } as any;

    const syncResult = timeSync('sync', () => 123);
    expect(syncResult).toBe(123);

    const asyncResult = await timeAsync('async', async () => 456);
    expect(asyncResult).toBe(456);

    (global as any).performance = original;
  });

  it('enables probe and persists verbose flag', () => {
    const setItem = jest.fn();
    const getItem = jest.fn(() => '1');
    (global as any).window = {
      localStorage: { setItem, getItem },
      PerformanceObserver: function () {} as any,
    };

    enableCCPerfProbe({}, { verbose: true });
    expect(CC_PERF.verbose).toBe(true);
    expect((window as any).setCCPerfVerbose).toBeInstanceOf(Function);
    expect((window as any).vesselCCPerf).toBeDefined();
    expect((window as any).vesselCCPerf.snapshot).toBeInstanceOf(Function);
    expect((window as any).vesselCCPerf.reset).toBeInstanceOf(Function);
    expect((window as any).vesselCCPerf.print).toBeInstanceOf(Function);
  });

  it('resets all counters', () => {
    recordCanvasDrawPerf({ durationMs: 2, reason: 'main' });
    expect(CC_PERF.counters.canvasDrawCalls).toBe(1);
    resetPerfCounters();
    expect(CC_PERF.counters.canvasDrawCalls).toBe(0);
    expect(CC_PERF.counters.ccFillCpuCount).toBe(0);
  });
});
