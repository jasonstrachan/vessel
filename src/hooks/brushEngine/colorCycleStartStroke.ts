import { ColorCycleAnimator } from '@/lib/ColorCycleAnimator';
import type { FlowMode } from '@/lib/colorCycle/flowEncoding';
import { encodeColorCycleSpeedByte } from '@/utils/colorCycleSpeed';
import { debugLog, debugWarn } from '@/utils/debug';

import {
  ensureStampDitherBaseBuffers,
  ensureStampDitherBuffers,
  ensureStampDitherTag,
  resolveStampDitherBucket,
  resolveStampDitherCoverage,
  STAMP_DITHER_BUCKETS,
  type StampDitherState,
} from './strokeStampDither';
import { nowMs } from './colorCycleCanvas2DUtils';
import type { ColorCycleRuntimeMutationReason, LayerStrokeState, RgbColor } from './colorCycleCanvas2DTypes';

type StrokePerf = {
  durations: {
    beginStrokeTotalMs: number;
    allocOrResizeMs: number;
  };
};

type StampDitherStrokeData = StampDitherState & {
  paint: Uint8Array;
  gradientIdBuffer?: Uint8Array;
  gradientDefIdBuffer?: Uint16Array;
  speedBuffer?: Uint8Array;
  stampSeqMeta?: Array<[number, number]>;
  stampSeqToTileScale?: Uint16Array;
};

type ClearStrokeMutation = {
  layerId: string;
  reason: ColorCycleRuntimeMutationReason;
  source: 'stroke';
  expectedDestructive: boolean;
  mutate: (state: LayerStrokeState) => void;
  after: { hasContent: boolean };
};

export type ColorCycleStartStrokeContext = {
  layerId?: string;
  clearBuffer: boolean;
  activeLayerId: string | null;
  setActiveLayerId: (layerId: string) => void;
  setIsDrawing: (isDrawing: boolean) => void;
  incrementStrokeCounter: () => number;
  resetPerfStroke: () => void;
  getPerfStroke: () => StrokePerf | null;
  isHistoryRestore: () => boolean;
  ensureFullResolution: (layerId: string, reason: 'stroke') => ColorCycleAnimator;
  getStrokeData: (layerId: string) => LayerStrokeState | undefined;
  getResolvedWriteCycleSpeed: () => number;
  bindStrokeBuffersToAnimator: (strokeData: LayerStrokeState, animator: ColorCycleAnimator) => void;
  stampDitherEnabled: () => boolean;
  stampDitherBgFill: () => boolean;
  flowMode: () => FlowMode;
  width: () => number;
  height: () => number;
  resolveActiveStrokeSlot: (layerId: string, strokeData: LayerStrokeState) => number;
  computeColorBandIndex: (strokeData: LayerStrokeState) => number;
  colorAtPosition: (position: number) => RgbColor;
  hashStrokeDitherSeed: (r: number, g: number, b: number, slot: number, strokeCounter: number) => number;
  mutateLayerStrokeState: (mutation: ClearStrokeMutation) => void;
  ensureStampDitherState: (strokeData: LayerStrokeState) => StampDitherState;
  getStampDitherStrokeData: (strokeData: LayerStrokeState) => StampDitherStrokeData;
  assertStrokeHandleSize: (handle: StampDitherStrokeData['stampDitherFillHandle'], label: string) => void;
  isAnimating: () => boolean;
};

export const startColorCycleStroke = (context: ColorCycleStartStrokeContext): void => {
  const beginStrokeStart = nowMs();
  context.resetPerfStroke();
  if (typeof window !== 'undefined') {
    const globalWindow = window as typeof window & {
      __CC_probe?: { start: number; paint: number; end: number; last: Record<string, unknown> };
    };
    globalWindow.__CC_probe ??= { start: 0, paint: 0, end: 0, last: {} };
    globalWindow.__CC_probe.start += 1;
    globalWindow.__CC_probe.last = { ...globalWindow.__CC_probe.last, layerId: context.layerId };
  }

  const id = context.layerId || context.activeLayerId || 'default';
  context.setActiveLayerId(id);
  context.setIsDrawing(true);
  const strokeCounter = context.incrementStrokeCounter();

  const animator = context.ensureFullResolution(id, 'stroke');
  if (typeof animator.startStroke === 'function') {
    animator.startStroke();
  }
  const strokeData = context.getStrokeData(id);
  if (context.clearBuffer && !context.isHistoryRestore() && !strokeData) {
    try { animator.clear(); } catch {}
  }
  const strokeStartSpeed = context.getResolvedWriteCycleSpeed();
  const speedByte = encodeColorCycleSpeedByte(strokeStartSpeed);
  try {
    if (typeof (animator as { setStrokeSpeedByte?: (value: number) => void }).setStrokeSpeedByte === 'function') {
      (animator as { setStrokeSpeedByte: (value: number) => void }).setStrokeSpeedByte(speedByte);
    }
  } catch {}

  if (strokeData && !strokeData.hasContent) {
    strokeData.hasContent = true;
    strokeData.contentIsOptimistic = true;
  }
  if (strokeData) {
    const expected = context.width() * context.height();
    if (strokeData.buffers.paint.length === expected) {
      try {
        animator.setIndexBufferFromArray(
          strokeData.buffers.paint,
          strokeData.buffers.gid,
          strokeData.buffers.spd,
          strokeData.buffers.flow,
          strokeData.buffers.phase
        );
      } catch {}
      try {
        context.bindStrokeBuffersToAnimator(strokeData, animator);
      } catch {}
    }
    if (!context.stampDitherEnabled()) {
      strokeData.lastPoint = null;
      strokeData.strokePhaseUnits = 0;
      strokeData.stampCounter = 0;
    }
    strokeData.flow.activeSlot = context.resolveActiveStrokeSlot(id, strokeData);
    strokeData.flow.mode = context.flowMode();
    strokeData.flow.encoded = true;
    let nextSeed = 0;
    if (context.stampDitherEnabled()) {
      const seedSlot = strokeData.flow.activeSlot ?? 0;
      const colorIndex = context.computeColorBandIndex(strokeData);
      const seedPos = Math.max(0, Math.min(1, (colorIndex - 1) / 254));
      const seedRgb = context.colorAtPosition(seedPos);
      nextSeed = context.hashStrokeDitherSeed(
        seedRgb.r,
        seedRgb.g,
        seedRgb.b,
        seedSlot,
        strokeCounter
      );
    }
    if (context.clearBuffer && !context.isHistoryRestore()) {
      const preservedStampCounter = context.stampDitherEnabled() ? strokeData.stampCounter : 0;
      const preservedPhaseUnits = context.stampDitherEnabled() ? strokeData.strokePhaseUnits : 0;
      context.mutateLayerStrokeState({
        layerId: id,
        reason: 'brush-stroke-write',
        source: 'stroke',
        expectedDestructive: true,
        mutate: (state) => {
          state.buffers.paint.fill(0);
          state.buffers.gid.fill(0);
          state.buffers.spd.fill(0);
          state.buffers.flow.fill(0);
          state.buffers.phase.fill(0);
          state.buffers.def.fill(0);
          state.stampCounter = preservedStampCounter;
          state.strokePhaseUnits = preservedPhaseUnits;
        },
        after: { hasContent: false },
      });
      try { animator.clear(); } catch {}
      strokeData.stampCounter = preservedStampCounter;
      strokeData.strokePhaseUnits = preservedPhaseUnits;
    }
    strokeData.strokeCounter = strokeCounter;
    strokeData.strokeCycleSpeed = strokeStartSpeed;
    strokeData.strokeSpeedByte = speedByte;
    strokeData.lastPoint = null;
    if (
      process.env.NODE_ENV !== 'production' &&
      typeof globalThis !== 'undefined' &&
      (globalThis as { __CC_NON_DITHER_DEBUG?: boolean }).__CC_NON_DITHER_DEBUG === true
    ) {
      debugLog('raw-console', '[cc-stroke-begin]', {
        stampCounter: strokeData.stampCounter,
        phase: strokeData.strokePhaseUnits,
        lastPoint: strokeData.lastPoint,
      });
    }
    if (context.stampDitherEnabled()) {
      const perf = context.getPerfStroke();
      const stampState = context.ensureStampDitherState(strokeData);
      stampState.stampDitherSeed = nextSeed;
      stampState.stampDitherOrigin = null;
      stampState.stampDitherPressureState = null;
      stampState.stampDitherPressureStable = undefined;
      stampState.stampDitherPressureLast = undefined;
      stampState.stampDitherPressureLastTime = undefined;
      stampState.stampDitherPressureSampleCount = undefined;
      stampState.stampDitherBounds = null;
      stampState.stampDitherLastTileScale = null;
      stampState.stampDitherStrokeScale = undefined;
      stampState.stampDitherRecomposeLastMs = undefined;
      stampState.stampDitherRecomposePending = false;
      stampState.stampDitherRecomposeScale = undefined;
      stampState.stampDitherOriginUnits = null;
      stampState.stampDitherOriginBaseSize = undefined;
      stampState.stampDitherLockedBucket = undefined;
      stampState.stampSeqMeta = [];
      stampState.stampSeqToTileScale = undefined;
      const stampStroke = context.getStampDitherStrokeData(strokeData);
      stampStroke.stampDitherStrokeEpoch = ((stampStroke.stampDitherStrokeEpoch ?? 0) + 1) & 0xffff;
      if (stampStroke.stampDitherStrokeEpoch === 0) {
        stampStroke.stampDitherStrokeEpoch = 1;
      }
      const allocStart = perf ? nowMs() : 0;
      ensureStampDitherBuffers(stampStroke, context.width(), context.height());
      ensureStampDitherTag(stampStroke, context.width(), context.height());
      if (!context.stampDitherBgFill()) {
        ensureStampDitherBaseBuffers(stampStroke, context.width(), context.height());
      } else {
        stampStroke.stampDitherBaseIdx = undefined;
        stampStroke.stampDitherBaseGid = undefined;
        stampStroke.stampDitherBaseDef = undefined;
        stampStroke.stampDitherBaseTag = undefined;
      }
      if (perf) perf.durations.allocOrResizeMs += Math.max(0, nowMs() - allocStart);
      stampStroke.stampDitherStampSeq = 0;
      stampStroke.stampDitherFillHandle = animator.beginDirectFill();
      context.assertStrokeHandleSize(stampStroke.stampDitherFillHandle, 'stamp dither');
      if (process.env.NODE_ENV !== 'production') {
        const h = stampStroke.stampDitherFillHandle;
        if (h && (h.width !== context.width() || h.height !== context.height())) {
          debugWarn('raw-console', '[CC] stamp dither handle size mismatch', {
            handle: { w: h.width, h: h.height },
            brush: { w: context.width(), h: context.height() },
          });
        }
      }
      const phaseForMask = 0.5;
      const idxForMask = context.computeColorBandIndex(strokeData);
      const coverage = resolveStampDitherCoverage(phaseForMask, idxForMask, context.isAnimating());
      const rawBucket = resolveStampDitherBucket(coverage);
      stampStroke.stampDitherLockedBucket = Math.min(
        STAMP_DITHER_BUCKETS - 2,
        Math.max(1, rawBucket)
      );
    } else {
      strokeData.stampDither = undefined;
    }
  }
  const perf = context.getPerfStroke();
  if (perf) {
    perf.durations.beginStrokeTotalMs += Math.max(0, nowMs() - beginStrokeStart);
  }
};
