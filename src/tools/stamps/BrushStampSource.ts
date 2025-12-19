import type { AppState } from '@/stores/useAppStore';
import type { CustomBrushStrokeData } from '@/hooks/brushEngine/BrushEngineFacade';
import { BrushShape } from '@/types';

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
  private originalBrushShape: BrushShape | null = null;
  private shapeOverrideApplied = false;

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

    this.applyOverridesIfNeeded(state);

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
    if (this.sizeOverrideApplied || this.shapeOverrideApplied) {
      const state = this.getState();
      const brushSettings = state.tools.brushSettings;
      const restoreSize = this.sizeOverrideApplied
        ? this.originalBrushSize ?? brushSettings.size
        : brushSettings.size;
      const restoreShape = this.shapeOverrideApplied
        ? this.originalBrushShape ?? brushSettings.brushShape
        : brushSettings.brushShape;
      this.brushEngine.updateConfig?.({
        brushSettings: {
          ...brushSettings,
          size: restoreSize,
          brushShape: restoreShape,
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
    this.originalBrushShape = null;
    this.shapeOverrideApplied = false;
  }

  last(): CanvasPoint | null {
    return this.lastPoint;
  }

  private applyOverridesIfNeeded(state: AppState): void {
    if (state.tools.currentTool !== 'eraser') {
      this.sizeOverrideApplied = false;
      this.originalBrushSize = null;
      this.shapeOverrideApplied = false;
      this.originalBrushShape = null;
      return;
    }
    const eraserSettings = state.tools.eraserSettings;
    const brushSettings = state.tools.brushSettings;
    const hasUpdate = Boolean(this.brushEngine.updateConfig);
    if (!hasUpdate) {
      this.sizeOverrideApplied = false;
      this.originalBrushSize = null;
      this.shapeOverrideApplied = false;
      this.originalBrushShape = null;
      return;
    }

    const nextSettings = { ...brushSettings };
    let changed = false;

    // Size override (when eraser is unlinked from brush size)
    const shouldLink = eraserSettings.linkSizeToBrush !== false;
    if (!shouldLink) {
      const overrideSize = eraserSettings.size ?? brushSettings.size;
      if (typeof overrideSize === 'number' && !Number.isNaN(overrideSize) && overrideSize > 0) {
        this.originalBrushSize = brushSettings.size ?? null;
        nextSettings.size = overrideSize;
        this.sizeOverrideApplied = true;
        changed = true;
      } else {
        this.sizeOverrideApplied = false;
        this.originalBrushSize = null;
      }
    } else {
      this.sizeOverrideApplied = false;
      this.originalBrushSize = null;
    }

    // Shape override (when eraser shape differs from active brush)
    const eraserShape = eraserSettings.brushShape;
    const brushShape = brushSettings.brushShape;
    if (eraserShape && eraserShape !== brushShape) {
      this.originalBrushShape = brushShape ?? null;
      nextSettings.brushShape = eraserShape;
      this.shapeOverrideApplied = true;
      changed = true;
    } else {
      this.shapeOverrideApplied = false;
      this.originalBrushShape = null;
    }

    if (!changed) {
      return;
    }
    this.brushEngine.updateConfig({
      brushSettings: {
        ...brushSettings,
        ...nextSettings,
      }
    });
  }
}
