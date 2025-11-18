/**
 * Color utility functions extracted from useBrushEngine
 * Pure functions for color manipulation and conversion
 */

/**
 * Parse a color string to RGB values
 */
export const parseColor = (color: string): [number, number, number] => {
  // Manual parsing first to stay SSR-safe
  const hexMatch = color.match(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/);
  if (hexMatch) {
    const hex = hexMatch[1];
    if (hex.length === 3) {
      return [
        parseInt(hex[0] + hex[0], 16),
        parseInt(hex[1] + hex[1], 16),
        parseInt(hex[2] + hex[2], 16)
      ];
    }
    return [
      parseInt(hex.slice(0, 2), 16),
      parseInt(hex.slice(2, 4), 16),
      parseInt(hex.slice(4, 6), 16)
    ];
  }

  const rgbMatch = color.match(/^rgba?\(([^)]+)\)/i);
  if (rgbMatch) {
    const parts = rgbMatch[1].split(',').map((p) => p.trim());
    if (parts.length >= 3) {
      return [
        parseInt(parts[0], 10) || 0,
        parseInt(parts[1], 10) || 0,
        parseInt(parts[2], 10) || 0
      ];
    }
  }

  // Browser-only fallback for named colors
  if (typeof document !== 'undefined') {
    try {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.fillStyle = '#000';
        ctx.fillStyle = color;
        const computed = ctx.fillStyle;
        if (computed.startsWith('#')) {
          const hex = computed.slice(1);
          return [
            parseInt(hex.slice(0, 2), 16),
            parseInt(hex.slice(2, 4), 16),
            parseInt(hex.slice(4, 6), 16)
          ];
        }
        const matches = computed.match(/\d+/g);
        if (matches && matches.length >= 3) {
          return [
            parseInt(matches[0], 10) || 0,
            parseInt(matches[1], 10) || 0,
            parseInt(matches[2], 10) || 0
          ];
        }
      }
    } catch {
      // ignore parse failures in non-DOM environments
    }
  }

  return [0, 0, 0];
};

/**
 * Convert sRGB color channel (0-255) to linear space (0-1)
 */
const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

export const srgbToLinear = (c: number): number => {
  if (!Number.isFinite(c)) {
    return 0;
  }
  const normalized = clamp01(c / 255.0);
  return normalized <= 0.04045
    ? normalized / 12.92
    : Math.pow((normalized + 0.055) / 1.055, 2.4);
};

/**
 * Convert linear color channel (0-1) back to sRGB (0-255)
 */
export const linearToSrgb = (c: number): number => {
  if (!Number.isFinite(c)) {
    return 0;
  }
  const normalized = clamp01(c);
  const srgb = normalized <= 0.0031308
    ? normalized * 12.92
    : 1.055 * Math.pow(normalized, 1 / 2.4) - 0.055;
  return Math.round(clamp01(srgb) * 255);
};

/**
 * Snap colors close to black or white to exact values
 */
export const snapColorToExtremes = (
  r: number, 
  g: number, 
  b: number, 
  threshold: number = 20
): [number, number, number] => {
  // Snap near-white to pure white
  if (r > 255 - threshold && g > 255 - threshold && b > 255 - threshold) {
    return [255, 255, 255];
  }
  // Snap near-black to pure black
  if (r < threshold && g < threshold && b < threshold) {
    return [0, 0, 0];
  }
  return [r, g, b];
};

/**
 * Calculate average color from array of color strings
 */
export const getAverageColor = (colors: string[]): string => {
  if (colors.length === 0) return '#000000';
  if (colors.length === 1) return colors[0];

  let totalR = 0, totalG = 0, totalB = 0;
  
  for (const color of colors) {
    const [r, g, b] = parseColor(color);
    totalR += r;
    totalG += g;
    totalB += b;
  }
  
  const avgR = Math.round(totalR / colors.length);
  const avgG = Math.round(totalG / colors.length);
  const avgB = Math.round(totalB / colors.length);
  
  const toHex = (n: number) => n.toString(16).padStart(2, '0');
  return `#${toHex(avgR)}${toHex(avgG)}${toHex(avgB)}`;
};

/**
 * Apply color jitter with interpolation for smooth transitions
 */
export interface JitterState {
  counter: number;
  recalcFrequency: number;
  lastJitterColor: [number, number, number];
  nextJitterColor: [number, number, number];
}

export const createJitterState = (): JitterState => ({
  counter: 0,
  recalcFrequency: 5,
  lastJitterColor: [0, 0, 0],
  nextJitterColor: [0, 0, 0]
});

const deterministicRandom = (seed: number): number => {
  const x = Math.sin(seed) * 10000;
  return x - Math.floor(x);
};

export const applyThrottledColorJitter = (
  baseColor: string, 
  jitterAmount: number,
  jitterState: JitterState
): string => {
  if (jitterAmount === 0) {
    jitterState.counter = 0;
    jitterState.lastJitterColor = jitterState.lastJitterColor ?? parseColor(baseColor);
    jitterState.nextJitterColor = jitterState.nextJitterColor ?? parseColor(baseColor);
    return baseColor;
  }

  const cycleLength = Math.max(1, jitterState.recalcFrequency || 1);
  const currentStep = jitterState.counter % cycleLength;
  const seedColor = parseColor(baseColor);

  const makeJitterColor = (seed: number): [number, number, number] => {
    const jitter = (jitterAmount / 100) * 128;
    const r = seedColor[0] + (deterministicRandom(seed + 1) - 0.5) * jitter;
    const g = seedColor[1] + (deterministicRandom(seed + 2) - 0.5) * jitter;
    const b = seedColor[2] + (deterministicRandom(seed + 3) - 0.5) * jitter;
    return [
      Math.max(0, Math.min(255, r)),
      Math.max(0, Math.min(255, g)),
      Math.max(0, Math.min(255, b))
    ];
  };

  if (jitterState.counter === 0 && jitterState.nextJitterColor.every((value) => value === 0)) {
    const initialSeed = seedColor[0] + seedColor[1] + seedColor[2] + jitterAmount;
    const initial = makeJitterColor(initialSeed);
    jitterState.lastJitterColor = initial;
    jitterState.nextJitterColor = initial;
  }

  const progress = currentStep / cycleLength;
  const rInterp = jitterState.lastJitterColor[0] + (jitterState.nextJitterColor[0] - jitterState.lastJitterColor[0]) * progress;
  const gInterp = jitterState.lastJitterColor[1] + (jitterState.nextJitterColor[1] - jitterState.lastJitterColor[1]) * progress;
  const bInterp = jitterState.lastJitterColor[2] + (jitterState.nextJitterColor[2] - jitterState.lastJitterColor[2]) * progress;

  const nextCounter = jitterState.counter + 1;
  if (nextCounter % cycleLength === 0) {
    jitterState.lastJitterColor = jitterState.nextJitterColor;
    const seed = nextCounter + seedColor[0] + seedColor[1] + seedColor[2] + jitterAmount;
    jitterState.nextJitterColor = makeJitterColor(seed);
  }

  jitterState.counter = nextCounter;

  return `rgb(${Math.round(rInterp)}, ${Math.round(gInterp)}, ${Math.round(bInterp)})`;
};

/**
 * Convert RGB to hex color string
 */
export const rgbToHex = (r: number, g: number, b: number): string => {
  const toHex = (n: number) => Math.round(Math.max(0, Math.min(255, n))).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
};

/**
 * Calculate perceptual color distance (weighted Euclidean)
 */
export const colorDistance = (
  r1: number, g1: number, b1: number,
  r2: number, g2: number, b2: number
): number => {
  // Human eyes are more sensitive to green, then red, then blue
  const dr = r1 - r2;
  const dg = g1 - g2;
  const db = b1 - b2;
  return Math.sqrt(dr * dr * 0.3 + dg * dg * 0.59 + db * db * 0.11);
};

/**
 * Calculate luminance from RGB
 */
export const getLuminance = (r: number, g: number, b: number): number => {
  return 0.299 * r + 0.587 * g + 0.114 * b;
};
