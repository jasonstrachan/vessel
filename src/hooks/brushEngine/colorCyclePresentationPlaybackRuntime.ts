import type { ColorCycleAnimator } from '@/lib/ColorCycleAnimator';
import type { ColorCycleLayerDirtyBatch } from '@/lib/colorCycle/document';

import type {
  ColorCycleFrameRenderedCallback,
  ColorCyclePresentationFlushOptions,
} from './colorCyclePresenter';
import {
  commitColorCycleLayerToCanvas,
  commitCurrentColorCycleStroke,
  hasColorCycleAnimatedContent,
  renderColorCycleDirectToCanvas,
  renderColorCycleFrame,
  type ColorCycleRenderCommitContext,
} from './colorCycleRenderCommitRuntime';

export type ColorCyclePresentationPlaybackContext = {
  getRenderCommitContext(): ColorCycleRenderCommitContext;
  getAnimator(layerId: string): ColorCycleAnimator | undefined;
  markLayerDirty(layerId: string, dirtyBatch?: ColorCycleLayerDirtyBatch | null): void;
  flushScheduledRender(options: ColorCyclePresentationFlushOptions): void;
  setOnFrameRendered(callback: ColorCycleFrameRenderedCallback): void;
  startPlayback(): void;
  stopPlayback(): void;
  togglePlayback(): void;
  pausePlayback(): void;
  resumePlayback(): void;
  updatePlaybackAnimation(): void;
  isPlaybackPlaying(): boolean;
  consumeLayerDirtyBatch(layerId: string): ColorCycleLayerDirtyBatch | null | undefined;
};

export function renderColorCyclePresentationFrame(
  context: ColorCyclePresentationPlaybackContext,
  forceFullOpacity = false,
  dirtyBatches: ColorCycleLayerDirtyBatch[] = [],
): void {
  renderColorCycleFrame(context.getRenderCommitContext(), forceFullOpacity, dirtyBatches);
}

export function renderColorCyclePresentationDirect(
  context: ColorCyclePresentationPlaybackContext,
  targetCanvas: HTMLCanvasElement,
  layerId: string,
): void {
  renderColorCycleDirectToCanvas(context.getRenderCommitContext(), targetCanvas, layerId);
}

export function commitCurrentColorCyclePresentationStroke(
  context: ColorCyclePresentationPlaybackContext,
  layerId: string,
): void {
  commitCurrentColorCycleStroke(context.getRenderCommitContext(), layerId);
}

export function commitColorCyclePresentationLayer(
  context: ColorCyclePresentationPlaybackContext,
  targetCanvas: HTMLCanvasElement,
  layerId: string,
  opacity = 1,
): void {
  commitColorCycleLayerToCanvas(context.getRenderCommitContext(), targetCanvas, layerId, opacity);
}

export function hasColorCyclePresentationAnimatedContent(
  context: ColorCyclePresentationPlaybackContext,
): boolean {
  return hasColorCycleAnimatedContent(context.getRenderCommitContext());
}

export function markColorCyclePresentationLayerDirty(
  context: ColorCyclePresentationPlaybackContext,
  layerId: string,
): void {
  context.markLayerDirty(layerId, context.consumeLayerDirtyBatch(layerId));
}

export function renderColorCyclePresentationDirtyBatches(
  context: ColorCyclePresentationPlaybackContext,
  dirtyBatches: ColorCycleLayerDirtyBatch[],
): void {
  renderColorCyclePresentationFrame(context, false, dirtyBatches);
}

export function forceColorCyclePresentationLayerRender(
  context: ColorCyclePresentationPlaybackContext,
  layerId: string,
): void {
  const animator = context.getAnimator(layerId) as ColorCycleAnimator | undefined;
  if (!animator) {
    return;
  }
  try {
    animator.forceRender();
  } catch {}
}

export function flushColorCyclePresentationScheduledRender(
  context: ColorCyclePresentationPlaybackContext,
): void {
  context.flushScheduledRender({
    forceLayerRender: (layerId) => forceColorCyclePresentationLayerRender(context, layerId),
    render: (dirtyBatches) => renderColorCyclePresentationDirtyBatches(context, dirtyBatches),
  });
}

export function startColorCyclePresentationAnimation(
  context: ColorCyclePresentationPlaybackContext,
): void {
  context.startPlayback();
}

export function stopColorCyclePresentationAnimation(
  context: ColorCyclePresentationPlaybackContext,
): void {
  context.stopPlayback();
}

export function toggleColorCyclePresentationPlayPause(
  context: ColorCyclePresentationPlaybackContext,
): void {
  context.togglePlayback();
}

export function pauseColorCyclePresentationAnimation(
  context: ColorCyclePresentationPlaybackContext,
): void {
  context.pausePlayback();
}

export function resumeColorCyclePresentationAnimation(
  context: ColorCyclePresentationPlaybackContext,
): void {
  context.resumePlayback();
}

export function updateColorCyclePresentationAnimation(
  context: ColorCyclePresentationPlaybackContext,
): void {
  context.updatePlaybackAnimation();
}

export function isColorCyclePresentationPlaying(
  context: ColorCyclePresentationPlaybackContext,
): boolean {
  return context.isPlaybackPlaying();
}

export function setColorCyclePresentationPlaying(
  context: ColorCyclePresentationPlaybackContext,
  playing: boolean,
): void {
  if (playing) {
    startColorCyclePresentationAnimation(context);
    return;
  }
  stopColorCyclePresentationAnimation(context);
}

export function setColorCyclePresentationFrameCallback(
  context: ColorCyclePresentationPlaybackContext,
  callback: (dirtyBatches: ColorCycleLayerDirtyBatch[]) => void,
): void {
  context.setOnFrameRendered(callback);
}
