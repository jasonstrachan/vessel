import { getAppStoreState } from '@/stores/appStoreAccess';
import { ColorCycleAnimator } from '@/lib/ColorCycleAnimator';
import { hasCcPayload } from '@/lib/colorCycle/document';
import {
  logCCMutation,
  summarizeColorCycleLayer,
} from '@/utils/colorCycle/ccMutationAudit';
import { debugLog } from '@/utils/debug';

import {
  finalizeStampDither,
  type StampDitherAlgorithm,
  type StampDitherConfig,
  type StampDitherRuntime,
  type StampDitherState,
} from './strokeStampDither';
import { nowMs } from './colorCycleCanvas2DUtils';
import type { LayerStrokeState } from './colorCycleCanvas2DTypes';

type EndStrokePerf = {
  durations: {
    endStrokeFinalizeMs: number;
    serializeMs: number;
  };
  stats: {
    dirtyMinX: number;
    dirtyMinY: number;
    dirtyMaxX: number;
    dirtyMaxY: number;
    dirtyRectArea: number;
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

export type ColorCycleEndStrokeContext = {
  layerId?: string;
  activeLayerId: string | null;
  setIsDrawing: (isDrawing: boolean) => void;
  strokeCounter: () => number;
  ensureFullResolution: (layerId: string, reason: 'stroke') => ColorCycleAnimator;
  getStrokeData: (layerId: string) => LayerStrokeState | undefined;
  getPerfStroke: () => EndStrokePerf | null;
  stampDitherEnabled: () => boolean;
  stampDitherAlgorithm: () => StampDitherAlgorithm | undefined;
  stampDitherPixelSize: () => number;
  stampDitherPatternStyle: () => StampDitherConfig['patternStyle'];
  getStampDitherImageTileThresholdResolver: () => StampDitherConfig['imageTileThresholdResolver'];
  stampDitherBgFill: () => boolean;
  stampDitherPressureLinked: () => boolean;
  ditherStrength: () => number;
  width: () => number;
  height: () => number;
  resolveActiveStrokeSlot: (layerId: string, strokeData: LayerStrokeState) => number;
  resolveFlowSlot: (strokeData: LayerStrokeState, activeSlot: number) => number;
  getStampDitherStrokeData: (strokeData: LayerStrokeState) => StampDitherStrokeData;
  getStampDitherRuntime: () => StampDitherRuntime;
  getWriteCycleSpeed: (strokeData: LayerStrokeState) => number;
  bindStrokeBuffersToAnimator: (strokeData: LayerStrokeState, animator: ColorCycleAnimator) => void;
  enableNonDitherPlaybackSpeed: (strokeData: LayerStrokeState) => boolean;
  snapshotFromBuffers: (strokeData: LayerStrokeState) => void;
  logPerfStroke: (layerId: string) => void;
  brushStateHasColorCyclePaintPayload: (brushState: unknown, layerId?: string) => boolean;
  render: (force?: boolean) => void;
};

export const endColorCycleStroke = (context: ColorCycleEndStrokeContext): void => {
  if (typeof window !== 'undefined') {
    const globalWindow = window as typeof window & {
      __CC_probe?: { start: number; paint: number; end: number; last: Record<string, unknown> };
    };
    globalWindow.__CC_probe ??= { start: 0, paint: 0, end: 0, last: {} };
    globalWindow.__CC_probe.end += 1;
    globalWindow.__CC_probe.last = { ...globalWindow.__CC_probe.last, layerId: context.layerId };
  }
  const id = context.layerId || context.activeLayerId || 'default';
  context.setIsDrawing(false);

  const animator = context.ensureFullResolution(id, 'stroke');
  const strokeData = context.getStrokeData(id);
  const perf = context.getPerfStroke();
  const shouldLog =
    process.env.NODE_ENV !== 'production' &&
    typeof globalThis !== 'undefined' &&
    (globalThis as { __CC_STAMP_DEBUG?: boolean }).__CC_STAMP_DEBUG === true;
  const hasDitherBounds = Boolean(strokeData?.stampDither?.stampDitherBounds);
  const sampleIndices = (label: string, data?: Uint8Array) => {
    if (!shouldLog || !hasDitherBounds || !data || data.length === 0) return;
    const count = Math.min(8, data.length);
    const step = Math.max(1, Math.floor(data.length / count));
    const samples: Array<{ i: number; v: number }> = [];
    for (let i = 0; i < data.length && samples.length < count; i += step) {
      samples.push({ i, v: data[i] });
    }
    try {
      debugLog('raw-console', `[CC endStroke] ${label}`, { len: data.length, samples });
    } catch {}
  };
  const probeIndexRegion = (label: string, buf?: Uint8Array) => {
    if (!shouldLog || !buf || !strokeData?.stampDither?.stampDitherBounds) return;
    const b = strokeData.stampDither.stampDitherBounds;
    const minX = Math.max(0, Math.floor(b.minX));
    const minY = Math.max(0, Math.floor(b.minY));
    const maxX = Math.min(context.width() - 1, Math.ceil(b.maxX));
    const maxY = Math.min(context.height() - 1, Math.ceil(b.maxY));
    if (maxX <= minX || maxY <= minY) return;
    const w = context.width();
    const seen = new Set<number>();
    let transitions = 0;
    const clampX = Math.min(maxX, minX + 128);
    const clampY = Math.min(maxY, minY + 128);
    for (let y = minY; y <= clampY; y += 1) {
      const row = y * w;
      let prev = buf[row + minX];
      seen.add(prev);
      for (let x = minX + 1; x <= clampX; x += 1) {
        const v = buf[row + x];
        seen.add(v);
        if (v !== prev) transitions += 1;
        prev = v;
      }
    }
    try {
      debugLog('raw-console', '[CC index probe]', {
        label,
        unique: seen.size,
        transitions,
        bounds: { minX, minY, maxX: clampX, maxY: clampY },
      });
    } catch {}
  };

  if (strokeData?.stampDither) {
    strokeData.stampDither.stampDitherRecomposePending = false;
    strokeData.stampDither.stampDitherRecomposeScale = undefined;
  }

  const skipStampFinalize = strokeData?.skipStampDitherFinalize === true;
  if (skipStampFinalize && strokeData) {
    strokeData.skipStampDitherFinalize = false;
  }

  if (strokeData && context.stampDitherEnabled() && !skipStampFinalize) {
    const algo = context.stampDitherAlgorithm() ?? 'sierra-lite';
    const finalizeStart = perf ? nowMs() : 0;
    const activeSlot = context.resolveActiveStrokeSlot(id, strokeData);
    strokeData.flow.activeSlot = activeSlot;
    const flowSlot = context.resolveFlowSlot(strokeData, activeSlot);
    finalizeStampDither({
      animator,
      state: context.getStampDitherStrokeData(strokeData),
      runtime: context.getStampDitherRuntime(),
      config: {
        algorithm: algo,
        pixelSize: context.stampDitherPixelSize(),
        patternStyle: context.stampDitherPatternStyle(),
        imageTileThresholdResolver: context.getStampDitherImageTileThresholdResolver(),
        bgFill: context.stampDitherBgFill(),
        pressureLinked: context.stampDitherPressureLinked(),
        seed: strokeData.stampDither?.stampDitherSeed ?? 0,
      },
      width: context.width(),
      height: context.height(),
      flowSlot,
      cycleSpeed: context.getWriteCycleSpeed(strokeData),
      ditherStrength: context.ditherStrength(),
    });
    if (perf) {
      perf.durations.endStrokeFinalizeMs += Math.max(0, nowMs() - finalizeStart);
    }
  }
  if (strokeData?.stampDither?.stampDitherFillHandle) {
    const needsUpload = animator.hasWebGL?.() ?? false;
    if (shouldLog && hasDitherBounds) {
      const handle = strokeData.stampDither.stampDitherFillHandle;
      sampleIndices('pre endDirectFill.handle.data', handle?.data);
      sampleIndices('pre endDirectFill.strokeData', strokeData?.buffers.paint);
      probeIndexRegion('pre endDirectFill.strokeData', strokeData?.buffers.paint);
    }
    animator.endDirectFill({ markDirty: needsUpload });
    if (shouldLog && hasDitherBounds) {
      sampleIndices('post endDirectFill.strokeData', strokeData?.buffers.paint);
      probeIndexRegion('post endDirectFill.strokeData', strokeData?.buffers.paint);
    }
    strokeData.stampDither.stampDitherFillHandle = undefined;
  }
  animator.endStroke();
  animator.forceRender();
  if (shouldLog && hasDitherBounds) {
    sampleIndices('post forceRender.strokeData', strokeData?.buffers.paint);
    probeIndexRegion('post forceRender.strokeData', strokeData?.buffers.paint);
  }

  if (strokeData) {
    if (context.stampDitherEnabled()) {
      try {
        context.bindStrokeBuffersToAnimator(strokeData, animator);
      } catch {}
    }
    if (!context.stampDitherEnabled() && context.enableNonDitherPlaybackSpeed(strokeData)) {
      try {
        animator.setIndexBufferFromArray(
          strokeData.buffers.paint,
          strokeData.buffers.gid,
          strokeData.buffers.spd,
          strokeData.buffers.flow,
          strokeData.buffers.phase
        );
        context.bindStrokeBuffersToAnimator(strokeData, animator);
      } catch {}
    }
    if (
      process.env.NODE_ENV !== 'production' &&
      typeof globalThis !== 'undefined' &&
      (globalThis as { __CC_NON_DITHER_DEBUG?: boolean }).__CC_NON_DITHER_DEBUG === true
    ) {
      debugLog('raw-console', '[cc-stroke-end]', {
        stampCounter: strokeData.stampCounter,
        phase: strokeData.strokePhaseUnits,
        lastPoint: strokeData.lastPoint,
      });
    }
    strokeData.lastPoint = null;
    strokeData.strokeCounter = context.strokeCounter();

    if (perf && strokeData.stampDither?.stampDitherBounds) {
      const b = strokeData.stampDither.stampDitherBounds;
      const minX = Math.max(0, Math.floor(b.minX));
      const minY = Math.max(0, Math.floor(b.minY));
      const maxX = Math.min(context.width() - 1, Math.ceil(b.maxX));
      const maxY = Math.min(context.height() - 1, Math.ceil(b.maxY));
      if (maxX >= minX && maxY >= minY) {
        perf.stats.dirtyMinX = Math.min(perf.stats.dirtyMinX, minX);
        perf.stats.dirtyMinY = Math.min(perf.stats.dirtyMinY, minY);
        perf.stats.dirtyMaxX = Math.max(perf.stats.dirtyMaxX, maxX);
        perf.stats.dirtyMaxY = Math.max(perf.stats.dirtyMaxY, maxY);
        perf.stats.dirtyRectArea = (maxX - minX + 1) * (maxY - minY + 1);
      }
    }

    const serializeStart = perf ? nowMs() : 0;
    context.snapshotFromBuffers(strokeData);
    const hasContent = strokeData.hasContent;
    if (perf) {
      perf.durations.serializeMs += Math.max(0, nowMs() - serializeStart);
    }
    if (strokeData.stampDither) {
      strokeData.stampDither.stampDitherStampSeq = 0;
      strokeData.stampDither.stampDitherBounds = null;
      strokeData.stampDither.stampDitherRecomposeLastMs = undefined;
      strokeData.stampDither.stampDitherRecomposePending = false;
      strokeData.stampDither.stampDitherRecomposeScale = undefined;
      strokeData.stampDither.stampSeqMeta = undefined;
      strokeData.stampDither.stampSeqToTileScale = undefined;
    }

    context.logPerfStroke(id);
    try {
      const storeState = getAppStoreState();
      const layer = storeState.layers.find(layerItem => layerItem.id === id);
      if (layer?.colorCycleData) {
        const documentState = (layer as unknown as {
          state?: {
            hasContent?: boolean;
            paintRef?: unknown;
          };
        }).state;
        const hasCanonicalContentSource = Boolean(
          documentState?.hasContent === true ||
          hasCcPayload(documentState?.paintRef) ||
          layer.colorCycleData.hasContent === true ||
          context.brushStateHasColorCyclePaintPayload(layer.colorCycleData.brushState, layer.id) ||
          layer.colorCycleData.repairStatus?.ok === false
        );
        if (!hasContent && hasCanonicalContentSource) {
          logCCMutation({
            event: 'cc-empty-live-buffer-write-blocked',
            layerId: layer.id,
            reason: 'endStroke',
            severity: 'error',
            before: summarizeColorCycleLayer(layer),
            after: summarizeColorCycleLayer(layer),
            details: {
              paintBytes: strokeData.buffers.paint.byteLength,
              gradientIdBufferBytes: strokeData.buffers.gid.byteLength,
              gradientDefIdBufferBytes: strokeData.buffers.def.byteLength,
              strokeDataHadContent: strokeData.hasContent,
              brushStateHasPayload: context.brushStateHasColorCyclePaintPayload(
                layer.colorCycleData.brushState,
                layer.id,
              ),
              repairStatus: layer.colorCycleData.repairStatus?.reason ?? null,
              stateHasContent: documentState?.hasContent ?? null,
            },
          });
          return;
        }
        storeState.updateLayer(layer.id, {
          colorCycleData: {
            ...layer.colorCycleData,
            hasContent,
          },
        });
      }
    } catch {}
  }

  context.render(false);
};
