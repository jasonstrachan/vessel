export type AnimationRuntimeConsumer = (timestampMs: number, deltaMs: number) => void;

class AnimationRuntime {
  private consumers = new Set<AnimationRuntimeConsumer>();

  private rafId: number | null = null;

  private lastTimestampMs: number | null = null;

  register(consumer: AnimationRuntimeConsumer): () => void {
    this.consumers.add(consumer);
    return () => {
      this.consumers.delete(consumer);
      if (this.consumers.size === 0) {
        this.stop();
      }
    };
  }

  start(): void {
    if (this.rafId !== null || typeof window === 'undefined') {
      return;
    }
    this.lastTimestampMs = null;
    this.rafId = window.requestAnimationFrame(this.tick);
  }

  stop(): void {
    if (this.rafId !== null && typeof window !== 'undefined') {
      window.cancelAnimationFrame(this.rafId);
    }
    this.rafId = null;
    this.lastTimestampMs = null;
  }

  isRunning(): boolean {
    return this.rafId !== null;
  }

  private tick = (timestampMs: number): void => {
    if (this.rafId === null) {
      return;
    }

    const frameId = this.rafId;
    const lastTimestampMs = this.lastTimestampMs;
    this.lastTimestampMs = timestampMs;
    const deltaMs =
      lastTimestampMs == null || !Number.isFinite(lastTimestampMs)
        ? 0
        : Math.max(0, timestampMs - lastTimestampMs);

    this.consumers.forEach((consumer) => {
      try {
        consumer(timestampMs, deltaMs);
      } catch {
        // Consumer failures should not kill the shared runtime loop.
      }
    });

    // A consumer may stop and restart the scheduler while this frame runs.
    // The restart already owns the next callback.
    if (this.rafId !== frameId) return;
    if (this.consumers.size === 0) {
      this.stop();
      return;
    }

    this.rafId = window.requestAnimationFrame(this.tick);
  };
}

const sharedAnimationRuntime = new AnimationRuntime();

export const getSharedAnimationRuntime = (): AnimationRuntime => sharedAnimationRuntime;
