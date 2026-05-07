import { cloneStops } from '@/hooks/canvas/utils/colorCycleHelpers';
import type { StoredStop } from '@/utils/colorCycleGradientDefs';

type SampledCcShapePreviewStopsEntry = {
  layerId: string;
  stops: StoredStop[];
  replayKey: string;
  shapeKey: string;
  rawPointCount: number;
  seq: number;
  pointCount: number;
  at: number;
};

const previewStopsByLayer = new Map<string, SampledCcShapePreviewStopsEntry>();
const MAX_PREVIEW_STOP_AGE_MS = 30_000;

export const buildSampledCcShapePreviewShapeKey = (
  points: Array<{ x: number; y: number }>
): string =>
  points
    .map((point) => `${Math.round(point.x * 100) / 100},${Math.round(point.y * 100) / 100}`)
    .join('|');

export const rememberSampledCcShapePreviewStops = ({
  layerId,
  stops,
  replayKey,
  shapeKey,
  rawPointCount,
  seq,
  pointCount,
}: {
  layerId: string | null | undefined;
  stops: StoredStop[];
  replayKey: string;
  shapeKey: string;
  rawPointCount: number;
  seq: number;
  pointCount: number;
}): void => {
  if (!layerId || stops.length < 2) {
    return;
  }
  previewStopsByLayer.set(layerId, {
    layerId,
    stops: cloneStops(stops),
    replayKey,
    shapeKey,
    rawPointCount,
    seq,
    pointCount,
    at: Date.now(),
  });
};

export const consumeSampledCcShapePreviewStops = ({
  layerId,
  shapeKey,
  rawPointCount,
}: {
  layerId: string | null | undefined;
  shapeKey: string;
  rawPointCount: number;
}): SampledCcShapePreviewStopsEntry | null => {
  if (!layerId || !shapeKey) {
    return null;
  }
  const entry = previewStopsByLayer.get(layerId) ?? null;
  if (!entry) {
    return null;
  }
  previewStopsByLayer.delete(layerId);
  if (Date.now() - entry.at > MAX_PREVIEW_STOP_AGE_MS) {
    return null;
  }
  if (entry.shapeKey !== shapeKey || entry.rawPointCount !== rawPointCount) {
    return null;
  }
  return {
    ...entry,
    stops: cloneStops(entry.stops),
  };
};

export const clearSampledCcShapePreviewStops = (
  layerId?: string | null
): void => {
  if (layerId) {
    previewStopsByLayer.delete(layerId);
    return;
  }
  previewStopsByLayer.clear();
};
