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

describe('anchor artwork pixel nudges', () => {
  it('retains finite signed fractional nudges only for anchors without mutating the input', () => {
    const raw = { positioning: 'anchor', offsetPx: { x: 7.5, y: -5.25 } };
    expect(normalizeAlign(raw)).toMatchObject({ offsetPx: { x: 7.5, y: -5.25 } });
    expect(normalizeAlign(raw).offsetPx).not.toBe(raw.offsetPx);
    expect(raw.offsetPx).toEqual({ x: 7.5, y: -5.25 });
    expect(normalizeAlign({ ...raw, positioning: 'auto' })).not.toHaveProperty('offsetPx');
  });

  it('normalizes invalid coordinates independently and keeps old missing offsets optional', () => {
    expect(normalizeAlign({ positioning: 'anchor', offsetPx: { x: Infinity, y: -3 } } as Parameters<typeof normalizeAlign>[0]))
      .toMatchObject({ offsetPx: { x: 0, y: -3 } });
    expect(normalizeAlign({ positioning: 'anchor' })).not.toHaveProperty('offsetPx');
  });
});
