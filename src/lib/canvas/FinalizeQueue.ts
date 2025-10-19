/**
 * FinalizeQueue - Serializes finalization operations
 *
 * You almost never want two finalizations in flight. A simple queue (size 1)
 * protects the staging/final surface.
 */

type QueueItem = {
  task: () => Promise<void>;
  layerId?: string;
  resolve: () => void;
  reject: (error: unknown) => void;
};

type Waiter = {
  resolve: () => void;
  reject: (error: unknown) => void;
};

export class FinalizeQueue {
  private busy = false;
  private readonly queue: QueueItem[] = [];
  private readonly pendingCounts = new Map<string, number>();
  private readonly waiters = new Map<string, Waiter[]>();
  private readonly globalWaiters: Waiter[] = [];

  async enqueue(task: () => Promise<void>, layerId?: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      if (layerId) {
        this.incrementLayer(layerId);
      }
      this.queue.push({ task, layerId, resolve, reject });
      void this.processQueue();
    });
  }

  async whenIdle(layerId?: string): Promise<void> {
    if (layerId) {
      if (!this.pendingCounts.has(layerId)) {
        return;
      }

      await new Promise<void>((resolve, reject) => {
        const layerWaiters = this.waiters.get(layerId) ?? [];
        layerWaiters.push({ resolve, reject });
        this.waiters.set(layerId, layerWaiters);
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
    return this.busy;
  }

  hasPending(): boolean {
    return this.queue.length > 0 || this.busy;
  }

  clear(): void {
    this.queue.length = 0;
  }

  async drainPendingForLayer(layerId: string): Promise<void> {
    if (!this.pendingCounts.has(layerId)) {
      return;
    }

    await new Promise<void>((resolve, reject) => {
      const layerWaiters = this.waiters.get(layerId) ?? [];
      layerWaiters.push({ resolve, reject });
      this.waiters.set(layerId, layerWaiters);
    });
  }

  private async processQueue(): Promise<void> {
    if (this.busy) {
      return;
    }
    const next = this.queue.shift();
    if (!next) {
      return;
    }

    this.busy = true;
    try {
      await next.task();
      next.resolve();
    } catch (error) {
      next.reject(error);
      this.notifyLayerWaiters(next.layerId, error);
      this.notifyGlobalWaiters(error);
    } finally {
      if (next.layerId) {
        this.decrementLayer(next.layerId);
      }
      this.busy = false;
      if (!this.hasPending()) {
        this.notifyGlobalWaiters();
      }
      void this.processQueue();
    }
  }

  private incrementLayer(layerId: string): void {
    this.pendingCounts.set(layerId, (this.pendingCounts.get(layerId) ?? 0) + 1);
  }

  private decrementLayer(layerId: string): void {
    const nextCount = (this.pendingCounts.get(layerId) ?? 1) - 1;
    if (nextCount <= 0) {
      this.pendingCounts.delete(layerId);
      this.notifyLayerWaiters(layerId);
    } else {
      this.pendingCounts.set(layerId, nextCount);
    }
  }

  private notifyLayerWaiters(layerId?: string, error?: unknown): void {
    if (!layerId) {
      return;
    }
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
          console.error('[FinalizeQueue] waiter callback failed', callbackError);
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
          console.error('[FinalizeQueue] global waiter callback failed', callbackError);
        }
      }
    });
  }
}
