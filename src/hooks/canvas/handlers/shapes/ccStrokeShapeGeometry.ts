import type { BrushSettings } from '@/types';
import { calculatePressureSize } from '@/utils/pressureCurve';
import { resolveBrushPressureRange } from '@/utils/pressureSettings';

export type CcStrokeSample = {
  x: number;
  y: number;
  pressure?: number;
};

export type CcStrokeShapeGeometry = {
  shapePoints: Array<{ x: number; y: number }>;
  direction: { x: number; y: number };
  centerline: CcStrokeSample[];
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
};

const MIN_SAMPLE_DISTANCE_PX = 0.25;
const MIN_DIRECTION_LENGTH = 1e-3;

const dedupeSamples = (samples: CcStrokeSample[]): CcStrokeSample[] => {
  const deduped: CcStrokeSample[] = [];
  for (const sample of samples) {
    const previous = deduped[deduped.length - 1];
    if (
      previous &&
      Math.hypot(sample.x - previous.x, sample.y - previous.y) < MIN_SAMPLE_DISTANCE_PX
    ) {
      continue;
    }
    deduped.push({ ...sample });
  }
  return deduped;
};

const resolveSampleWidth = (
  settings: Pick<BrushSettings, 'size' | 'pressureEnabled' | 'minPressure' | 'maxPressure' | 'brushShape'>,
  pressure?: number
): number => {
  const baseSize = Math.max(1, Number.isFinite(settings.size) ? settings.size : 1);
  if (!settings.pressureEnabled) {
    return baseSize;
  }

  const range = resolveBrushPressureRange(settings as BrushSettings);
  return calculatePressureSize(
    baseSize,
    Math.max(0, Math.min(1, pressure ?? 0.5)),
    range.minPercent,
    range.maxPercent
  );
};

const normalize = (x: number, y: number): { x: number; y: number } | null => {
  const length = Math.hypot(x, y);
  if (length < MIN_DIRECTION_LENGTH) {
    return null;
  }
  return { x: x / length, y: y / length };
};

const resolveStrokeDirection = (centerline: CcStrokeSample[]): { x: number; y: number } | null => {
  const first = centerline[0];
  const last = centerline[centerline.length - 1];
  const endpointDirection = normalize(last.x - first.x, last.y - first.y);
  if (endpointDirection) {
    return endpointDirection;
  }

  for (let index = 1; index < centerline.length; index += 1) {
    const previous = centerline[index - 1];
    const current = centerline[index];
    const segmentDirection = normalize(current.x - previous.x, current.y - previous.y);
    if (segmentDirection) {
      return segmentDirection;
    }
  }

  return null;
};

const computeBounds = (points: Array<{ x: number; y: number }>) => {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const point of points) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  return { minX, minY, maxX, maxY };
};

export const buildCcStrokeShapeGeometry = ({
  samples,
  brushSettings,
}: {
  samples: CcStrokeSample[];
  brushSettings: Pick<BrushSettings, 'size' | 'pressureEnabled' | 'minPressure' | 'maxPressure' | 'brushShape'>;
}): CcStrokeShapeGeometry | null => {
  const centerline = dedupeSamples(samples);
  if (centerline.length < 2) {
    return null;
  }

  const direction = resolveStrokeDirection(centerline);
  if (!direction) {
    return null;
  }

  const left: Array<{ x: number; y: number }> = [];
  const right: Array<{ x: number; y: number }> = [];

  for (let index = 0; index < centerline.length; index += 1) {
    const current = centerline[index];
    const previous = centerline[Math.max(0, index - 1)];
    const next = centerline[Math.min(centerline.length - 1, index + 1)];
    const tangent =
      normalize(next.x - previous.x, next.y - previous.y) ??
      normalize(current.x - previous.x, current.y - previous.y) ??
      normalize(next.x - current.x, next.y - current.y) ??
      direction;
    const halfWidth = Math.max(0.5, resolveSampleWidth(brushSettings, current.pressure) / 2);
    const normal = { x: -tangent.y, y: tangent.x };
    const capOffset =
      index === 0
        ? { x: -tangent.x * halfWidth, y: -tangent.y * halfWidth }
        : index === centerline.length - 1
          ? { x: tangent.x * halfWidth, y: tangent.y * halfWidth }
          : { x: 0, y: 0 };
    const cx = current.x + capOffset.x;
    const cy = current.y + capOffset.y;

    left.push({
      x: cx + normal.x * halfWidth,
      y: cy + normal.y * halfWidth,
    });
    right.push({
      x: cx - normal.x * halfWidth,
      y: cy - normal.y * halfWidth,
    });
  }

  const shapePoints = [...left, ...right.reverse()];
  if (shapePoints.length < 4) {
    return null;
  }

  return {
    shapePoints,
    direction,
    centerline,
    bounds: computeBounds(shapePoints),
  };
};
