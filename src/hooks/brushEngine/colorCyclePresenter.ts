import { ColorCycleAnimator } from '@/lib/ColorCycleAnimator';
import { type ColorCycleLayerDirtyBatch, type ColorCycleLayerDocumentRead } from '@/lib/colorCycle/document';
import { recordColorCycleRuntimePerf } from '@/utils/perf/ccPerfProbe';

import {
  ColorCyclePresenterRebuildScheduler,
  renderColorCycleAnimatorToContext,
} from './colorCyclePresenterRender';

export type ColorCyclePresenterTargetUpdate = {
  width: number;
  height: number;
  dimensionsChanged: boolean;
};

export type ColorCyclePresenterLayerCanvasParams = {
  targetCanvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  layerId: string;
  animator: ColorCycleAnimator;
  documentRead?: ColorCycleLayerDocumentRead;
  applyMask?: (layerId: string, ctx: CanvasRenderingContext2D) => void;
};

export type ColorCyclePresenterDirectRenderParams = ColorCyclePresenterLayerCanvasParams & {
  hasRenderableContent: boolean;
  preserveExternalBase: boolean;
};

export type ColorCyclePresenterCommitParams = ColorCyclePresenterLayerCanvasParams & {
  opacity?: number;
};

export type ColorCyclePresenterCompositeLayer = {
  layerId: string;
  animator: ColorCycleAnimator;
  documentRead?: ColorCycleLayerDocumentRead;
  tier?: 'static' | 'animated';
  prepare?: () => void;
};

export type ColorCyclePresentationFlushOptions = {
  forceLayerRender: (layerId: string, dirtyBatch?: ColorCycleLayerDirtyBatch) => void;
  render: (dirtyBatches: ColorCycleLayerDirtyBatch[]) => void;
};

export type ColorCyclePresentationScheduleOptions = ColorCyclePresentationFlushOptions & {
  isAnimating: boolean;
  requireConnectedTarget?: boolean;
};

export type ColorCycleFrameRenderedCallback = (dirtyBatches: ColorCycleLayerDirtyBatch[]) => void;

export class ColorCyclePresenter {
  private targetCanvas: HTMLCanvasElement;
  private compositeCanvas: HTMLCanvasElement;
  private compositeCtx: CanvasRenderingContext2D;
  private staticTierCanvas: HTMLCanvasElement;
  private staticTierCtx: CanvasRenderingContext2D;
  private animatedOverlayCanvas: HTMLCanvasElement;
  private animatedOverlayCtx: CanvasRenderingContext2D;
  private directRenderCanvas: HTMLCanvasElement;
  private directRenderCtx: CanvasRenderingContext2D;
  private staticTierKey: string | null = null;
  private readonly rebuildScheduler = new ColorCyclePresenterRebuildScheduler();
  private renderScheduled = false;
  private readonly dirtyLayers = new Map<string, ColorCycleLayerDirtyBatch | undefined>();
  private onFrameRendered?: ColorCycleFrameRenderedCallback;
  private width: number;
  private height: number;

  constructor(targetCanvas: HTMLCanvasElement) {
    this.targetCanvas = targetCanvas;
    this.width = targetCanvas.width;
    this.height = targetCanvas.height;
    this.compositeCanvas = document.createElement('canvas');
    this.compositeCanvas.width = this.width;
    this.compositeCanvas.height = this.height;
    this.staticTierCanvas = document.createElement('canvas');
    this.staticTierCanvas.width = this.width;
    this.staticTierCanvas.height = this.height;
    this.animatedOverlayCanvas = document.createElement('canvas');
    this.animatedOverlayCanvas.width = this.width;
    this.animatedOverlayCanvas.height = this.height;
    this.directRenderCanvas = document.createElement('canvas');
    this.directRenderCanvas.width = this.width;
    this.directRenderCanvas.height = this.height;

    const ctx = this.compositeCanvas.getContext('2d', {
      willReadFrequently: true,
      alpha: true,
    });
    const staticCtx = this.staticTierCanvas.getContext('2d', {
      willReadFrequently: true,
      alpha: true,
    });
    const animatedCtx = this.animatedOverlayCanvas.getContext('2d', {
      willReadFrequently: true,
      alpha: true,
    });
    const directRenderCtx = this.directRenderCanvas.getContext('2d', {
      willReadFrequently: true,
      alpha: true,
    });

    if (!ctx || !staticCtx || !animatedCtx || !directRenderCtx) {
      throw new Error('Failed to create 2D context');
    }

    this.compositeCtx = ctx;
    this.staticTierCtx = staticCtx;
    this.animatedOverlayCtx = animatedCtx;
    this.directRenderCtx = directRenderCtx;
    this.compositeCtx.imageSmoothingEnabled = false;
    this.staticTierCtx.imageSmoothingEnabled = false;
    this.animatedOverlayCtx.imageSmoothingEnabled = false;
    this.directRenderCtx.imageSmoothingEnabled = false;
  }

  getTargetCanvas(): HTMLCanvasElement {
    return this.targetCanvas;
  }

  hasConnectedTarget(): boolean {
    return !!this.targetCanvas && (!(this.targetCanvas instanceof HTMLCanvasElement) || this.targetCanvas.isConnected);
  }

  markLayerDirty(layerId: string, dirtyBatch?: ColorCycleLayerDirtyBatch | null): void {
    this.dirtyLayers.set(layerId, dirtyBatch ?? undefined);
  }

  clearDirtyLayers(): void {
    this.dirtyLayers.clear();
  }

  cancelScheduledRender(): void {
    this.renderScheduled = false;
    this.clearDirtyLayers();
  }

  setOnFrameRendered(callback: ColorCycleFrameRenderedCallback): void {
    this.onFrameRendered = callback;
  }

  notifyFrameRendered(dirtyBatches: ColorCycleLayerDirtyBatch[] = []): void {
    this.onFrameRendered?.(dirtyBatches);
  }

  flushScheduledRender(options: ColorCyclePresentationFlushOptions): void {
    if (!this.renderScheduled) {
      return;
    }
    this.renderScheduled = false;
    this.flushDirtyLayers(options);
  }

  scheduleDirtyRender(options: ColorCyclePresentationScheduleOptions): void {
    const requireConnectedTarget = options.requireConnectedTarget ?? true;
    if (
      options.isAnimating ||
      this.renderScheduled ||
      (requireConnectedTarget && !this.hasConnectedTarget())
    ) {
      return;
    }

    this.renderScheduled = true;
    requestAnimationFrame(() => {
      this.renderScheduled = false;
      this.flushDirtyLayers(options);
    });
  }

  private flushDirtyLayers({ forceLayerRender, render }: ColorCyclePresentationFlushOptions): void {
    if (this.dirtyLayers.size === 0) {
      return;
    }

    const dirtyBatches = Array.from(this.dirtyLayers.values()).filter(
      (dirtyBatch): dirtyBatch is ColorCycleLayerDirtyBatch => Boolean(dirtyBatch),
    );
    this.dirtyLayers.forEach((dirtyBatch, layerId) => {
      forceLayerRender(layerId, dirtyBatch);
    });
    this.clearDirtyLayers();
    render(dirtyBatches);
  }

  setTargetCanvas(canvas: HTMLCanvasElement): ColorCyclePresenterTargetUpdate {
    const width = canvas.width || this.width;
    const height = canvas.height || this.height;
    const dimensionsChanged = width !== this.width || height !== this.height;

    this.targetCanvas = canvas;

    if (dimensionsChanged) {
      this.resize(width, height);
    }

    return { width, height, dimensionsChanged };
  }

  resize(width: number, height: number): void {
    this.width = width;
    this.height = height;
    this.compositeCanvas.width = width;
    this.compositeCanvas.height = height;
    this.staticTierCanvas.width = width;
    this.staticTierCanvas.height = height;
    this.animatedOverlayCanvas.width = width;
    this.animatedOverlayCanvas.height = height;
    this.directRenderCanvas.width = width;
    this.directRenderCanvas.height = height;
    this.staticTierKey = null;

    const ctx = this.compositeCanvas.getContext('2d', {
      willReadFrequently: true,
      alpha: true,
    }) as CanvasRenderingContext2D | null;
    const staticCtx = this.staticTierCanvas.getContext('2d', {
      willReadFrequently: true,
      alpha: true,
    }) as CanvasRenderingContext2D | null;
    const animatedCtx = this.animatedOverlayCanvas.getContext('2d', {
      willReadFrequently: true,
      alpha: true,
    }) as CanvasRenderingContext2D | null;
    const directRenderCtx = this.directRenderCanvas.getContext('2d', {
      willReadFrequently: true,
      alpha: true,
    }) as CanvasRenderingContext2D | null;

    if (ctx) {
      this.compositeCtx = ctx;
      this.compositeCtx.imageSmoothingEnabled = false;
    }
    if (staticCtx) {
      this.staticTierCtx = staticCtx;
      this.staticTierCtx.imageSmoothingEnabled = false;
    }
    if (animatedCtx) {
      this.animatedOverlayCtx = animatedCtx;
      this.animatedOverlayCtx.imageSmoothingEnabled = false;
    }
    if (directRenderCtx) {
      this.directRenderCtx = directRenderCtx;
      this.directRenderCtx.imageSmoothingEnabled = false;
    }
  }

  clearComposite(): void {
    this.compositeCtx.clearRect(0, 0, this.width, this.height);
  }

  private clearAnimatedOverlay(): void {
    this.animatedOverlayCtx.clearRect(0, 0, this.width, this.height);
  }

  renderComposite(renderLayers: (renderAnimator: (animator: ColorCycleAnimator) => void) => void): boolean {
    if (!this.hasConnectedTarget()) {
      return false;
    }

    this.clearComposite();
    this.clearAnimatedOverlay();
    renderLayers((animator) => {
      animator.renderToCanvas2D(this.animatedOverlayCtx);
    });
    this.compositeCtx.drawImage(this.animatedOverlayCanvas, 0, 0);
    this.presentCompositeToTarget();
    return true;
  }

  renderCompositeLayers(layers: ColorCyclePresenterCompositeLayer[], label: string): boolean {
    if (!this.hasConnectedTarget()) {
      return false;
    }

    const staticLayers = layers.filter((layer) => layer.tier === 'static');
    const animatedLayers = layers.filter((layer) => layer.tier !== 'static');
    const nextStaticTierKey = this.createStaticTierKey(staticLayers);

    if (nextStaticTierKey !== this.staticTierKey) {
      this.staticTierCtx.clearRect(0, 0, this.width, this.height);
      staticLayers.forEach((layer) => {
        this.prepareCompositeLayer(layer, label);
        layer.animator.renderToCanvas2D(this.staticTierCtx);
      });
      this.staticTierKey = nextStaticTierKey;
    }

    this.clearAnimatedOverlay();
    animatedLayers.forEach((layer) => {
      this.prepareCompositeLayer(layer, label);
      layer.animator.renderToCanvas2D(this.animatedOverlayCtx);
    });

    this.clearComposite();
    this.compositeCtx.drawImage(this.staticTierCanvas, 0, 0);
    this.compositeCtx.drawImage(this.animatedOverlayCanvas, 0, 0);
    this.presentCompositeToTarget();
    recordColorCycleRuntimePerf('presenterComposite');
    return true;
  }

  private prepareCompositeLayer(layer: ColorCyclePresenterCompositeLayer, label: string): void {
    layer.prepare?.();
    this.rebuildScheduler.assertFreshForRender(layer.layerId, layer.animator, layer.documentRead, label);
  }

  private createStaticTierKey(layers: ColorCyclePresenterCompositeLayer[]): string {
    return layers
      .map((layer) => `${layer.layerId}:${layer.documentRead?.version ?? layer.animator.builtFromVersion ?? 'null'}`)
      .join('|');
  }

  presentCompositeToTarget(): void {
    const targetCtx = this.targetCanvas.getContext('2d') as CanvasRenderingContext2D | null;
    if (!targetCtx) {
      return;
    }

    const prevOp = targetCtx.globalCompositeOperation;
    targetCtx.globalCompositeOperation = 'copy';
    targetCtx.drawImage(this.compositeCanvas, 0, 0);
    targetCtx.globalCompositeOperation = prevOp;
  }

  renderDirectToCanvas(params: ColorCyclePresenterDirectRenderParams): void {
    recordColorCycleRuntimePerf('forcedDirectRender', { layerId: params.layerId });
    this.publishLayerCanvas(params, true);
  }

  presentCurrentFrameToCanvas(params: ColorCyclePresenterDirectRenderParams): void {
    this.publishLayerCanvas(params, false);
  }

  private publishLayerCanvas(
    params: ColorCyclePresenterDirectRenderParams,
    forceRender: boolean,
  ): void {
    const {
      targetCanvas,
      ctx,
      layerId,
      animator,
      hasRenderableContent,
      preserveExternalBase,
      applyMask,
    } = params;

    if (!hasRenderableContent) {
      if (!preserveExternalBase) {
        ctx.clearRect(0, 0, targetCanvas.width, targetCanvas.height);
      }
      return;
    }

    if (forceRender) {
      this.rebuildScheduler.assertFreshForRender(
        layerId,
        animator,
        params.documentRead,
        'ColorCyclePresenter.renderDirectToCanvas',
      );
      this.rebuildScheduler.forceRender(animator);
    } else {
      const isCurrent = this.rebuildScheduler.isCurrentForPresentation(
        layerId,
        animator,
        params.documentRead,
        'ColorCyclePresenter.presentCurrentFrameToCanvas',
      );
      if (!isCurrent) {
        return;
      }
    }

    if (this.directRenderCanvas.width !== targetCanvas.width || this.directRenderCanvas.height !== targetCanvas.height) {
      this.directRenderCanvas.width = targetCanvas.width;
      this.directRenderCanvas.height = targetCanvas.height;
      const resizedCtx = this.directRenderCanvas.getContext('2d', {
        willReadFrequently: true,
        alpha: true,
      });
      if (!resizedCtx) throw new Error('Failed to resize transactional color-cycle render surface');
      this.directRenderCtx = resizedCtx;
    }
    const scratchCtx = this.directRenderCtx;
    scratchCtx.save();
    try {
      scratchCtx.setTransform(1, 0, 0, 1, 0, 0);
      scratchCtx.globalCompositeOperation = 'copy';
      scratchCtx.globalAlpha = 1;
      scratchCtx.imageSmoothingEnabled = false;
      scratchCtx.clearRect(0, 0, this.directRenderCanvas.width, this.directRenderCanvas.height);
      this.renderAnimatorToContext(animator, scratchCtx, this.directRenderCanvas);
      applyMask?.(layerId, scratchCtx);
    } finally {
      scratchCtx.restore();
    }

    ctx.save();
    try {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalCompositeOperation = 'copy';
      ctx.globalAlpha = 1;
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(this.directRenderCanvas, 0, 0);
    } finally {
      ctx.restore();
    }
    recordColorCycleRuntimePerf('presentedLayerSurface', { layerId });
  }

  commitToLayer(params: ColorCyclePresenterCommitParams): void {
    const {
      targetCanvas,
      ctx,
      layerId,
      animator,
      opacity = 1,
      applyMask,
    } = params;

    const commitOpacity = Number.isFinite(opacity) ? Math.max(0, Math.min(1, opacity)) : 1;
    this.rebuildScheduler.assertFreshForRender(layerId, animator, params.documentRead, 'ColorCyclePresenter.commitToLayer');
    this.rebuildScheduler.forceRender(animator);

    const prevComposite = ctx.globalCompositeOperation;
    const prevAlpha = ctx.globalAlpha;
    const prevSmoothing = ctx.imageSmoothingEnabled;
    try {
      ctx.save();
    } catch {}
    try {
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = commitOpacity;
      try {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
      } catch {}
      ctx.imageSmoothingEnabled = false;

      ctx.clearRect(0, 0, targetCanvas.width, targetCanvas.height);
      this.renderAnimatorToContext(animator, ctx, targetCanvas);
      applyMask?.(layerId, ctx);
    } finally {
      ctx.globalCompositeOperation = prevComposite;
      ctx.globalAlpha = prevAlpha;
      ctx.imageSmoothingEnabled = prevSmoothing;
      try {
        ctx.restore();
      } catch {}
    }
  }

  renderAnimatorToContext(
    animator: ColorCycleAnimator,
    ctx: CanvasRenderingContext2D,
    targetCanvas: HTMLCanvasElement,
  ): void {
    renderColorCycleAnimatorToContext(animator, ctx, targetCanvas);
  }
}
