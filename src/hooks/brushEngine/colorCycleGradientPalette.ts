import type { GradientStop } from '@/lib/GradientPalette';

import type { RgbColor } from './colorCycleCanvas2DTypes';

export const parseCssColor = (color: string | RgbColor): RgbColor => {
  if (typeof color === 'object' && color !== null && 'r' in color && 'g' in color && 'b' in color) {
    const { r, g, b } = color;
    return { r: Math.round(r), g: Math.round(g), b: Math.round(b) };
  }
  const canvas = document.createElement('canvas');
  canvas.width = 1;
  canvas.height = 1;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) {
    return { r: 0, g: 0, b: 0 };
  }
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, 1, 1);
  const data = ctx.getImageData(0, 0, 1, 1).data;
  return { r: data[0], g: data[1], b: data[2] };
};

export const interpolateColor = (a: RgbColor, b: RgbColor, t: number): RgbColor => ({
  r: Math.round(a.r + (b.r - a.r) * t),
  g: Math.round(a.g + (b.g - a.g) * t),
  b: Math.round(a.b + (b.b - a.b) * t),
});

export const colorAtPosition = (
  stops: GradientStop[] | undefined,
  pos: number,
): RgbColor => {
  if (!stops || stops.length === 0) return { r: 0, g: 0, b: 0 };
  const sorted = [...stops].sort((a, b) => a.position - b.position);
  if (pos <= sorted[0].position) return parseCssColor(sorted[0].color);
  if (pos >= sorted[sorted.length - 1].position) return parseCssColor(sorted[sorted.length - 1].color);
  for (let i = 0; i < sorted.length - 1; i += 1) {
    const s0 = sorted[i];
    const s1 = sorted[i + 1];
    if (pos >= s0.position && pos <= s1.position) {
      const c0 = parseCssColor(s0.color);
      const c1 = parseCssColor(s1.color);
      const t = (pos - s0.position) / Math.max(1e-6, s1.position - s0.position);
      return interpolateColor(c0, c1, t);
    }
  }
  return parseCssColor(sorted[sorted.length - 1].color);
};

const rgbToHex = (c: RgbColor): string => {
  const toHex = (v: number) => v.toString(16).padStart(2, '0');
  return `#${toHex(c.r)}${toHex(c.g)}${toHex(c.b)}`;
};

export const buildQuantizedGradientPalette = (
  stops: GradientStop[] | undefined,
  numColors: number,
): { css: string[]; mapRgbToIndex: Map<string, number> } => {
  const colors: string[] = [];
  const map = new Map<string, number>();
  const n = Math.max(2, Math.floor(numColors));
  for (let i = 0; i < n; i += 1) {
    const pos = i / n;
    const rgb = colorAtPosition(stops, pos);
    colors.push(rgbToHex(rgb));
    const idx = Math.min(255, Math.round(pos * 254) + 1);
    map.set(`${rgb.r},${rgb.g},${rgb.b}`, idx);
  }
  return { css: colors, mapRgbToIndex: map };
};
