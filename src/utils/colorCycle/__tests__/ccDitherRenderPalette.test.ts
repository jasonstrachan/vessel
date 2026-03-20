import { parseColor } from '@/hooks/brushEngine/colorUtils';
import { buildCcDitherRenderPalette, resolveCcDitherBandMode } from '@/utils/colorCycle/ccDitherRenderPalette';

describe('resolveCcDitherBandMode', () => {
  it('treats 1 color as flat dither and shifts gradient bands up by one', () => {
    expect(resolveCcDitherBandMode(1)).toEqual({
      pairBandCount: 0,
      quantLevels: 1,
    });
    expect(resolveCcDitherBandMode(2)).toEqual({
      pairBandCount: 1,
      quantLevels: 2,
    });
    expect(resolveCcDitherBandMode(4)).toEqual({
      pairBandCount: 3,
      quantLevels: 4,
    });
  });
});

describe('buildCcDitherRenderPalette', () => {
  it('keeps the pair midpoint near the base color while increasing separation', () => {
    const baseStops = [
      { position: 0, color: '#7a7f88' },
      { position: 1, color: '#7a7f88' },
    ];

    const subtle = buildCcDitherRenderPalette({
      baseStops,
      bands: 1,
      spread: 0,
    });
    const strong = buildCcDitherRenderPalette({
      baseStops,
      bands: 1,
      spread: 80,
    });

    const subtleLow = parseColor(subtle.renderStops[0].color);
    const subtleHigh = parseColor(subtle.renderStops[1].color);
    const strongLow = parseColor(strong.renderStops[0].color);
    const strongHigh = parseColor(strong.renderStops[1].color);

    const midpoint = [
      Math.round((strongLow[0] + strongHigh[0]) / 2),
      Math.round((strongLow[1] + strongHigh[1]) / 2),
      Math.round((strongLow[2] + strongHigh[2]) / 2),
    ] as [number, number, number];

    const base = parseColor('#7a7f88');
    const midpointError = Math.sqrt(
      (midpoint[0] - base[0]) ** 2 +
      (midpoint[1] - base[1]) ** 2 +
      (midpoint[2] - base[2]) ** 2
    );
    const subtleDistance = Math.sqrt(
      (subtleLow[0] - subtleHigh[0]) ** 2 +
      (subtleLow[1] - subtleHigh[1]) ** 2 +
      (subtleLow[2] - subtleHigh[2]) ** 2
    );
    const strongDistance = Math.sqrt(
      (strongLow[0] - strongHigh[0]) ** 2 +
      (strongLow[1] - strongHigh[1]) ** 2 +
      (strongLow[2] - strongHigh[2]) ** 2
    );

    expect(midpointError).toBeLessThan(45);
    expect(strongDistance).toBeGreaterThan(subtleDistance);
  });

  it('emits a triad per band at max spread so CC dither can match dither-shape energy', () => {
    const baseStops = [
      { position: 0, color: '#7a7f88' },
      { position: 1, color: '#7a7f88' },
    ];

    const strong = buildCcDitherRenderPalette({
      baseStops,
      bands: 2,
      spread: 100,
    });

    expect(strong.bandCount).toBe(2);
    expect(strong.renderStops).toHaveLength(6);
    expect(strong.renderStops[0].position).toBe(0);
    expect(strong.renderStops[1].position).toBe(0.25);
    expect(strong.renderStops[2].position).toBe(0.5);
    expect(strong.renderStops[3].position).toBe(0.5);
    expect(strong.renderStops[4].position).toBe(0.75);
    expect(strong.renderStops[5].position).toBe(1);

    const distinct = new Set(strong.renderStops.map((stop) => stop.color));
    expect(distinct.size).toBeGreaterThanOrEqual(3);
  });

  it('builds a flat two-ink palette when band count is zero', () => {
    const baseStops = [
      { position: 0, color: '#224466' },
      { position: 1, color: '#88aacc' },
    ];

    const flat = buildCcDitherRenderPalette({
      baseStops,
      bands: 0,
      spread: 100,
    });

    expect(flat.bandCount).toBe(0);
    expect(flat.renderStops).toHaveLength(3);
    expect(flat.renderStops[0].position).toBe(0);
    expect(flat.renderStops[1].position).toBe(0.5);
    expect(flat.renderStops[2].position).toBe(1);
    expect(new Set(flat.renderStops.map((stop) => stop.color)).size).toBeGreaterThanOrEqual(3);
  });
});
