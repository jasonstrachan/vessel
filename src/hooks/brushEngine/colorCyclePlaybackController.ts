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
  private animationFrameId: number | null = null;
  private lastAnimationTimestamp = 0;
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
    return this.animationFrameId !== null;
  }

  resetTiming(): void {
    this.playbackAccumulatorMs = 0;
    this.lastAnimationTimestamp = 0;
  }

  setFps(fps: number): void {
    this.fpsValue = fps;
    this.resetTiming();
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

  updateAnimation(): void {
    this.forEachAnimator((animator, layerId) => {
      recordColorCycleRuntimePerf('playbackTick', { layerId });
      const documentRead = this.options.getDocumentRead(layerId);
      if (documentRead && animator.builtFromVersion !== documentRead.version) {
        animator.rebuild(documentRead.snapshot, documentRead.version);
      }
      if (this.options.shouldUpdateAnimator(layerId)) {
        animator.updateFrame();
      }
    });
    this.options.render();
  }

  start(): void {
    if (this.isAnimatingValue) {
      return;
    }

    this.options.flushScheduledRender();
    this.isAnimatingValue = true;
    this.isPausedValue = false;
    this.ensureLoop();
  }

  stop(): void {
    if (!this.isAnimatingValue && this.animationFrameId === null) {
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
    if (typeof window === 'undefined') {
      return;
    }
    if (this.animationFrameId !== null) {
      return;
    }
    this.resetTiming();
    this.animationFrameId = requestAnimationFrame(this.handleAnimationTick);
  }

  private cancelLoop(): void {
    if (this.animationFrameId !== null && typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(this.animationFrameId);
    }
    this.animationFrameId = null;
  }

  private handleAnimationTick = (timestamp: number): void => {
    if (!this.isAnimatingValue) {
      this.animationFrameId = null;
      return;
    }

    if (!this.options.hasAnimatedContent()) {
      this.animationFrameId = requestAnimationFrame(this.handleAnimationTick);
      return;
    }

    if (this.lastAnimationTimestamp === 0) {
      this.lastAnimationTimestamp = timestamp;
    }

    const delta = timestamp - this.lastAnimationTimestamp;
    this.lastAnimationTimestamp = timestamp;

    if (!this.isPausedValue) {
      const interval = this.frameIntervalMs();
      this.playbackAccumulatorMs += delta;
      const maxCatchup = interval * 4;
      if (this.playbackAccumulatorMs > maxCatchup) {
        this.playbackAccumulatorMs = interval;
      }
      while (this.playbackAccumulatorMs >= interval) {
        this.playbackAccumulatorMs -= interval;
        this.updateAnimation();
      }
    }

    this.animationFrameId = requestAnimationFrame(this.handleAnimationTick);
  };
}
