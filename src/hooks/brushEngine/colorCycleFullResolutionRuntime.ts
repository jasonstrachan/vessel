import type { ColorCycleAnimator } from '@/lib/ColorCycleAnimator';

import type { LayerStrokeState } from './colorCycleCanvas2DTypes';
import { ensureLayerStrokeBuffersSize } from './colorCycleLayerStrokeBuffers';

export type ColorCycleFullResolutionReason = 'stroke' | 'fill' | 'restore';

export type ColorCycleFullResolutionContext = {
  getAnimator(layerId: string): ColorCycleAnimator | undefined;
  createAnimator(layerId: string): ColorCycleAnimator;
  getCanvasWidth(): number;
  getCanvasHeight(): number;
  getStrokeState(layerId: string): LayerStrokeState | undefined;
};

export function ensureColorCycleFullResolution(
  context: ColorCycleFullResolutionContext,
  layerId: string,
  reason: ColorCycleFullResolutionReason,
): ColorCycleAnimator {
  const animator = context.getAnimator(layerId) ?? context.createAnimator(layerId);
  const canvasWidth = context.getCanvasWidth();
  const canvasHeight = context.getCanvasHeight();
  const { width, height } = animator.getDimensions();
  if (width !== canvasWidth || height !== canvasHeight) {
    animator.resize(canvasWidth, canvasHeight);
  }

  const strokeData = context.getStrokeState(layerId);
  if (strokeData) {
    ensureLayerStrokeBuffersSize(strokeData, canvasWidth * canvasHeight);
  }

  if (process.env.NODE_ENV !== 'production' && reason === 'stroke') {
    const dims = animator.getDimensions();
    console.assert(
      dims.width === canvasWidth && dims.height === canvasHeight,
      '[CC] Animator size mismatch during stroke',
      {
        layerId,
        reason,
        animator: dims,
        brush: { width: canvasWidth, height: canvasHeight },
      },
    );
  }

  return animator;
}
