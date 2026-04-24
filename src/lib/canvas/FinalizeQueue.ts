import { logError } from '@/utils/debug';
/**
 * FinalizeQueue - Serializes finalization operations
 *
 * Multiple lanes (per layer or global) are keyed to avoid unnecessary
 * serialization between unrelated work. Each lane executes tasks sequentially.
 */

const DEFAULT_LANE = '__global__';

type Waiter = {
  resolve: () => void;
  reject: (error: unknown) => void;
};

export class FinalizeQueue {
  private readonly tails = new Map<string, Promise<void>>();
  private readonly waiters = new Map<string, Waiter[]>();
  private readonly globalWaiters: Waiter[] = [];

  enqueue(task: () => Promise<void>, laneId: string = DEFAULT_LANE): Promise<void> {
    const key = laneId ?? DEFAULT_LANE;
    const previousTail = this.tails.get(key) ?? Promise.resolve();

    const taskPromise = previousTail.catch(() => undefined).then(() => task());

    const publicPromise = taskPromise.catch(error => {
      this.notifyLayerWaiters(key, error);
      this.notifyGlobalWaiters(error);
      throw error;
    });

    const laneTail = publicPromise.catch(() => undefined);

    laneTail.finally(() => {
      if (this.tails.get(key) === laneTail) {
        this.tails.delete(key);
        this.notifyLayerWaiters(key);
        if (!this.hasPending()) {
          this.notifyGlobalWaiters();
        }
      }
    });

    this.tails.set(key, laneTail);

    return publicPromise;
  }

  async whenIdle(laneId?: string): Promise<void> {
    if (laneId) {
      if (!this.tails.has(laneId)) {
        return;
      }

      await new Promise<void>((resolve, reject) => {
        const layerWaiters = this.waiters.get(laneId) ?? [];
        layerWaiters.push({ resolve, reject });
        this.waiters.set(laneId, layerWaiters);
      });
      return;
    }

    if (!this.hasPending()) {
      return;
    }

    await new Promise<void>((resolve, reject) => {
      this.globalWaiters.push({ resolve, reject });
    });
  }

  isBusy(): boolean {
    return this.hasPending();
  }

  hasPending(): boolean {
    return this.tails.size > 0;
  }

  clear(): void {
    this.tails.clear();
  }

  async drainPendingForLayer(layerId: string): Promise<void> {
    await this.whenIdle(layerId);
  }

  private notifyLayerWaiters(layerId: string, error?: unknown): void {
    const layerWaiters = this.waiters.get(layerId);
    if (!layerWaiters || layerWaiters.length === 0) {
      return;
    }
    this.waiters.delete(layerId);
    layerWaiters.forEach(({ resolve, reject }) => {
      try {
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      } catch (callbackError) {
        if (process.env.NODE_ENV !== 'production') {
          logError('[FinalizeQueue] waiter callback failed', callbackError);
        }
      }
    });
  }

  private notifyGlobalWaiters(error?: unknown): void {
    if (this.globalWaiters.length === 0) {
      return;
    }
    const waiters = this.globalWaiters.splice(0, this.globalWaiters.length);
    waiters.forEach(({ resolve, reject }) => {
      try {
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      } catch (callbackError) {
        if (process.env.NODE_ENV !== 'production') {
          logError('[FinalizeQueue] global waiter callback failed', callbackError);
        }
      }
    });
  }
}
