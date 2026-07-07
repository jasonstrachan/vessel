import type { ColorCycleAnimator } from '@/lib/ColorCycleAnimator';

import type {
  ColorCycleRuntimeMutationReason,
} from './colorCycleCanvas2DTypes';
import {
  clearColorCyclePaintBuffer,
  type ColorCyclePaintBufferClearContext,
} from './colorCyclePaintBufferClearRuntime';

export type ColorCyclePaintBufferClearApiRuntimeDeps = {
  getActiveLayerId(): string | null;
  isHistoryRestore(): boolean;
  mutateLayerStrokeState: ColorCyclePaintBufferClearContext['mutateLayerStrokeState'];
  ensureFullResolution(layerId: string, reason: 'stroke'): ColorCycleAnimator;
  render(force: boolean): void;
  isAnimating(): boolean;
  hasAnimatedContent(): boolean;
  stopAnimation(): void;
};

export class ColorCyclePaintBufferClearApiRuntime {
  constructor(
    private readonly deps: ColorCyclePaintBufferClearApiRuntimeDeps,
  ) {}

  readonly clearPaintBuffer = (
    layerId?: string,
    reason: ColorCycleRuntimeMutationReason = 'manual-clear-layer',
  ): void => {
    clearColorCyclePaintBuffer(this.getContext(), layerId, reason);
  };

  private getContext(): ColorCyclePaintBufferClearContext {
    return {
      getActiveLayerId: () => this.deps.getActiveLayerId(),
      isHistoryRestore: () => this.deps.isHistoryRestore(),
      mutateLayerStrokeState: (params) => this.deps.mutateLayerStrokeState(params),
      ensureFullResolution: (layerId, reason) => this.deps.ensureFullResolution(layerId, reason),
      render: (force) => this.deps.render(force),
      isAnimating: () => this.deps.isAnimating(),
      hasAnimatedContent: () => this.deps.hasAnimatedContent(),
      stopAnimation: () => this.deps.stopAnimation(),
    };
  }
}
