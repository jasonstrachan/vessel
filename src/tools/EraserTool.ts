import type { Layer } from '@/types';
import { BrushShape } from '@/types';
import { ROITracker, type ROI } from '@/utils/ROITracker';
import type { MaskManager } from '@/layers/MaskManager';
import type { BrushStampSource } from './stamps/BrushStampSource';
import { RasterEraseStrategy } from './strategies/RasterEraseStrategy';
import { CCMaskEraseStrategy } from './strategies/CCMaskEraseStrategy';
import type { EraseStrategy } from './strategies/types';
import { perfMark, perfMeasure } from '@/utils/perf/ccPerfProbe';
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
      ? new CCMaskEraseStrategy(deps.maskManager, layer.id, deps.getBrushSettings)
      : new RasterEraseStrategy(deps.overlayCtx);
  }

  begin(point: CanvasPoint, pressure = 1): void {
    perfMark('eraser:begin');
    perfMark('eraser:roi-build:start');
    this.roi.reset();
    this.isActive = true;

    const target = this.layer.layerType === 'color-cycle' ? this.layer : this.deps.overlayCtx;
    const ctx = this.strategy.begin(target, { opacity: this.options.opacity });
    this.activeContext = ctx;
    if (ctx && this.stampSource) {
      this.stampSource.begin(ctx, point, pressure);
    }

    this.recordROI(null, point);
  }

  move(point: CanvasPoint, pressure = 1, from?: CanvasPoint | null): void {
    if (!this.isActive || !this.activeContext) {
      return;
    }
    perfMark('eraser:move');
    const lastPoint = from ?? this.stampSource?.last() ?? null;
    this.strategy.stamp(lastPoint ?? point, point, pressure, this.stampSource);
    this.recordROI(lastPoint, point);
  }

  end(): void {
    if (!this.isActive) {
      return;
    }
    perfMark('eraser:end');
    this.strategy.end();
    this.stampSource?.end();
    this.isActive = false;
    this.activeContext = null;
    perfMark('eraser:roi-build:end');
    perfMeasure('eraser:roi-build', 'eraser:roi-build:start', 'eraser:roi-build:end');
  }

  cancel(): void {
    this.end();
  }

  getROI(): ROI | null {
    return this.roi.rect();
  }

  private recordROI(from: CanvasPoint | null, to: CanvasPoint): void {
    const padding = Math.ceil(this.deps.brushHalfSize()) + ROI_PADDING;
    if (from) {
      this.roi.addSegment(from, to, padding);
    } else {
      this.roi.addPoint(to, padding);
    }
  }
}
