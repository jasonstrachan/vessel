import type { ColorCycleAnimator } from '@/lib/ColorCycleAnimator';
import type { GradientStop } from '@/lib/GradientPalette';

import type { LayerStrokeState } from './colorCycleCanvas2DTypes';
import type { StampDitherAlgorithm } from './strokeStampDither';
import type { PatternStyle } from '@/utils/ditherAlgorithms';
import type { PreparedColorCycleShapeFillLayer, PrepareColorCycleShapeFillLayerOptions } from './colorCycleShapeFillRuntime';

export type Vec2 = { x: number; y: number };

export type ShapeFillBufferSnapshotLog = {
  layerId: string;
  mode: 'linear' | 'concentric';
  path: 'cpu' | 'gpu' | 'worker';
  ccGradient: boolean;
  ditherEnabled: boolean;
  colors: number;
  bbox: { minX: number; minY: number; width: number; height: number };
  width: number;
  paint: Uint8Array;
  speed: Uint8Array;
  flow: Uint8Array;
  phase: Uint8Array;
};

export type StrokeStateCreateOptions = {
  hasContent?: boolean;
  bufferSize?: number;
  contentIsOptimistic?: boolean;
};

export type ColorCycleShapeFillExecutionContext = {
  getCanvasWidth(): number;
  getCanvasHeight(): number;
  getCanvasPixelCount(): number;
  prepareShapeFillLayer(options: PrepareColorCycleShapeFillLayerOptions): PreparedColorCycleShapeFillLayer;
  normalizeBandSpacingValue(spacing?: number): number;
  getGradientBands(): number;
  deriveBandCountFromDistance(distance: number, spacing?: number): number;
  isDitherEnabled(): boolean;
  getDitherPixelSize(): number;
  isPerceptualDitherEnabled(): boolean;
  getDitherStrength(): number;
  isPxlEdgeEnabled(): boolean;
  canRunPerceptualDitherWorker(width: number, height: number): boolean;
  canRunConcentricWorker(width: number, height: number): boolean;
  beginConcentricWorkerJob(): number;
  isCurrentConcentricWorkerJob(jobId: number): boolean;
  hasStrokeState(layerId: string): boolean;
  getStrokeState(layerId: string): LayerStrokeState | undefined;
  getActiveSlot(layerId: string): number;
  getFlowMode(): 'forward' | 'reverse' | 'pingpong';
  getStampDitherAlgorithm(): StampDitherAlgorithm;
  getStampDitherPatternStyle(): PatternStyle;
  getStampCounter(): number;
  advanceStampCounter(delta: number): number;
  createLayerStrokeState(options?: StrokeStateCreateOptions): LayerStrokeState;
  setLayerStrokeState(layerId: string, strokeData: LayerStrokeState): void;
  refreshShapeFillWriteSpeed(strokeData: LayerStrokeState): void;
  resolveFlowSlot(strokeData: LayerStrokeState | null | undefined, activeSlot: number): number;
  ensureFullResolution(layerId: string, reason: 'fill'): ColorCycleAnimator;
  bindStrokeBuffersToAnimator(strokeData: LayerStrokeState, animator: ColorCycleAnimator): void;
  resolveShapeAnimationBytes(strokeData: LayerStrokeState | null | undefined, options: {
    ccGradient?: boolean;
    pairBandCount?: number;
    ditherAlgorithm?: StampDitherAlgorithm;
  }): { speedByte: number; flowByte: number };
  resolveShapePhaseBaseByte(options: {
    ccGradient: boolean;
    pairBandCount: number;
    effectiveColorCount: number;
    markId?: string | null;
    bounds: { minX: number; minY: number; width: number; height: number };
    points?: Vec2[];
  }): number;
  resolveShapePhaseByte(normalized: number, options: {
    ccGradient?: boolean;
    pairBandCount?: number;
    effectiveColorCount?: number;
    shapePhaseBaseByte?: number;
  }): number;
  logShapeFillBufferSnapshot(options: ShapeFillBufferSnapshotLog): void;
  stampGradientDefForGpuShapeFillResult(
    strokeData: LayerStrokeState,
    animator: ColorCycleAnimator,
    bbox: { minX: number; minY: number; width: number; height: number },
    defId: number | null,
    slot: number,
  ): void;
  markPresenterLayerDirty(layerId: string): void;
  render(force?: boolean): void;
  snapshotFromBuffers(strokeData: LayerStrokeState): void;
  buildQuantizedGradientPalette(numColors: number): { css: string[]; mapRgbToIndex: Map<string, number> };
  getStampDitherImageTileThresholdResolver(): ((x: number, y: number) => number | null) | undefined;
  colorAtPosition(pos: number, stopsOverride?: GradientStop[]): { r: number; g: number; b: number };
  logSetIndexSample(layerId: string, x: number, y: number): void;
  markStrokeStateContentWritten(strokeData: LayerStrokeState | undefined): void;
  resolveLostEdgeTileSize(): number | undefined;
};
