import type { ColorCycleAnimator } from '@/lib/ColorCycleAnimator';
import type { FlowMode } from '@/lib/colorCycle/flowEncoding';

import type { ColorCycleBrushCanvas2DOptions } from './colorCycleBrushContracts';
import type {
  FillOptions,
  LayerStrokeState,
} from './colorCycleCanvas2DTypes';
import { shouldUseFillWorker } from './colorCycleCanvas2DUtils';
import { ensureLayerStrokeBuffersAllocated } from './colorCycleLayerStrokeBuffers';
import { ColorCycleShapeFillJobState } from './colorCycleShapeFillJobState';
import {
  ColorCycleShapeFillSettingsState,
  type ColorCycleShapeFillSettingsSnapshot,
} from './colorCycleShapeFillSettingsState';

type ColorCycleShapeFillPerformanceOptions = Required<
  Pick<
    ColorCycleBrushCanvas2DOptions,
    'useOffscreenCanvas' | 'useWebWorkers' | 'useWASM' | 'useImageBitmap' | 'usePerceptualDitherWorker'
  >
>;

export type PreparedColorCycleShapeFillLayer = {
  id: string;
  animator: ColorCycleAnimator;
  strokeData: LayerStrokeState | undefined;
  activeSlot: number;
  activeDefId: number | null;
  flowSlot: number;
};

export type PrepareColorCycleShapeFillLayerOptions = {
  layerId: string;
  options?: FillOptions;
  canvasPixelCount: number;
  hasStrokeState: (layerId: string) => boolean;
  createStrokeState: () => LayerStrokeState;
  setStrokeState: (layerId: string, strokeState: LayerStrokeState) => void;
  getStrokeState: (layerId: string) => LayerStrokeState | undefined;
  refreshShapeFillWriteSpeed: (strokeData: LayerStrokeState) => void;
  getActiveSlot: (layerId: string) => number;
  getFlowMode: () => FlowMode;
  resolveFlowSlot: (strokeData: LayerStrokeState | undefined, activeSlot: number) => number;
  ensureFullResolution: (layerId: string) => ColorCycleAnimator;
  bindStrokeBuffersToAnimator: (strokeData: LayerStrokeState, animator: ColorCycleAnimator) => void;
};

export const prepareColorCycleShapeFillLayer = ({
  layerId,
  options,
  canvasPixelCount,
  hasStrokeState,
  createStrokeState,
  setStrokeState,
  getStrokeState,
  refreshShapeFillWriteSpeed,
  getActiveSlot,
  getFlowMode,
  resolveFlowSlot,
  ensureFullResolution,
  bindStrokeBuffersToAnimator,
}: PrepareColorCycleShapeFillLayerOptions): PreparedColorCycleShapeFillLayer => {
  if (!hasStrokeState(layerId)) {
    setStrokeState(layerId, createStrokeState());
  }

  const strokeData = getStrokeState(layerId);
  if (strokeData) {
    strokeData.hasContent = true;
    strokeData.contentIsOptimistic = true;
    strokeData.skipStampDitherFinalize = true;
    refreshShapeFillWriteSpeed(strokeData);
    ensureLayerStrokeBuffersAllocated(strokeData, canvasPixelCount);
  }

  const activeSlot = Number.isFinite(options?.paintSlotOverride)
    ? Math.max(0, Math.round(options?.paintSlotOverride as number))
    : strokeData?.flow.activeSlot ?? getActiveSlot(layerId);
  const activeDefId = Number.isFinite(options?.paintDefIdOverride)
    ? Math.max(1, Math.min(0xffff, Math.round(options?.paintDefIdOverride as number)))
    : null;

  if (strokeData) {
    strokeData.flow.activeSlot = activeSlot;
    strokeData.flow.mode = getFlowMode();
    strokeData.flow.encoded = true;
  }

  const flowSlot = resolveFlowSlot(strokeData, activeSlot);
  const animator = ensureFullResolution(layerId);
  if (strokeData) {
    try {
      bindStrokeBuffersToAnimator(strokeData, animator);
    } catch {}
  }

  return {
    id: layerId,
    animator,
    strokeData,
    activeSlot,
    activeDefId,
    flowSlot,
  };
};

export class ColorCycleShapeFillRuntime {
  private readonly settings = new ColorCycleShapeFillSettingsState();
  private readonly jobState = new ColorCycleShapeFillJobState();
  private readonly performanceOptions: ColorCycleShapeFillPerformanceOptions;

  constructor(options: ColorCycleBrushCanvas2DOptions = {}) {
    this.performanceOptions = {
      useOffscreenCanvas: options.useOffscreenCanvas ?? true,
      useWebWorkers: options.useWebWorkers ?? true,
      useWASM: options.useWASM ?? true,
      useImageBitmap: options.useImageBitmap ?? true,
      usePerceptualDitherWorker: options.usePerceptualDitherWorker ?? false,
    };
  }

  prepareLayer(options: PrepareColorCycleShapeFillLayerOptions): PreparedColorCycleShapeFillLayer {
    return prepareColorCycleShapeFillLayer(options);
  }

  getGradientBands(): number {
    return this.settings.getGradientBands();
  }

  setGradientBands(bands: number): number | null {
    return this.settings.setGradientBands(bands);
  }

  setBandSpacing(spacing: number): number | null {
    return this.settings.setBandSpacing(spacing);
  }

  normalizeBandSpacingValue(spacing?: number): number {
    return this.settings.normalizeBandSpacingValue(spacing);
  }

  deriveBandCountFromDistance(distance: number, spacing?: number): number {
    return this.settings.deriveBandCountFromDistance(distance, spacing);
  }

  isDitherEnabled(): boolean {
    return this.settings.isDitherEnabled();
  }

  setDitherEnabled(enabled: boolean): boolean {
    return this.settings.setDitherEnabled(enabled);
  }

  getDitherStrength(): number {
    return this.settings.getDitherStrength();
  }

  setDitherStrength(strength: number): void {
    this.settings.setDitherStrength(strength);
  }

  getDitherPixelSize(): number {
    return this.settings.getDitherPixelSize();
  }

  setDitherPixelSize(size: number): void {
    this.settings.setDitherPixelSize(size);
  }

  isPxlEdgeEnabled(): boolean {
    return this.settings.isPxlEdgeEnabled();
  }

  setPxlEdgeEnabled(enabled: boolean): void {
    this.settings.setPxlEdgeEnabled(enabled);
  }

  isPerceptualDitherEnabled(): boolean {
    return this.settings.isPerceptualDitherEnabled();
  }

  setPerceptualDither(enabled: boolean): void {
    this.settings.setPerceptualDither(enabled);
  }

  getSettings(): ColorCycleShapeFillSettingsSnapshot {
    return this.settings.getSettings();
  }

  canRunPerceptualDitherWorker(width: number, height: number): boolean {
    return (
      this.performanceOptions.useWebWorkers &&
      this.performanceOptions.usePerceptualDitherWorker &&
      shouldUseFillWorker(width, height)
    );
  }

  canRunConcentricWorker(width: number, height: number): boolean {
    return (
      this.performanceOptions.useWebWorkers &&
      shouldUseFillWorker(width, height)
    );
  }

  beginConcentricWorkerJob(): number {
    return this.jobState.beginConcentricWorkerJob();
  }

  isCurrentConcentricWorkerJob(jobId: number): boolean {
    return this.jobState.isCurrentConcentricWorkerJob(jobId);
  }
}
