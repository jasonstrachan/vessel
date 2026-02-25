export type PolyPoint = { x: number; y: number };

export type AutoSampleComputeOptions = {
  allowTiny?: boolean;
  minDistance?: number;
  maxStops?: number;
};

export const AUTO_SAMPLE_DEDUPE_EPS = 0.25;
export const AUTO_SAMPLE_MAX_STOPS = 6;
export const MIN_AUTO_SAMPLE_PREVIEW_DISTANCE = 18;

export const dedupePolylineForSampling = (
  pts: PolyPoint[],
  eps = AUTO_SAMPLE_DEDUPE_EPS
): PolyPoint[] => {
  if (pts.length === 0) {
    return [];
  }
  const deduped: PolyPoint[] = [];
  for (let i = 0; i < pts.length; i += 1) {
    const p = pts[i];
    const last = deduped[deduped.length - 1];
    if (!last || Math.hypot(p.x - last.x, p.y - last.y) > eps) {
      deduped.push(p);
    }
  }
  return deduped;
};

export const computePolylineLength = (pts: PolyPoint[]): number => {
  if (pts.length < 2) {
    return 0;
  }
  let total = 0;
  for (let i = 0; i < pts.length - 1; i += 1) {
    const dx = pts[i + 1].x - pts[i].x;
    const dy = pts[i + 1].y - pts[i].y;
    total += Math.hypot(dx, dy);
  }
  return total;
};

export const computeAutoSampleStopsFromPolyline = (
  sourcePts: PolyPoint[],
  sampleColor: (x: number, y: number) => string,
  sampler: (pts: PolyPoint[], count: number) => PolyPoint[],
  options: AutoSampleComputeOptions = {}
): Array<{ position: number; color: string }> | null => {
  const deduped = dedupePolylineForSampling(sourcePts);
  if (deduped.length < 2) {
    return null;
  }

  const totalLen = computePolylineLength(deduped);
  const minDistance = options.minDistance ?? MIN_AUTO_SAMPLE_PREVIEW_DISTANCE;
  if (!options.allowTiny && totalLen < minDistance) {
    return null;
  }

  const maxStops = options.maxStops ?? AUTO_SAMPLE_MAX_STOPS;
  const sampleCount = Math.min(maxStops, Math.max(2, Math.floor(totalLen / 64) + 2));
  const sampledPoints = sampler(deduped, sampleCount);
  if (sampledPoints.length < 2) {
    if (options.allowTiny && deduped.length >= 2) {
      const firstColor = sampleColor(deduped[0].x, deduped[0].y);
      const lastColor = sampleColor(deduped[deduped.length - 1].x, deduped[deduped.length - 1].y);
      return [
        { position: 0, color: firstColor },
        { position: 1, color: lastColor }
      ];
    }
    return null;
  }

  return sampledPoints.map((point, index) => ({
    position: sampledPoints.length === 1 ? 0 : index / (sampledPoints.length - 1),
    color: sampleColor(point.x, point.y)
  }));
};

export const computeDitherGradSampleStopsFromPolyline = (
  sourcePts: PolyPoint[],
  sampleColor: (x: number, y: number) => string,
  sampler: (pts: PolyPoint[], count: number) => PolyPoint[],
  count: number
): string[] | null => {
  const clampedCount = Math.max(1, Math.min(AUTO_SAMPLE_MAX_STOPS, Math.round(count)));
  if (clampedCount <= 0) {
    return null;
  }

  const deduped = dedupePolylineForSampling(sourcePts);
  if (deduped.length === 0) {
    return null;
  }

  if (deduped.length === 1 || clampedCount === 1) {
    const color = sampleColor(deduped[0].x, deduped[0].y);
    return Array.from({ length: clampedCount }, () => color);
  }

  const sampledPoints = sampler(deduped, clampedCount);
  if (sampledPoints.length === 0) {
    const color = sampleColor(deduped[0].x, deduped[0].y);
    return Array.from({ length: clampedCount }, () => color);
  }

  const filled = sampledPoints.slice(0, clampedCount);
  filled[0] = deduped[0];
  if (clampedCount > 1) {
    filled[clampedCount - 1] = deduped[deduped.length - 1];
  }
  while (filled.length < clampedCount) {
    filled.push(deduped[deduped.length - 1]);
  }

  return filled.map((point) => sampleColor(point.x, point.y));
};
