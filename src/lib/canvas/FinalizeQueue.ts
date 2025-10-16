/**
 * FinalizeQueue - Serializes finalization operations
 *
 * You almost never want two finalizations in flight. A simple queue (size 1)
 * protects the staging/final surface.
 */

export class FinalizeQueue {
  private busy = false;
  private pending: null | (() => Promise<void>) = null;

  async enqueue(task: () => Promise<void>): Promise<void> {
    if (this.busy) {
      this.pending = task;
      return;
    }

    this.busy = true;
    try {
      await task();
    } finally {
      this.busy = false;
      const next = this.pending;
      this.pending = null;
      if (next) {
        void this.enqueue(next);
      }
    }
  }

  isBusy(): boolean {
    return this.busy;
  }

  hasPending(): boolean {
    return this.pending !== null;
  }

  clear(): void {
    this.pending = null;
  }
}
