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

export interface BrushStampSourceOptions {
  forceOpaque?: boolean;
}

export interface BrushStampDrawOptions {
  pressure?: number;
}

export interface BrushStampBeginOptions {
  skipInitialStamp?: boolean;
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
  private readonly forceOpaque: boolean;
  private originalOpacity: number | null = null;
  private opacityOverrideApplied = false;
  private originalBrushSize: number | null = null;
  private sizeOverrideApplied = false;
  private originalBrushShape: BrushShape | null = null;
  private shapeOverrideApplied = false;

  constructor(deps: BrushStampSourceDeps, options: BrushStampSourceOptions = {}) {
    this.getState = deps.getState;
    this.brushEngine = deps.brushEngine;
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

    if (!options.skipInitialStamp) {
      this.brushEngine.drawBrush(ctx, point, point, {
        pressure,
        customBrushData: this.customBrushData
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

    this.brushEngine.drawBrush(ctx, from, to, {
      pressure,
      customBrushData: this.customBrushData
    });
  }

  end(): void {
    if (this.usingUserBrush) {
      this.userBrushEngine.endStroke();
    }
    if (this.opacityOverrideApplied || this.sizeOverrideApplied || this.shapeOverrideApplied) {
      const state = this.getState();
      const brushSettings = state.tools.brushSettings;
      const restoreOpacity = this.opacityOverrideApplied
        ? this.originalOpacity ?? brushSettings.opacity
        : brushSettings.opacity;
      const restoreSize = this.sizeOverrideApplied
        ? this.originalBrushSize ?? brushSettings.size
        : brushSettings.size;
      const restoreShape = this.shapeOverrideApplied
        ? this.originalBrushShape ?? brushSettings.brushShape
        : brushSettings.brushShape;
      this.brushEngine.updateConfig?.({
        brushSettings: {
          ...brushSettings,
          opacity: restoreOpacity,
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
    this.originalOpacity = null;
    this.opacityOverrideApplied = false;
    this.originalBrushSize = null;
    this.sizeOverrideApplied = false;
    this.originalBrushShape = null;
    this.shapeOverrideApplied = false;
  }

  last(): CanvasPoint | null {
    return this.lastPoint;
  }

  private applyOverridesIfNeeded(state: AppState): void {
    const eraserSettings = state.tools.eraserSettings;
    const brushSettings = state.tools.brushSettings;
    const updateConfig = this.brushEngine.updateConfig;
    if (!updateConfig) {
      this.opacityOverrideApplied = false;
      this.originalOpacity = null;
      this.sizeOverrideApplied = false;
      this.originalBrushSize = null;
      this.shapeOverrideApplied = false;
      this.originalBrushShape = null;
      return;
    }

    const nextSettings = { ...brushSettings };
    let changed = false;
    if (this.forceOpaque && brushSettings.opacity !== 1) {
      this.originalOpacity = brushSettings.opacity ?? null;
      nextSettings.opacity = 1;
      this.opacityOverrideApplied = true;
      changed = true;
    } else {
      this.opacityOverrideApplied = false;
      this.originalOpacity = null;
    }

    if (state.tools.currentTool !== 'eraser') {
      this.sizeOverrideApplied = false;
      this.originalBrushSize = null;
      this.shapeOverrideApplied = false;
      this.originalBrushShape = null;
      if (!changed) {
        return;
      }
      updateConfig({
        brushSettings: {
          ...brushSettings,
          ...nextSettings,
        }
      });
      return;
    }

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
    updateConfig({
      brushSettings: {
        ...brushSettings,
        ...nextSettings,
      }
    });
  }
}
