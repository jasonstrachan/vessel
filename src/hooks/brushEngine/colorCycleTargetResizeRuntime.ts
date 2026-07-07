import type { ColorCycleAnimator } from '@/lib/ColorCycleAnimator';

import type { LayerStrokeState } from './colorCycleCanvas2DTypes';
import { resizeLayerStrokeBuffersAfterTargetCanvasChange } from './colorCycleLayerStrokeBuffers';

export type ColorCycleTargetResizeContext = {
  forEachAnimator(callback: (animator: ColorCycleAnimator) => void): void;
  getStrokeStateValues(): Iterable<LayerStrokeState>;
  getCanvasWidth(): number;
  getCanvasHeight(): number;
  getCanvasPixelCount(): number;
};

export type ColorCycleTargetCanvasUpdateContext = ColorCycleTargetResizeContext & {
  setTargetCanvas(canvas: HTMLCanvasElement | null): {
    changed: boolean;
    dimensionsChanged: boolean;
  };
  render(force?: boolean): void;
};

export function resizeColorCycleTargetRuntimeSurfaces(
  context: ColorCycleTargetResizeContext,
): void {
  const width = context.getCanvasWidth();
  const height = context.getCanvasHeight();
  context.forEachAnimator((animator) => {
    try {
      animator.resize(width, height);
    } catch {
      // Ignore resize failures; full-resolution preparation will correct on next use.
    }
  });

  const pixelCount = context.getCanvasPixelCount();
  for (const strokeData of context.getStrokeStateValues()) {
    resizeLayerStrokeBuffersAfterTargetCanvasChange(strokeData, pixelCount);
  }
}

export function setColorCycleTargetCanvas(
  context: ColorCycleTargetCanvasUpdateContext,
  canvas: HTMLCanvasElement | null,
): void {
  const targetUpdate = context.setTargetCanvas(canvas);
  if (!targetUpdate.changed) {
    return;
  }

  if (targetUpdate.dimensionsChanged) {
    resizeColorCycleTargetRuntimeSurfaces(context);
  }

  try {
    context.render(false);
  } catch {
    // Best-effort refresh; failures should not break stroke flow.
  }
}
