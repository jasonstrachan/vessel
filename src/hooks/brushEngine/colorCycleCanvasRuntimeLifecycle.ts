export type ColorCycleLifecycleAnimator = {
  clear(): void;
  stop(): void;
  cleanup?: () => void;
  dispose?: () => void;
  destroy?: () => void;
  setForceCanvas2D?: (useCanvas2D: boolean) => void;
  forceRender?: () => void;
  hasWebGL?: () => boolean;
};

export type ColorCycleCanvasRuntimeLifecycleContext = {
  isHistoryRestore(): boolean;
  assertHistoryClearBlocked(): void;
  forEachAnimator(callback: (animator: ColorCycleLifecycleAnimator) => void): void;
  animatorValues(): Iterable<ColorCycleLifecycleAnimator>;
  animatorEntries(): Iterable<[string, ColorCycleLifecycleAnimator]>;
  clearAnimators(): void;
  cancelScheduledRender(): void;
  stopAnimation(): void;
  pauseAnimation(): void;
  render(): void;
  clearLayerStrokeStatesForReset(): void;
  clearRuntimeDocuments(): void;
  clearGradientSlots(): void;
  clearDefBindings(): void;
  clearCustomStampRuntime(): void;
  getForceCanvas2D(): boolean;
  setForceCanvas2D(useCanvas2D: boolean): void;
  warn(message: string, error: unknown): void;
  logDisposed(): void;
};

export function clearColorCycleRuntime(context: ColorCycleCanvasRuntimeLifecycleContext): void {
  if (context.isHistoryRestore()) {
    context.assertHistoryClearBlocked();
    return;
  }
  context.forEachAnimator((animator) => animator.clear());
  context.clearLayerStrokeStatesForReset();
  context.render();
}

export function setColorCycleRuntimeUseCanvas2D(
  context: ColorCycleCanvasRuntimeLifecycleContext,
  useCanvas2D: boolean,
): void {
  if (context.getForceCanvas2D() === useCanvas2D) {
    return;
  }

  context.setForceCanvas2D(useCanvas2D);

  context.forEachAnimator((animator) => {
    try {
      animator.setForceCanvas2D?.(useCanvas2D);
      animator.forceRender?.();
    } catch {}
  });

  try {
    context.render();
  } catch {}
}

export function isColorCycleRuntimeUsingWebGL(context: ColorCycleCanvasRuntimeLifecycleContext): boolean {
  if (context.getForceCanvas2D()) {
    return false;
  }

  for (const animator of context.animatorValues()) {
    if (animator.hasWebGL?.()) {
      return true;
    }
  }

  return false;
}

export function cleanupColorCycleRuntime(context: ColorCycleCanvasRuntimeLifecycleContext): void {
  context.cancelScheduledRender();
  context.stopAnimation();

  context.forEachAnimator((animator) => {
    try {
      animator.stop();
    } catch {}
    try {
      animator.cleanup?.();
    } catch {}
  });

  context.clearAnimators();
  context.clearRuntimeDocuments();
}

export function disposeColorCycleRuntime(context: ColorCycleCanvasRuntimeLifecycleContext): void {
  context.pauseAnimation();

  for (const [layerId, animator] of context.animatorEntries()) {
    try {
      if (typeof animator.dispose === 'function') {
        animator.dispose();
      } else if (typeof animator.destroy === 'function') {
        animator.destroy();
      } else if (typeof animator.cleanup === 'function') {
        animator.cleanup();
      } else {
        animator.stop();
      }
    } catch (error) {
      context.warn(`Error disposing animator for layer ${layerId}:`, error);
    }
  }
  context.clearAnimators();

  context.clearRuntimeDocuments();
  context.cancelScheduledRender();
  context.clearGradientSlots();
  context.clearDefBindings();
  context.clearCustomStampRuntime();

  context.logDisposed();
}
