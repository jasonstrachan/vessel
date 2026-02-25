import type { LayerAlignmentSettings } from '@/types';
import { buildNextAlignment } from '@/components/panels/AlignmentPanel';

const baseAlignment: LayerAlignmentSettings = {
  fit: 'contain',
  horizontal: 'right',
  vertical: 'bottom',
  positioning: 'auto',
  offsetPx: { x: 40, y: 60 },
  offsetPercent: { x: 20, y: 30 },
};

describe('buildNextAlignment', () => {
  it('preserves per-layer offsets when applying fit-only updates', () => {
    const next = buildNextAlignment(baseAlignment, { fit: 'cover' });

    expect(next.fit).toBe('cover');
    expect(next.offsetPx).toEqual({ x: 40, y: 60 });
    expect(next.offsetPercent).toEqual({ x: 20, y: 30 });
  });

  it('forces centered anchor for tile fit', () => {
    const next = buildNextAlignment(baseAlignment, { fit: 'tile' });

    expect(next.fit).toBe('tile');
    expect(next.horizontal).toBe('center');
    expect(next.vertical).toBe('center');
  });

  it('drops percent offsets in anchor mode', () => {
    const next = buildNextAlignment(baseAlignment, { positioning: 'anchor' });

    expect(next.positioning).toBe('anchor');
    expect(next.offsetPercent).toBeUndefined();
    expect(next.offsetPx).toEqual({ x: 40, y: 60 });
  });
});
