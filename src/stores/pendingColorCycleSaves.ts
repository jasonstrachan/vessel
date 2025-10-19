import type { FinalizeQueue } from '@/lib/canvas/FinalizeQueue';

const pendingCounts = new Map<string, number>();
const layerWaiters = new Map<string, Array<(error?: unknown) => void>>();
let finalizeQueueInstance: FinalizeQueue | null = null;

const notifyWaiters = (layerId: string, error?: unknown) => {
  const waiters = layerWaiters.get(layerId);
  if (!waiters || waiters.length === 0) {
    return;
  }
  layerWaiters.delete(layerId);
  waiters.forEach(callback => {
    try {
      callback(error);
    } catch (callbackError) {
      if (process.env.NODE_ENV !== 'production') {
        console.error('[cc-pending-saves] waiter callback failed', callbackError);
      }
    }
  });
};

export const markPendingColorCycleSaveStart = (layerId: string): void => {
  const nextCount = (pendingCounts.get(layerId) ?? 0) + 1;
  pendingCounts.set(layerId, nextCount);
};

export const markPendingColorCycleSaveEnd = (layerId: string, error?: unknown): void => {
  if (!pendingCounts.has(layerId)) {
    return;
  }
  const nextCount = (pendingCounts.get(layerId) ?? 1) - 1;
  if (nextCount <= 0) {
    pendingCounts.delete(layerId);
    notifyWaiters(layerId, error);
  } else {
    pendingCounts.set(layerId, nextCount);
  }
};

export const waitForPendingColorCycleSaves = async (layerId: string): Promise<void> => {
  if (!pendingCounts.has(layerId)) {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    const waiters = layerWaiters.get(layerId) ?? [];
    waiters.push(error => {
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    });
    layerWaiters.set(layerId, waiters);
  });
};

export const registerFinalizeQueue = (queue: FinalizeQueue | null): void => {
  finalizeQueueInstance = queue;
};

export const waitForFinalizeQueueIdle = async (layerId?: string): Promise<void> => {
  if (!finalizeQueueInstance) {
    return;
  }
  await finalizeQueueInstance.whenIdle(layerId);
};
