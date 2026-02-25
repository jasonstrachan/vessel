import type { PaletteState } from '@/types';
import { parseCssColor } from '@/utils/color/parseCssColor';
import { pointInPolygon } from './utils/geometry';

type Vec2 = { x: number; y: number };

export const toOpaqueColorString = (color: string): string => {
  const parsed = parseCssColor(color);
  return `rgb(${parsed.r}, ${parsed.g}, ${parsed.b})`;
};

const MIN_CONTRAST_RATIO = 4.5;
const OUTSIDE_SAMPLE_STEP = 6;
const OUTSIDE_SAMPLE_PADDING = 12;

const getRelativeLuminance = (color: string): number => {
  const { r, g, b } = parseCssColor(color);
  const normalize = (value: number): number => {
    const channel = value / 255;
    return channel <= 0.03928 ? channel / 12.92 : Math.pow((channel + 0.055) / 1.055, 2.4);
  };
  const [nr, ng, nb] = [normalize(r), normalize(g), normalize(b)];
  return 0.2126 * nr + 0.7152 * ng + 0.0722 * nb;
};

const getContrastRatio = (foreground: string, background: string): number => {
  const lumA = getRelativeLuminance(foreground);
  const lumB = getRelativeLuminance(background);
  const [lighter, darker] = lumA >= lumB ? [lumA, lumB] : [lumB, lumA];
  return (lighter + 0.05) / (darker + 0.05);
};

const rgbToHsl = (r: number, g: number, b: number): { h: number; s: number; l: number } => {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const delta = max - min;
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;

  if (delta > 1e-6) {
    s = l > 0.5 ? delta / (2 - max - min) : delta / (max + min);
    switch (max) {
      case rn:
        h = (gn - bn) / delta + (gn < bn ? 6 : 0);
        break;
      case gn:
        h = (bn - rn) / delta + 2;
        break;
      default:
        h = (rn - gn) / delta + 4;
        break;
    }
    h /= 6;
  }

  return { h, s, l };
};

const hslToRgb = (h: number, s: number, l: number): { r: number; g: number; b: number } => {
  const hueToRgb = (p: number, q: number, t: number): number => {
    let tt = t;
    if (tt < 0) tt += 1;
    if (tt > 1) tt -= 1;
    if (tt < 1 / 6) return p + (q - p) * 6 * tt;
    if (tt < 1 / 2) return q;
    if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
    return p;
  };

  if (s <= 1e-6) {
    const value = Math.round(l * 255);
    return { r: value, g: value, b: value };
  }

  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;

  const r = Math.round(hueToRgb(p, q, h + 1 / 3) * 255);
  const g = Math.round(hueToRgb(p, q, h) * 255);
  const b = Math.round(hueToRgb(p, q, h - 1 / 3) * 255);
  return { r, g, b };
};

const adjustBackgroundForContrast = (foreground: string, background: string): string => {
  const baseRatio = getContrastRatio(foreground, background);
  if (baseRatio >= MIN_CONTRAST_RATIO) {
    return background;
  }

  const parsedBackground = parseCssColor(background);
  const { h, s, l } = rgbToHsl(parsedBackground.r, parsedBackground.g, parsedBackground.b);
  const candidates: Array<{ ratio: number; color: string; delta: number }> = [];
  const maxSteps = 12;
  const step = 1 / (maxSteps * 2);

  const tryLightness = (targetL: number) => {
    const clampedL = Math.min(1, Math.max(0, targetL));
    const { r, g, b } = hslToRgb(h, s, clampedL);
    const color = `rgb(${r}, ${g}, ${b})`;
    const ratio = getContrastRatio(foreground, color);
    if (ratio >= MIN_CONTRAST_RATIO) {
      candidates.push({
        ratio,
        color,
        delta: Math.abs(clampedL - l),
      });
    }
  };

  for (let i = 1; i <= maxSteps; i += 1) {
    tryLightness(l + step * i);
    tryLightness(l - step * i);
  }

  if (candidates.length > 0) {
    candidates.sort((a, b) => {
      if (Math.abs(a.delta - b.delta) > 1e-6) {
        return a.delta - b.delta;
      }
      return b.ratio - a.ratio;
    });
    return candidates[0].color;
  }

  const whiteContrast = getContrastRatio(foreground, 'rgb(255, 255, 255)');
  const blackContrast = getContrastRatio(foreground, 'rgb(0, 0, 0)');
  return whiteContrast >= blackContrast ? 'rgb(255, 255, 255)' : 'rgb(0, 0, 0)';
};

const computeCentroid = (points: Vec2[]): Vec2 => {
  if (!points.length) {
    return { x: 0, y: 0 };
  }
  const sum = points.reduce(
    (acc, point) => ({ x: acc.x + point.x, y: acc.y + point.y }),
    { x: 0, y: 0 }
  );
  return {
    x: sum.x / points.length,
    y: sum.y / points.length,
  };
};

const computeBoundingBox = (points: Vec2[]): { width: number; height: number } => {
  if (!points.length) {
    return { width: 0, height: 0 };
  }

  let minX = points[0].x;
  let maxX = points[0].x;
  let minY = points[0].y;
  let maxY = points[0].y;

  for (let i = 1; i < points.length; i += 1) {
    const { x, y } = points[i];
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }

  return {
    width: Math.max(0, maxX - minX),
    height: Math.max(0, maxY - minY),
  };
};

const normalize = (vector: Vec2): Vec2 => {
  const length = Math.hypot(vector.x, vector.y);
  if (length < 1e-6) {
    return { x: 0, y: 0 };
  }
  return { x: vector.x / length, y: vector.y / length };
};

const sampleOutsideColor = (
  foreground: string,
  polygon: Vec2[],
  centroid: Vec2,
  sampleColorAtPosition: (x: number, y: number) => string
): string | null => {
  if (polygon.length < 3) {
    return null;
  }

  const { width, height } = computeBoundingBox(polygon);
  const maxExtent = Math.max(width, height, 1);
  const maxDistance = Math.min(256, maxExtent + OUTSIDE_SAMPLE_PADDING * 2);
  const initialStep = Math.max(OUTSIDE_SAMPLE_STEP, maxExtent * 0.15);

  const directions = [
    { x: 1, y: 0 },
    { x: -1, y: 0 },
    { x: 0, y: 1 },
    { x: 0, y: -1 },
    { x: 1, y: 1 },
    { x: -1, y: 1 },
    { x: 1, y: -1 },
    { x: -1, y: -1 },
  ].map(normalize);

  let bestColor: string | null = null;
  let bestContrast = -Infinity;

  for (const direction of directions) {
    if (Math.abs(direction.x) < 1e-6 && Math.abs(direction.y) < 1e-6) {
      continue;
    }

    for (
      let distance = initialStep;
      distance <= maxDistance;
      distance += OUTSIDE_SAMPLE_STEP
    ) {
      const samplePoint = {
        x: centroid.x + direction.x * distance,
        y: centroid.y + direction.y * distance,
      };

      if (pointInPolygon(samplePoint, polygon)) {
        continue;
      }

      const sampled = toOpaqueColorString(sampleColorAtPosition(samplePoint.x, samplePoint.y));
      const contrast = getContrastRatio(foreground, sampled);
      if (contrast > bestContrast) {
        bestContrast = contrast;
        bestColor = sampled;
      }

      break;
    }
  }

  return bestColor;
};

export interface ComputeShapeFillColorsOptions {
  points: Array<{ x: number; y: number; color?: string }>;
  palette: PaletteState;
  brushColor: string;
  sampleUnderShape: boolean;
  useBackgroundColor: boolean;
  sampleColorAtPosition: (x: number, y: number) => string;
  fallbackBackground?: string;
}

export interface ShapeFillColors {
  foreground: string;
  background?: string;
  sampledForeground: boolean;
  sampledBackground: boolean;
  primary: 'foreground' | 'background';
}

export const computeShapeFillColors = ({
  points,
  palette,
  brushColor,
  sampleUnderShape,
  useBackgroundColor,
  sampleColorAtPosition,
  fallbackBackground,
}: ComputeShapeFillColorsOptions): ShapeFillColors => {
  const polygon = points.map(point => ({ x: point.x, y: point.y }));
  const centroid = computeCentroid(polygon);

  const paletteForeground = palette.foregroundColor?.trim();
  const baseForeground = paletteForeground?.length
    ? toOpaqueColorString(paletteForeground)
    : toOpaqueColorString(brushColor);

  let foreground = baseForeground;
  let sampledForeground = false;

  if (sampleUnderShape && polygon.length >= 3) {
    const sampled = toOpaqueColorString(sampleColorAtPosition(centroid.x, centroid.y));
    foreground = sampled;
    sampledForeground = true;
  }

  let background: string | undefined;
  let sampledBackground = false;

  if (useBackgroundColor) {
    const paletteBackground = palette.backgroundColor?.trim();
    const baseBackground = paletteBackground?.length
      ? toOpaqueColorString(paletteBackground)
      : toOpaqueColorString(fallbackBackground ?? '#ffffff');

    background = baseBackground;

    if (sampleUnderShape && polygon.length >= 3) {
      const sampled = sampleOutsideColor(foreground, polygon, centroid, sampleColorAtPosition);
      if (sampled) {
        background = sampled;
        sampledBackground = true;
      }
    }

    if (sampledBackground) {
      background = adjustBackgroundForContrast(foreground, background);
    }
  }

  let primary: 'foreground' | 'background' = 'foreground';
  if (useBackgroundColor && background) {
    primary = 'background';
  }

  return {
    foreground,
    background,
    sampledForeground,
    sampledBackground,
    primary,
  };
};
