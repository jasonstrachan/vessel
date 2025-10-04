import { ShapeFillScheduler } from './ShapeFillScheduler';

let schedulerInstance: ShapeFillScheduler | null = null;

export const getShapeFillScheduler = (): ShapeFillScheduler => {
  if (!schedulerInstance) {
    schedulerInstance = new ShapeFillScheduler({
      cacheResultsByDefault: true,
    });
  }
  return schedulerInstance;
};

export const resetShapeFillScheduler = (): void => {
  schedulerInstance?.clearCache();
};

export const disposeShapeFillScheduler = (): void => {
  schedulerInstance?.destroy();
  schedulerInstance = null;
};
