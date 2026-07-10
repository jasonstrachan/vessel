import {
  cleanupColorCycleRuntime,
  clearColorCycleRuntime,
  disposeColorCycleRuntime,
  isColorCycleRuntimeUsingWebGL,
  setColorCycleRuntimeUseCanvas2D,
  type ColorCycleCanvasRuntimeLifecycleContext,
  type ColorCycleLifecycleAnimator,
} from './colorCycleCanvasRuntimeLifecycle';
import {
  hasValidColorCycleBuffers,
  verifyColorCyclePaintBufferCleared,
  type ColorCycleBufferValidationContext,
  type ColorCyclePaintBufferClearVerificationContext,
} from './colorCycleBufferValidationRuntime';
import {
  setColorCycleTargetCanvas,
  type ColorCycleTargetCanvasUpdateContext,
  type ColorCycleTargetResizeContext,
} from './colorCycleTargetResizeRuntime';
import {
  ColorCycleCanvasTargetState,
  type ColorCycleCanvasTargetPresenter,
  type ColorCycleCanvasTargetUpdate,
} from './colorCycleCanvasTargetState';
import type { ColorCycleAnimator } from '@/lib/ColorCycleAnimator';
import type { LayerStrokeState } from './colorCycleCanvas2DTypes';

export type ColorCycleCanvasLifecycleApiRuntimeDeps = {
  isHistoryRestore(): boolean;
  forEachAnimator(callback: (animator: ColorCycleAnimator, layerId: string) => void): void;
  animatorValues(): Iterable<ColorCycleLifecycleAnimator>;
  animatorEntries(): Iterable<[string, ColorCycleLifecycleAnimator]>;
  clearAnimators(): void;
  cancelScheduledRender(): void;
  stopAnimation(): void;
  pauseAnimation(): void;
  render(force?: boolean): void;
  setPresenterTargetCanvas(canvas: HTMLCanvasElement): ReturnType<ColorCycleCanvasTargetPresenter['setTargetCanvas']>;
  clearLayerStrokeStatesForReset(): void;
  clearRuntimeDocuments(): void;
  clearGradientSlots(): void;
  clearDefBindings(): void;
  clearCustomStampRuntime(): void;
  getStrokeStateValues(): Iterable<LayerStrokeState>;
  getActiveLayerId(): string | null;
  getStrokeState(layerId: string): LayerStrokeState | undefined;
  createStrokeState(options: { hasContent: boolean; bufferSize: number }): LayerStrokeState;
  setStrokeState(layerId: string, strokeData: LayerStrokeState): void;
  hasAnimator(layerId: string): boolean;
  getPaintBuffer(layerId: string): Uint8Array | undefined;
  log(message: string, ...args: unknown[]): void;
  warn(message: string, error: unknown): void;
  logDisposed(): void;
};

export class ColorCycleCanvasLifecycleApiRuntime {
  private canvasTarget: ColorCycleCanvasTargetState | null = null;

  constructor(
    private readonly deps: ColorCycleCanvasLifecycleApiRuntimeDeps,
  ) {}

  readonly configureTarget = (canvas: HTMLCanvasElement, forceCanvas2D: boolean): void => {
    this.canvasTarget = new ColorCycleCanvasTargetState(canvas, forceCanvas2D);
  };

  readonly replaceTargetCanvas = (
    canvas: HTMLCanvasElement | null,
    presenter: ColorCycleCanvasTargetPresenter,
  ): ColorCycleCanvasTargetUpdate => (
    this.getCanvasTarget().setTargetCanvas(canvas, presenter)
  );

  readonly getCanvasWidth = (): number => this.getCanvasTarget().width;
  readonly getCanvasHeight = (): number => this.getCanvasTarget().height;
  readonly getCanvasPixelCount = (): number => this.getCanvasTarget().pixelCount;
  readonly getForceCanvas2D = (): boolean => this.getCanvasTarget().forceCanvas2D;
  readonly setForceCanvas2DValue = (useCanvas2D: boolean): void => {
    this.getCanvasTarget().setForceCanvas2D(useCanvas2D);
  };

  readonly clear = (): void => {
    clearColorCycleRuntime(this.getCanvasRuntimeLifecycleContext());
  };

  readonly getCanvas = (): HTMLCanvasElement => (
    this.getCanvasTarget().canvas
  );

  readonly setTargetCanvas = (canvas: HTMLCanvasElement | null): void => {
    setColorCycleTargetCanvas(this.getTargetCanvasUpdateContext(), canvas);
  };

  readonly setUseCanvas2D = (useCanvas2D: boolean): void => {
    setColorCycleRuntimeUseCanvas2D(this.getCanvasRuntimeLifecycleContext(), useCanvas2D);
  };

  readonly isUsingWebGL = (): boolean => (
    isColorCycleRuntimeUsingWebGL(this.getCanvasRuntimeLifecycleContext())
  );

  readonly isContextLost = (): boolean => {
    for (const animator of this.deps.animatorValues()) {
      if (animator.isContextLost?.()) {
        return true;
      }
    }
    return false;
  };

  readonly hasValidBuffers = (): boolean => (
    hasValidColorCycleBuffers(this.getBufferValidationContext())
  );

  readonly cleanup = (): void => {
    cleanupColorCycleRuntime(this.getCanvasRuntimeLifecycleContext());
  };

  readonly destroy = (): void => {
    this.cleanup();
  };

  readonly verifyPaintBufferCleared = (layerId: string): boolean => (
    verifyColorCyclePaintBufferCleared(
      this.getPaintBufferClearVerificationContext(),
      layerId,
    )
  );

  readonly dispose = (): void => {
    disposeColorCycleRuntime(this.getCanvasRuntimeLifecycleContext());
  };

  private getCanvasTarget(): ColorCycleCanvasTargetState {
    if (!this.canvasTarget) {
      throw new Error('Color-cycle canvas target is not configured');
    }
    return this.canvasTarget;
  }

  private getTargetResizeContext(): ColorCycleTargetResizeContext {
    return {
      forEachAnimator: (callback) => this.deps.forEachAnimator((animator) => callback(animator)),
      getStrokeStateValues: () => this.deps.getStrokeStateValues(),
      getCanvasWidth: () => this.getCanvasWidth(),
      getCanvasHeight: () => this.getCanvasHeight(),
      getCanvasPixelCount: () => this.getCanvasPixelCount(),
    };
  }

  private getTargetCanvasUpdateContext(): ColorCycleTargetCanvasUpdateContext {
    return {
      ...this.getTargetResizeContext(),
      setTargetCanvas: (canvas) => this.getCanvasTarget().setTargetCanvas(canvas, {
        setTargetCanvas: (targetCanvas) => this.deps.setPresenterTargetCanvas(targetCanvas),
      }),
      render: (force) => this.deps.render(force),
    };
  }

  private getBufferValidationContext(): ColorCycleBufferValidationContext {
    return {
      getActiveLayerId: () => this.deps.getActiveLayerId(),
      getStrokeState: (layerId) => this.deps.getStrokeState(layerId),
      createStrokeState: (options) => this.deps.createStrokeState(options),
      setStrokeState: (layerId, strokeData) => this.deps.setStrokeState(layerId, strokeData),
      getCanvasPixelCount: () => this.getCanvasPixelCount(),
    };
  }

  private getCanvasRuntimeLifecycleContext(): ColorCycleCanvasRuntimeLifecycleContext {
    return {
      isHistoryRestore: () => this.deps.isHistoryRestore(),
      assertHistoryClearBlocked: () => {
        if (process.env.NODE_ENV !== 'production') {
          console.assert(false, '[ColorCycleBrush] clear() invoked during history restore');
        }
      },
      forEachAnimator: (callback) => this.deps.forEachAnimator((animator) => {
        callback(animator as ColorCycleLifecycleAnimator);
      }),
      animatorValues: () => this.deps.animatorValues(),
      animatorEntries: () => this.deps.animatorEntries(),
      clearAnimators: () => this.deps.clearAnimators(),
      cancelScheduledRender: () => this.deps.cancelScheduledRender(),
      stopAnimation: () => this.deps.stopAnimation(),
      pauseAnimation: () => this.deps.pauseAnimation(),
      render: () => this.deps.render(false),
      clearLayerStrokeStatesForReset: () => this.deps.clearLayerStrokeStatesForReset(),
      clearRuntimeDocuments: () => this.deps.clearRuntimeDocuments(),
      clearGradientSlots: () => this.deps.clearGradientSlots(),
      clearDefBindings: () => this.deps.clearDefBindings(),
      clearCustomStampRuntime: () => this.deps.clearCustomStampRuntime(),
      getForceCanvas2D: () => this.getForceCanvas2D(),
      setForceCanvas2D: (useCanvas2D) => this.setForceCanvas2DValue(useCanvas2D),
      warn: (message, error) => this.deps.warn(message, error),
      logDisposed: () => this.deps.logDisposed(),
    };
  }

  private getPaintBufferClearVerificationContext(): ColorCyclePaintBufferClearVerificationContext {
    return {
      hasAnimator: (layerId) => this.deps.hasAnimator(layerId),
      getPaintBuffer: (layerId) => this.deps.getPaintBuffer(layerId),
      getCanvasWidth: () => this.getCanvasWidth(),
      getCanvasHeight: () => this.getCanvasHeight(),
      log: (message, ...args) => this.deps.log(message, ...args),
      warn: (message, error) => this.deps.warn(message, error),
    };
  }
}
