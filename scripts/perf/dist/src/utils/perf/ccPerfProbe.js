"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CC_PERF = void 0;
exports.recordColorCycleFillPerf = recordColorCycleFillPerf;
exports.perfMark = perfMark;
exports.perfMeasure = perfMeasure;
exports.timeAsync = timeAsync;
exports.timeSync = timeSync;
exports.enableLongTaskObserver = enableLongTaskObserver;
exports.enableEventTiming = enableEventTiming;
exports.wrapCanvasReadbacks = wrapCanvasReadbacks;
exports.wrapAppHotspots = wrapAppHotspots;
exports.printPerfSummary = printPerfSummary;
exports.enableCCPerfProbe = enableCCPerfProbe;
exports.CC_PERF = {
    on: true,
    verbose: false,
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
    },
};
if (typeof process !== 'undefined' && process.env.NODE_ENV === 'production') {
    exports.CC_PERF.on = false;
}
const VERBOSE_STORAGE_KEY = 'vessel:cc-perf-verbose';
function resolveVerboseFlag(explicit) {
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
    }
    catch {
        return false;
    }
}
function persistVerboseFlag(value) {
    if (typeof window === 'undefined') {
        return;
    }
    try {
        window.localStorage?.setItem(VERBOSE_STORAGE_KEY, value ? '1' : '0');
    }
    catch {
        // ignore storage errors (e.g., private browsing)
    }
}
function shouldLog() {
    return exports.CC_PERF.on && exports.CC_PERF.verbose;
}
function perfLog(...args) {
    if (shouldLog()) {
        console.log(...args);
    }
}
function perfWarn(...args) {
    if (shouldLog()) {
        console.warn(...args);
    }
}
function recordColorCycleFillPerf(meta) {
    if (!exports.CC_PERF.on) {
        return;
    }
    const counterKey = meta.path === 'gpu'
        ? 'ccFillGpu'
        : meta.path === 'worker'
            ? 'ccFillWorker'
            : 'ccFillCpu';
    const msKey = `${counterKey}Ms`;
    const countKey = `${counterKey}Count`;
    exports.CC_PERF.counters[msKey] += meta.durationMs;
    exports.CC_PERF.counters[countKey] += 1;
    perfLog('[perf] cc-fill', {
        path: meta.path,
        mode: meta.mode,
        dur: `${meta.durationMs.toFixed(2)}ms`,
        area: meta.area,
        verts: meta.vertices,
    });
}
function perfMark(name) {
    if (!exports.CC_PERF.on || typeof performance === 'undefined')
        return;
    performance.mark(name);
}
function perfMeasure(name, start, end) {
    if (!exports.CC_PERF.on || typeof performance === 'undefined')
        return;
    try {
        performance.measure(name, start, end);
    }
    catch {
        // swallow measure errors (usually missing marks)
    }
}
async function timeAsync(label, fn) {
    if (!exports.CC_PERF.on || typeof performance === 'undefined') {
        return fn();
    }
    const t0 = performance.now();
    try {
        return await fn();
    }
    finally {
        perfLog(`[perf] ${label}: ${(performance.now() - t0).toFixed(2)}ms`);
    }
}
function timeSync(label, fn) {
    if (!exports.CC_PERF.on || typeof performance === 'undefined') {
        return fn();
    }
    const t0 = performance.now();
    try {
        return fn();
    }
    finally {
        perfLog(`[perf] ${label}: ${(performance.now() - t0).toFixed(2)}ms`);
    }
}
function enableLongTaskObserver() {
    if (!exports.CC_PERF.on || typeof window === 'undefined' || !('PerformanceObserver' in window))
        return;
    try {
        const observer = new PerformanceObserver(list => {
            for (const entry of list.getEntries()) {
                const attribution = entry.attribution;
                perfWarn('[longtask]', {
                    name: entry.name,
                    dur: `${entry.duration.toFixed(1)}ms`,
                    start: entry.startTime.toFixed(1),
                    attr: attribution,
                });
            }
        });
        if (typeof PerformanceObserver !== 'undefined' && 'supportedEntryTypes' in PerformanceObserver) {
            const supported = PerformanceObserver.supportedEntryTypes;
            if (!supported || !supported.includes('longtask')) {
                return;
            }
        }
        observer.observe({ type: 'longtask', buffered: true });
    }
    catch {
        // ignore observer errors
    }
}
function enableEventTiming() {
    if (!exports.CC_PERF.on || typeof window === 'undefined' || !('PerformanceObserver' in window))
        return;
    try {
        const observer = new PerformanceObserver(list => {
            for (const entry of list.getEntries()) {
                if (entry.name === 'pointerup' || entry.name === 'click') {
                    perfLog('[event]', entry.name, {
                        dur: `${entry.duration?.toFixed(2)}ms`,
                        processingStart: `${(entry.processingStart - entry.startTime).toFixed(2)}ms`,
                        processingEnd: `${(entry.processingEnd - entry.processingStart).toFixed(2)}ms`,
                        interactionId: 'interactionId' in entry ? entry.interactionId : undefined,
                    });
                }
            }
        });
        if (typeof PerformanceObserver !== 'undefined' && 'supportedEntryTypes' in PerformanceObserver) {
            const supported = PerformanceObserver.supportedEntryTypes;
            if (!supported || !supported.includes('event')) {
                return;
            }
        }
        const eventInit = {
            type: 'event',
            buffered: true,
            durationThreshold: 16,
        };
        observer.observe(eventInit);
    }
    catch {
        // ignore observer errors
    }
}
function wrapMethod(obj, key, label, before, after) {
    const original = obj[key];
    if (typeof original !== 'function')
        return;
    const wrapped = function wrappedMethod(...args) {
        before?.(...args);
        const t0 = performance.now();
        try {
            return original.apply(this, args);
        }
        finally {
            const dt = performance.now() - t0;
            after?.(dt, args);
            if (dt > 16) {
                perfLog(`[perf] ${label} ${dt.toFixed(2)}ms`, { args });
            }
        }
    };
    Reflect.set(obj, key, wrapped);
}
function wrapCanvasReadbacks() {
    if (!exports.CC_PERF.on || typeof window === 'undefined')
        return;
    const proto = window.CanvasRenderingContext2D?.prototype;
    if (proto) {
        wrapMethod(proto, 'getImageData', 'getImageData', undefined, (dt, args) => {
            const [x, y, w, h] = args;
            const mp = (w * h) / 1e6;
            exports.CC_PERF.counters.getImageDataCalls += 1;
            exports.CC_PERF.counters.getImageDataMp += mp;
            exports.CC_PERF.counters.getImageDataMs += dt;
            perfLog('[perf] getImageData', {
                x,
                y,
                w,
                h,
                mp: mp.toFixed(3),
                ms: dt.toFixed(2),
            });
        });
        wrapMethod(proto, 'putImageData', 'putImageData');
        wrapMethod(proto, 'drawImage', 'drawImage');
    }
    const offscreenContextCtor = window.OffscreenCanvasRenderingContext2D;
    const offscreenProto = offscreenContextCtor?.prototype;
    if (offscreenProto) {
        wrapMethod(offscreenProto, 'getImageData', 'offscr.getImageData', undefined, (dt, args) => {
            const [x, y, w, h] = args;
            perfLog('[perf] offscr.getImageData', { x, y, w, h, ms: dt.toFixed(2) });
        });
    }
}
function wrapAppHotspots(opts) {
    if (opts.captureColorCycleBrushState) {
        const original = opts.captureColorCycleBrushState;
        opts.captureColorCycleBrushState = function wrappedCapture(...args) {
            const t0 = performance.now();
            try {
                return original(...args);
            }
            finally {
                const ms = performance.now() - t0;
                exports.CC_PERF.counters.serializeMs += ms;
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
        opts.commitLayerHistory = async function wrappedCommit(...args) {
            const t0 = performance.now();
            try {
                return await original(...args);
            }
            finally {
                const ms = performance.now() - t0;
                exports.CC_PERF.counters.commits += 1;
                exports.CC_PERF.counters.commitMs += ms;
                if (ms > 16) {
                    perfLog('[perf] commitLayerHistory', `${ms.toFixed(2)}ms`, args[0]);
                }
            }
        };
    }
    return opts;
}
function printPerfSummary() {
    const c = exports.CC_PERF.counters;
    console.table({
        getImageDataCalls: c.getImageDataCalls,
        getImageDataMP_total: c.getImageDataMp.toFixed(2),
        getImageDataMs_total: c.getImageDataMs.toFixed(1),
        serializeMs_total: c.serializeMs.toFixed(1),
        commits: c.commits,
        commitMs_total: c.commitMs.toFixed(1),
        ccFillGpu: `${c.ccFillGpuCount} / ${c.ccFillGpuMs.toFixed(1)}ms`,
        ccFillCpu: `${c.ccFillCpuCount} / ${c.ccFillCpuMs.toFixed(1)}ms`,
        ccFillWorker: `${c.ccFillWorkerCount} / ${c.ccFillWorkerMs.toFixed(1)}ms`,
    });
}
function enableCCPerfProbe(globals, options) {
    if (!exports.CC_PERF.on) {
        return globals;
    }
    exports.CC_PERF.verbose = resolveVerboseFlag(options?.verbose);
    if (typeof window !== 'undefined') {
        window.setCCPerfVerbose = value => {
            exports.CC_PERF.verbose = value;
            persistVerboseFlag(value);
        };
    }
    enableLongTaskObserver();
    enableEventTiming();
    wrapCanvasReadbacks();
    if (globals) {
        wrapAppHotspots({
            captureColorCycleBrushState: typeof globals.captureColorCycleBrushState === 'function'
                ? globals.captureColorCycleBrushState
                : undefined,
            commitLayerHistory: typeof globals.commitLayerHistory === 'function'
                ? globals.commitLayerHistory
                : undefined,
        });
    }
    perfLog('[perf] CC probe enabled');
    persistVerboseFlag(exports.CC_PERF.verbose);
    return globals;
}
