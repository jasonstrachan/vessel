type AnyFn = (...args: unknown[]) => unknown;

export const CC_PERF = {
  on: true,
  verbose: false,
  captureReadbackSources: false,
  counters: {
    getImageDataCalls: 0,
    getImageDataMp: 0,
    getImageDataMs: 0,
    commits: 0,
    serializeMs: 0,
    commitMs: 0,
    ccFillGpuMs: 0,
    ccFillGpuCount: 0,
    ccFillCpuMs: 0,
    ccFillCpuCount: 0,
    ccFillWorkerMs: 0,
    ccFillWorkerCount: 0,
    ccLayerRenderMs: 0,
    ccLayerRenderTicks: 0,
    ccLayerRenderVisibleLayers: 0,
    canvasDrawMs: 0,
    canvasDrawCalls: 0,
  },
};

type ReadbackSourceStats = {
  calls: number;
  ms: number;
  mp: number;
};

const getImageDataSourceStats = new Map<string, ReadbackSourceStats>();

if (typeof process !== 'undefined' && process.env.NODE_ENV === 'production') {
  CC_PERF.on = false;
}

const VERBOSE_STORAGE_KEY = 'vessel:cc-perf-verbose';

function resolveVerboseFlag(explicit?: boolean) {
  if (typeof explicit === 'boolean') {
    return explicit;
  }
  if (typeof window === 'undefined') {
    return false;
  }
  try {
    const stored = window.localStorage?.getItem(VERBOSE_STORAGE_KEY);
    if (stored === null) {
      return false;
    }
    return stored === '1' || stored === 'true';
  } catch {
    return false;
  }
}

function persistVerboseFlag(value: boolean) {
  if (typeof window === 'undefined') {
    return;
  }
  try {
    window.localStorage?.setItem(VERBOSE_STORAGE_KEY, value ? '1' : '0');
  } catch {
    // ignore storage errors (e.g., private browsing)
  }
}

function shouldLog() {
  return CC_PERF.on && CC_PERF.verbose;
}

function perfLog(...args: Parameters<typeof console.log>) {
  if (shouldLog()) {
    console.log(...args);
  }
}

function perfWarn(...args: Parameters<typeof console.warn>) {
  if (shouldLog()) {
    console.warn(...args);
  }
}

function resolveReadbackSourceFromStack(stack: string): string {
  const lines = stack.split('\n').map((line) => line.trim());
  const helperPaths = [
    '/src/utils/perf/ccPerfProbe.ts',
    '/src/utils/canvas/canvasImage.ts',
  ];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (
      !line ||
      line.includes('ccPerfProbe') ||
      line.includes('wrapMethod') ||
      line.includes('wrappedMethod')
    ) {
      continue;
    }
    if (line.includes('node_modules')) {
      continue;
    }
    if (helperPaths.some((path) => line.includes(path))) {
      continue;
    }
    const srcIndex = line.indexOf('/src/');
    if (srcIndex >= 0) {
      return line.slice(srcIndex);
    }
    if (line.startsWith('at ')) {
      return line.replace(/^at\s+/, '');
    }
  }
  return 'unknown';
}

function recordReadbackSource(dt: number, mp: number): void {
  if (!CC_PERF.captureReadbackSources) {
    return;
  }
  let source = 'unknown';
  try {
    const stack = new Error().stack;
    if (typeof stack === 'string') {
      source = resolveReadbackSourceFromStack(stack);
    }
  } catch {
    source = 'unknown';
  }

  const previous = getImageDataSourceStats.get(source) ?? { calls: 0, ms: 0, mp: 0 };
  previous.calls += 1;
  previous.ms += dt;
  previous.mp += mp;
  getImageDataSourceStats.set(source, previous);
}

type FillPath = 'gpu' | 'cpu' | 'worker';
type FillMode = 'concentric' | 'linear';

export function recordColorCycleFillPerf(meta: {
  path: FillPath;
  mode: FillMode;
  durationMs: number;
  area?: number;
  vertices?: number;
}) {
  if (!CC_PERF.on) {
    return;
  }
  const counterKey = meta.path === 'gpu'
    ? ('ccFillGpu' as const)
    : meta.path === 'worker'
      ? ('ccFillWorker' as const)
      : ('ccFillCpu' as const);
  const msKey = `${counterKey}Ms` as 'ccFillGpuMs' | 'ccFillCpuMs' | 'ccFillWorkerMs';
  const countKey = `${counterKey}Count` as 'ccFillGpuCount' | 'ccFillCpuCount' | 'ccFillWorkerCount';
  (CC_PERF.counters as Record<typeof msKey, number>)[msKey] += meta.durationMs;
  (CC_PERF.counters as Record<typeof countKey, number>)[countKey] += 1;
  perfLog('[perf] cc-fill', {
    path: meta.path,
    mode: meta.mode,
    dur: `${meta.durationMs.toFixed(2)}ms`,
    area: meta.area,
    verts: meta.vertices,
  });
}

export function recordColorCycleLayerRenderPerf(meta: {
  durationMs: number;
  visibleLayerCount: number;
  onlyActiveLayer: boolean;
}) {
  if (!CC_PERF.on) {
    return;
  }
  CC_PERF.counters.ccLayerRenderMs += meta.durationMs;
  CC_PERF.counters.ccLayerRenderTicks += 1;
  CC_PERF.counters.ccLayerRenderVisibleLayers += meta.visibleLayerCount;
  perfLog('[perf] cc-layer-render', {
    ms: meta.durationMs.toFixed(2),
    visibleLayerCount: meta.visibleLayerCount,
    onlyActiveLayer: meta.onlyActiveLayer,
  });
}

export function recordCanvasDrawPerf(meta: {
  durationMs: number;
  reason: 'main' | 'overlay-animation';
}) {
  if (!CC_PERF.on) {
    return;
  }
  CC_PERF.counters.canvasDrawMs += meta.durationMs;
  CC_PERF.counters.canvasDrawCalls += 1;
  perfLog('[perf] canvas-draw', {
    ms: meta.durationMs.toFixed(2),
    reason: meta.reason,
  });
}

export function resetPerfCounters() {
  Object.keys(CC_PERF.counters).forEach((key) => {
    const typedKey = key as keyof typeof CC_PERF.counters;
    CC_PERF.counters[typedKey] = 0;
  });
  getImageDataSourceStats.clear();
}

export function getPerfSnapshot() {
  const c = CC_PERF.counters;
  const ccLayerRenderAvgMs = c.ccLayerRenderTicks > 0
    ? c.ccLayerRenderMs / c.ccLayerRenderTicks
    : 0;
  const ccLayerRenderAvgVisibleLayers = c.ccLayerRenderTicks > 0
    ? c.ccLayerRenderVisibleLayers / c.ccLayerRenderTicks
    : 0;
  const canvasDrawAvgMs = c.canvasDrawCalls > 0 ? c.canvasDrawMs / c.canvasDrawCalls : 0;

  return {
    ...c,
    ccLayerRenderAvgMs,
    ccLayerRenderAvgVisibleLayers,
    canvasDrawAvgMs,
    readbackSourceCaptureEnabled: CC_PERF.captureReadbackSources,
  };
}

export function getTopReadbackSources(limit: number = 10) {
  const rows = Array.from(getImageDataSourceStats.entries()).map(([source, stats]) => ({
    source,
    calls: stats.calls,
    ms: Number(stats.ms.toFixed(2)),
    mp: Number(stats.mp.toFixed(3)),
    avgMs: Number((stats.ms / Math.max(1, stats.calls)).toFixed(3)),
  }));
  rows.sort((a, b) => b.ms - a.ms);
  return rows.slice(0, Math.max(1, limit));
}

export function perfMark(name: string) {
  if (!CC_PERF.on || typeof performance === 'undefined') return;
  performance.mark(name);
}

export function perfMeasure(name: string, start: string, end: string) {
  if (!CC_PERF.on || typeof performance === 'undefined') return;
  try {
    performance.measure(name, start, end);
  } catch {
    // swallow measure errors (usually missing marks)
  }
}

export async function timeAsync<T>(label: string, fn: () => Promise<T>): Promise<T> {
  if (!CC_PERF.on || typeof performance === 'undefined') {
    return fn();
  }
  const t0 = performance.now();
  try {
    return await fn();
  } finally {
    perfLog(`[perf] ${label}: ${(performance.now() - t0).toFixed(2)}ms`);
  }
}

export function timeSync<T>(label: string, fn: () => T): T {
  if (!CC_PERF.on || typeof performance === 'undefined') {
    return fn();
  }
  const t0 = performance.now();
  try {
    return fn();
  } finally {
    perfLog(`[perf] ${label}: ${(performance.now() - t0).toFixed(2)}ms`);
  }
}

export function enableLongTaskObserver() {
  if (!CC_PERF.on || typeof window === 'undefined' || !('PerformanceObserver' in window)) return;
  try {
    const observer = new PerformanceObserver(list => {
      for (const entry of list.getEntries()) {
        const attribution = (entry as PerformanceEntry & { attribution?: unknown }).attribution;
        perfWarn('[longtask]', {
          name: entry.name,
          dur: `${entry.duration.toFixed(1)}ms`,
          start: entry.startTime.toFixed(1),
          attr: attribution,
        });
      }
    });
    if (typeof PerformanceObserver !== 'undefined' && 'supportedEntryTypes' in PerformanceObserver) {
      const supported = (PerformanceObserver as typeof PerformanceObserver & { supportedEntryTypes?: string[] }).supportedEntryTypes;
      if (!supported || !supported.includes('longtask')) {
        return;
      }
    }
    observer.observe({ type: 'longtask', buffered: true });
  } catch {
    // ignore observer errors
  }
}

export function enableEventTiming() {
  if (!CC_PERF.on || typeof window === 'undefined' || !('PerformanceObserver' in window)) return;
  try {
    const observer = new PerformanceObserver(list => {
      for (const entry of list.getEntries() as PerformanceEventTiming[]) {
        if (entry.name === 'pointerup' || entry.name === 'click') {
          perfLog('[event]', entry.name, {
            dur: `${entry.duration?.toFixed(2)}ms`,
            processingStart: `${(entry.processingStart - entry.startTime).toFixed(2)}ms`,
            processingEnd: `${(entry.processingEnd - entry.processingStart).toFixed(2)}ms`,
            interactionId: 'interactionId' in entry ? (entry as { interactionId?: unknown }).interactionId : undefined,
          });
        }
      }
    });
    if (typeof PerformanceObserver !== 'undefined' && 'supportedEntryTypes' in PerformanceObserver) {
      const supported = (PerformanceObserver as typeof PerformanceObserver & { supportedEntryTypes?: string[] }).supportedEntryTypes;
      if (!supported || !supported.includes('event')) {
        return;
      }
    }
    const eventInit: PerformanceObserverInit & { durationThreshold?: number } = {
      type: 'event',
      buffered: true,
      durationThreshold: 16,
    };
    observer.observe(eventInit);
  } catch {
    // ignore observer errors
  }
}

function wrapMethod<T extends object, K extends keyof T>(
  obj: T,
  key: K,
  label: string,
  before?: (...args: unknown[]) => void,
  after?: (ms: number, args: unknown[]) => void
) {
  const original = obj[key];
  if (typeof original !== 'function') return;
  const wrapped = function wrappedMethod(this: unknown, ...args: unknown[]) {
    before?.(...args);
    const t0 = performance.now();
    try {
      return (original as AnyFn).apply(this, args);
    } finally {
      const dt = performance.now() - t0;
      after?.(dt, args);
      if (dt > 16) {
        perfLog(`[perf] ${label} ${dt.toFixed(2)}ms`, { args });
      }
    }
  };
  Reflect.set(obj, key, wrapped);
}

export function wrapCanvasReadbacks() {
  if (!CC_PERF.on || typeof window === 'undefined') return;
  const proto = window.CanvasRenderingContext2D?.prototype;
  if (proto) {
    wrapMethod(
      proto,
      'getImageData',
      'getImageData',
      undefined,
      (dt, args) => {
        const [x, y, w, h] = args as [number, number, number, number];
        const mp = (w * h) / 1e6;
        CC_PERF.counters.getImageDataCalls += 1;
        CC_PERF.counters.getImageDataMp += mp;
        CC_PERF.counters.getImageDataMs += dt;
        recordReadbackSource(dt, mp);
        perfLog('[perf] getImageData', {
          x,
          y,
          w,
          h,
          mp: mp.toFixed(3),
          ms: dt.toFixed(2),
        });
      }
    );
    wrapMethod(proto, 'putImageData', 'putImageData');
    wrapMethod(proto, 'drawImage', 'drawImage');
  }
  const offscreenContextCtor = (window as typeof window & {
    OffscreenCanvasRenderingContext2D?: { prototype: CanvasRenderingContext2D };
  }).OffscreenCanvasRenderingContext2D;
  const offscreenProto = offscreenContextCtor?.prototype;
  if (offscreenProto) {
    wrapMethod(
      offscreenProto,
      'getImageData',
      'offscr.getImageData',
      undefined,
      (dt, args) => {
        const [x, y, w, h] = args as [number, number, number, number];
        perfLog('[perf] offscr.getImageData', { x, y, w, h, ms: dt.toFixed(2) });
      }
    );
  }
}

export function wrapAppHotspots(opts: {
  captureColorCycleBrushState?: AnyFn;
  commitLayerHistory?: AnyFn;
}) {
  if (opts.captureColorCycleBrushState) {
    const original = opts.captureColorCycleBrushState;
    opts.captureColorCycleBrushState = function wrappedCapture(...args: unknown[]) {
      const t0 = performance.now();
      try {
        return original(...args);
      } finally {
        const ms = performance.now() - t0;
        CC_PERF.counters.serializeMs += ms;
        if (ms > 8) {
          const [layerId] = args;
          perfLog('[perf] captureColorCycleBrushState', `${ms.toFixed(2)}ms`, {
            layerId: typeof layerId === 'string' ? layerId : undefined,
          });
        }
      }
    };
  }
  if (opts.commitLayerHistory) {
    const original = opts.commitLayerHistory;
    opts.commitLayerHistory = async function wrappedCommit(...args: unknown[]) {
      const t0 = performance.now();
      try {
        return await original(...args);
      } finally {
        const ms = performance.now() - t0;
        CC_PERF.counters.commits += 1;
        CC_PERF.counters.commitMs += ms;
        if (ms > 16) {
          perfLog('[perf] commitLayerHistory', `${ms.toFixed(2)}ms`, args[0]);
        }
      }
    };
  }
  return opts;
}

export function printPerfSummary() {
  const snapshot = getPerfSnapshot();
  console.table({
    getImageDataCalls: snapshot.getImageDataCalls,
    getImageDataMP_total: snapshot.getImageDataMp.toFixed(2),
    getImageDataMs_total: snapshot.getImageDataMs.toFixed(1),
    serializeMs_total: snapshot.serializeMs.toFixed(1),
    commits: snapshot.commits,
    commitMs_total: snapshot.commitMs.toFixed(1),
    ccFillGpu: `${snapshot.ccFillGpuCount} / ${snapshot.ccFillGpuMs.toFixed(1)}ms`,
    ccFillCpu: `${snapshot.ccFillCpuCount} / ${snapshot.ccFillCpuMs.toFixed(1)}ms`,
    ccFillWorker: `${snapshot.ccFillWorkerCount} / ${snapshot.ccFillWorkerMs.toFixed(1)}ms`,
    ccLayerRender: `${snapshot.ccLayerRenderTicks} / ${snapshot.ccLayerRenderMs.toFixed(1)}ms total`,
    ccLayerRenderAvgMs: snapshot.ccLayerRenderAvgMs.toFixed(2),
    ccLayerRenderAvgVisibleLayers: snapshot.ccLayerRenderAvgVisibleLayers.toFixed(2),
    canvasDraw: `${snapshot.canvasDrawCalls} / ${snapshot.canvasDrawMs.toFixed(1)}ms total`,
    canvasDrawAvgMs: snapshot.canvasDrawAvgMs.toFixed(2),
    readbackSourceCaptureEnabled: snapshot.readbackSourceCaptureEnabled ? 'yes' : 'no',
  });
  if (CC_PERF.captureReadbackSources) {
    console.table(getTopReadbackSources(10));
  }
}

export function enableCCPerfProbe<
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  Capture extends (...args: any[]) => unknown,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  Commit extends (...args: any[]) => unknown
>(globals?: {
  captureColorCycleBrushState?: Capture;
  commitLayerHistory?: Commit;
}, options?: { verbose?: boolean }) {
  if (!CC_PERF.on) {
    return globals;
  }
  CC_PERF.verbose = resolveVerboseFlag(options?.verbose);
  if (typeof window !== 'undefined') {
    const scope = window as typeof window & {
      setCCPerfVerbose?: (value: boolean) => void;
      vesselCCPerf?: {
        snapshot: typeof getPerfSnapshot;
        reset: typeof resetPerfCounters;
        print: typeof printPerfSummary;
        topReadbacks: typeof getTopReadbackSources;
        setReadbackSourceCapture: (value: boolean) => void;
      };
    };
    scope.setCCPerfVerbose = value => {
      CC_PERF.verbose = value;
      persistVerboseFlag(value);
    };
    scope.vesselCCPerf = {
      snapshot: getPerfSnapshot,
      reset: resetPerfCounters,
      print: printPerfSummary,
      topReadbacks: getTopReadbackSources,
      setReadbackSourceCapture: (value: boolean) => {
        CC_PERF.captureReadbackSources = value;
      },
    };
  }
  enableLongTaskObserver();
  enableEventTiming();
  wrapCanvasReadbacks();
  if (globals) {
    wrapAppHotspots({
      captureColorCycleBrushState: typeof globals.captureColorCycleBrushState === 'function'
        ? (globals.captureColorCycleBrushState as unknown as AnyFn)
        : undefined,
      commitLayerHistory: typeof globals.commitLayerHistory === 'function'
        ? (globals.commitLayerHistory as unknown as AnyFn)
        : undefined,
    });
  }
  perfLog('[perf] CC probe enabled');
  persistVerboseFlag(CC_PERF.verbose);
  return globals;
}
