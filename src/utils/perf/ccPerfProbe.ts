export type ColorCycleRuntimePerfEvent =
  | 'playbackTick'
  | 'animatorRender'
  | 'animatorRenderGpu'
  | 'animatorRenderCpu'
  | 'presenterComposite'
  | 'forcedDirectRender'
  | 'frameReadyPublication'
  | 'segmentRefresh'
  | 'presentationFlush'
  | 'presentedLayerSurface'
  | 'mainRedrawRequest';

type RuntimePerfCounters = {
  playbackTicks: number;
  animatorRenderCalls: number;
  animatorGpuRenderCalls: number;
  animatorCpuRenderCalls: number;
  presenterCompositeCalls: number;
  forcedDirectRenders: number;
  frameReadyPublications: number;
  segmentRefreshPasses: number;
  presentationFlushes: number;
  presentedLayerSurfaces: number;
  mainRedrawRequests: number;
};

type PerfCounters = RuntimePerfCounters & {
  getImageDataCalls: number;
  getImageDataMp: number;
  getImageDataMs: number;
  commits: number;
  serializeMs: number;
  commitMs: number;
  ccFillGpuMs: number;
  ccFillGpuCount: number;
  ccFillCpuMs: number;
  ccFillCpuCount: number;
  ccFillWorkerMs: number;
  ccFillWorkerCount: number;
  ccLayerRenderMs: number;
  ccLayerRenderTicks: number;
  ccLayerRenderVisibleLayers: number;
  canvasDrawMs: number;
  canvasDrawCalls: number;
};

type LayerPerfCounters = Pick<
  RuntimePerfCounters,
  | 'playbackTicks'
  | 'animatorRenderCalls'
  | 'animatorGpuRenderCalls'
  | 'animatorCpuRenderCalls'
  | 'presentedLayerSurfaces'
>;

const createEmptyRuntimeCounters = (): RuntimePerfCounters => ({
  playbackTicks: 0,
  animatorRenderCalls: 0,
  animatorGpuRenderCalls: 0,
  animatorCpuRenderCalls: 0,
  presenterCompositeCalls: 0,
  forcedDirectRenders: 0,
  frameReadyPublications: 0,
  segmentRefreshPasses: 0,
  presentationFlushes: 0,
  presentedLayerSurfaces: 0,
  mainRedrawRequests: 0,
});

const createEmptyLayerCounters = (): LayerPerfCounters => ({
  playbackTicks: 0,
  animatorRenderCalls: 0,
  animatorGpuRenderCalls: 0,
  animatorCpuRenderCalls: 0,
  presentedLayerSurfaces: 0,
});

const createEmptyCounters = (): PerfCounters => ({
  ...createEmptyRuntimeCounters(),
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
});

export const CC_PERF = {
  on: false,
  verbose: false,
  captureReadbackSources: false,
  counters: createEmptyCounters(),
  layerCounters: new Map<string, LayerPerfCounters>(),
};

const runtimeCounterByEvent: Record<ColorCycleRuntimePerfEvent, keyof RuntimePerfCounters> = {
  playbackTick: 'playbackTicks',
  animatorRender: 'animatorRenderCalls',
  animatorRenderGpu: 'animatorGpuRenderCalls',
  animatorRenderCpu: 'animatorCpuRenderCalls',
  presenterComposite: 'presenterCompositeCalls',
  forcedDirectRender: 'forcedDirectRenders',
  frameReadyPublication: 'frameReadyPublications',
  segmentRefresh: 'segmentRefreshPasses',
  presentationFlush: 'presentationFlushes',
  presentedLayerSurface: 'presentedLayerSurfaces',
  mainRedrawRequest: 'mainRedrawRequests',
};

const layerCounterEvents = new Set<ColorCycleRuntimePerfEvent>([
  'playbackTick',
  'animatorRender',
  'animatorRenderGpu',
  'animatorRenderCpu',
  'presentedLayerSurface',
]);

export function recordColorCycleRuntimePerf(
  event: ColorCycleRuntimePerfEvent,
  options?: { layerId?: string | null; amount?: number },
): void {
  if (!CC_PERF.on) {
    return;
  }
  const amount = Number.isFinite(options?.amount) ? Number(options?.amount) : 1;
  const counter = runtimeCounterByEvent[event];
  CC_PERF.counters[counter] += amount;

  const layerId = options?.layerId;
  if (!layerId || !layerCounterEvents.has(event)) {
    return;
  }
  const layerCounters = CC_PERF.layerCounters.get(layerId) ?? createEmptyLayerCounters();
  if (!CC_PERF.layerCounters.has(layerId)) {
    CC_PERF.layerCounters.set(layerId, layerCounters);
  }
  const layerCounter = counter as keyof LayerPerfCounters;
  layerCounters[layerCounter] += amount;
}

export function recordColorCycleFillPerf(args: {
  path: 'gpu' | 'cpu' | 'worker';
  mode: 'concentric' | 'linear';
  durationMs: number;
  area?: number;
  vertices?: number;
}) {
  if (!CC_PERF.on || !Number.isFinite(args.durationMs)) {
    return;
  }
  const durationMs = Math.max(0, args.durationMs);
  if (args.path === 'gpu') {
    CC_PERF.counters.ccFillGpuMs += durationMs;
    CC_PERF.counters.ccFillGpuCount += 1;
  } else if (args.path === 'worker') {
    CC_PERF.counters.ccFillWorkerMs += durationMs;
    CC_PERF.counters.ccFillWorkerCount += 1;
  } else {
    CC_PERF.counters.ccFillCpuMs += durationMs;
    CC_PERF.counters.ccFillCpuCount += 1;
  }
}

export function recordColorCycleLayerRenderPerf(args: {
  durationMs: number;
  visibleLayerCount: number;
  onlyActiveLayer: boolean;
}) {
  if (!CC_PERF.on || !Number.isFinite(args.durationMs)) {
    return;
  }
  CC_PERF.counters.ccLayerRenderMs += Math.max(0, args.durationMs);
  CC_PERF.counters.ccLayerRenderTicks += 1;
  CC_PERF.counters.ccLayerRenderVisibleLayers += Math.max(0, args.visibleLayerCount);
}

export function recordCanvasDrawPerf(args: {
  durationMs: number;
  reason: 'main' | 'overlay-animation';
}) {
  if (!CC_PERF.on || !Number.isFinite(args.durationMs)) {
    return;
  }
  CC_PERF.counters.canvasDrawMs += Math.max(0, args.durationMs);
  CC_PERF.counters.canvasDrawCalls += 1;
}

export function resetPerfCounters() {
  Object.assign(CC_PERF.counters, createEmptyCounters());
  CC_PERF.layerCounters.clear();
}

export function getPerfSnapshot() {
  const counters = CC_PERF.counters;
  return {
    ...counters,
    ccLayerRenderAvgMs: counters.ccLayerRenderTicks > 0
      ? counters.ccLayerRenderMs / counters.ccLayerRenderTicks
      : 0,
    ccLayerRenderAvgVisibleLayers: counters.ccLayerRenderTicks > 0
      ? counters.ccLayerRenderVisibleLayers / counters.ccLayerRenderTicks
      : 0,
    canvasDrawAvgMs: counters.canvasDrawCalls > 0
      ? counters.canvasDrawMs / counters.canvasDrawCalls
      : 0,
    readbackSourceCaptureEnabled: CC_PERF.captureReadbackSources,
    enabled: CC_PERF.on,
    layers: Object.fromEntries(
      Array.from(CC_PERF.layerCounters.entries(), ([layerId, layerCounters]) => [
        layerId,
        { ...layerCounters },
      ]),
    ),
  };
}

export function getTopReadbackSources(limit: number = 10) {
  void limit;
  return [];
}

export function perfMark(name: string) {
  if (!CC_PERF.on || typeof performance === 'undefined') {
    return;
  }
  performance.mark(name);
}

export function perfMeasure(name: string, start: string, end: string) {
  if (!CC_PERF.on || typeof performance === 'undefined') {
    return;
  }
  try {
    performance.measure(name, start, end);
  } catch {}
}

export async function timeAsync<T>(label: string, fn: () => Promise<T>): Promise<T> {
  if (!CC_PERF.on || typeof performance === 'undefined') {
    return fn();
  }
  const start = performance.now();
  try {
    return await fn();
  } finally {
    if (CC_PERF.verbose) {
      performance.measure(label, { start, end: performance.now() });
    }
  }
}

export function timeSync<T>(label: string, fn: () => T): T {
  if (!CC_PERF.on || typeof performance === 'undefined') {
    return fn();
  }
  const start = performance.now();
  try {
    return fn();
  } finally {
    if (CC_PERF.verbose) {
      performance.measure(label, { start, end: performance.now() });
    }
  }
}

export function enableLongTaskObserver() {}

export function enableEventTiming() {}

export function wrapCanvasReadbacks() {}

export function wrapAppHotspots<T extends Record<string, unknown>>(opts: T): T {
  return opts;
}

export function printPerfSummary() {}

export function enableCCPerfProbe<T extends Record<string, unknown>>(
  globals?: T,
  options?: { verbose?: boolean }
): T | undefined {
  CC_PERF.on = true;
  CC_PERF.verbose = Boolean(options?.verbose);
  if (globals) {
    const perfGlobals = globals as Record<string, unknown>;
    perfGlobals.CC_PERF = CC_PERF;
    perfGlobals.__VESSEL_CC_PERF__ = {
      disable: () => {
        CC_PERF.on = false;
      },
      enable: (verbose = false) => {
        CC_PERF.on = true;
        CC_PERF.verbose = verbose;
      },
      reset: resetPerfCounters,
      snapshot: getPerfSnapshot,
    };
  }
  return globals;
}

if (typeof globalThis !== 'undefined') {
  const globals = globalThis as Record<string, unknown>;
  if (!globals.__VESSEL_CC_PERF__) {
    globals.__VESSEL_CC_PERF__ = {
      disable: () => {
        CC_PERF.on = false;
      },
      enable: (verbose = false) => {
        CC_PERF.on = true;
        CC_PERF.verbose = verbose;
      },
      reset: resetPerfCounters,
      snapshot: getPerfSnapshot,
    };
  }
}
