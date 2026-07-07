import type { ColorCycleAnimator } from '@/lib/ColorCycleAnimator';
import type { FlowMode } from '@/lib/colorCycle/flowEncoding';

import type { LayerStrokeState } from './colorCycleCanvas2DTypes';
import {
  createColorCycleAnimatorForLayer,
  getOrCreateColorCycleAnimator,
  type ColorCycleAnimatorLifecycleContext,
} from './colorCycleAnimatorLifecycleRuntime';
import {
  ensureColorCycleFullResolution,
  type ColorCycleFullResolutionContext,
  type ColorCycleFullResolutionReason,
} from './colorCycleFullResolutionRuntime';

export type ColorCycleAnimatorApiRuntimeDeps = {
  getAnimator(layerId: string): ColorCycleAnimator | undefined;
  hasAnimator(layerId: string): boolean;
  setAnimator(layerId: string, animator: ColorCycleAnimator): void;
  getStrokeState(layerId: string): LayerStrokeState | undefined;
  ensureStrokeState(layerId: string, createStrokeState: () => LayerStrokeState): LayerStrokeState;
  createStrokeState(options: { hasContent?: boolean; bufferSize?: number }): LayerStrokeState;
  getCanvasWidth(): number;
  getCanvasHeight(): number;
  getFps(): number;
  getForceCanvas2D(): boolean;
  getLegacyFlowMode(): FlowMode;
};

export class ColorCycleAnimatorApiRuntime {
  constructor(
    private readonly deps: ColorCycleAnimatorApiRuntimeDeps,
  ) {}

  readonly createAnimator = (
    layerId: string,
    options: { initial: 'reduced' | 'full' },
  ): ColorCycleAnimator => (
    createColorCycleAnimatorForLayer(
      this.getAnimatorLifecycleContext(),
      layerId,
      options,
    )
  );

  readonly getAnimator = (layerId: string): ColorCycleAnimator => (
    getOrCreateColorCycleAnimator(this.getAnimatorLifecycleContext(), layerId)
  );

  readonly ensureFullResolution = (
    layerId: string,
    reason: ColorCycleFullResolutionReason,
  ): ColorCycleAnimator => (
    ensureColorCycleFullResolution(
      this.getFullResolutionContext(),
      layerId,
      reason,
    )
  );

  private getFullResolutionContext(): ColorCycleFullResolutionContext {
    return {
      getAnimator: (layerId) => this.deps.getAnimator(layerId),
      createAnimator: (layerId) => this.createAnimator(layerId, { initial: 'full' }),
      getCanvasWidth: () => this.deps.getCanvasWidth(),
      getCanvasHeight: () => this.deps.getCanvasHeight(),
      getStrokeState: (layerId) => this.deps.getStrokeState(layerId),
    };
  }

  private getAnimatorLifecycleContext(): ColorCycleAnimatorLifecycleContext {
    return {
      getAnimator: (layerId) => this.deps.getAnimator(layerId),
      hasAnimator: (layerId) => this.deps.hasAnimator(layerId),
      setAnimator: (layerId, animator) => this.deps.setAnimator(layerId, animator),
      getStrokeState: (layerId) => this.deps.getStrokeState(layerId),
      ensureStrokeState: (layerId, createStrokeState) =>
        this.deps.ensureStrokeState(layerId, createStrokeState),
      createStrokeState: (options) => this.deps.createStrokeState(options),
      getCanvasWidth: () => this.deps.getCanvasWidth(),
      getCanvasHeight: () => this.deps.getCanvasHeight(),
      getFps: () => this.deps.getFps(),
      getForceCanvas2D: () => this.deps.getForceCanvas2D(),
      getLegacyFlowMode: () => this.deps.getLegacyFlowMode(),
    };
  }
}
