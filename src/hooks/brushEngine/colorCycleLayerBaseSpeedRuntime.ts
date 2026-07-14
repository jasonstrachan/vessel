import type { ColorCycleAnimator } from '@/lib/ColorCycleAnimator';
import type { LayerStrokeState } from './colorCycleCanvas2DTypes';

export type ColorCycleLayerBaseSpeedContext = {
  getStrokeStateEntries(): Iterable<[string, LayerStrokeState]>;
  getActiveLayerId(): string | null;
  isStampDitherEnabled(): boolean;
  getStrokeCounter(): number;
  getResolvedWriteCycleSpeed(): number;
  publishLayerBaseSpeed(
    layerId: string,
    nextBaseSpeed: number,
    strokeData: LayerStrokeState | undefined,
    pixelsChanged: boolean,
  ): void;
  getAnimator(layerId: string): ColorCycleAnimator | undefined;
  forEachAnimator(callback: (animator: ColorCycleAnimator) => void): void;
  getPlaybackSpeedScale(): number;
  render(force?: boolean): void;
};

export function applyColorCycleLayerBaseSpeedChange(
  context: ColorCycleLayerBaseSpeedContext,
  change: { nextBaseSpeed: number },
): void {
  const { nextBaseSpeed } = change;
  const activeLayerId = context.getActiveLayerId();
  let publishedActiveLayer = false;

  for (const [layerId, strokeData] of context.getStrokeStateEntries()) {
    if (!activeLayerId || layerId !== activeLayerId) {
      continue;
    }
    context.publishLayerBaseSpeed(layerId, nextBaseSpeed, strokeData, false);
    publishedActiveLayer = true;
  }

  if (activeLayerId && !publishedActiveLayer) {
    context.publishLayerBaseSpeed(activeLayerId, nextBaseSpeed, undefined, false);
  }

  if (activeLayerId) {
    context.getAnimator(activeLayerId)?.setLayerSpeedMultiplier(nextBaseSpeed);
  }

  context.render(false);
}
