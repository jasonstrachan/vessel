import { hashNumbers } from '@/utils/risographTexture';

type FlatSeedPoint = {
  x: number;
  y: number;
};

type FlatSeedBounds = {
  minX: number;
  minY: number;
  width: number;
  height: number;
};

const hashStringSeed = (value: string | null | undefined): number => {
  if (!value) {
    return 0;
  }
  let hash = 2166136261 >>> 0;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i) & 0xff;
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash >>> 0;
};

export const resolveStableFlatSeed = ({
  markId,
  bounds,
  points,
}: {
  markId?: string | null;
  bounds?: FlatSeedBounds | null;
  points?: FlatSeedPoint[] | null;
}): number => {
  const seedValues = [hashStringSeed(markId)];
  if (bounds) {
    seedValues.push(bounds.minX, bounds.minY, bounds.width, bounds.height);
  }
  const previewPoints = (points ?? []).slice(0, 3);
  seedValues.push(previewPoints.length);
  for (let i = 0; i < previewPoints.length; i += 1) {
    seedValues.push(previewPoints[i].x, previewPoints[i].y);
  }
  return hashNumbers(...seedValues);
};
