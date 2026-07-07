import type { ColorCycleAnimator } from '@/lib/ColorCycleAnimator';

import type {
  ColorCycleRuntimeMutationReason,
  ColorCycleRuntimeMutationSource,
  LayerStrokeState,
} from './colorCycleCanvas2DTypes';

type StrokeStateMutationParams = {
  layerId: string;
  reason: ColorCycleRuntimeMutationReason;
  source: ColorCycleRuntimeMutationSource;
  expectedDestructive?: boolean;
  mutate: (strokeData: LayerStrokeState) => void;
  after?: {
    hasContent?: boolean;
    strokeCounter?: number;
  };
  markDirty?: boolean;
};

export type ColorCyclePaintBufferClearContext = {
  getActiveLayerId(): string | null;
  isHistoryRestore(): boolean;
  mutateLayerStrokeState(params: StrokeStateMutationParams): LayerStrokeState;
  ensureFullResolution(layerId: string, reason: 'stroke'): ColorCycleAnimator;
  render(force: boolean): void;
  isAnimating(): boolean;
  hasAnimatedContent(): boolean;
  stopAnimation(): void;
};

export function clearColorCyclePaintBuffer(
  context: ColorCyclePaintBufferClearContext,
  layerId: string | undefined,
  reason: ColorCycleRuntimeMutationReason,
): void {
  const id = layerId || context.getActiveLayerId() || 'default';
  if (context.isHistoryRestore()) {
    if (process.env.NODE_ENV !== 'production') {
      console.assert(false, '[ColorCycleBrush] clearPaintBuffer invoked during history restore');
    }
    return;
  }

  const strokeData = context.mutateLayerStrokeState({
    layerId: id,
    reason,
    source: 'clear',
    expectedDestructive: true,
    mutate: (state) => {
      state.buffers.paint.fill(0);
      state.buffers.gid.fill(0);
      state.buffers.spd.fill(0);
      state.buffers.flow.fill(0);
      state.buffers.phase.fill(0);
      state.buffers.def.fill(0);
      state.externalBase.hasExternalBase = false;
    },
    after: { hasContent: false },
  });

  const animator = context.ensureFullResolution(id, 'stroke');
  animator.setIndexBufferFromArray(
    strokeData.buffers.paint,
    strokeData.buffers.gid,
    strokeData.buffers.spd,
    strokeData.buffers.flow,
    strokeData.buffers.phase,
  );
  animator.setDefIdData(strokeData.buffers.def);
  animator.forceRender();
  context.render(false);

  if (context.isAnimating() && !context.hasAnimatedContent()) {
    context.stopAnimation();
  }
}
