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
  return value === 'anchor' || value === 'percent' || value === 'auto';
};

const toNumber = (value: unknown, fallback = 0): number => {
  const num = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(num) ? num : fallback;
};

export const normalizeAlign = (
  raw: RawAlignInput | null | undefined,
  autoOffsetPercent?: { x: number; y: number }
): AlignInput => {
  const fit = isFit(raw?.fit) ? raw?.fit : 'none';
  const positioning = isPositioning(raw?.positioning) ? raw?.positioning : 'percent';
  const horizontal = raw?.horizontal === 'center' || raw?.horizontal === 'right' ? raw.horizontal : 'left';
  const vertical = raw?.vertical === 'center' || raw?.vertical === 'bottom' ? raw.vertical : 'top';
  const anchor = raw?.anchor as AlignInput['anchor'] | undefined;

  const align: AlignInput = {
    fit,
    positioning,
    horizontal,
    vertical,
    anchor
  };

  if (positioning === 'percent') {
    const source = raw?.offsetPercent ?? undefined;
    align.offsetPercent = {
      x: toNumber(source?.x, 0),
      y: toNumber(source?.y, 0)
    };
  } else if (positioning === 'auto' && autoOffsetPercent) {
    align.offsetPercent = {
      x: autoOffsetPercent.x,
      y: autoOffsetPercent.y
    };
  }

  return align;
};

export default normalizeAlign;
