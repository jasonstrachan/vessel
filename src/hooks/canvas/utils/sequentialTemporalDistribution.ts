import { isFeatureFlagEnabled } from '@/config/featureFlags';
import type { SequentialStampPoint } from '@/types';

const MAX_TEMPORAL_DISTRIBUTION_FRAMES = 32;

const normalizeFrameIndex = (frame: number, frameCount: number): number => {
  const safeFrameCount = Math.max(1, Math.round(frameCount));
  const normalized = Math.round(frame) % safeFrameCount;
  return normalized < 0 ? normalized + safeFrameCount : normalized;
};

export const buildSequentialTemporalFrameBuckets = ({
  stamps,
  frameCount,
  baseFrameIndex,
  spreadFrames,
  trailFalloff,
  burstFrames,
  gapFrames,
  disableDistribution,
}: {
  stamps: SequentialStampPoint[];
  frameCount: number;
  baseFrameIndex: number;
  spreadFrames: number;
  trailFalloff: number;
  burstFrames: number;
  gapFrames: number;
  disableDistribution?: boolean;
}): Array<{ frameIndex: number; stamps: SequentialStampPoint[] }> => {
  if (disableDistribution) {
    return [{ frameIndex: baseFrameIndex, stamps }];
  }
  if (
    !isFeatureFlagEnabled('enableSequentialTemporalDistribution') ||
    frameCount <= 1 ||
    stamps.length <= 1
  ) {
    return [{ frameIndex: baseFrameIndex, stamps }];
  }

  const requestedSpread = Number.isFinite(spreadFrames)
    ? Math.max(1, Math.round(spreadFrames))
    : 1;
  if (requestedSpread <= 1) {
    return [{ frameIndex: baseFrameIndex, stamps }];
  }
  const bucketCount = Math.min(
    MAX_TEMPORAL_DISTRIBUTION_FRAMES,
    requestedSpread,
    stamps.length,
  );
  const buckets = Array.from({ length: bucketCount }, () => [] as SequentialStampPoint[]);
  for (let i = 0; i < stamps.length; i += 1) {
    const bucketIndex = Math.min(bucketCount - 1, Math.floor((i * bucketCount) / stamps.length));
    buckets[bucketIndex].push(stamps[i]);
  }

  const safeBurstFrames = Number.isFinite(burstFrames)
    ? Math.max(1, Math.round(burstFrames))
    : 1;
  const safeGapFrames = Number.isFinite(gapFrames)
    ? Math.max(0, Math.round(gapFrames))
    : 0;
  const cycleLength = safeBurstFrames + safeGapFrames;
  const safeTrailFalloff = Number.isFinite(trailFalloff)
    ? Math.max(0, Math.min(1, trailFalloff))
    : 0;
  const distributed: Array<{ frameIndex: number; stamps: SequentialStampPoint[] }> = [];
  for (let i = 0; i < buckets.length; i += 1) {
    const bucketStamps = buckets[i];
    if (bucketStamps.length === 0) {
      continue;
    }
    const cycleIndex = Math.floor(i / safeBurstFrames);
    const cycleOffset = i % safeBurstFrames;
    const frameOffset = cycleIndex * cycleLength + cycleOffset;
    const progress = bucketCount <= 1 ? 0 : i / (bucketCount - 1);
    const alphaScale = 1 - safeTrailFalloff * progress;
    distributed.push({
      frameIndex: normalizeFrameIndex(baseFrameIndex + frameOffset, frameCount),
      stamps: alphaScale >= 0.999
        ? bucketStamps
        : bucketStamps.map((stamp) => ({
            ...stamp,
            alpha: Math.max(0, Math.min(1, stamp.alpha * alphaScale)),
          })),
    });
  }

  return distributed.length > 0
    ? distributed
    : [{ frameIndex: baseFrameIndex, stamps }];
};

export const resolveSequentialTemporalDistributionReason = ({
  frameCount,
  stampCount,
  bucketCount,
  spreadFrames,
}: {
  frameCount: number;
  stampCount: number;
  bucketCount: number;
  spreadFrames: number;
}): string => {
  if (!isFeatureFlagEnabled('enableSequentialTemporalDistribution')) {
    return 'flag-disabled';
  }
  if (frameCount <= 1) {
    return 'frame-count-1';
  }
  if (stampCount <= 1) {
    return 'insufficient-stamps';
  }
  if (!Number.isFinite(spreadFrames) || spreadFrames <= 1) {
    return 'spread-single';
  }
  return bucketCount > 1 ? 'split' : 'bucket-single';
};
