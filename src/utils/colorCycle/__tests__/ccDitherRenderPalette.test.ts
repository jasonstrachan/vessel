import { parseColor } from '@/hooks/brushEngine/colorUtils';
import { GradientPalette } from '@/lib/GradientPalette';
import {
  buildCcDitherRenderPalette,
  buildCcDitherRuntimePalette,
  resolveCcDitherBandMode,
  resolveCcDitherInkColorCount,
  resolveCcDitherInkMode,
} from '@/utils/colorCycle/ccDitherRenderPalette';
import { resolveFlatInkSetForPosition } from '@/utils/colorCycle/ccFlatModePatterns';

const linear = (byte: number) => byte / 255 <= 0.04045 ? byte / 255 / 12.92 : ((byte / 255 + 0.055) / 1.055) ** 2.4;

describe('CC sampled ink tonal balance', () => {
  it.each([2, 9])('preserves dark, middle and light sample averages with %i source stops', (stopCount) => {
    for (const color of ['#000000', '#080808', '#202020', '#808080', '#e0e0e0', '#f8f8f8', '#ffffff', '#204060', '#0080c0']) {
      const target = parseColor(color);
      const baseStops = Array.from({ length: stopCount }, (_, index) => ({
        position: index / (stopCount - 1), color,
      }));
      for (const spread of [35, 80, 100]) {
        const result = buildCcDitherRenderPalette({ baseStops, bands: 4, spread });
        const inkCount = 2;
        // Each band's inks must remain centred on the reference sample even
        // when spreading a dark/light sample reaches the RGB gamut boundary.
        const inks = result.renderStops.slice(0, inkCount).map(stop => parseColor(stop.color));
        for (let channel = 0; channel < 3; channel += 1) {
          const mean = inks.reduce((sum, rgb) => sum + linear(rgb[channel]), 0) / inkCount;
          expect(Math.abs(mean - linear(target[channel]))).toBeLessThanOrEqual(0.005);
        }
      }
    }
  });

  it('retains separation in other channels when one channel is saturated', () => {
    const result = buildCcDitherRenderPalette({
      baseStops: [{ position: 0, color: '#0080c0' }, { position: 1, color: '#0080c0' }],
      bands: 4,
      spread: 80,
    });
    const [low, high] = result.renderStops.slice(0, 2).map(stop => parseColor(stop.color));
    expect(low[0]).toBe(0);
    expect(high[0]).toBe(0);
    expect(Math.abs(high[1] - low[1])).toBeGreaterThan(20);
  });

  it.each([35, 100])('preserves flat sample averages at spread %i with zero bands', (spread) => {
    const color = '#102030';
    const result = buildCcDitherRenderPalette({
      baseStops: [{ position: 0, color }, { position: 1, color }],
      bands: 0,
      spread,
    });
    const inks = result.renderStops.slice(0, 2).map(stop => parseColor(stop.color));
    parseColor(color).forEach((target, channel) => {
      const mean = inks.reduce((sum, rgb) => sum + linear(rgb[channel]), 0) / inks.length;
      expect(Math.abs(mean - linear(target))).toBeLessThanOrEqual(0.005);
    });
  });

  it.each([
    { spread: 80, inkCount: 2, targets: [36, 151] },
    { spread: 100, inkCount: 2, targets: [36, 151] },
  ])('preserves each changing gradient band at spread $spread', ({ spread, inkCount, targets }) => {
    const baseStops = [
      { position: 0, color: '#080808', opacity: 0.25 },
      { position: 0.5, color: '#404040', opacity: 0.5 },
      { position: 1, color: '#eeeeee', opacity: 1 },
    ];
    const original = baseStops.map(stop => ({ ...stop }));
    const result = buildCcDitherRenderPalette({ baseStops, bands: 2, spread });
    targets.forEach((target, band) => {
      const inks = result.renderStops.slice(band * inkCount, (band + 1) * inkCount)
        .map(stop => parseColor(stop.color));
      for (let channel = 0; channel < 3; channel += 1) {
        const mean = inks.reduce((sum, rgb) => sum + linear(rgb[channel]), 0) / inkCount;
        expect(Math.abs(mean - linear(target))).toBeLessThanOrEqual(0.005);
      }
    });
    expect(baseStops).toEqual(original);
  });
});

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

describe('CC dither ink settings', () => {
  it('defaults and clamps the dedicated ink count independently of gradient bands', () => {
    expect(resolveCcDitherInkColorCount({})).toBe(16);
    expect(resolveCcDitherInkColorCount({ colorCycleUseForegroundGradient: true, colorCycleFgColors: 6, ccDitherInkColors: 1, gradientBands: 2 })).toBe(6);
    expect(resolveCcDitherInkColorCount({ gradientBands: 64 })).toBe(64);
    expect(resolveCcDitherInkColorCount({ ccDitherInkColors: 9 })).toBe(9);
    expect(resolveCcDitherInkColorCount({ ccDitherInkColors: 99 })).toBe(16);
    expect(resolveCcDitherInkColorCount({ ccDitherInkColors: 0 })).toBe(1);
    expect(resolveCcDitherInkMode({ ccDitherInkColors: 4 })).toEqual({
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

  it('keeps two inks per band through maximum spread without a threshold jump', () => {
    const baseStops = [{ position: 0, color: '#7a7f88' }, { position: 1, color: '#7a7f88' }];
    const results = [94, 95, 96, 100].map(spread => buildCcDitherRenderPalette({ baseStops, bands: 2, spread }));
    for (const result of results) {
      expect(result.renderStops.map(stop => stop.position)).toEqual([0, 0.25, 0.5, 0.75]);
      expect(new Set(result.renderStops.map(stop => stop.color)).size).toBe(2);
    }
    const before = parseColor(results[0].renderStops[0].color);
    const after = parseColor(results[1].renderStops[0].color);
    expect(Math.max(...before.map((v, i) => Math.abs(v - after[i])))).toBeLessThan(5);
  });

  it('preserves ordered colors for multi-stop gradients', () => {
    const baseStops = [
      { position: 0, color: '#ff0000' },
      { position: 0.5, color: '#00ff00' },
      { position: 1, color: '#0000ff' },
    ];

    const palette = buildCcDitherRenderPalette({
      baseStops,
      bands: 2,
      spread: 0,
    });

    expect(palette.bandCount).toBe(2);
    expect(palette.renderStops).toEqual([
      { position: 0, color: 'rgb(128, 128, 0)' },
      { position: 0.25, color: 'rgb(128, 128, 0)' },
      { position: 0.5, color: 'rgb(0, 128, 128)' },
      { position: 0.75, color: 'rgb(0, 128, 128)' },
    ]);
  });

  it('preserves interpolated source alpha in generated dither stops', () => {
    const palette = buildCcDitherRenderPalette({
      baseStops: [
        { position: 0, color: '#00ff00', opacity: 1 },
        { position: 1, color: '#0000ff', opacity: 0 },
      ],
      bands: 2,
      spread: 0,
    });

    expect(palette.renderStops.map(({ position, opacity }) => ({ position, opacity }))).toEqual([
      { position: 0, opacity: undefined },
      { position: 0.25, opacity: 0.75 },
      { position: 0.5, opacity: 0.5 },
      { position: 0.75, opacity: 0.25 },
      { position: 1, opacity: 0 },
    ]);
    expect(new GradientPalette(palette.renderStops).getColor(255).a).toBe(0);
  });

  it('combines CSS alpha with explicit stop opacity', () => {
    const palette = buildCcDitherRenderPalette({
      baseStops: [
        { position: 0, color: 'rgba(0, 255, 0, 0.5)', opacity: 0.5 },
        { position: 1, color: 'rgba(0, 0, 255, 0)', opacity: 1 },
      ],
      bands: 0,
      spread: 0,
    });

    expect(palette.renderStops.map((stop) => stop.opacity)).toEqual([
      64 / 255,
      32 / 255,
      0,
    ]);
  });

  it('emits center-aligned ordered stops for wrapped multi-stop dither bands', () => {
    const baseStops = [
      { position: 0, color: '#000000' },
      { position: 0.1, color: '#1f1f1f' },
      { position: 0.2, color: '#3f3f3f' },
      { position: 0.3, color: '#5f5f5f' },
      { position: 0.4, color: '#7f7f7f' },
      { position: 0.5, color: '#9f9f9f' },
      { position: 0.6, color: '#bfbfbf' },
      { position: 0.7, color: '#dfdfdf' },
      { position: 0.8, color: '#f5f5f5' },
      { position: 0.9, color: '#ffffff' },
      { position: 1, color: '#000000' },
    ];

    const palette = buildCcDitherRenderPalette({
      baseStops,
      bands: 4,
      spread: 0,
    });

    expect(palette.renderStops.map((stop) => stop.position)).toEqual([
      0,
      0.125,
      0.25,
      0.375,
      0.5,
      0.625,
      0.75,
      0.875,
    ]);
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
    expect(flat.renderStops).toHaveLength(2);
    expect(flat.renderStops[0].position).toBe(0);
    expect(flat.renderStops[1].position).toBe(0.5);
    expect(new Set(flat.renderStops.map((stop) => stop.color)).size).toBe(2);
  });
});

describe('buildCcDitherRuntimePalette', () => {
  it('uses contrast-forward flat Sierra palette stops when pair bands are zero', () => {
    const runtime = buildCcDitherRuntimePalette({
      baseStops: [
        { position: 0, color: '#446688' },
        { position: 1, color: '#88aacc' },
      ],
      bands: 0,
      spread: 100,
      algorithm: 'sierra-lite',
    });

    expect(runtime.bandCount).toBe(0);
    expect(runtime.renderStops).toHaveLength(10);
    expect(runtime.renderStops.map((stop) => stop.position)).toEqual(
      [0.1, 0.3, 0.5, 0.7, 0.9].flatMap((position) =>
        resolveFlatInkSetForPosition(position, 2, 0, 100).indices.map((index) => (index - 1) / 254)
      ).sort((a, b) => a - b)
    );
    const uniqueColors = new Set(runtime.renderStops.map((stop) => stop.color));
    expect(uniqueColors.size).toBeGreaterThanOrEqual(8);
  });

  it('uses the same two inks for non-Sierra algorithms', () => {
    const runtime = buildCcDitherRuntimePalette({
      baseStops: [
        { position: 0, color: '#446688' },
        { position: 1, color: '#88aacc' },
      ],
      bands: 0,
      spread: 100,
      algorithm: 'pattern',
    });

    expect(runtime.bandCount).toBe(0);
    expect(runtime.renderStops).toHaveLength(2);
  });

  it('can preserve source stops for flat runtime playback across algorithms', () => {
    const baseStops = [
      { position: 0, color: '#112233' },
      { position: 0.5, color: '#445566' },
      { position: 1, color: '#778899' },
    ];

    for (const algorithm of ['sierra-lite', 'pattern'] as const) {
      const runtime = buildCcDitherRuntimePalette({
        baseStops,
        bands: 0,
        spread: 100,
        algorithm,
        preserveSourceStops: true,
      });

      expect(runtime.bandCount).toBe(0);
      expect(runtime.renderStops).toEqual(baseStops);
    }
  });

  it('makes the runtime palette opaque only when background fill is enabled', () => {
    const baseStops = [
      { position: 0, color: 'rgba(17, 34, 51, 0.25)', opacity: 0.5 },
      { position: 1, color: '#778899', opacity: 0 },
    ];
    const transparentRuntime = buildCcDitherRuntimePalette({
      baseStops,
      bands: 2,
      spread: 0,
      algorithm: 'bayer',
      fillBackground: false,
    });
    const filledRuntime = buildCcDitherRuntimePalette({
      baseStops,
      bands: 2,
      spread: 0,
      algorithm: 'bayer',
      fillBackground: true,
    });

    expect(transparentRuntime.renderStops.some((stop) => (stop.opacity ?? 1) < 1)).toBe(true);
    expect(filledRuntime.renderStops.every((stop) => stop.opacity === 1)).toBe(true);
    expect(filledRuntime.renderStops.every((stop) => !stop.color.startsWith('rgba'))).toBe(true);
  });

  it('preserves Flat Cycle source colors and alpha when background fill is enabled', () => {
    const baseStops = [
      { position: 0, color: 'rgba(17, 34, 51, 0.25)', opacity: 0.5 },
      { position: 1, color: '#778899', opacity: 0 },
    ];
    const runtime = buildCcDitherRuntimePalette({
      baseStops,
      bands: 8,
      spread: 35,
      algorithm: 'bayer',
      useDitherRenderPalette: false,
      fillBackground: true,
    });

    expect(runtime.bandCount).toBe(0);
    expect(runtime.renderStops).toEqual(baseStops);
  });

  it('preserves neighboring chroma for legacy transparent keyword stops', () => {
    const baseStops = [
      { position: 0, color: '#ffffff' },
      { position: 1, color: 'transparent' },
    ];
    const transparentRuntime = buildCcDitherRuntimePalette({
      baseStops,
      bands: 2,
      spread: 0,
      algorithm: 'bayer',
      fillBackground: false,
    });
    const filledRuntime = buildCcDitherRuntimePalette({
      baseStops,
      bands: 2,
      spread: 0,
      algorithm: 'bayer',
      fillBackground: true,
    });

    expect(transparentRuntime.renderStops.at(-1)).toMatchObject({
      color: 'rgb(255, 255, 255)',
      opacity: 0,
    });
    expect(filledRuntime.renderStops.at(-1)).toMatchObject({
      color: 'rgb(255, 255, 255)',
      opacity: 1,
    });
  });
});
