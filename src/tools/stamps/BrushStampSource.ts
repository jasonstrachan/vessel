import type { AppState } from '@/stores/useAppStore';
import type { CustomBrushStrokeData } from '@/hooks/brushEngine/BrushEngineFacade';

type CanvasPoint = { x: number; y: number };

type BrushEngineAdapter = {
  drawBrush: (
    ctx: CanvasRenderingContext2D,
    from: CanvasPoint,
    to: CanvasPoint,
    options?: { pressure?: number; customBrushData?: CustomBrushStrokeData }
  ) => void;
  updateConfig?: (config: { brushSettings: AppState['tools']['brushSettings'] }) => void;
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
  brushEngine: BrushEngineAdapter;
  userBrushEngine: UserBrushEngineAdapter;
  resolveCustomBrush: ResolveCustomBrush;
}

export interface BrushStampDrawOptions {
  pressure?: number;
}

export class BrushStampSource {
  private readonly getState: () => AppState;
  private readonly brushEngine: BrushEngineAdapter;
  private readonly userBrushEngine: UserBrushEngineAdapter;
  private readonly resolveCustomBrush: ResolveCustomBrush;

  private activeCtx: CanvasRenderingContext2D | null = null;
  private lastPoint: CanvasPoint | null = null;
  private customBrushData: CustomBrushStrokeData | undefined;
  private activeBrushId: string | null = null;
  private usingUserBrush = false;
  private originalBrushSize: number | null = null;
  private sizeOverrideApplied = false;

  constructor(deps: BrushStampSourceDeps) {
    this.getState = deps.getState;
    this.brushEngine = deps.brushEngine;
    this.userBrushEngine = deps.userBrushEngine;
    this.resolveCustomBrush = deps.resolveCustomBrush;
  }

  begin(ctx: CanvasRenderingContext2D, point: CanvasPoint, pressure = 1): void {
    this.activeCtx = ctx;
    this.lastPoint = point;

    const state = this.getState();
    this.customBrushData = this.resolveCustomBrush(state);
    this.activeBrushId = state.currentBrushPreset?.id ?? null;
    this.usingUserBrush =
      !!this.activeBrushId && this.userBrushEngine.isUserBrush(this.activeBrushId);

    this.applySizeOverrideIfNeeded(state);

    if (this.usingUserBrush) {
      this.userBrushEngine.setActiveBrush(this.activeBrushId);
      this.userBrushEngine.startStroke(ctx, point.x, point.y, pressure);
      return;
    }

    this.brushEngine.drawBrush(ctx, point, point, {
      pressure,
      customBrushData: this.customBrushData
    });
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

    this.brushEngine.drawBrush(ctx, from, to, {
      pressure,
      customBrushData: this.customBrushData
    });
  }

  end(): void {
    if (this.usingUserBrush) {
      this.userBrushEngine.endStroke();
    }
    if (this.sizeOverrideApplied) {
      const state = this.getState();
      const brushSettings = state.tools.brushSettings;
      const restoreSize = this.originalBrushSize ?? brushSettings.size;
      this.brushEngine.updateConfig?.({
        brushSettings: {
          ...brushSettings,
          size: restoreSize
        }
      });
    }
    this.activeCtx = null;
    this.lastPoint = null;
    this.customBrushData = undefined;
    this.activeBrushId = null;
    this.usingUserBrush = false;
    this.originalBrushSize = null;
    this.sizeOverrideApplied = false;
  }

  last(): CanvasPoint | null {
    return this.lastPoint;
  }

  private applySizeOverrideIfNeeded(state: AppState): void {
    if (state.tools.currentTool !== 'eraser') {
      this.sizeOverrideApplied = false;
      this.originalBrushSize = null;
      return;
    }
    const eraserSettings = state.tools.eraserSettings;
    const shouldLink =
      eraserSettings.linkSizeToBrush !== false && eraserSettings.linkSizeToBrush !== 0;
    if (shouldLink || !this.brushEngine.updateConfig) {
      this.sizeOverrideApplied = false;
      this.originalBrushSize = null;
      return;
    }
    const overrideSize = eraserSettings.size ?? state.tools.brushSettings.size;
    if (typeof overrideSize !== 'number' || Number.isNaN(overrideSize) || overrideSize <= 0) {
      this.sizeOverrideApplied = false;
      this.originalBrushSize = null;
      return;
    }

    const brushSettings = state.tools.brushSettings;
    this.originalBrushSize = brushSettings.size;
    this.sizeOverrideApplied = true;
    this.brushEngine.updateConfig({
      brushSettings: {
        ...brushSettings,
        size: overrideSize
      }
    });
  }
}
