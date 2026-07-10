import { getAppStoreState } from '@/stores/appStoreAccess';
import type { ColorCycleAnimator } from '@/lib/ColorCycleAnimator';
import type { ColorCycleLayerDirtyBatch } from '@/lib/colorCycle/document';
import type { FlowMode } from '@/lib/colorCycle/flowEncoding';
import { CC_PERF } from '@/utils/perf/ccPerfProbe';
import { debugLog, debugWarn } from '@/utils/debug';
import type { CcCustomTilePattern } from '@/types';

import {
  applyStampDitherStamp,
  recomposeStampDitherOverlay,
  scheduleStampDitherRecompose,
  type StampDitherConfig,
  type StampDitherRuntime,
  type StampDitherState,
} from './strokeStampDither';
import { clearStrokeDefIdsForStamp } from './strokeDefClear';
import { nowMs } from './colorCycleCanvas2DUtils';
import type { LayerStrokeState } from './colorCycleCanvas2DTypes';
import type { StampShape } from './colorCycleBrushContracts';
import type { ColorCycleStrokePerfState } from './colorCycleStrokePerf';

type StrokeContext = {
  id: string;
  animator: ColorCycleAnimator;
  strokeData: LayerStrokeState;
};

export type ColorCyclePaintStrokeContext = {
  getActiveLayerId(): string | null;
  prepareStrokeContext(layerId: string): StrokeContext;
  applyStrokeFlowSpeed(strokeData: LayerStrokeState, speedSamplePxPerMs?: number): void;
  resolveActiveStrokeSlot(layerId: string, strokeData: LayerStrokeState): number;
  resolveFlowSlot(strokeData: LayerStrokeState, activeSlot: number): number;
  isStampDitherEnabled(): boolean;
  getStampShape(): StampShape;
  computeColorBandIndex(strokeData: LayerStrokeState): number;
  getNonDitherStrokeColorIndex(strokeData: LayerStrokeState): number;
  advanceStrokePhase(strokeData: LayerStrokeState): void;
  getWriteSpeedByte(strokeData: LayerStrokeState): number;
  getFlowMode(): FlowMode;
  resolvePressureBrushSize(pressure: number): number;
  getGradientBands(): number;
  createStampDitherConfig(options: { patterns: CcCustomTilePattern[] | undefined; seed: number }): StampDitherConfig;
  getPerfStroke(): ReturnType<ColorCycleStrokePerfState['get']>;
  getStampDitherStrokeData(strokeData: LayerStrokeState): StampDitherState & {
    paint: Uint8Array;
    gradientIdBuffer?: Uint8Array;
    gradientDefIdBuffer?: Uint16Array;
    speedBuffer?: Uint8Array;
    flowBuffer?: Uint8Array;
    phaseBuffer?: Uint8Array;
  };
  getStampDitherRuntime(): StampDitherRuntime;
  ensureStampDitherState(strokeData: LayerStrokeState): StampDitherState;
  getWriteCycleSpeed(strokeData: LayerStrokeState): number;
  updateStampPerfBounds(bounds: { minX: number; minY: number; maxX: number; maxY: number }): void;
  markStrokeStateContentWritten(strokeData: LayerStrokeState): void;
  markPresenterLayerDirty(layerId: string): void;
  isAnimating(): boolean;
  hasScheduledFrame(): boolean;
  hasConnectedTarget(): boolean;
  forceLayerRender(layerId: string): void;
  renderFromDirtyBatches(dirtyBatches: ColorCycleLayerDirtyBatch[]): void;
  render(force?: boolean): void;
  scheduleDirtyRender(options: {
    isAnimating: boolean;
    forceLayerRender: (layerId: string) => void;
    render: (dirtyBatches: ColorCycleLayerDirtyBatch[]) => void;
  }): void;
  getCanvasWidth(): number;
  getCanvasHeight(): number;
};

export function runColorCyclePaintStroke(
  context: ColorCyclePaintStrokeContext,
  x: number,
  y: number,
  layerId?: string,
  pressure: number = 1.0,
  _rotation: number = 0,
  speedSamplePxPerMs?: number
): void {
  if (typeof window !== 'undefined') {
    const globalWindow = window as typeof window & {
      __CC_probe?: { start: number; paint: number; end: number; last: Record<string, unknown> };
    };
    globalWindow.__CC_probe ??= { start: 0, paint: 0, end: 0, last: {} };
    globalWindow.__CC_probe.paint += 1;
    globalWindow.__CC_probe.last = { ...globalWindow.__CC_probe.last, layerId };
  }
  void _rotation;

  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    debugWarn('raw-console', `Invalid paint coordinates: x=${x}, y=${y}`);
    return;
  }

  const targetLayerId = layerId || context.getActiveLayerId() || 'default';
  const { id, animator, strokeData } = context.prepareStrokeContext(targetLayerId);

  context.applyStrokeFlowSpeed(strokeData, speedSamplePxPerMs);
  const activeSlot = context.resolveActiveStrokeSlot(id, strokeData);
  strokeData.flow.activeSlot = activeSlot;
  const flowSlot = context.resolveFlowSlot(strokeData, activeSlot);
  const useStampDither = context.isStampDitherEnabled();
  const stampShape = context.getStampShape();
  const prevColorIndex = useStampDither
    ? context.computeColorBandIndex(strokeData)
    : context.getNonDitherStrokeColorIndex(strokeData);
  const last = strokeData.lastPoint;
  const dx = last ? x - last.x : 0;
  const dy = last ? y - last.y : 0;
  const dist = Math.hypot(dx, dy);
  const prevPhase = strokeData.strokePhaseUnits;

  if (useStampDither) {
    context.advanceStrokePhase(strokeData);
  }
  const nextPhase = strokeData.strokePhaseUnits;
  const nextColorIndex = useStampDither
    ? context.computeColorBandIndex(strokeData)
    : context.getNonDitherStrokeColorIndex(strokeData);
  const colorIndex = nextColorIndex;
  const speedByte = useStampDither ? context.getWriteSpeedByte(strokeData) : 0;
  if (typeof (animator as { setStrokeSpeedByte?: (value: number) => void }).setStrokeSpeedByte === 'function') {
    (animator as { setStrokeSpeedByte: (value: number) => void }).setStrokeSpeedByte(speedByte);
  }
  try {
    animator.setFlowMode(context.getFlowMode());
  } catch {}

  const pressureSize = context.resolvePressureBrushSize(pressure);
  const primaryIndex = colorIndex;

  if (shouldLogNonDitherDebug(strokeData, useStampDither)) {
    debugLog('raw-console', '[cc-nodither-decision]', {
      x,
      y,
      lastPoint: last ? { x: last.x, y: last.y } : null,
      dx,
      dy,
      dist,
      prevPhase,
      nextPhase,
      advancedPhase: nextPhase !== prevPhase,
      prevColorIndex,
      nextColorIndex,
      gradientBands: context.getGradientBands(),
      stampCounter: strokeData.stampCounter,
      flowSlot,
      speedSamplePxPerMs: speedSamplePxPerMs ?? null,
      strokeCycleSpeed: strokeData.strokeCycleSpeed,
      strokeSpeedByte: strokeData.strokeSpeedByte,
    });
  }
  if (shouldLogNonDitherDebug(strokeData, useStampDither) && dist === 0) {
    debugLog('raw-console', '[cc-nodither-zero-dist]', {
      x,
      y,
      stampCounter: strokeData.stampCounter,
      phase: strokeData.strokePhaseUnits,
      colorIndex: nextColorIndex,
    });
    debugLog('raw-console', '[cc-zero-dist-phase-check]', {
      prevPhase,
      nextPhase: strokeData.strokePhaseUnits,
      advanced: strokeData.strokePhaseUnits !== prevPhase,
      x,
      y,
      stampCounter: strokeData.stampCounter,
    });
  }

  const halfPressureSize = Math.max(0.5, pressureSize / 2);
  const canvasWidth = context.getCanvasWidth();
  const canvasHeight = context.getCanvasHeight();
  const stampMayTouchCanvas =
    pressureSize > 0 &&
    x + halfPressureSize >= 0 &&
    y + halfPressureSize >= 0 &&
    x - halfPressureSize < canvasWidth &&
    y - halfPressureSize < canvasHeight;

  if (useStampDither) {
    paintStampDither(
      {
        createStampDitherConfig: (options) => context.createStampDitherConfig(options),
        getPerfStroke: () => context.getPerfStroke(),
        getStampDitherStrokeData: (targetStrokeData) => context.getStampDitherStrokeData(targetStrokeData),
        getStampDitherRuntime: () => context.getStampDitherRuntime(),
        ensureStampDitherState: (targetStrokeData) => context.ensureStampDitherState(targetStrokeData),
        getWriteCycleSpeed: (targetStrokeData) => context.getWriteCycleSpeed(targetStrokeData),
        getCanvasWidth: () => context.getCanvasWidth(),
        getCanvasHeight: () => context.getCanvasHeight(),
        isAnimating: () => context.isAnimating(),
        updateStampPerfBounds: (bounds) => context.updateStampPerfBounds(bounds),
      },
      {
        animator,
        strokeData,
        stampShape,
        x,
        y,
        pressure,
        pressureSize,
        primaryIndex,
        flowSlot,
      },
    );
  } else {
    paintStandardStamp({
      animator,
      strokeShape: stampShape,
      x,
      y,
      pressureSize,
      primaryIndex,
      flowSlot,
      perf: context.getPerfStroke(),
    });
  }

  if (!useStampDither) {
    clearStrokeDefIdsForStamp({
      buffers: strokeData.buffers,
      width: canvasWidth,
      height: canvasHeight,
      x,
      y,
      brushSize: pressureSize,
      flowSlot,
      shape: stampShape,
    });
  }

  if (shouldLogNonDitherDebug(strokeData, useStampDither)) {
    const sx = Math.max(0, Math.min(canvasWidth - 1, Math.round(x)));
    const sy = Math.max(0, Math.min(canvasHeight - 1, Math.round(y)));
    const si = sy * canvasWidth + sx;
    debugLog('raw-console', '[cc-nodither-postpaint]', {
      x: sx,
      y: sy,
      expectedColorIndex: nextColorIndex,
      actualPaint: strokeData.buffers.paint[si],
      actualGid: strokeData.buffers.gid[si],
      actualSpd: strokeData.buffers.spd[si],
      actualFlow: strokeData.buffers.flow[si],
    });
  }

  if (
    typeof window !== 'undefined' &&
    (window as typeof window & { __CC_DIAG_BUFFERS__?: boolean }).__CC_DIAG_BUFFERS__ === true
  ) {
    const globalWindow = window as typeof window & {
      __CC_probe?: { start: number; paint: number; end: number; last: Record<string, unknown> };
    };
    try {
      const handle = animator.beginDirectFill();
      globalWindow.__CC_probe ??= { start: 0, paint: 0, end: 0, last: {} };
      globalWindow.__CC_probe.last = {
        ...globalWindow.__CC_probe.last,
        paintX: x,
        paintY: y,
        pressureSize,
        primaryIndex,
        stampMayTouchCanvas,
        strokePaintHasContentAfterPaint: strokeData.buffers.paint.some((value) => value !== 0),
        animatorPaintHasContentAfterPaint: handle.data?.some((value) => value !== 0) ?? false,
        sharesAnimatorPaintBufferAfterPaint: handle.data === strokeData.buffers.paint,
      };
      animator.endDirectFill({ markDirty: false });
    } catch {}
  }

  if (stampMayTouchCanvas) {
    context.markStrokeStateContentWritten(strokeData);
  }
  strokeData.lastPoint = { x, y };
  strokeData.stampCounter++;

  context.markPresenterLayerDirty(id);
  const needsImmediateRender = context.isAnimating() && !context.hasScheduledFrame();
  if (needsImmediateRender && context.hasConnectedTarget()) {
    try {
      animator.forceRender();
    } catch {}
    context.render(false);
  }

  context.scheduleDirtyRender({
    isAnimating: context.isAnimating(),
    forceLayerRender: (dirtyLayerId) => context.forceLayerRender(dirtyLayerId),
    render: (dirtyBatches) => context.renderFromDirtyBatches(dirtyBatches),
  });
}

type StampDitherPaintOptions = {
  animator: ColorCycleAnimator;
  strokeData: LayerStrokeState;
  stampShape: StampShape;
  x: number;
  y: number;
  pressure: number;
  pressureSize: number;
  primaryIndex: number;
  flowSlot: number;
};

type StampDitherPaintContext = {
  createStampDitherConfig: ColorCyclePaintStrokeContext['createStampDitherConfig'];
  getPerfStroke: ColorCyclePaintStrokeContext['getPerfStroke'];
  getStampDitherStrokeData: ColorCyclePaintStrokeContext['getStampDitherStrokeData'];
  getStampDitherRuntime: ColorCyclePaintStrokeContext['getStampDitherRuntime'];
  ensureStampDitherState: ColorCyclePaintStrokeContext['ensureStampDitherState'];
  getWriteCycleSpeed: ColorCyclePaintStrokeContext['getWriteCycleSpeed'];
  getCanvasWidth: ColorCyclePaintStrokeContext['getCanvasWidth'];
  getCanvasHeight: ColorCyclePaintStrokeContext['getCanvasHeight'];
  isAnimating: ColorCyclePaintStrokeContext['isAnimating'];
  updateStampPerfBounds: ColorCyclePaintStrokeContext['updateStampPerfBounds'];
};

function paintStampDither(
  context: StampDitherPaintContext,
  {
    animator,
    strokeData,
    stampShape,
    x,
    y,
    pressure,
    pressureSize,
    primaryIndex,
    flowSlot,
  }: StampDitherPaintOptions
): void {
  const config = context.createStampDitherConfig({
    patterns: getAppStoreState().project?.ccCustomTilePatterns,
    seed: strokeData.stampDither?.stampDitherSeed ?? 0,
  });
  const perf = context.getPerfStroke();
  const stampStart = perf ? nowMs() : 0;
  let lastMaskMs = 0;
  let lastApplyMs = 0;
  let lastBounds: { minX: number; minY: number; maxX: number; maxY: number } | undefined;
  applyStampDitherStamp({
    animator,
    state: context.getStampDitherStrokeData(strokeData),
    config,
    runtime: context.getStampDitherRuntime(),
    stampShape,
    x,
    y,
    pressure,
    pressureSize,
    primaryIndex,
    flowSlot,
    cycleSpeed: context.getWriteCycleSpeed(strokeData),
    width: context.getCanvasWidth(),
    height: context.getCanvasHeight(),
    isAnimating: context.isAnimating(),
    onScheduleRecompose: (tileScale) => {
      const stampState = context.ensureStampDitherState(strokeData);
      stampState.stampDitherRecomposeScale = tileScale;
      scheduleStampDitherRecompose({
        state: context.getStampDitherStrokeData(strokeData),
        onRecompose: (nextScale) => {
          const perfLocal = context.getPerfStroke();
          const recomposeStart = perfLocal ? nowMs() : 0;
          recomposeStampDitherOverlay({
            state: context.getStampDitherStrokeData(strokeData),
            config,
            runtime: context.getStampDitherRuntime(),
            animator,
            flowSlot,
            cycleSpeed: context.getWriteCycleSpeed(strokeData),
            tileScale: nextScale,
          });
          if (perfLocal) {
            perfLocal.durations.midstrokeRecomposeMs += Math.max(0, nowMs() - recomposeStart);
          }
        },
      });
    },
    perf: perf
      ? {
          onMask: (ms, bounds) => {
            perf.durations.stampMaskPassMs += ms;
            lastMaskMs = ms;
            lastBounds = bounds;
            context.updateStampPerfBounds(bounds);
          },
          onApply: (ms) => {
            perf.durations.stampApplyPassMs += ms;
            lastApplyMs = ms;
          },
        }
      : undefined,
  });
  if (perf) {
    const stampMs = Math.max(0, nowMs() - stampStart);
    perf.durations.stampTotalMs += stampMs;
    perf.stampCounter += 1;
    if (CC_PERF.verbose && perf.sampleEvery > 0 && perf.stampCounter % perf.sampleEvery === 0) {
      const boundsArea = lastBounds
        ? (lastBounds.maxX - lastBounds.minX + 1) * (lastBounds.maxY - lastBounds.minY + 1)
        : 0;
      debugLog('raw-console', '[perf] cc-stamp', {
        stamp: perf.stampCounter,
        canvas: `${perf.stats.canvasW}x${perf.stats.canvasH}`,
        brushBucket: perf.stats.brushBucket,
        stampBoundsArea: boundsArea,
        stamp_total: stampMs.toFixed(2),
        stamp_mask_pass: lastMaskMs.toFixed(2),
        stamp_apply_pass: lastApplyMs.toFixed(2),
      });
    }
  }
}

type StandardStampOptions = {
  animator: ColorCycleAnimator;
  strokeShape: StampShape;
  x: number;
  y: number;
  pressureSize: number;
  primaryIndex: number;
  flowSlot: number;
  perf: ReturnType<ColorCycleStrokePerfState['get']>;
};

function paintStandardStamp({
  animator,
  strokeShape,
  x,
  y,
  pressureSize,
  primaryIndex,
  flowSlot,
  perf,
}: StandardStampOptions): void {
  const stampStart = perf ? nowMs() : 0;
  if (strokeShape === 'triangle') {
    animator.paintTriangle(x, y, pressureSize, primaryIndex, undefined, undefined, undefined, undefined, flowSlot);
  } else if (strokeShape === 'round') {
    animator.paintCircle(x, y, pressureSize, primaryIndex, undefined, undefined, undefined, undefined, flowSlot);
  } else if (strokeShape === 'diamond') {
    animator.paintDiamond(x, y, pressureSize, primaryIndex, undefined, undefined, undefined, undefined, flowSlot);
  } else if (strokeShape === 'diamond5') {
    animator.paintDiamond5Pixelated(x, y, Math.max(1, Math.round(pressureSize / 5)), primaryIndex, undefined, undefined, undefined, undefined, flowSlot);
  } else if (strokeShape === 'diamond7') {
    animator.paintDiamond7Pixelated(x, y, Math.max(1, Math.round(pressureSize / 7)), primaryIndex, undefined, undefined, undefined, undefined, flowSlot);
  } else if (strokeShape === 'diamond9') {
    animator.paintDiamond9Pixelated(x, y, Math.max(1, Math.round(pressureSize / 9)), primaryIndex, undefined, undefined, undefined, undefined, flowSlot);
  } else if (strokeShape === 'checkered') {
    animator.paintCheckeredPixelated(x, y, Math.max(1, Math.round(pressureSize / 4)), primaryIndex, undefined, undefined, undefined, undefined, flowSlot);
  } else {
    animator.paintSquare(x, y, pressureSize, primaryIndex, undefined, undefined, undefined, undefined, flowSlot);
  }
  if (perf) {
    perf.durations.stampTotalMs += Math.max(0, nowMs() - stampStart);
    perf.stampCounter += 1;
  }
}

function shouldLogNonDitherDebug(strokeData: LayerStrokeState, useStampDither: boolean): boolean {
  return (
    process.env.NODE_ENV !== 'production' &&
    typeof globalThis !== 'undefined' &&
    (globalThis as { __CC_NON_DITHER_DEBUG?: boolean }).__CC_NON_DITHER_DEBUG === true &&
    !useStampDither &&
    (strokeData.stampCounter % 4 === 0)
  );
}
