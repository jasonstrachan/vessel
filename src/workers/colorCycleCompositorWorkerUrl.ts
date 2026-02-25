export const getColorCycleCompositorWorkerUrl = (): URL => {
  return new URL('./colorCycleCompositor.worker.js', import.meta.url);
};
