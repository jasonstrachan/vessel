type AnyFn = (...args: unknown[]) => unknown;

export const CC_PERF = {
  on: true,
  counters: {
    getImageDataCalls: 0,
    getImageDataMp: 0,
    getImageDataMs: 0,
    commits: 0,
    serializeMs: 0,
    commitMs: 0,
  },
};

if (typeof process !== 'undefined' && process.env.NODE_ENV === 'production') {
  CC_PERF.on = false;
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
    console.log(`[perf] ${label}: ${(performance.now() - t0).toFixed(2)}ms`);
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
    console.log(`[perf] ${label}: ${(performance.now() - t0).toFixed(2)}ms`);
  }
}

export function enableLongTaskObserver() {
  if (!CC_PERF.on || typeof window === 'undefined' || !('PerformanceObserver' in window)) return;
  try {
    const po = new PerformanceObserver(list => {
      for (const entry of list.getEntries()) {
        const attribution = (entry as PerformanceEntry & { attribution?: unknown }).attribution;
        console.warn('[longtask]', {
          name: entry.name,
          dur: `${entry.duration.toFixed(1)}ms`,
          start: entry.startTime.toFixed(1),
          attr: attribution,
        });
      }
    });
    po.observe({ entryTypes: ['longtask'], buffered: true });
  } catch {
    // ignore observer errors
  }
}

export function enableEventTiming() {
  if (!CC_PERF.on || typeof window === 'undefined' || !('PerformanceObserver' in window)) return;
  try {
    const po = new PerformanceObserver(list => {
      for (const entry of list.getEntries() as PerformanceEventTiming[]) {
        if (entry.name === 'pointerup' || entry.name === 'click') {
          console.log('[event]', entry.name, {
            dur: `${entry.duration?.toFixed(2)}ms`,
            processingStart: `${(entry.processingStart - entry.startTime).toFixed(2)}ms`,
            processingEnd: `${(entry.processingEnd - entry.processingStart).toFixed(2)}ms`,
            interactionId: 'interactionId' in entry ? (entry as { interactionId?: unknown }).interactionId : undefined,
          });
        }
      }
    });
    po.observe({ entryTypes: ['event'], buffered: true });
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
        console.log(`[perf] ${label} ${dt.toFixed(2)}ms`, { args });
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
        console.log('[perf] getImageData', {
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
        console.log('[perf] offscr.getImageData', { x, y, w, h, ms: dt.toFixed(2) });
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
          console.log('[perf] captureColorCycleBrushState', `${ms.toFixed(2)}ms`, {
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
          console.log('[perf] commitLayerHistory', `${ms.toFixed(2)}ms`, args[0]);
        }
      }
    };
  }
  return opts;
}

export function printPerfSummary() {
  const c = CC_PERF.counters;
  console.table({
    getImageDataCalls: c.getImageDataCalls,
    getImageDataMP_total: c.getImageDataMp.toFixed(2),
    getImageDataMs_total: c.getImageDataMs.toFixed(1),
    serializeMs_total: c.serializeMs.toFixed(1),
    commits: c.commits,
    commitMs_total: c.commitMs.toFixed(1),
  });
}

export function enableCCPerfProbe<
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  Capture extends (...args: any[]) => unknown,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  Commit extends (...args: any[]) => unknown
>(globals?: {
  captureColorCycleBrushState?: Capture;
  commitLayerHistory?: Commit;
}) {
  if (!CC_PERF.on) {
    return globals;
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
  console.log('[perf] CC probe enabled');
  return globals;
}
