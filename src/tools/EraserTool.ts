import type { Layer } from '@/types';
import { BrushShape } from '@/types';
import { ROITracker, type ROI } from '@/utils/ROITracker';
import type { MaskManager } from '@/layers/MaskManager';
import type { BrushStampSource } from './stamps/BrushStampSource';
import { RasterEraseStrategy } from './strategies/RasterEraseStrategy';
import { CCMaskEraseStrategy } from './strategies/CCMaskEraseStrategy';
import type { EraseStrategy } from './strategies/types';
import type { CustomBrushStrokeData } from '@/hooks/brushEngine/BrushEngineFacade';

export type CanvasPoint = { x: number; y: number };

export interface StrokeTool {
  begin(point: CanvasPoint, pressure?: number): void;
  move(point: CanvasPoint, pressure?: number, from?: CanvasPoint | null): void;
  end(): void | Promise<void>;
  cancel(): void;
  getROI(): ROI | null;
}

export interface EraserToolOptions {
  opacity: number;
}

export interface EraserToolDeps {
  overlayCtx: CanvasRenderingContext2D;
  maskManager: MaskManager;
  createStampSource: () => BrushStampSource;
  brushHalfSize: () => number;
  getBrushSettings: () => {
    size: number;
    pressureEnabled: boolean;
    minPressure: number;
    maxPressure: number;
    brushShape: BrushShape;
    customStamp?: CustomBrushStrokeData;
  };
}

const ROI_PADDING = 2;

export class EraserTool implements StrokeTool {
  private readonly layer: Layer;
  private readonly options: EraserToolOptions;
  private readonly deps: EraserToolDeps;

  private readonly roi = new ROITracker();
  private strategy: EraseStrategy;
  private stampSource: BrushStampSource | null;
  private activeContext: CanvasRenderingContext2D | null = null;
  private isActive = false;

  constructor(layer: Layer, options: EraserToolOptions, deps: EraserToolDeps) {
    this.layer = layer;
    this.options = options;
    this.deps = deps;
    const isColorCycleLayer = layer.layerType === 'color-cycle';
    this.stampSource = isColorCycleLayer ? null : deps.createStampSource();
    this.strategy = isColorCycleLayer
      ? new CCMaskEraseStrategy(deps.maskManager, layer.id, deps.getBrushSettings, deps.overlayCtx)
      : new RasterEraseStrategy(deps.overlayCtx);
  }

  begin(point: CanvasPoint, pressure = 1): void {
    this.roi.reset();
    this.isActive = true;

    const target = this.layer.layerType === 'color-cycle' ? this.layer : this.deps.overlayCtx;
    const ctx = this.strategy.begin(target, { opacity: this.options.opacity });
    this.activeContext = ctx;
    if (ctx && this.stampSource) {
      this.stampSource.begin(ctx, point, pressure);
    } else if (ctx) {
      // Color-cycle erasing uses the mask strategy directly, so stamp once on pointer-down
      // to keep taps and the first preview frame visible before any move event arrives.
      this.strategy.stamp(point, point, pressure, null);
    }

    this.recordROI(null, point);
  }

  move(point: CanvasPoint, pressure = 1, from?: CanvasPoint | null): void {
    if (!this.isActive || !this.activeContext) {
      return;
    }
    const lastPoint = from ?? this.stampSource?.last() ?? null;
    this.strategy.stamp(lastPoint ?? point, point, pressure, this.stampSource);
    this.recordROI(lastPoint, point);
  }

  end(): void {
    if (!this.isActive) {
      return;
    }
    this.strategy.end();
    this.stampSource?.end();
    this.isActive = false;
    this.activeContext = null;
  }

  cancel(): void {
    this.end();
  }

  getROI(): ROI | null {
    return this.roi.rect();
  }

  private recordROI(from: CanvasPoint | null, to: CanvasPoint): void {
    const padding = this.computeRoiPadding();
    if (from) {
      this.roi.addSegment(from, to, padding);
    } else {
      this.roi.addPoint(to, padding);
    }
  }

  private computeRoiPadding(): number {
    const basePadding = Math.ceil(this.deps.brushHalfSize()) + ROI_PADDING;
    const snapshot = this.deps.getBrushSettings();
    if (!snapshot) {
      return basePadding;
    }

    let size = Math.max(1, snapshot.size || 1);
    const customStamp = snapshot.customStamp;
    if (customStamp && !customStamp.isResampler) {
      const maxDim = Math.max(customStamp.width, customStamp.height) || 1;
      size = (size / 100) * maxDim;
    }

    if (snapshot.pressureEnabled) {
      const pressureScale = Math.max(1, (snapshot.maxPressure ?? 200) / 100);
      size *= pressureScale;
    }

    const brushPadding = Math.ceil(size / 2) + ROI_PADDING;
    return Math.max(basePadding, brushPadding);
  }
}
