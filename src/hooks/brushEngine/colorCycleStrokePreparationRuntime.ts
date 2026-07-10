import type { ColorCycleAnimator } from '@/lib/ColorCycleAnimator';

import type { LayerStrokeState } from './colorCycleCanvas2DTypes';
import { ensureLayerStrokeBuffersSize } from './colorCycleLayerStrokeBuffers';

export type ColorCycleStrokePreparationContext = {
  ensureFullResolution(layerId: string, reason: 'stroke'): ColorCycleAnimator;
  getStrokeState(layerId: string): LayerStrokeState | undefined;
  createStrokeState(options: { hasContent: boolean; contentIsOptimistic: boolean }): LayerStrokeState;
  setStrokeState(layerId: string, strokeData: LayerStrokeState): void;
  bindStrokeBuffersToAnimator(strokeData: LayerStrokeState, animator: ColorCycleAnimator): void;
  getCanvasBufferSize(): number;
  getActiveSlot(layerId: string): number;
};

export function prepareColorCycleStrokeContext(
  context: ColorCycleStrokePreparationContext,
  layerId: string,
): {
  id: string;
  animator: ColorCycleAnimator;
  strokeData: LayerStrokeState;
} {
  const id = layerId;
  const animator = context.ensureFullResolution(id, 'stroke');
  let strokeData = context.getStrokeState(id);
  let shouldBindBuffers = false;
  if (!strokeData) {
    strokeData = context.createStrokeState({
      hasContent: true,
      contentIsOptimistic: true,
    });
    context.setStrokeState(id, strokeData);
    shouldBindBuffers = true;
  } else if (!strokeData.hasContent) {
    strokeData.hasContent = true;
    strokeData.contentIsOptimistic = true;
    const expectedSize = context.getCanvasBufferSize();
    shouldBindBuffers = strokeData.buffers.paint.length !== expectedSize;
    ensureLayerStrokeBuffersSize(strokeData, context.getCanvasBufferSize());
  }

  if (shouldBindBuffers) {
    context.bindStrokeBuffersToAnimator(strokeData, animator);
  }

  const activeSlot = strokeData.flow.activeSlot ?? context.getActiveSlot(id);
  strokeData.flow.activeSlot = activeSlot;

  return { id, animator, strokeData };
}
