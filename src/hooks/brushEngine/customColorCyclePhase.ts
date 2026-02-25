export type CustomBrushCcPhaseMode = 'global' | 'per-stroke-seeded' | 'jittered';

const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

const clamp01 = (value: number): number => {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(1, value));
};

const normalizePhase = (value: number): number => {
  if (!Number.isFinite(value)) {
    return 0;
  }
  const normalized = value % 1;
  return normalized < 0 ? normalized + 1 : normalized;
};

const fnv1aByte = (hash: number, byte: number): number =>
  Math.imul((hash ^ (byte & 0xff)) >>> 0, FNV_PRIME) >>> 0;

const fnv1aInt = (hash: number, value: number): number => {
  const v = value | 0;
  let next = hash;
  next = fnv1aByte(next, v & 0xff);
  next = fnv1aByte(next, (v >>> 8) & 0xff);
  next = fnv1aByte(next, (v >>> 16) & 0xff);
  next = fnv1aByte(next, (v >>> 24) & 0xff);
  return next;
};

const hashToUnitFloat = (hash: number): number => {
  const normalized = (hash >>> 0) / 0x100000000;
  return clamp01(normalized);
};

export const resolveCustomBrushCcPhaseMode = (
  mode: CustomBrushCcPhaseMode | undefined
): CustomBrushCcPhaseMode => {
  if (mode === 'per-stroke-seeded' || mode === 'jittered') {
    return mode;
  }
  return 'global';
};

export const computeCustomBrushStrokeSeedPhase = (
  x: number,
  y: number,
  timestamp: number
): number => {
  let hash = FNV_OFFSET;
  hash = fnv1aInt(hash, Math.round(x * 1000));
  hash = fnv1aInt(hash, Math.round(y * 1000));
  hash = fnv1aInt(hash, Math.round(timestamp));
  return normalizePhase(hashToUnitFloat(hash));
};

export const computeCustomBrushStampJitter = (
  strokeSeedPhase: number,
  stampIndex: number,
  jitterAmount: number
): number => {
  const jitter = clamp01(jitterAmount);
  if (jitter <= 0) {
    return 0;
  }

  let hash = FNV_OFFSET;
  hash = fnv1aInt(hash, Math.round(strokeSeedPhase * 0x7fffffff));
  hash = fnv1aInt(hash, stampIndex);
  const centered = hashToUnitFloat(hash) * 2 - 1;
  return centered * jitter;
};

export const computeCustomBrushPhaseAtStamp = (
  basePhase: number,
  stampIndex: number,
  phaseStep: number,
  jitterOffset: number
): number => normalizePhase(basePhase + stampIndex * phaseStep + jitterOffset);

