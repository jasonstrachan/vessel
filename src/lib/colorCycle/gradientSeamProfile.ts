export type GradientSeamProfile = 'hard' | 'soft';

export const DEFAULT_GRADIENT_SEAM_PROFILE: GradientSeamProfile = 'hard';
export const DEFAULT_HARD_SEAM_SHARE = 0.6;

const SOFT_SEAM_BLEND_RATIO = 1 / 8;

export const normalizeGradientSeamProfile = (value?: string | null): GradientSeamProfile =>
  value === 'soft' ? 'soft' : DEFAULT_GRADIENT_SEAM_PROFILE;

export const appendGradientSeamProfileSignature = (
  signature: string,
  seamProfile?: GradientSeamProfile | null,
): string => `${signature}|seam:${normalizeGradientSeamProfile(seamProfile)}`;

const hashStringToUnitInterval = (value: string): number => {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 4294967295;
};

export const resolveDefaultGradientSeamProfile = (
  signature: string,
  hardShare: number = DEFAULT_HARD_SEAM_SHARE,
): GradientSeamProfile => {
  const clampedHardShare = Math.max(0, Math.min(1, hardShare));
  return hashStringToUnitInterval(signature) < clampedHardShare ? 'hard' : 'soft';
};

export const applyGradientSeamProfile = (
  palette: Uint8Array | Uint8ClampedArray,
  params: {
    paletteSize: number;
    seamProfile?: GradientSeamProfile | null;
    offset?: number;
  },
): void => {
  const seamProfile = normalizeGradientSeamProfile(params.seamProfile);
  const paletteSize = Math.max(1, Math.floor(params.paletteSize));
  if (seamProfile === 'hard' || paletteSize < 2) {
    return;
  }

  const offset = Math.max(0, Math.floor(params.offset ?? 0));
  const segmentLength = paletteSize * 4;
  const segmentEnd = offset + segmentLength;
  if (segmentEnd > palette.length) {
    return;
  }

  const source = palette.slice(offset, segmentEnd);
  const firstR = source[0] ?? 0;
  const firstG = source[1] ?? 0;
  const firstB = source[2] ?? 0;
  const firstA = source[3] ?? 255;
  const blendLength = Math.max(2, Math.round(paletteSize * SOFT_SEAM_BLEND_RATIO));
  const blendStart = Math.max(1, paletteSize - blendLength);
  const blendSpan = paletteSize - blendStart;
  if (blendSpan <= 0) {
    return;
  }

  for (let i = blendStart; i < paletteSize; i += 1) {
    const blendT = (i - blendStart + 1) / blendSpan;
    const srcIdx = i * 4;
    const dstIdx = offset + srcIdx;
    palette[dstIdx] = Math.round((source[srcIdx] ?? 0) * (1 - blendT) + firstR * blendT);
    palette[dstIdx + 1] = Math.round((source[srcIdx + 1] ?? 0) * (1 - blendT) + firstG * blendT);
    palette[dstIdx + 2] = Math.round((source[srcIdx + 2] ?? 0) * (1 - blendT) + firstB * blendT);
    palette[dstIdx + 3] = Math.round((source[srcIdx + 3] ?? 255) * (1 - blendT) + firstA * blendT);
  }
};
