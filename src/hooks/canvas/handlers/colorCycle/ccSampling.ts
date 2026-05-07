import { getAppStoreState } from '@/stores/appStoreAccess';
import type React from 'react';
import type { MarkGradientSession } from '@/hooks/canvas/utils/colorCycleMarkSession';
import {
  MIN_AUTO_SAMPLE_PREVIEW_DISTANCE,
  computePolylineLength,
  dedupePolylineForSampling,
} from '@/hooks/canvas/utils/autoSampleGradient';
import { equidistantPointsOnPolyline } from '@/hooks/canvas/handlers/brushSampling';
import { resolveStrokeDitherPalette } from '@/hooks/brushEngine/engineShared';
import { appendCCDebugOverlayEntry } from '@/utils/colorCycle/ccDebugOverlayStore';
import { hashStops, type StoredStop } from '@/utils/colorCycleGradientDefs';
import { parseCssColorToRgba } from '@/hooks/canvas/utils/colorCycleHelpers';

export const CC_SAMPLED_THROTTLE_MS = 120;
export const CC_SAMPLED_MAX_STOPS = 32;
export const CC_SAMPLED_SAMPLE_SPACING_PX = 16;

export type CcSampledUpdateArgs = {
  session: MarkGradientSession;
  sourcePts: Array<{ x: number; y: number }>;
  now: number;
  lastUpdateRef: React.MutableRefObject<number>;
  sampleColor: (x: number, y: number) => string;
  allowTiny?: boolean;
};

export type CcSampledUpdateResult = {
  updated: boolean;
  sampleCount: number;
  stops: StoredStop[];
};

const logSampledPipeline = (event: string, payload: Record<string, unknown>): void => {
  if (process.env.NODE_ENV === 'test') {
    return;
  }
  appendCCDebugOverlayEntry('log', `sampled pipeline: ${event}`, payload);
};

const buildSingleSampleAnimatedStops = (color: string): StoredStop[] => {
  const brushSettings = getAppStoreState().tools.brushSettings;
  const { palette } = resolveStrokeDitherPalette({
    color,
    spreadPercent: brushSettings.ditherPaletteSpread ?? 0,
    ditherBackgroundFill: false,
  });
  const low = palette[0] ?? color;
  const high = palette[1] ?? palette[0] ?? color;

  if (low === high) {
    return [
      { position: 0, color },
      { position: 1, color },
    ];
  }

  return [
    { position: 0, color: low },
    { position: 1, color: high },
  ];
};

export const buildSampledStops = (params: {
  sourcePts: Array<{ x: number; y: number }>;
  sampleColor: (x: number, y: number) => string;
  allowTiny: boolean;
}): { stops: StoredStop[]; samples: Array<{ t01: number; rgba: [number, number, number, number] }>; sampleCount: number } | null => {
  const deduped = dedupePolylineForSampling(params.sourcePts);
  if (deduped.length === 0) {
    logSampledPipeline('buildSampledStops empty', {
      sourcePts: params.sourcePts.length,
    });
    return null;
  }
  if (deduped.length === 1) {
    const color = params.sampleColor(deduped[0].x, deduped[0].y);
    const rgba = parseCssColorToRgba(color);
    logSampledPipeline('buildSampledStops single', {
      sourcePts: params.sourcePts.length,
      deduped: deduped.length,
      color,
    });
    return {
      stops: buildSingleSampleAnimatedStops(color),
      samples: [{ t01: 0, rgba }],
      sampleCount: 1,
    };
  }

  const totalLen = computePolylineLength(deduped);
  if (!params.allowTiny && totalLen < MIN_AUTO_SAMPLE_PREVIEW_DISTANCE) {
    logSampledPipeline('buildSampledStops too short', {
      sourcePts: params.sourcePts.length,
      deduped: deduped.length,
      totalLen: Number(totalLen.toFixed(2)),
      allowTiny: params.allowTiny,
    });
    return null;
  }

  const sampleCount = Math.min(
    CC_SAMPLED_MAX_STOPS,
    Math.max(2, Math.floor(totalLen / CC_SAMPLED_SAMPLE_SPACING_PX) + 2)
  );
  const sampledPoints = equidistantPointsOnPolyline(deduped, sampleCount);
  if (sampledPoints.length === 0) {
    logSampledPipeline('buildSampledStops no sampled points', {
      sourcePts: params.sourcePts.length,
      deduped: deduped.length,
      totalLen: Number(totalLen.toFixed(2)),
      requestedSampleCount: sampleCount,
    });
    return null;
  }

  const stops: StoredStop[] = [];
  const samples: Array<{ t01: number; rgba: [number, number, number, number] }> = [];
  const denom = Math.max(1, sampledPoints.length - 1);
  for (let i = 0; i < sampledPoints.length; i += 1) {
    const point = sampledPoints[i];
    const color = params.sampleColor(point.x, point.y);
    const t01 = sampledPoints.length === 1 ? 0 : i / denom;
    stops.push({ position: t01, color });
    samples.push({ t01, rgba: parseCssColorToRgba(color) });
  }

  logSampledPipeline('buildSampledStops', {
    sourcePts: params.sourcePts.length,
    deduped: deduped.length,
    totalLen: Number(totalLen.toFixed(2)),
    requestedSampleCount: sampleCount,
    sampledPoints: sampledPoints.length,
    stopCount: stops.length,
    uniqueColors: new Set(stops.map((stop) => stop.color)).size,
  });

  return { stops, samples, sampleCount: sampledPoints.length };
};

export const updateCcSampledSession = (args: CcSampledUpdateArgs): CcSampledUpdateResult | null => {
  if (args.now - args.lastUpdateRef.current < CC_SAMPLED_THROTTLE_MS) {
    logSampledPipeline('updateCcSampledSession throttled', {
      now: Number(args.now.toFixed(2)),
      last: Number(args.lastUpdateRef.current.toFixed(2)),
      delta: Number((args.now - args.lastUpdateRef.current).toFixed(2)),
      sourcePts: args.sourcePts.length,
    });
    return null;
  }
  if (!args.session || args.session.source !== 'sampled') {
    logSampledPipeline('updateCcSampledSession skipped session', {
      hasSession: Boolean(args.session),
      source: args.session?.source ?? null,
      sourcePts: args.sourcePts.length,
    });
    return null;
  }

  const result = buildSampledStops({
    sourcePts: args.sourcePts,
    sampleColor: args.sampleColor,
    allowTiny: Boolean(args.allowTiny),
  });
  if (!result || result.stops.length < 2) {
    logSampledPipeline('updateCcSampledSession no result', {
      hasResult: Boolean(result),
      stopCount: result?.stops.length ?? 0,
      sourcePts: args.sourcePts.length,
    });
    return null;
  }

  const fallbackStops = args.session.fallbackStopsStored;
  const sampledUniqueColors = new Set(result.stops.map((stop) => stop.color)).size;
  const isDegenerateSampledPreview = result.sampleCount <= 1 || sampledUniqueColors <= 1;
  const shouldPreserveFallback =
    Array.isArray(fallbackStops) &&
    fallbackStops.length >= 2 &&
    fallbackStops.length > result.stops.length &&
    isDegenerateSampledPreview;
  if (shouldPreserveFallback) {
    logSampledPipeline('updateCcSampledSession preserve fallback', {
      resultSampleCount: result.sampleCount,
      resultStops: result.stops.length,
      resultUniqueColors: sampledUniqueColors,
      fallbackStops: fallbackStops?.length ?? 0,
    });
    args.lastUpdateRef.current = args.now;
    return {
      updated: false,
      sampleCount: result.sampleCount,
      stops: fallbackStops,
    };
  }

  const nextHash = hashStops(result.stops, args.session.gradientKind);
  const updated = nextHash !== args.session.previewHash;
  args.session.previewStopsStored = result.stops;
  args.session.previewHash = nextHash;
  args.session.samples = result.samples;
  args.lastUpdateRef.current = args.now;
  logSampledPipeline('updateCcSampledSession commit preview', {
    sampleCount: result.sampleCount,
    stopCount: result.stops.length,
    uniqueColors: sampledUniqueColors,
    previewHash: nextHash,
  });

  return {
    updated,
    sampleCount: result.sampleCount,
    stops: result.stops,
  };
};
