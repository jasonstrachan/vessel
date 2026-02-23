import type { AlignInput } from './alignFitCore';

export interface RawAlignInput {
  fit?: unknown;
  positioning?: unknown;
  horizontal?: unknown;
  vertical?: unknown;
  anchor?: unknown;
  offsetPercent?: { x?: unknown; y?: unknown } | null;
}

const isFit = (value: unknown): value is AlignInput['fit'] => {
  return value === 'none'
    || value === 'contain'
    || value === 'cover'
    || value === 'uniform'
    || value === 'fill'
    || value === 'tile';
};

const isPositioning = (value: unknown): value is AlignInput['positioning'] => {
  return value === 'anchor' || value === 'auto';
};

const toNumber = (value: unknown, fallback = 0): number => {
  const num = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(num) ? num : fallback;
};

const normalizePositioning = (value: unknown): AlignInput['positioning'] => {
  if (value === 'anchor') {
    return 'anchor';
  }
  // Legacy payloads may still emit `percent`; treat it as modern `auto`.
  if (value === 'percent' || value === 'auto') {
    return 'auto';
  }
  return 'auto';
};

export const normalizeAlign = (
  raw: RawAlignInput | null | undefined,
  autoOffsetPercent?: { x: number; y: number }
): AlignInput => {
  const fit = isFit(raw?.fit) ? raw?.fit : 'none';
  const positioning = isPositioning(raw?.positioning)
    ? raw.positioning
    : normalizePositioning(raw?.positioning);
  const horizontal = raw?.horizontal === 'left' || raw?.horizontal === 'right'
    ? raw.horizontal
    : 'center';
  const vertical = raw?.vertical === 'top' || raw?.vertical === 'bottom'
    ? raw.vertical
    : 'center';
  const anchor = raw?.anchor as AlignInput['anchor'] | undefined;

  const align: AlignInput = {
    fit,
    positioning,
    horizontal,
    vertical,
    anchor
  };

  if (positioning === 'auto') {
    const source = raw?.offsetPercent ?? autoOffsetPercent ?? { x: 50, y: 50 };
    align.offsetPercent = {
      x: toNumber(source?.x, 0),
      y: toNumber(source?.y, 0)
    };
  }

  return align;
};

export default normalizeAlign;
