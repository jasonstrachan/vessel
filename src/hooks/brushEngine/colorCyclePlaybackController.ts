import { getSharedAnimationRuntime } from '@/runtime/playback/animationRuntime';
import type { ColorCycleAnimator } from '@/lib/ColorCycleAnimator';
import type { ColorCycleLayerDocumentRead } from '@/lib/colorCycle/document';
import { recordColorCycleRuntimePerf } from '@/utils/perf/ccPerfProbe';

export type ColorCyclePlaybackControllerOptions = {
  initialFps: number;
  initialPlaybackSpeedScale: number;
  hasAnimatedContent: () => boolean;
  getDocumentRead: (layerId: string) => ColorCycleLayerDocumentRead | undefined;
  shouldUpdateAnimator: (layerId: string) => boolean;
  render: () => void;
  flushScheduledRender: () => void;
  stopAnimators: () => void;
};

export class ColorCyclePlaybackController {
  private readonly animators = new Map<string, ColorCycleAnimator>();
  private isAnimatingValue = false;
  private isPausedValue = false;
  private fpsValue: number;
  private playbackSpeedScaleValue: number;
  private unregisterAnimation: (() => void) | null = null;
  private lastAnimationTimestamp: number | null = null;
  private elapsedSinceRenderMs = 0;
  private playbackAccumulatorMs = 0;

  constructor(private readonly options: ColorCyclePlaybackControllerOptions) {
    this.fpsValue = options.initialFps;
    this.playbackSpeedScaleValue = options.initialPlaybackSpeedScale;
  }

  getAnimator(layerId: string): ColorCycleAnimator | undefined {
    return this.animators.get(layerId);
  }

  setAnimator(layerId: string, animator: ColorCycleAnimator): void {
    animator.setFPS(this.fpsValue);
    animator.setSpeed(this.playbackSpeedScaleValue);
    this.animators.set(layerId, animator);
  }

  hasAnimator(layerId: string): boolean {
    return this.animators.has(layerId);
  }

  forEachAnimator(callback: (animator: ColorCycleAnimator, layerId: string) => void): void {
    this.animators.forEach(callback);
  }

  animatorValues(): IterableIterator<ColorCycleAnimator> {
    return this.animators.values();
  }

  animatorEntries(): IterableIterator<[string, ColorCycleAnimator]> {
    return this.animators.entries();
  }

  getAnimatorMap(): Map<string, ColorCycleAnimator> {
    return this.animators;
  }

  clearAnimators(): void {
    this.animators.clear();
  }

  get isAnimating(): boolean {
    return this.isAnimatingValue;
  }

  get isPaused(): boolean {
    return this.isPausedValue;
  }

  get fps(): number {
    return this.fpsValue;
  }

  get playbackSpeedScale(): number {
    return this.playbackSpeedScaleValue;
  }

  isPlaying(): boolean {
    return this.isAnimatingValue && !this.isPausedValue;
  }

  hasScheduledFrame(): boolean {
    return this.unregisterAnimation !== null;
  }

  resetTiming(): void {
    this.playbackAccumulatorMs = 0;
    this.lastAnimationTimestamp = null;
    this.elapsedSinceRenderMs = 0;
  }

  setFps(fps: number): void {
    this.fpsValue = fps;
    this.forEachAnimator((animator) => animator.setFPS(fps));
  }

  setPlaybackSpeedScale(scale: number): void {
    this.playbackSpeedScaleValue = scale;
    this.forEachAnimator((animator) => animator.setSpeed(scale));
  }

  setPhase(phase: number): void {
    const normalizedPhase = ((phase % 1) + 1) % 1;
    this.forEachAnimator((animator) => {
      if (typeof animator.setPhase === 'function') {
        animator.setPhase(normalizedPhase);
      } else {
        animator.updateFrame();
      }
    });
  }

  updateAnimation(deltaSeconds?: number): void {
    this.forEachAnimator((animator, layerId) => {
      recordColorCycleRuntimePerf('playbackTick', { layerId });
      const documentRead = this.options.getDocumentRead(layerId);
      if (documentRead && animator.builtFromVersion !== documentRead.version) {
        animator.rebuild(documentRead.snapshot, documentRead.version);
      }
      if (this.options.shouldUpdateAnimator(layerId)) {
        animator.updateFrame(deltaSeconds);
      }
    });
    this.options.render();
  }

  start(): void {
    if (this.isAnimatingValue) {
      if (this.isPausedValue) this.resume();
      return;
    }

    this.options.flushScheduledRender();
    this.isAnimatingValue = true;
    this.isPausedValue = false;
    this.ensureLoop();
  }

  stop(): void {
    if (!this.isAnimatingValue && this.unregisterAnimation === null) {
      return;
    }

    this.isAnimatingValue = false;
    this.isPausedValue = false;
    this.cancelLoop();
    this.options.flushScheduledRender();
    this.options.stopAnimators();
  }

  toggle(): void {
    if (!this.isAnimatingValue) {
      this.start();
      return;
    }

    if (this.isPausedValue) {
      this.resume();
    } else {
      this.pause();
    }
  }

  pause(): void {
    this.isPausedValue = true;
    this.cancelLoop();
  }

  resume(): void {
    if (!this.isAnimatingValue) {
      this.start();
      return;
    }
    if (!this.isPausedValue) {
      return;
    }
    this.isPausedValue = false;
    this.ensureLoop();
  }

  private frameIntervalMs(): number {
    const frameFps = Math.max(1, Math.min(120, this.fpsValue || 60));
    return 1000 / frameFps;
  }

  private ensureLoop(): void {
    if (typeof window === 'undefined' || this.unregisterAnimation !== null) {
      return;
    }
    this.resetTiming();
    const runtime = getSharedAnimationRuntime();
    this.unregisterAnimation = runtime.register(this.handleAnimationTick);
    runtime.start();
  }

  private cancelLoop(): void {
    this.unregisterAnimation?.();
    this.unregisterAnimation = null;
    this.resetTiming();
  }

  private handleAnimationTick = (timestamp: number): void => {
    if (!this.isPlaying()) {
      return;
    }
    const previousTimestamp = this.lastAnimationTimestamp;
    this.lastAnimationTimestamp = timestamp;
    if (!this.options.hasAnimatedContent()) {
      this.playbackAccumulatorMs = 0;
      this.elapsedSinceRenderMs = 0;
      return;
    }
    const delta = previousTimestamp === null ? 0 : Math.max(0, timestamp - previousTimestamp);
    this.playbackAccumulatorMs += delta;
    this.elapsedSinceRenderMs += delta;
    const interval = this.frameIntervalMs();
    if (this.playbackAccumulatorMs + 1e-6 < interval) {
      return;
    }
    this.playbackAccumulatorMs %= interval;
    const deltaSeconds = this.elapsedSinceRenderMs / 1000;
    this.elapsedSinceRenderMs = 0;
    this.updateAnimation(deltaSeconds);
  };
}
