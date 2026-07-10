import type { ColorCycleAnimator } from '@/lib/ColorCycleAnimator';
import {
  decodeColorCycleSpeedByte,
  encodeColorCycleSpeedByte,
  sanitizeBrushColorCycleSpeed,
} from '@/utils/colorCycleSpeed';

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
  change: { nextBaseSpeed: number; ratio: number },
): void {
  const { nextBaseSpeed, ratio } = change;
  if (!Number.isFinite(ratio) || ratio <= 0) {
    return;
  }

  const nextBaseSpeedByte = encodeColorCycleSpeedByte(nextBaseSpeed);
  const activeLayerId = context.getActiveLayerId();
  let changedAnyLayer = false;
  let publishedActiveLayer = false;

  for (const [layerId, strokeData] of context.getStrokeStateEntries()) {
    if (!activeLayerId || layerId !== activeLayerId) {
      continue;
    }
    const changedLayer = rescaleStrokeSpeedBuffers({
      strokeData,
      ratio,
      nextBaseSpeedByte,
      stampDitherEnabled: context.isStampDitherEnabled(),
      currentStrokeCounter: context.getStrokeCounter(),
      resolvedWriteCycleSpeed: context.getResolvedWriteCycleSpeed(),
    });

    context.publishLayerBaseSpeed(layerId, nextBaseSpeed, strokeData, changedLayer);
    publishedActiveLayer = true;
    changedAnyLayer = changedAnyLayer || changedLayer;
    if (!changedLayer) {
      continue;
    }
    const animator = context.getAnimator(layerId);
    if (animator) {
      const dims = animator.getDimensions();
      animator.markDirtyBounds({
        minX: 0,
        minY: 0,
        width: Math.max(1, dims.width),
        height: Math.max(1, dims.height),
      });
    }
  }

  if (activeLayerId && !publishedActiveLayer) {
    context.publishLayerBaseSpeed(activeLayerId, nextBaseSpeed, undefined, false);
  }

  context.forEachAnimator((animator) => (
    animator.setSpeed(context.getPlaybackSpeedScale())
  ));

  if (changedAnyLayer) {
    context.render(false);
  }
}

const rescaleStrokeSpeedBuffers = ({
  strokeData,
  ratio,
  nextBaseSpeedByte,
  stampDitherEnabled,
  currentStrokeCounter,
  resolvedWriteCycleSpeed,
}: {
  strokeData: LayerStrokeState;
  ratio: number;
  nextBaseSpeedByte: number;
  stampDitherEnabled: boolean;
  currentStrokeCounter: number;
  resolvedWriteCycleSpeed: number;
}): boolean => {
  let changedLayer = false;
  const speedBuffer = strokeData.buffers.spd;
  const paint = strokeData.buffers.paint;
  let sawEncodedSpeed = false;

  for (let i = 0; i < speedBuffer.length; i += 1) {
    const encoded = speedBuffer[i] ?? 0;
    if (encoded <= 0) {
      continue;
    }
    sawEncodedSpeed = true;
    const decoded = decodeColorCycleSpeedByte(encoded);
    const scaled = encodeColorCycleSpeedByte(decoded * ratio);
    if (scaled !== encoded) {
      speedBuffer[i] = scaled;
      changedLayer = true;
    }
  }

  if (stampDitherEnabled && !sawEncodedSpeed && paint.length === speedBuffer.length) {
    for (let i = 0; i < paint.length; i += 1) {
      const nextByte = paint[i] === 0 ? 0 : nextBaseSpeedByte;
      if (speedBuffer[i] !== nextByte) {
        speedBuffer[i] = nextByte;
        changedLayer = true;
      }
    }
  }

  if (strokeData.strokeCounter === currentStrokeCounter && Number.isFinite(strokeData.strokeCycleSpeed)) {
    strokeData.strokeCycleSpeed = sanitizeBrushColorCycleSpeed(strokeData.strokeCycleSpeed * ratio);
    strokeData.strokeSpeedByte = encodeColorCycleSpeedByte(strokeData.strokeCycleSpeed);
  } else {
    strokeData.strokeCycleSpeed = resolvedWriteCycleSpeed;
    strokeData.strokeSpeedByte = encodeColorCycleSpeedByte(strokeData.strokeCycleSpeed);
  }

  return changedLayer;
};
