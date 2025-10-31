import type { FinalizeQueue } from '@/lib/canvas/FinalizeQueue';

const pendingPromises = new Map<string, Set<Promise<void>>>();
let finalizeQueueInstance: FinalizeQueue | null = null;

const settlePromise = (layerId: string, promise: Promise<void>, error?: unknown) => {
  const entries = pendingPromises.get(layerId);
  if (!entries) {
    return;
  }

  entries.delete(promise);
  if (entries.size === 0) {
    pendingPromises.delete(layerId);
    if (error && process.env.NODE_ENV !== 'production') {
      console.error('[cc-pending-saves] pending promise rejected', { layerId, error });
    }
  }
};

export const trackPendingColorCycleSave = (layerId: string, promise: Promise<void>): void => {
  let entries = pendingPromises.get(layerId);
  if (!entries) {
    entries = new Set<Promise<void>>();
    pendingPromises.set(layerId, entries);
  }

  entries.add(promise);

  promise.then(
    () => {
      settlePromise(layerId, promise);
    },
    (error) => {
      settlePromise(layerId, promise, error);
    },
  );
};

export const waitForPendingColorCycleSaves = async (layerId: string): Promise<void> => {
  // Loop to account for new promises being registered while we await existing ones.
  // We also surface the first rejection to the caller so undo can bubble errors.
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const entries = pendingPromises.get(layerId);
    if (!entries || entries.size === 0) {
      return;
    }

    const pendingArray = Array.from(entries);
    const results = await Promise.allSettled(pendingArray);
    results.forEach((result, index) => {
      if (result.status === 'rejected' && process.env.NODE_ENV !== 'production') {
        console.error('[cc-pending-saves] deferred save rejected', {
          layerId,
          index,
          reason: result.reason,
        });
      }
    });
  }
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
