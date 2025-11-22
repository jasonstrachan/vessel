import {
  CC_PERF,
  recordColorCycleFillPerf,
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
  });
});
