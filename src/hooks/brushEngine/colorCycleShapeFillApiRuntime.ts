import type { ColorCycleAnimator } from '@/lib/ColorCycleAnimator';
import type { GradientStop } from '@/lib/GradientPalette';
import { FLOW_SLOT_MASK } from '@/lib/colorCycle/flowEncoding';
import { LOST_EDGE_TILE_MAX, LOST_EDGE_TILE_MIN } from '@/utils/ditherConstants';

import type { FillMode, FillOptions, Vec2 } from './colorCycleCanvas2DTypes';
import type { ColorCycleBrushCanvas2DOptions } from './colorCycleBrushContracts';
import type { ColorCycleShapeFillExecutionContext } from './colorCycleShapeFillExecutionTypes';
import {
  dispatchColorCycleShapeFill,
  fillColorCycleConcentricShape,
  fillColorCycleLinearShape,
} from './colorCycleShapeFillDispatchRuntime';
import { ColorCycleShapeFillRuntime } from './colorCycleShapeFillRuntime';
import {
  bindColorCycleRuntimeLayerStrokeBuffersToAnimator,
  createColorCycleRuntimeLayerStrokeState,
  snapshotColorCycleRuntimeLayerStrokeStateFromBuffers,
  type ColorCycleLayerDocumentRuntimeContext,
} from './colorCycleLayerDocumentRuntime';
import type { LayerStrokeState } from './colorCycleCanvas2DTypes';
import {
  buildQuantizedGradientPalette,
  colorAtPosition,
} from './colorCycleGradientPalette';
import { logColorCycleShapeFillBufferSnapshot } from './colorCycleShapeFillDiagnostics';
import { stampColorCycleGradientDefForGpuShapeFillResult } from './colorCycleShapeFillDefStampRuntime';
import {
  markColorCycleStrokeStateContentWritten,
} from './colorCycleStrokeStateRuntime';
import {
  refreshColorCycleShapeFillWriteSpeed,
  resolveColorCycleShapeAnimationBytes,
  resolveColorCycleShapePhaseBaseByte,
  resolveColorCycleShapePhaseByte,
} from './colorCycleStrokeTimingRuntime';

export type ColorCycleShapeFillApiRuntimeContext = {
  getCanvasWidth(): number;
  getCanvasHeight(): number;
  getCanvasPixelCount(): number;
  getLayerDocumentRuntimeContext(): ColorCycleLayerDocumentRuntimeContext;
  hasStrokeState(layerId: string): boolean;
  getStrokeState(layerId: string): LayerStrokeState | undefined;
  getActiveSlot(layerId: string): number;
  getFlowMode(): ReturnType<ColorCycleShapeFillExecutionContext['getFlowMode']>;
  getStampDitherAlgorithm(): ReturnType<ColorCycleShapeFillExecutionContext['getStampDitherAlgorithm']>;
  getStampDitherPatternStyle(): ReturnType<ColorCycleShapeFillExecutionContext['getStampDitherPatternStyle']>;
  getStampCounter(): number;
  advanceStampCounter(delta: number): number;
  setLayerStrokeState(layerId: string, strokeData: LayerStrokeState): void;
  getStrokeCounter(): number;
  getResolvedWriteCycleSpeed(): number;
  resolveFlowSlot(strokeData: LayerStrokeState | null | undefined, activeSlot: number): number;
  ensureFullResolution(layerId: string, reason: 'fill'): ColorCycleAnimator;
  getGradientStops(): GradientStop[];
  getStampDitherImageTileThresholdResolver():
    ReturnType<ColorCycleShapeFillExecutionContext['getStampDitherImageTileThresholdResolver']>;
  markPresenterLayerDirty(layerId: string): void;
  render(force?: boolean): void;
};

export class ColorCycleShapeFillApiRuntime {
  private shapeFillRuntime = new ColorCycleShapeFillRuntime();

  constructor(
    private readonly context: ColorCycleShapeFillApiRuntimeContext,
  ) {}

  readonly configure = (options: ColorCycleBrushCanvas2DOptions = {}): void => {
    this.shapeFillRuntime = new ColorCycleShapeFillRuntime(options);
  };

  readonly fillShapeDispatch = async (args: {
    mode: FillMode;
    vertices: Vec2[];
    layerId: string;
    direction?: Vec2;
    options?: FillOptions;
  }): Promise<void> => (
    dispatchColorCycleShapeFill(this.getExecutionContext(), args)
  );

  readonly fillShapeLinear = async (
    vertices: Array<{ x: number; y: number }>,
    direction: { x: number; y: number },
    layerId: string,
    spacing?: number,
    options?: FillOptions,
  ): Promise<void> => (
    fillColorCycleLinearShape(
      this.getExecutionContext(),
      vertices,
      direction,
      layerId,
      spacing,
      options,
    )
  );

  readonly fillShape = async (
    vertices: Array<{ x: number; y: number }>,
    layerId: string,
    spacing?: number,
    options?: FillOptions,
  ): Promise<void> => (
    fillColorCycleConcentricShape(
      this.getExecutionContext(),
      vertices,
      layerId,
      spacing,
      options,
    )
  );

  readonly prepareLayer = (
    options: Parameters<ColorCycleShapeFillRuntime['prepareLayer']>[0],
  ): ReturnType<ColorCycleShapeFillRuntime['prepareLayer']> => (
    this.shapeFillRuntime.prepareLayer(options)
  );
  readonly getSettings = (): ReturnType<ColorCycleShapeFillRuntime['getSettings']> => (
    this.shapeFillRuntime.getSettings()
  );
  readonly getGradientBands = (): number => this.shapeFillRuntime.getGradientBands();
  readonly setGradientBands = (bands: number): number | null => this.shapeFillRuntime.setGradientBands(bands);
  readonly setBandSpacing = (spacing: number): number | null => this.shapeFillRuntime.setBandSpacing(spacing);
  readonly normalizeBandSpacingValue = (spacing?: number): number => this.shapeFillRuntime.normalizeBandSpacingValue(spacing);
  readonly deriveBandCountFromDistance = (distance: number, spacing?: number): number =>
    this.shapeFillRuntime.deriveBandCountFromDistance(distance, spacing);
  readonly isDitherEnabled = (): boolean => this.shapeFillRuntime.isDitherEnabled();
  readonly setDitherEnabled = (enabled: boolean): boolean => this.shapeFillRuntime.setDitherEnabled(enabled);
  readonly getDitherStrength = (): number => this.shapeFillRuntime.getDitherStrength();
  readonly setDitherStrength = (strength: number): void => {
    this.shapeFillRuntime.setDitherStrength(strength);
  };
  readonly getDitherPixelSize = (): number => this.shapeFillRuntime.getDitherPixelSize();
  readonly setDitherPixelSize = (size: number): void => {
    this.shapeFillRuntime.setDitherPixelSize(size);
  };
  readonly isPxlEdgeEnabled = (): boolean => this.shapeFillRuntime.isPxlEdgeEnabled();
  readonly setPxlEdgeEnabled = (enabled: boolean): void => {
    this.shapeFillRuntime.setPxlEdgeEnabled(enabled);
  };
  readonly isPerceptualDitherEnabled = (): boolean => this.shapeFillRuntime.isPerceptualDitherEnabled();
  readonly setPerceptualDither = (enabled: boolean): void => {
    this.shapeFillRuntime.setPerceptualDither(enabled);
  };
  readonly canRunPerceptualDitherWorker = (width: number, height: number): boolean => (
    this.shapeFillRuntime.canRunPerceptualDitherWorker(width, height)
  );
  readonly canRunConcentricWorker = (width: number, height: number): boolean => (
    this.shapeFillRuntime.canRunConcentricWorker(width, height)
  );
  readonly beginConcentricWorkerJob = (): number => this.shapeFillRuntime.beginConcentricWorkerJob();
  readonly isCurrentConcentricWorkerJob = (jobId: number): boolean => (
    this.shapeFillRuntime.isCurrentConcentricWorkerJob(jobId)
  );

  private getExecutionContext(): ColorCycleShapeFillExecutionContext {
    return {
      getCanvasWidth: () => this.context.getCanvasWidth(),
      getCanvasHeight: () => this.context.getCanvasHeight(),
      getCanvasPixelCount: () => this.context.getCanvasPixelCount(),
      prepareShapeFillLayer: (options) => this.prepareLayer(options),
      normalizeBandSpacingValue: (spacing) => this.normalizeBandSpacingValue(spacing),
      getGradientBands: () => this.getGradientBands(),
      deriveBandCountFromDistance: (distance, spacing) => this.deriveBandCountFromDistance(distance, spacing),
      isDitherEnabled: () => this.isDitherEnabled(),
      getDitherPixelSize: () => this.getDitherPixelSize(),
      isPerceptualDitherEnabled: () => this.isPerceptualDitherEnabled(),
      getDitherStrength: () => this.getDitherStrength(),
      isPxlEdgeEnabled: () => this.isPxlEdgeEnabled(),
      canRunPerceptualDitherWorker: (width, height) => this.canRunPerceptualDitherWorker(width, height),
      canRunConcentricWorker: (width, height) => this.canRunConcentricWorker(width, height),
      beginConcentricWorkerJob: () => this.beginConcentricWorkerJob(),
      isCurrentConcentricWorkerJob: (jobId) => this.isCurrentConcentricWorkerJob(jobId),
      hasStrokeState: (layerId) => this.context.hasStrokeState(layerId),
      getStrokeState: (layerId) => this.context.getStrokeState(layerId),
      getActiveSlot: (layerId) => this.context.getActiveSlot(layerId),
      getFlowMode: () => this.context.getFlowMode(),
      getStampDitherAlgorithm: () => this.context.getStampDitherAlgorithm(),
      getStampDitherPatternStyle: () => this.context.getStampDitherPatternStyle(),
      getStampCounter: () => this.context.getStampCounter(),
      advanceStampCounter: (delta) => this.context.advanceStampCounter(delta),
      createLayerStrokeState: (options) => createColorCycleRuntimeLayerStrokeState(
        this.context.getLayerDocumentRuntimeContext(),
        options,
      ),
      setLayerStrokeState: (layerId, strokeData) => this.context.setLayerStrokeState(layerId, strokeData),
      refreshShapeFillWriteSpeed: (strokeData) => {
        refreshColorCycleShapeFillWriteSpeed({
          strokeData,
          strokeCounter: this.context.getStrokeCounter(),
          resolvedSpeed: this.context.getResolvedWriteCycleSpeed(),
        });
      },
      resolveFlowSlot: (strokeData, activeSlot) => this.context.resolveFlowSlot(strokeData, activeSlot),
      ensureFullResolution: (layerId, reason) => this.context.ensureFullResolution(layerId, reason),
      bindStrokeBuffersToAnimator: (strokeData, animator) => bindColorCycleRuntimeLayerStrokeBuffersToAnimator(
        this.context.getLayerDocumentRuntimeContext(),
        strokeData,
        animator,
      ),
      resolveShapeAnimationBytes: (strokeData, options) => resolveColorCycleShapeAnimationBytes({
        strokeData,
        strokeCounter: this.context.getStrokeCounter(),
        resolvedSpeed: this.context.getResolvedWriteCycleSpeed(),
        flowMode: this.context.getFlowMode(),
        ccGradient: options?.ccGradient,
      }),
      resolveShapePhaseBaseByte: (options) => resolveColorCycleShapePhaseBaseByte(options),
      resolveShapePhaseByte: (normalized, options) => resolveColorCycleShapePhaseByte(normalized, options),
      logShapeFillBufferSnapshot: (options) => logColorCycleShapeFillBufferSnapshot({
        ...options,
        canvasHeight: this.context.getCanvasHeight(),
      }),
      stampGradientDefForGpuShapeFillResult: (strokeData, animator, bbox, defId, slot) => {
        stampColorCycleGradientDefForGpuShapeFillResult({
          strokeData,
          animator,
          bbox,
          defId,
          slot,
          canvasWidth: this.context.getCanvasWidth(),
          canvasHeight: this.context.getCanvasHeight(),
          flowSlotMask: FLOW_SLOT_MASK,
        });
      },
      markPresenterLayerDirty: (layerId) => this.context.markPresenterLayerDirty(layerId),
      render: (force) => this.context.render(force),
      snapshotFromBuffers: (strokeData) => snapshotColorCycleRuntimeLayerStrokeStateFromBuffers(
        this.context.getLayerDocumentRuntimeContext(),
        strokeData,
      ),
      buildQuantizedGradientPalette: (numColors) => buildQuantizedGradientPalette(
        this.context.getGradientStops(),
        numColors,
      ),
      getStampDitherImageTileThresholdResolver: () => this.context.getStampDitherImageTileThresholdResolver(),
      colorAtPosition: (pos, stopsOverride) => colorAtPosition(
        stopsOverride ?? this.context.getGradientStops(),
        pos,
      ),
      logSetIndexSample: () => undefined,
      markStrokeStateContentWritten: (strokeData) => markColorCycleStrokeStateContentWritten(strokeData),
      resolveLostEdgeTileSize: () => {
        if (!this.isPxlEdgeEnabled()) {
          return undefined;
        }
        return Math.max(
          LOST_EDGE_TILE_MIN,
          Math.min(LOST_EDGE_TILE_MAX, Math.floor(this.getDitherPixelSize())),
        );
      },
    };
  }
}
