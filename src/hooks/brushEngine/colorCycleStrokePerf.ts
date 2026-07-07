import { CC_PERF } from '@/utils/perf/ccPerfProbe';
import { debugLog, isDebugEnabled } from '@/utils/debug';

import { nowMs, resolveBrushSizeBucket } from './colorCycleCanvas2DUtils';

export type ColorCycleStrokePerfSession = {
  startMs: number;
  sampleEvery: number;
  stampCounter: number;
  stampSampleCounter: number;
  durations: {
    beginStrokeTotalMs: number;
    clearPrimaryMs: number;
    clearMaskMs: number;
    clearBaseMaskMs: number;
    allocOrResizeMs: number;
    stampTotalMs: number;
    stampMaskPassMs: number;
    stampApplyPassMs: number;
    midstrokeRecomposeMs: number;
    endStrokeFinalizeMs: number;
    endStrokeRecomposeOverlayMs: number;
    serializeMs: number;
  };
  stats: {
    canvasW: number;
    canvasH: number;
    brushBucket: number;
    stampBoundsArea: number;
    dirtyRectArea: number;
    stampBoundsMinX: number;
    stampBoundsMinY: number;
    stampBoundsMaxX: number;
    stampBoundsMaxY: number;
    dirtyMinX: number;
    dirtyMinY: number;
    dirtyMaxX: number;
    dirtyMaxY: number;
  };
};

export class ColorCycleStrokePerfState {
  private session?: ColorCycleStrokePerfSession;

  reset(params: { width: number; height: number; brushSize: number }): void {
    if (!CC_PERF.on) {
      this.session = undefined;
      return;
    }

    this.session = {
      startMs: nowMs(),
      sampleEvery: 20,
      stampCounter: 0,
      stampSampleCounter: 0,
      durations: {
        beginStrokeTotalMs: 0,
        clearPrimaryMs: 0,
        clearMaskMs: 0,
        clearBaseMaskMs: 0,
        allocOrResizeMs: 0,
        stampTotalMs: 0,
        stampMaskPassMs: 0,
        stampApplyPassMs: 0,
        midstrokeRecomposeMs: 0,
        endStrokeFinalizeMs: 0,
        endStrokeRecomposeOverlayMs: 0,
        serializeMs: 0,
      },
      stats: {
        canvasW: params.width,
        canvasH: params.height,
        brushBucket: resolveBrushSizeBucket(params.brushSize),
        stampBoundsArea: 0,
        dirtyRectArea: 0,
        stampBoundsMinX: params.width,
        stampBoundsMinY: params.height,
        stampBoundsMaxX: -1,
        stampBoundsMaxY: -1,
        dirtyMinX: params.width,
        dirtyMinY: params.height,
        dirtyMaxX: -1,
        dirtyMaxY: -1,
      },
    };
  }

  get(): ColorCycleStrokePerfSession | null {
    return this.session ?? null;
  }

  updateStampBounds(bounds: { minX: number; minY: number; maxX: number; maxY: number }): void {
    const perf = this.session;
    if (!perf) {
      return;
    }
    perf.stats.stampBoundsMinX = Math.min(perf.stats.stampBoundsMinX, bounds.minX);
    perf.stats.stampBoundsMinY = Math.min(perf.stats.stampBoundsMinY, bounds.minY);
    perf.stats.stampBoundsMaxX = Math.max(perf.stats.stampBoundsMaxX, bounds.maxX);
    perf.stats.stampBoundsMaxY = Math.max(perf.stats.stampBoundsMaxY, bounds.maxY);
  }

  finalizeBounds(): void {
    const perf = this.session;
    if (!perf) {
      return;
    }
    const { stampBoundsMinX, stampBoundsMinY, stampBoundsMaxX, stampBoundsMaxY } = perf.stats;
    perf.stats.stampBoundsArea = stampBoundsMaxX >= stampBoundsMinX && stampBoundsMaxY >= stampBoundsMinY
      ? (stampBoundsMaxX - stampBoundsMinX + 1) * (stampBoundsMaxY - stampBoundsMinY + 1)
      : 0;
  }

  logStroke(layerId: string): void {
    const perf = this.session;
    if (!perf || !CC_PERF.on || !isDebugEnabled('cc-perf')) {
      return;
    }
    this.finalizeBounds();
    const stats = perf.stats;
    const durations = perf.durations;
    debugLog('cc-perf', '[perf] cc-stroke', {
      layerId,
      canvas: `${stats.canvasW}x${stats.canvasH}`,
      brushBucket: stats.brushBucket,
      stamps: perf.stampCounter,
      stampBoundsArea: stats.stampBoundsArea,
      dirtyRectArea: stats.dirtyRectArea,
      beginStroke_total: durations.beginStrokeTotalMs.toFixed(2),
      clear_primary: durations.clearPrimaryMs.toFixed(2),
      clear_mask: durations.clearMaskMs.toFixed(2),
      clear_baseMask: durations.clearBaseMaskMs.toFixed(2),
      alloc_or_resize_buffers: durations.allocOrResizeMs.toFixed(2),
      stamp_total: durations.stampTotalMs.toFixed(2),
      stamp_mask_pass: durations.stampMaskPassMs.toFixed(2),
      stamp_apply_pass: durations.stampApplyPassMs.toFixed(2),
      midstroke_recompose: durations.midstrokeRecomposeMs.toFixed(2),
      endStroke_finalize: durations.endStrokeFinalizeMs.toFixed(2),
      endStroke_recompose_overlay: durations.endStrokeRecomposeOverlayMs.toFixed(2),
      serialize: durations.serializeMs.toFixed(2),
    });
  }
}
