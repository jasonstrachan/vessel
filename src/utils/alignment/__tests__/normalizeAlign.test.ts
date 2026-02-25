import { normalizeAlign } from '@/utils/alignment/normalizeAlign';

describe('normalizeAlign', () => {
  it('defaults to centered auto alignment when fields are missing', () => {
    const normalized = normalizeAlign({});

    expect(normalized.positioning).toBe('auto');
    expect(normalized.horizontal).toBe('center');
    expect(normalized.vertical).toBe('center');
    expect(normalized.offsetPercent).toEqual({ x: 50, y: 50 });
  });

  it('maps legacy percent positioning to auto and preserves offsets', () => {
    const normalized = normalizeAlign({
      positioning: 'percent',
      offsetPercent: { x: 12, y: 34 },
    });

    expect(normalized.positioning).toBe('auto');
    expect(normalized.offsetPercent).toEqual({ x: 12, y: 34 });
  });

  it('uses computed auto offset when raw auto alignment omits offsets', () => {
    const normalized = normalizeAlign(
      { positioning: 'auto' },
      { x: 23, y: 77 }
    );

    expect(normalized.positioning).toBe('auto');
    expect(normalized.offsetPercent).toEqual({ x: 23, y: 77 });
  });
});
