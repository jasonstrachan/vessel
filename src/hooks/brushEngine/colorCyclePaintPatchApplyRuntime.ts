import type { ColorCycleAnimator } from '@/lib/ColorCycleAnimator';
import {
  executeColorCycleBrushPaintPatchRuntimeApply,
  type ColorCycleBrushPaintPatchExtras,
  type ColorCycleBrushPaintPatchStrokeStateCommit,
} from '@/lib/colorCycle/document';

import type { LayerStrokeState } from './colorCycleCanvas2DTypes';

type PaintPatchRoi = { x: number; y: number; width: number; height: number };

export type ColorCyclePaintPatchApplyRuntimeContext = {
  getCanvasWidth(): number;
  getCanvasHeight(): number;
  ensureStrokeState(layerId: string): LayerStrokeState;
  ensureAnimator(layerId: string): ColorCycleAnimator;
  bindStrokeBuffersToAnimator(strokeState: LayerStrokeState, animator: ColorCycleAnimator): void;
  publishStrokeState(
    layerId: string,
    strokeState: LayerStrokeState,
    publish: ColorCycleBrushPaintPatchStrokeStateCommit['publish'],
  ): void;
  snapshotFromBuffers(strokeState: LayerStrokeState): void;
  markLayerDirty(layerId: string): void;
};

export type ColorCyclePaintPatchApplyRuntime = {
  apply(
    layerId: string,
    roi: PaintPatchRoi,
    bytes: Uint8Array,
    extras?: ColorCycleBrushPaintPatchExtras,
  ): boolean;
};

export function createColorCyclePaintPatchApplyRuntime(
  context: ColorCyclePaintPatchApplyRuntimeContext,
): ColorCyclePaintPatchApplyRuntime {
  return {
    apply: (layerId, roi, bytes, extras) => executeColorCycleBrushPaintPatchRuntimeApply({
      layerId,
      roi,
      bytes,
      extras,
      canvasWidth: context.getCanvasWidth(),
      canvasHeight: context.getCanvasHeight(),
      ensureStrokeState: (targetLayerId) => context.ensureStrokeState(targetLayerId),
      ensureAnimator: (targetLayerId) => context.ensureAnimator(targetLayerId),
      bindStrokeBuffersToAnimator: (strokeState, animator) => {
        context.bindStrokeBuffersToAnimator(strokeState, animator);
      },
      publishStrokeState: (targetLayerId, strokeState, publish) => {
        context.publishStrokeState(targetLayerId, strokeState, publish);
      },
      setDefIdData: (animator, def) => animator.setDefIdData(def, { forceDirty: true }),
      setIndexBuffers: (animator, buffers) => animator.setIndexBufferFromArray(
        buffers.paint,
        buffers.gid,
        buffers.spd,
        buffers.flow,
        buffers.phase,
      ),
      snapshotFromBuffers: (strokeState) => context.snapshotFromBuffers(strokeState),
      markDirtyBounds: (animator, bounds) => animator.markDirtyBounds(bounds),
      markLayerDirty: (targetLayerId) => context.markLayerDirty(targetLayerId),
    }),
  };
}
