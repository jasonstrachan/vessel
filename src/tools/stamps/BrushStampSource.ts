import type { AppState } from '@/stores/useAppStore';
import type { CustomBrushStrokeData } from '@/hooks/brushEngine/BrushEngineFacade';
import { resolveEraserBrushSettings } from '@/stores/helpers/eraserSettings';

type CanvasPoint = { x: number; y: number };

type BrushStampRuntime = {
  drawBrush: (
    ctx: CanvasRenderingContext2D,
    from: CanvasPoint,
    to: CanvasPoint,
    options?: BrushStampDrawOptions & { customBrushData?: CustomBrushStrokeData; target?: 'erase-mask' }
  ) => void;
  updateConfig?: (config: { brushSettings: AppState['tools']['brushSettings'] }) => void;
  finalizeStroke?: (ctx: CanvasRenderingContext2D) => unknown;
};

type UserBrushEngineAdapter = {
  isUserBrush: (brushId: string) => boolean;
  setActiveBrush: (brushId: string | null) => void;
  startStroke: (ctx: CanvasRenderingContext2D, x: number, y: number, pressure?: number) => void;
  continueStroke: (ctx: CanvasRenderingContext2D, x: number, y: number, pressure?: number) => void;
  endStroke: () => void;
};

type ResolveCustomBrush = (state: AppState) => CustomBrushStrokeData | undefined;

export interface BrushStampSourceDeps {
  getState: () => AppState;
  brushRuntime: BrushStampRuntime;
  userBrushEngine: UserBrushEngineAdapter;
  resolveCustomBrush: ResolveCustomBrush;
}

export interface BrushStampSourceOptions {
  forceOpaque?: boolean;
}

export interface BrushStampMotion {
  velocityPxPerMs?: number;
  timestampMs?: number;
}

export interface BrushStampDrawOptions extends BrushStampMotion {
  pressure?: number;
}

export interface BrushStampBeginOptions {
  target?: 'erase-mask';
  skipInitialStamp?: boolean;
}

export class BrushStampSource {
  private readonly getState: () => AppState;
  private readonly brushRuntime: BrushStampRuntime;
  private readonly userBrushEngine: UserBrushEngineAdapter;
  private readonly resolveCustomBrush: ResolveCustomBrush;

  private target: 'erase-mask' | undefined;
  private activeCtx: CanvasRenderingContext2D | null = null;
  private lastPoint: CanvasPoint | null = null;
  private customBrushData: CustomBrushStrokeData | undefined;
  private activeBrushId: string | null = null;
  private usingUserBrush = false;
  private readonly forceOpaque: boolean;
  private originalOpacity: number | null = null;
  private opacityOverrideApplied = false;
  private eraserOverrideApplied = false;

  constructor(deps: BrushStampSourceDeps, options: BrushStampSourceOptions = {}) {
    this.getState = deps.getState;
    this.brushRuntime = deps.brushRuntime;
    this.userBrushEngine = deps.userBrushEngine;
    this.resolveCustomBrush = deps.resolveCustomBrush;
    this.forceOpaque = options.forceOpaque === true;
  }

  begin(
    ctx: CanvasRenderingContext2D,
    point: CanvasPoint,
    pressure = 1,
    options: BrushStampBeginOptions = {}
  ): void {
    this.activeCtx = ctx;
    this.target = options.target;
    this.lastPoint = point;

    const state = this.getState();
    const isEraserTool = state.tools.currentTool === 'eraser';
    this.customBrushData = isEraserTool ? undefined : this.resolveCustomBrush(state);
    this.activeBrushId = state.currentBrushPreset?.id ?? null;
    this.usingUserBrush =
      !isEraserTool && !!this.activeBrushId && this.userBrushEngine.isUserBrush(this.activeBrushId);

    this.applyOverridesIfNeeded(state);

    if (this.usingUserBrush) {
      this.userBrushEngine.setActiveBrush(this.activeBrushId);
      this.userBrushEngine.startStroke(ctx, point.x, point.y, pressure);
      return;
    }

    if (!options.skipInitialStamp) {
      this.brushRuntime.drawBrush(ctx, point, point, {
        pressure,
        customBrushData: this.customBrushData,
        ...(this.target ? { target: this.target } : {}),
      });
    }
  }

  draw(
    ctx: CanvasRenderingContext2D,
    from: CanvasPoint,
    to: CanvasPoint,
    options: BrushStampDrawOptions = {}
  ): void {
    const pressure = options.pressure ?? 1;
    this.activeCtx = ctx;
    this.lastPoint = to;

    if (this.usingUserBrush) {
      this.userBrushEngine.continueStroke(ctx, to.x, to.y, pressure);
      return;
    }

    this.brushRuntime.drawBrush(ctx, from, to, {
      ...options,
      pressure,
      customBrushData: this.customBrushData,
      ...(this.target ? { target: this.target } : {}),
    });
  }

  end(cancelled = false): void {
    if (this.eraserOverrideApplied && this.activeCtx && !cancelled) {
      // Flush deferred stamps before the tool restores its composition and selection clip.
      this.brushRuntime.finalizeStroke?.(this.activeCtx);
    }
    if (this.usingUserBrush) {
      this.userBrushEngine.endStroke();
    }
    if (this.eraserOverrideApplied || this.opacityOverrideApplied) {
      const state = this.getState();
      const brushSettings = state.tools.brushSettings;
      const restoreOpacity = this.opacityOverrideApplied
        ? this.originalOpacity ?? brushSettings.opacity
        : brushSettings.opacity;
      this.brushRuntime.updateConfig?.({
        brushSettings: {
          ...brushSettings,
          opacity: restoreOpacity,
        }
      });
    }
    this.activeCtx = null;
    this.target = undefined;
    this.lastPoint = null;
    this.customBrushData = undefined;
    this.activeBrushId = null;
    this.usingUserBrush = false;
    this.originalOpacity = null;
    this.opacityOverrideApplied = false;
    this.eraserOverrideApplied = false;
  }

  last(): CanvasPoint | null {
    return this.lastPoint;
  }

  private applyOverridesIfNeeded(state: AppState): void {
    const eraserSettings = state.tools.eraserSettings;
    const brushSettings = state.tools.brushSettings;
    const updateConfig = this.brushRuntime.updateConfig;
    this.eraserOverrideApplied = state.tools.currentTool === 'eraser';
    if (this.eraserOverrideApplied) {
      const settings = resolveEraserBrushSettings(brushSettings, eraserSettings);
      updateConfig?.({ brushSettings: this.forceOpaque ? { ...settings, opacity: 1 } : settings });
      return;
    }
    if (!updateConfig) {
      this.opacityOverrideApplied = false;
      this.originalOpacity = null;
      return;
    }

    if (this.forceOpaque && brushSettings.opacity !== 1) {
      this.originalOpacity = brushSettings.opacity ?? null;
      this.opacityOverrideApplied = true;
      updateConfig({
        brushSettings: {
          ...brushSettings,
          opacity: 1,
        },
      });
    } else {
      this.opacityOverrideApplied = false;
      this.originalOpacity = null;
    }
  }
}
