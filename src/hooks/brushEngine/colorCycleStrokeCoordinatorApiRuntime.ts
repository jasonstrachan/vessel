import { TEMP_SAMPLE_SLOT } from '@/constants/colorCycle';
import { getActiveMarkGradientSession } from '@/hooks/canvas/utils/colorCycleMarkSession';
import { FLOW_SLOT_MASK } from '@/lib/colorCycle/flowEncoding';

import type { LayerStrokeState } from './colorCycleCanvas2DTypes';
import {
  advanceColorCycleStrokePhase,
  applyColorCycleStrokeFlowSpeed,
  computeColorCycleBandIndex,
  getColorCycleNonDitherStrokeColorIndex,
  resolveColorCycleGradientFillSpeedByte,
  resolveColorCycleStrokeFlowCycleSpeed,
  resolveColorCycleWriteCycleSpeed,
  resolveColorCycleWriteSpeedByte,
} from './colorCycleStrokeTimingRuntime';
import type { StampDitherAlgorithm } from './strokeStampDither';

export type ColorCycleStrokeCoordinatorApiRuntimeDeps = {
  getStrokeCounter(): number;
  getResolvedWriteCycleSpeed(rawSpeed?: number | null): number;
  getGradientBands(): number;
  getActiveSlot(layerId: string): number;
  getCanvasWidth(): number;
  getCanvasHeight(): number;
};

export class ColorCycleStrokeCoordinatorApiRuntime {
  constructor(
    private readonly deps: ColorCycleStrokeCoordinatorApiRuntimeDeps,
  ) {}

  readonly applyStrokeFlowSpeed = (
    strokeData: LayerStrokeState,
    speedSamplePxPerMs?: number,
  ): void => {
    applyColorCycleStrokeFlowSpeed({
      strokeData,
      resolvedSpeed: resolveColorCycleStrokeFlowCycleSpeed({
        baseSpeed: this.deps.getResolvedWriteCycleSpeed(),
        speedSamplePxPerMs,
      }),
    });
  };

  readonly resolveFlowSlot = (
    _strokeData: LayerStrokeState | null | undefined,
    activeSlot: number,
  ): number => {
    if (!Number.isFinite(activeSlot)) {
      return 0;
    }
    return Math.max(0, Math.min(FLOW_SLOT_MASK, Math.round(activeSlot)));
  };

  readonly resolveActiveStrokeSlot = (
    layerId: string,
    strokeData?: LayerStrokeState | null,
  ): number => {
    const activeSession = getActiveMarkGradientSession(layerId);
    if (activeSession?.source === 'sampled' && activeSession.markKind === 'stroke') {
      return TEMP_SAMPLE_SLOT;
    }
    return strokeData?.flow.activeSlot ?? this.deps.getActiveSlot(layerId);
  };

  readonly resolvePhaseAdvancePerStamp = (): number => 1;

  readonly advanceStrokePhase = (strokeData: LayerStrokeState): void => {
    advanceColorCycleStrokePhase({
      strokeData,
      phaseAdvance: this.resolvePhaseAdvancePerStamp(),
    });
  };

  readonly getWriteCycleSpeed = (strokeData?: LayerStrokeState | null): number => (
    resolveColorCycleWriteCycleSpeed({
      strokeData,
      strokeCounter: this.deps.getStrokeCounter(),
      resolvedSpeed: this.deps.getResolvedWriteCycleSpeed(),
    })
  );

  readonly getWriteSpeedByte = (strokeData?: LayerStrokeState | null): number => (
    resolveColorCycleWriteSpeedByte({
      strokeData,
      strokeCounter: this.deps.getStrokeCounter(),
      resolvedSpeed: this.deps.getResolvedWriteCycleSpeed(),
    })
  );

  readonly resolveCcGradientFillSpeed = (
    strokeData?: LayerStrokeState | null,
    options?: {
      pairBandCount?: number;
      ditherAlgorithm?: StampDitherAlgorithm;
    },
  ): number => {
    void options;
    return this.getWriteCycleSpeed(strokeData);
  };

  readonly getCcGradientFillSpeedByte = (
    strokeData?: LayerStrokeState | null,
    options?: {
      pairBandCount?: number;
      ditherAlgorithm?: StampDitherAlgorithm;
    },
  ): number => {
    void options;
    return resolveColorCycleGradientFillSpeedByte({
      strokeData,
      strokeCounter: this.deps.getStrokeCounter(),
      resolvedSpeed: this.deps.getResolvedWriteCycleSpeed(),
    });
  };

  readonly computeColorBandIndex = (strokeData: LayerStrokeState): number => (
    computeColorCycleBandIndex({
      strokeData,
      gradientBands: this.deps.getGradientBands(),
    })
  );

  readonly getNonDitherStrokeColorIndex = (strokeData: LayerStrokeState): number => (
    getColorCycleNonDitherStrokeColorIndex(strokeData)
  );

  readonly hashStrokeDitherSeed = (
    r: number,
    g: number,
    b: number,
    slot: number,
    strokeCounter: number,
  ): number => {
    let h = (Math.round(r) & 255) | ((Math.round(g) & 255) << 8) | ((Math.round(b) & 255) << 16);
    h ^= (Math.round(slot) & 255) << 24;
    h ^= strokeCounter + 0x9e3779b9 + (h << 6) + (h >> 2);
    return h >>> 0;
  };

  readonly assertStrokeHandleSize = (
    handle: { width: number; height: number } | null | undefined,
    context: string,
  ): void => {
    if (process.env.NODE_ENV === 'production' || !handle) {
      return;
    }
    const width = this.deps.getCanvasWidth();
    const height = this.deps.getCanvasHeight();
    console.assert(
      handle.width === width && handle.height === height,
      `[CC] ${context} handle size mismatch`,
      { handle: { width: handle.width, height: handle.height }, brush: { width, height } },
    );
  };
}
