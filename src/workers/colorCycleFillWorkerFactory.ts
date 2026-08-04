export const createColorCycleFillWorker = (): Worker => new Worker(
  new URL('./colorCycleFill.worker.ts', import.meta.url),
  { type: 'module' },
);
