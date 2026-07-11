import type {
  ColorCycleLayerDirtyBatch,
  ColorCycleLayerDocumentRead,
} from '@/lib/colorCycle/document';
import type { ColorCycleAnimator } from '@/lib/ColorCycleAnimator';
import type { GradientStop } from '@/lib/GradientPalette';

import {
  ColorCyclePlaybackController,
  type ColorCyclePlaybackControllerOptions,
} from './colorCyclePlaybackController';
import {
  ColorCyclePresenter,
  type ColorCycleFrameRenderedCallback,
  type ColorCyclePresentationFlushOptions,
  type ColorCyclePresentationScheduleOptions,
  type ColorCyclePresenterCommitParams,
  type ColorCyclePresenterCompositeLayer,
  type ColorCyclePresenterDirectRenderParams,
  type ColorCyclePresenterTargetUpdate,
} from './colorCyclePresenter';
import {
  commitColorCyclePresentationLayer,
  commitCurrentColorCyclePresentationStroke,
  flushColorCyclePresentationScheduledRender,
  forceColorCyclePresentationLayerRender,
  hasColorCyclePresentationAnimatedContent,
  isColorCyclePresentationPlaying,
  markColorCyclePresentationLayerDirty,
  pauseColorCyclePresentationAnimation,
  renderColorCyclePresentationDirect,
  renderColorCyclePresentationDirtyBatches,
  renderColorCyclePresentationFrame,
  resumeColorCyclePresentationAnimation,
  setColorCyclePresentationFrameCallback,
  setColorCyclePresentationPlaying,
  startColorCyclePresentationAnimation,
  stopColorCyclePresentationAnimation,
  toggleColorCyclePresentationPlayPause,
  updateColorCyclePresentationAnimation,
  type ColorCyclePresentationPlaybackContext,
} from './colorCyclePresentationPlaybackRuntime';
import type { LayerStrokeState, SerializedLayerColorCycleMeta } from './colorCycleCanvas2DTypes';
import type { ColorCycleRenderCommitContext } from './colorCycleRenderCommitRuntime';

type ColorCyclePresentationPlaybackOptions = Omit<
  ColorCyclePlaybackControllerOptions,
  'stopAnimators'
>;

export type ColorCyclePresentationApiRuntimeDeps = {
  ensureAnimator(layerId: string): ColorCycleAnimator;
  getStrokeState(layerId: string): LayerStrokeState | undefined;
  restoreRuntimeFromDocument(
    layerId: string,
    animator: ColorCycleAnimator,
    documentRead: ColorCycleLayerDocumentRead,
  ): LayerStrokeState;
  getStrokeStateValues(): Iterable<LayerStrokeState>;
  getLayerDocumentRead(layerId: string): ColorCycleLayerDocumentRead | undefined;
  getLayerColorCycleMeta(layerId: string): SerializedLayerColorCycleMeta | null;
  applyDefBindingsForLayer(
    layerId: string,
    animator: ColorCycleAnimator,
    strokeData: LayerStrokeState | undefined,
    defs?: Array<{ id: number; hash: string; stops: GradientStop[] }>,
  ): void;
  paintHasContent: ColorCycleRenderCommitContext['paintHasContent'];
  getCanvasWidth(): number;
  getCanvasHeight(): number;
  finalizeCurrentStroke(layerId?: string): void;
  isDrawing(): boolean;
  consumeLayerDirtyBatch(layerId: string): ColorCycleLayerDirtyBatch | null | undefined;
};

export class ColorCyclePresentationApiRuntime {
  private presenter: ColorCyclePresenter | null = null;
  private playbackController: ColorCyclePlaybackController | null = null;

  constructor(
    private readonly deps: ColorCyclePresentationApiRuntimeDeps,
  ) {}

  configurePresenter(canvas: HTMLCanvasElement): void {
    this.presenter = new ColorCyclePresenter(canvas);
  }

  configurePlayback(options: ColorCyclePresentationPlaybackOptions): void {
    this.playbackController = new ColorCyclePlaybackController({
      ...options,
      stopAnimators: () => this.stopAnimators(),
    });
  }

  private getPlaybackController(): ColorCyclePlaybackController {
    if (!this.playbackController) {
      throw new Error('[ColorCycle] Playback controller is not configured');
    }
    return this.playbackController;
  }

  private getPresenter(): ColorCyclePresenter {
    if (!this.presenter) {
      throw new Error('[ColorCycle] Presenter is not configured');
    }
    return this.presenter;
  }

  setTargetCanvas(canvas: HTMLCanvasElement): ColorCyclePresenterTargetUpdate {
    return this.getPresenter().setTargetCanvas(canvas);
  }

  clearComposite(): void {
    this.getPresenter().clearComposite();
  }

  hasConnectedTarget(): boolean {
    return this.getPresenter().hasConnectedTarget();
  }

  scheduleDirtyRender(options: ColorCyclePresentationScheduleOptions): void {
    this.getPresenter().scheduleDirtyRender(options);
  }

  renderPresenterCompositeLayers(
    layers: ColorCyclePresenterCompositeLayer[],
    label: string,
  ): boolean {
    return this.getPresenter().renderCompositeLayers(layers, label);
  }

  cancelPresenterScheduledRender(): void {
    this.getPresenter().cancelScheduledRender();
  }

  notifyPresenterFrameRendered(dirtyBatches: ColorCycleLayerDirtyBatch[]): void {
    this.getPresenter().notifyFrameRendered(dirtyBatches);
  }

  clearPresenterDirtyLayers(): void {
    this.getPresenter().clearDirtyLayers();
  }

  renderPresenterDirectToCanvas(params: ColorCyclePresenterDirectRenderParams): void {
    this.getPresenter().renderDirectToCanvas(params);
  }

  commitPresenterToLayer(params: ColorCyclePresenterCommitParams): void {
    this.getPresenter().commitToLayer(params);
  }

  markPresenterLayerDirty(
    layerId: string,
    dirtyBatch?: ColorCycleLayerDirtyBatch | null,
  ): void {
    this.getPresenter().markLayerDirty(layerId, dirtyBatch);
  }

  flushPresenterScheduledRender(options: ColorCyclePresentationFlushOptions): void {
    this.getPresenter().flushScheduledRender(options);
  }

  setPresenterFrameCallback(callback: ColorCycleFrameRenderedCallback): void {
    this.getPresenter().setOnFrameRendered(callback);
  }

  private stopAnimators(): void {
    this.forEachAnimator((animator) => {
      try {
        animator.stop();
      } catch {}
    });
  }

  getAnimator(layerId: string): ColorCycleAnimator | undefined {
    return this.getPlaybackController().getAnimator(layerId);
  }

  setAnimator(layerId: string, animator: ColorCycleAnimator): void {
    this.getPlaybackController().setAnimator(layerId, animator);
  }

  hasAnimator(layerId: string): boolean {
    return this.getPlaybackController().hasAnimator(layerId);
  }

  forEachAnimator(callback: (animator: ColorCycleAnimator, layerId: string) => void): void {
    this.getPlaybackController().forEachAnimator(callback);
  }

  animatorValues(): IterableIterator<ColorCycleAnimator> {
    return this.getPlaybackController().animatorValues();
  }

  animatorEntries(): IterableIterator<[string, ColorCycleAnimator]> {
    return this.getPlaybackController().animatorEntries();
  }

  getAnimatorMap(): Map<string, ColorCycleAnimator> {
    return this.getPlaybackController().getAnimatorMap();
  }

  clearAnimators(): void {
    this.getPlaybackController().clearAnimators();
  }

  isAnimating(): boolean {
    return this.getPlaybackController().isAnimating;
  }

  hasScheduledFrame(): boolean {
    return this.getPlaybackController().hasScheduledFrame();
  }

  getFps(): number {
    return this.getPlaybackController().fps;
  }

  getPlaybackSpeedScale(): number {
    return this.getPlaybackController().playbackSpeedScale;
  }

  setPhase(phase: number): void {
    this.getPlaybackController().setPhase(phase);
  }

  setPlaybackSpeedScale(scale: number): void {
    this.getPlaybackController().setPlaybackSpeedScale(scale);
  }

  setFps(fps: number): void {
    this.getPlaybackController().setFps(fps);
  }

  startPlayback(): void {
    this.getPlaybackController().start();
  }

  stopPlayback(): void {
    this.getPlaybackController().stop();
  }

  togglePlayback(): void {
    this.getPlaybackController().toggle();
  }

  pausePlayback(): void {
    this.getPlaybackController().pause();
  }

  resumePlayback(): void {
    this.getPlaybackController().resume();
  }

  updatePlaybackAnimation(): void {
    this.getPlaybackController().updateAnimation();
  }

  isPlaybackPlaying(): boolean {
    return this.getPlaybackController().isPlaying();
  }

  readonly render = (
    forceFullOpacity: boolean = false,
    dirtyBatches: ColorCycleLayerDirtyBatch[] = [],
  ): void => {
    renderColorCyclePresentationFrame(this.getContext(), forceFullOpacity, dirtyBatches);
  };

  readonly renderDirectToCanvas = (
    targetCanvas: HTMLCanvasElement,
    layerId: string,
  ): void => {
    renderColorCyclePresentationDirect(this.getContext(), targetCanvas, layerId);
  };

  readonly commitCurrentStroke = (layerId: string): void => {
    commitCurrentColorCyclePresentationStroke(this.getContext(), layerId);
  };

  readonly commitToLayer = (
    targetCanvas: HTMLCanvasElement,
    layerId: string,
    opacity: number = 1,
  ): void => {
    commitColorCyclePresentationLayer(this.getContext(), targetCanvas, layerId, opacity);
  };

  readonly hasAnimatedContent = (): boolean => (
    hasColorCyclePresentationAnimatedContent(this.getContext())
  );

  readonly markLayerDirty = (layerId: string): void => {
    markColorCyclePresentationLayerDirty(this.getContext(), layerId);
  };

  readonly renderFromDirtyBatches = (dirtyBatches: ColorCycleLayerDirtyBatch[]): void => {
    renderColorCyclePresentationDirtyBatches(this.getContext(), dirtyBatches);
  };

  readonly forceRenderLayer = (layerId: string): void => {
    forceColorCyclePresentationLayerRender(this.getContext(), layerId);
  };

  readonly flushScheduledRender = (): void => {
    flushColorCyclePresentationScheduledRender(this.getContext());
  };

  readonly flush = (layerId?: string): void => {
    void layerId;
    this.flushScheduledRender();
  };

  readonly startAnimation = (): void => {
    startColorCyclePresentationAnimation(this.getContext());
  };

  readonly stopAnimation = (): void => {
    stopColorCyclePresentationAnimation(this.getContext());
  };

  readonly togglePlayPause = (): void => {
    toggleColorCyclePresentationPlayPause(this.getContext());
  };

  readonly pause = (): void => {
    pauseColorCyclePresentationAnimation(this.getContext());
  };

  readonly resume = (): void => {
    resumeColorCyclePresentationAnimation(this.getContext());
  };

  readonly pauseAnimation = (): void => {
    this.pause();
  };

  readonly resumeAnimation = (): void => {
    this.resume();
  };

  readonly updateAnimation = (): void => {
    updateColorCyclePresentationAnimation(this.getContext());
  };

  readonly isPlaying = (): boolean => (
    isColorCyclePresentationPlaying(this.getContext())
  );

  readonly setOnFrameRendered = (
    callback: (dirtyBatches: ColorCycleLayerDirtyBatch[]) => void,
  ): void => {
    setColorCyclePresentationFrameCallback(this.getContext(), callback);
  };

  readonly setPlaying = (playing: boolean): void => {
    setColorCyclePresentationPlaying(this.getContext(), playing);
  };

  readonly startCycling = (): void => {
    this.resume();
  };

  readonly stopCycling = (): void => {
    this.pause();
  };

  private getContext(): ColorCyclePresentationPlaybackContext {
    return {
      getRenderCommitContext: () => this.getRenderCommitContext(),
      getAnimator: (layerId) => this.getAnimator(layerId),
      markLayerDirty: (layerId, dirtyBatch) => this.markPresenterLayerDirty(layerId, dirtyBatch),
      flushScheduledRender: (options) => this.flushPresenterScheduledRender(options),
      setOnFrameRendered: (callback) => this.setPresenterFrameCallback(callback),
      startPlayback: () => this.startPlayback(),
      stopPlayback: () => this.stopPlayback(),
      togglePlayback: () => this.togglePlayback(),
      pausePlayback: () => this.pausePlayback(),
      resumePlayback: () => this.resumePlayback(),
      updatePlaybackAnimation: () => this.updatePlaybackAnimation(),
      isPlaybackPlaying: () => this.isPlaybackPlaying(),
      consumeLayerDirtyBatch: (layerId) => this.deps.consumeLayerDirtyBatch(layerId),
    };
  }

  private getRenderCommitContext(): ColorCycleRenderCommitContext {
    return {
      renderCompositeLayers: (layers, reason) => this.renderPresenterCompositeLayers(layers, reason),
      cancelScheduledRender: () => this.cancelPresenterScheduledRender(),
      notifyFrameRendered: (dirtyBatches) => this.notifyPresenterFrameRendered(dirtyBatches),
      clearDirtyLayers: () => this.clearPresenterDirtyLayers(),
      renderDirectToCanvas: (params) => this.renderPresenterDirectToCanvas(params),
      commitToLayer: (params) => this.commitPresenterToLayer(params),
      isAnimating: () => this.isAnimating(),
      forEachAnimator: (callback) => this.forEachAnimator(callback),
      getAnimator: (layerId) => this.getAnimator(layerId),
      ensureAnimator: (layerId) => this.deps.ensureAnimator(layerId),
      getStrokeState: (layerId) => this.deps.getStrokeState(layerId),
      restoreRuntimeFromDocument: (layerId, animator, documentRead) => (
        this.deps.restoreRuntimeFromDocument(layerId, animator, documentRead)
      ),
      getStrokeStateValues: () => this.deps.getStrokeStateValues(),
      getLayerDocumentRead: (layerId) => this.deps.getLayerDocumentRead(layerId),
      getLayerColorCycleMeta: (layerId) => this.deps.getLayerColorCycleMeta(layerId),
      applyDefBindingsForLayer: (layerId, animator, strokeData, defs) => {
        this.deps.applyDefBindingsForLayer(layerId, animator, strokeData, defs);
      },
      paintHasContent: this.deps.paintHasContent,
      getCanvasWidth: () => this.deps.getCanvasWidth(),
      getCanvasHeight: () => this.deps.getCanvasHeight(),
      finalizeCurrentStroke: (layerId) => this.deps.finalizeCurrentStroke(layerId),
      isDrawing: () => this.deps.isDrawing(),
    };
  }
}
