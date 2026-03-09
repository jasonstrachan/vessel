type PerfCounters = {
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

const createEmptyCounters = (): PerfCounters => ({
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
};

export function recordColorCycleFillPerf(args: {
  path: 'gpu' | 'cpu' | 'worker';
  mode: 'concentric' | 'linear';
  durationMs: number;
  area?: number;
  vertices?: number;
}) {
  void args;
}

export function recordColorCycleLayerRenderPerf(args: {
  durationMs: number;
  visibleLayerCount: number;
  onlyActiveLayer: boolean;
}) {
  void args;
}

export function recordCanvasDrawPerf(args: {
  durationMs: number;
  reason: 'main' | 'overlay-animation';
}) {
  void args;
}

export function resetPerfCounters() {
  Object.assign(CC_PERF.counters, createEmptyCounters());
}

export function getPerfSnapshot() {
  return {
    ...CC_PERF.counters,
    ccLayerRenderAvgMs: 0,
    ccLayerRenderAvgVisibleLayers: 0,
    canvasDrawAvgMs: 0,
    readbackSourceCaptureEnabled: false,
  };
}

export function getTopReadbackSources(limit: number = 10) {
  void limit;
  return [];
}

export function perfMark(name: string) {
  void name;
}

export function perfMeasure(name: string, start: string, end: string) {
  void name;
  void start;
  void end;
}

export async function timeAsync<T>(label: string, fn: () => Promise<T>): Promise<T> {
  void label;
  return fn();
}

export function timeSync<T>(label: string, fn: () => T): T {
  void label;
  return fn();
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
  void options;
  return globals;
}
