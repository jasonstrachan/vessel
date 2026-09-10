import { buildCcPickupStrokeStops, type CcColourPickup } from '@/utils/colorCycle/ccColourPickup';
import type React from 'react';

import { getAppStoreState } from '@/stores/appStoreAccess';
import type { MarkGradientSession } from '@/hooks/canvas/utils/colorCycleMarkSession';
import {
  MIN_AUTO_SAMPLE_PREVIEW_DISTANCE,
  computePolylineLength,
  dedupePolylineForSampling,
} from '@/hooks/canvas/utils/autoSampleGradient';
import { equidistantPointsOnPolyline } from '@/hooks/canvas/handlers/brushSampling';
import { resolveStrokeDitherPalette } from '@/hooks/brushEngine/engineShared';
import { resolveStampDitherSecondaryIndex } from '@/hooks/brushEngine/strokeStampDither';
import { appendCCDebugOverlayEntry } from '@/utils/colorCycle/ccDebugOverlayStore';
import { hashStops, type StoredStop } from '@/utils/colorCycleGradientDefs';
import { parseCssColorToRgba } from '@/hooks/canvas/utils/colorCycleHelpers';
import type { CaptureRegion } from '@/hooks/canvas/utils/captureRegions';
import type { ColorCyclePaintSnapshot } from '@/lib/colorCycle/document';
import { FLOW_SLOT_MASK } from '@/lib/colorCycle/flowEncoding';

export const CC_SAMPLED_THROTTLE_MS = 120;
export const CC_SAMPLED_MAX_STOPS = 256;
export const CC_SAMPLED_SAMPLE_SPACING_PX = 1;
const CC_SHAPE_SAMPLED_MAX_STOPS = 16;
const CC_SHAPE_SAMPLED_SAMPLE_SPACING_PX = 32;

type StrokePoint = { x: number; y: number };

const clamp = (value: number, min: number, max: number): number => (
  Math.max(min, Math.min(max, value))
);

const prepareStrokePath = (points: StrokePoint[]): {
  points: StrokePoint[];
  cumulativeLengths: Float64Array;
  totalLength: number;
} | null => {
  const prepared: StrokePoint[] = [];
  for (const point of points) {
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
      continue;
    }
    const previous = prepared[prepared.length - 1];
    if (previous && Math.hypot(point.x - previous.x, point.y - previous.y) < 0.01) {
      continue;
    }
    prepared.push({ x: point.x, y: point.y });
  }
  if (prepared.length < 2) {
    return null;
  }

  const cumulativeLengths = new Float64Array(prepared.length);
  for (let index = 1; index < prepared.length; index += 1) {
    const previous = prepared[index - 1];
    const current = prepared[index];
    cumulativeLengths[index] = cumulativeLengths[index - 1]
      + Math.hypot(current.x - previous.x, current.y - previous.y);
  }
  const totalLength = cumulativeLengths[cumulativeLengths.length - 1];
  if (!(totalLength > 0)) {
    return null;
  }
  return { points: prepared, cumulativeLengths, totalLength };
};

export const remapSampledStrokePaintPhase = ({
  snapshot,
  width,
  height,
  points,
  targetSlot,
  region,
  pathPadding,
  ditherPrimaryBuffer,
}: {
  snapshot: ColorCyclePaintSnapshot;
  width: number;
  height: number;
  points: StrokePoint[];
  targetSlot: number;
  region?: CaptureRegion;
  pathPadding: number;
  ditherPrimaryBuffer?: Uint8Array | null;
}): ColorCyclePaintSnapshot | null => {
  const safeWidth = Math.floor(width);
  const safeHeight = Math.floor(height);
  const pixelCount = safeWidth * safeHeight;
  const gradientIdBuffer = snapshot.gradientIdBuffer;
  const path = prepareStrokePath(points);
  if (
    safeWidth <= 0 ||
    safeHeight <= 0 ||
    pixelCount <= 0 ||
    snapshot.paintBuffer.byteLength < pixelCount ||
    !gradientIdBuffer ||
    gradientIdBuffer.byteLength < pixelCount ||
    !path
  ) {
    return null;
  }

  const regionX = clamp(Math.floor(region?.x ?? 0), 0, safeWidth);
  const regionY = clamp(Math.floor(region?.y ?? 0), 0, safeHeight);
  const regionRight = clamp(
    Math.ceil((region?.x ?? 0) + (region?.width ?? safeWidth)),
    regionX,
    safeWidth,
  );
  const regionBottom = clamp(
    Math.ceil((region?.y ?? 0) + (region?.height ?? safeHeight)),
    regionY,
    safeHeight,
  );
  const regionWidth = regionRight - regionX;
  const regionHeight = regionBottom - regionY;
  if (regionWidth <= 0 || regionHeight <= 0) {
    return null;
  }

  const sourcePaint = new Uint8Array(snapshot.paintBuffer);
  const gradientIds = new Uint8Array(gradientIdBuffer);
  const ditherPrimary = ditherPrimaryBuffer?.byteLength === pixelCount
    ? ditherPrimaryBuffer
    : null;
  const bestDistanceSq = new Float32Array(regionWidth * regionHeight);
  bestDistanceSq.fill(Number.POSITIVE_INFINITY);
  const bestPathT = new Float32Array(regionWidth * regionHeight);
  const visited = new Uint8Array(regionWidth * regionHeight);
  const radius = Math.max(1, pathPadding);
  const radiusSq = radius * radius;

  for (let segmentIndex = 1; segmentIndex < path.points.length; segmentIndex += 1) {
    const start = path.points[segmentIndex - 1];
    const end = path.points[segmentIndex];
    const deltaX = end.x - start.x;
    const deltaY = end.y - start.y;
    const segmentLengthSq = deltaX * deltaX + deltaY * deltaY;
    if (!(segmentLengthSq > 0)) {
      continue;
    }
    const segmentLength = Math.sqrt(segmentLengthSq);
    const minX = Math.max(regionX, Math.floor(Math.min(start.x, end.x) - radius));
    const maxX = Math.min(regionRight - 1, Math.ceil(Math.max(start.x, end.x) + radius));
    const minY = Math.max(regionY, Math.floor(Math.min(start.y, end.y) - radius));
    const maxY = Math.min(regionBottom - 1, Math.ceil(Math.max(start.y, end.y) + radius));

    for (let y = minY; y <= maxY; y += 1) {
      const row = y * safeWidth;
      const localRow = (y - regionY) * regionWidth;
      for (let x = minX; x <= maxX; x += 1) {
        const pixelIndex = row + x;
        if (
          sourcePaint[pixelIndex] === 0 ||
          (gradientIds[pixelIndex] & FLOW_SLOT_MASK) !== targetSlot
        ) {
          continue;
        }

        const pixelX = x + 0.5;
        const pixelY = y + 0.5;
        const projection = clamp(
          ((pixelX - start.x) * deltaX + (pixelY - start.y) * deltaY) / segmentLengthSq,
          0,
          1,
        );
        const nearestX = start.x + deltaX * projection;
        const nearestY = start.y + deltaY * projection;
        const distanceX = pixelX - nearestX;
        const distanceY = pixelY - nearestY;
        const distanceSq = distanceX * distanceX + distanceY * distanceY;
        if (distanceSq > radiusSq) {
          continue;
        }

        const localIndex = localRow + (x - regionX);
        if (!visited[localIndex] || distanceSq <= bestDistanceSq[localIndex]) {
          visited[localIndex] = 1;
          bestDistanceSq[localIndex] = distanceSq;
          bestPathT[localIndex] = (
            path.cumulativeLengths[segmentIndex - 1] + segmentLength * projection
          ) / path.totalLength;
        }
      }
    }
  }

  const remappedPaint = new Uint8Array(sourcePaint);
  let didChange = false;
  for (let y = regionY; y < regionBottom; y += 1) {
    const row = y * safeWidth;
    const localRow = (y - regionY) * regionWidth;
    for (let x = regionX; x < regionRight; x += 1) {
      const localIndex = localRow + (x - regionX);
      if (!visited[localIndex]) {
        continue;
      }
      const pixelIndex = row + x;
      const pathT = clamp(bestPathT[localIndex], 0, 1);
      // The finalized palette is the complete sampled path. Dither inks must
      // bracket that position, not jump a quarter of the way along the image.
      const palettePosition = pathT * 254;
      const nextPrimary = 1 + (ditherPrimary ? Math.floor(palettePosition) : Math.round(palettePosition));
      let nextIndex = nextPrimary;
      if (ditherPrimary) {
        const sourcePrimary = ditherPrimary[pixelIndex];
        const sourceIndex = sourcePaint[pixelIndex];
        if (sourcePrimary === 0) {
          continue;
        }
        if (sourceIndex === resolveStampDitherSecondaryIndex(sourcePrimary)) {
          nextIndex = 1 + Math.ceil(palettePosition);
        } else if (sourceIndex !== sourcePrimary) {
          continue;
        }
      }
      if (remappedPaint[pixelIndex] !== nextIndex) {
        remappedPaint[pixelIndex] = nextIndex;
        didChange = true;
      }
    }
  }

  return didChange
    ? { ...snapshot, paintBuffer: remappedPaint.buffer }
    : null;
};

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
  markKind?: 'stroke' | 'shape';
  pickup?: CcColourPickup;
  sourcePts: Array<{ x: number; y: number }>;
  sampleColor: (x: number, y: number) => string;
  allowTiny: boolean;
}): { stops: StoredStop[]; samples: Array<{ t01: number; rgba: [number, number, number, number] }>; sampleCount: number } | null => {
  if (params.pickup) {
    const sampled = params.pickup.sampleBase
      ? buildSampledStops({ ...params, pickup: undefined })
      : null;
    return {
      stops: buildCcPickupStrokeStops({
        ...params.pickup,
        baseStops: sampled?.stops ?? params.pickup.baseStops,
      }, params.sourcePts),
      samples: sampled?.samples ?? [],
      sampleCount: sampled?.sampleCount ?? params.sourcePts.length,
    };
  }

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

  // Shape fallbacks retain their sparse sampling; dense samples are for stroke paths.
  const maxStops = params.markKind === 'stroke' ? CC_SAMPLED_MAX_STOPS : CC_SHAPE_SAMPLED_MAX_STOPS;
  const spacing = params.markKind === 'stroke' ? CC_SAMPLED_SAMPLE_SPACING_PX : CC_SHAPE_SAMPLED_SAMPLE_SPACING_PX;
  const sampleCount = Math.min(
    maxStops,
    Math.max(2, Math.floor(totalLen / spacing) + 2)
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

export const resolveSampledStopsWithFallback = ({
  sampledStops,
  sampleCount,
  fallbackStops,
}: {
  sampledStops: StoredStop[] | null | undefined;
  sampleCount: number;
  fallbackStops: StoredStop[];
}): { stops: StoredStop[]; usedFallbackStops: boolean; sampledUniqueColors: number; fallbackUniqueColors: number } => {
  const sampledUniqueColors = new Set((sampledStops ?? []).map((stop) => stop.color)).size;
  const fallbackUniqueColors = new Set(fallbackStops.map((stop) => stop.color)).size;
  const hasUsableSampledStops = Boolean(sampledStops && sampledStops.length >= 2);
  const isDegenerateSampledPreview = sampleCount <= 1 || sampledUniqueColors <= 1;
  const shouldPreserveFallback =
    fallbackStops.length >= 2 &&
    fallbackUniqueColors > 1 &&
    (!hasUsableSampledStops || isDegenerateSampledPreview);

  if (shouldPreserveFallback) {
    return {
      stops: fallbackStops,
      usedFallbackStops: true,
      sampledUniqueColors,
      fallbackUniqueColors,
    };
  }

  return {
    stops: hasUsableSampledStops ? (sampledStops ?? fallbackStops) : fallbackStops,
    usedFallbackStops: !hasUsableSampledStops,
    sampledUniqueColors,
    fallbackUniqueColors,
  };
};

export const updateCcSampledSession = (args: CcSampledUpdateArgs): CcSampledUpdateResult | null => {
  if (args.session.source === 'sampled' && args.session.markKind === 'stroke') {
    args.session.sampledStrokePoints = dedupePolylineForSampling(args.sourcePts)
      .map((point) => ({ x: point.x, y: point.y }));
    args.session.sampledStrokeColorAt = args.sampleColor;
  }
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
    markKind: args.session.markKind,
    pickup: args.session.colourPickup,
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
