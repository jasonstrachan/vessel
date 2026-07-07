import { parseColor } from './colorUtils';

export type CustomBrushCycleGradientStop = {
  position: number;
  color: string;
  opacity?: number;
};

export const hashGradientStops = (stops?: CustomBrushCycleGradientStop[]): string => {
  if (!stops || stops.length === 0) {
    return 'none';
  }
  return stops
    .map(stop => `${stop.position}:${stop.color}:${Number.isFinite(stop.opacity) ? stop.opacity : 1}`)
    .join('|');
};

export const sampleGradientColor = (
  stops: CustomBrushCycleGradientStop[],
  position: number,
): string => {
  if (!stops.length) {
    return '#ffffff';
  }

  const clamped = Math.max(0, Math.min(1, position));
  let prev = stops[0];
  let next = stops[stops.length - 1];

  for (let i = 0; i < stops.length - 1; i += 1) {
    const current = stops[i];
    const upcoming = stops[i + 1];
    if (clamped >= current.position && clamped <= upcoming.position) {
      prev = current;
      next = upcoming;
      break;
    }
  }

  const span = next.position - prev.position;
  const t = span > 0 ? (clamped - prev.position) / span : 0;

  const [r1, g1, b1] = parseColor(prev.color);
  const [r2, g2, b2] = parseColor(next.color);

  const r = Math.round(r1 + (r2 - r1) * t);
  const g = Math.round(g1 + (g2 - g1) * t);
  const b = Math.round(b1 + (b2 - b1) * t);

  return `rgb(${r}, ${g}, ${b})`;
};

const trimPaletteCache = (cache: Map<string, Uint8ClampedArray>, limit: number): void => {
  if (cache.size <= limit) {
    return;
  }
  const oldestKey = cache.keys().next().value;
  if (typeof oldestKey === 'string') {
    cache.delete(oldestKey);
  }
};

export const getGradientPalette = (
  stops: CustomBrushCycleGradientStop[],
  cycleLength: number,
  cache: Map<string, Uint8ClampedArray>,
  limit: number,
): Uint8ClampedArray => {
  const gradientHash = hashGradientStops(stops);
  const key = `${gradientHash}:${cycleLength}`;
  const cached = cache.get(key);
  if (cached) {
    return cached;
  }

  const length = Math.max(1, Math.min(1024, Math.round(cycleLength)));
  const palette = new Uint8ClampedArray(length * 4);
  for (let i = 0; i < length; i += 1) {
    const t = length <= 1 ? 0 : i / (length - 1);
    const color = sampleGradientColor(stops, t);
    const [r, g, b] = parseColor(color);
    const p = i * 4;
    palette[p] = r;
    palette[p + 1] = g;
    palette[p + 2] = b;
    palette[p + 3] = 255;
  }

  cache.set(key, palette);
  trimPaletteCache(cache, limit);
  return palette;
};

export const getCapturedColorPalette = (
  colors: string[],
  cache: Map<string, Uint8ClampedArray>,
  limit: number,
): Uint8ClampedArray => {
  const normalized = colors
    .map((color) => color.trim().toLowerCase())
    .filter((color) => /^#[0-9a-f]{6}$/.test(color));
  const key = `captured:${normalized.join('|')}`;
  const cached = cache.get(key);
  if (cached) {
    return cached;
  }

  const palette = new Uint8ClampedArray(normalized.length * 4);
  normalized.forEach((color, index) => {
    const [r, g, b] = parseColor(color);
    const p = index * 4;
    palette[p] = r;
    palette[p + 1] = g;
    palette[p + 2] = b;
    palette[p + 3] = 255;
  });

  cache.set(key, palette);
  trimPaletteCache(cache, limit);
  return palette;
};
