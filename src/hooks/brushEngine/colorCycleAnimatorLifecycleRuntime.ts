import { ColorCycleAnimator } from '@/lib/ColorCycleAnimator';
import type { FlowMode } from '@/lib/colorCycle/flowEncoding';

import type { LayerStrokeState } from './colorCycleCanvas2DTypes';

const REDUCED_INIT_SIZE = 256;

export type ColorCycleAnimatorLifecycleContext = {
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

export function createColorCycleAnimatorForLayer(
  context: ColorCycleAnimatorLifecycleContext,
  layerId: string,
  options: { initial: 'reduced' | 'full' },
): ColorCycleAnimator {
  const useReduced = options.initial === 'reduced';
  const animator = new ColorCycleAnimator({
    width: useReduced ? REDUCED_INIT_SIZE : context.getCanvasWidth(),
    height: useReduced ? REDUCED_INIT_SIZE : context.getCanvasHeight(),
    fps: context.getFps(),
    speed: 1,
    autoStart: false,
    lazyInit: true,
    forceCanvas2D: context.getForceCanvas2D(),
  });
  animator.setFlowMode(context.getLegacyFlowMode());
  context.setAnimator(layerId, animator);

  context.ensureStrokeState(
    layerId,
    () => context.createStrokeState({ hasContent: false, bufferSize: 0 }),
  );

  return animator;
}

export function getOrCreateColorCycleAnimator(
  context: ColorCycleAnimatorLifecycleContext,
  layerId: string,
): ColorCycleAnimator {
  if (!layerId) {
    throw new Error('Layer ID is required');
  }

  if (!context.hasAnimator(layerId)) {
    const strokeData = context.getStrokeState(layerId);
    const initial = strokeData?.hasContent ? 'full' : 'reduced';
    createColorCycleAnimatorForLayer(context, layerId, { initial });
  }

  const animator = context.getAnimator(layerId);
  if (!animator) {
    throw new Error(`Failed to get or create animator for layer: ${layerId}`);
  }

  return animator;
}
