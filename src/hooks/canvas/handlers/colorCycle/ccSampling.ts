import { getAppStoreState } from '@/stores/appStoreAccess';
import type React from 'react';
import type { MarkGradientSession } from '@/hooks/canvas/utils/colorCycleMarkSession';
import {
  AUTO_SAMPLE_MAX_STOPS,
  MIN_AUTO_SAMPLE_PREVIEW_DISTANCE,
  computePolylineLength,
  dedupePolylineForSampling,
} from '@/hooks/canvas/utils/autoSampleGradient';
import { equidistantPointsOnPolyline } from '@/hooks/canvas/handlers/brushSampling';
import { resolveStrokeDitherPalette } from '@/hooks/brushEngine/engineShared';
import { hashStops, type StoredStop } from '@/utils/colorCycleGradientDefs';
import { parseCssColorToRgba } from '@/hooks/canvas/utils/colorCycleHelpers';

export const CC_SAMPLED_THROTTLE_MS = 120;

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
    return null;
  }
  if (deduped.length === 1) {
    const color = params.sampleColor(deduped[0].x, deduped[0].y);
    const rgba = parseCssColorToRgba(color);
    return {
      stops: buildSingleSampleAnimatedStops(color),
      samples: [{ t01: 0, rgba }],
      sampleCount: 1,
    };
  }

  const totalLen = computePolylineLength(deduped);
  if (!params.allowTiny && totalLen < MIN_AUTO_SAMPLE_PREVIEW_DISTANCE) {
    return null;
  }

  const sampleCount = Math.min(
    AUTO_SAMPLE_MAX_STOPS,
    Math.max(2, Math.floor(totalLen / 64) + 2)
  );
  const sampledPoints = equidistantPointsOnPolyline(deduped, sampleCount);
  if (sampledPoints.length === 0) {
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

  return { stops, samples, sampleCount: sampledPoints.length };
};

export const updateCcSampledSession = (args: CcSampledUpdateArgs): CcSampledUpdateResult | null => {
  if (args.now - args.lastUpdateRef.current < CC_SAMPLED_THROTTLE_MS) {
    return null;
  }
  if (!args.session || args.session.source !== 'sampled') {
    return null;
  }

  const result = buildSampledStops({
    sourcePts: args.sourcePts,
    sampleColor: args.sampleColor,
    allowTiny: Boolean(args.allowTiny),
  });
  if (!result || result.stops.length < 2) {
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

  return {
    updated,
    sampleCount: result.sampleCount,
    stops: result.stops,
  };
};
