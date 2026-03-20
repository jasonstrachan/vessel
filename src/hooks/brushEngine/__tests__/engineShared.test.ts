import {
  computeStrokeDitherPaletteForSettings,
  spreadPaletteColors,
} from '../engineShared';
import type { BrushSettings } from '@/types';

const parseRgb = (color: string): [number, number, number] => {
  const match = color.match(/\d+/g);
  if (!match || match.length < 3) {
    throw new Error(`Expected rgb() color, received ${color}`);
  }
  return [Number(match[0]), Number(match[1]), Number(match[2])];
};

const distance = (a: [number, number, number], b: [number, number, number]) => {
  const dr = a[0] - b[0];
  const dg = a[1] - b[1];
  const db = a[2] - b[2];
  return Math.sqrt(dr * dr + dg * dg + db * db);
};

describe('engineShared palette spread helpers', () => {
  it('keeps palette colors unchanged when spread is zero', () => {
    const colors = ['#112233', '#445566', '#778899'];

    expect(spreadPaletteColors(colors, 0)).toEqual(colors);
  });

  it('expands a sampled palette while preserving stop count', () => {
    const colors = ['#304050', '#506070', '#708090'];

    const spread = spreadPaletteColors(colors, 80);

    expect(spread).toHaveLength(colors.length);
    expect(spread).not.toEqual(colors);
    spread.forEach((color) => {
      expect(color.startsWith('rgb(')).toBe(true);
    });
  });

  it('increases separation for sampled palette endpoints', () => {
    const colors = ['#52606d', '#6b7785', '#87929e', '#9ea7b3'];

    const spread = spreadPaletteColors(colors, 100);
    const originalDistance = distance(parseRgb('rgb(82, 96, 109)'), parseRgb('rgb(158, 167, 179)'));
    const spreadDistance = distance(parseRgb(spread[0]), parseRgb(spread[spread.length - 1]));

    expect(spreadDistance).toBeGreaterThan(originalDistance);
  });

  it('preserves stroke palette semantics for single-color spread', () => {
    const settings = {
      color: '#336699',
      ditherPaletteSpread: 100,
      ditherBackgroundFill: true,
    } satisfies Pick<BrushSettings, 'color' | 'ditherPaletteSpread' | 'ditherBackgroundFill'>;

    const palette = computeStrokeDitherPaletteForSettings(settings as BrushSettings);

    expect(palette.length).toBeGreaterThanOrEqual(3);
    palette.forEach((color) => {
      expect(color.startsWith('rgb(')).toBe(true);
    });
  });
});
