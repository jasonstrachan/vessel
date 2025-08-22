/**
 * Color utility functions extracted from useBrushEngine
 * Pure functions for color manipulation and conversion
 */

/**
 * Parse a color string to RGB values
 */
export const parseColor = (color: string): [number, number, number] => {
  // Create a temporary canvas context for color parsing
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d')!;
  
  ctx.fillStyle = '#000'; // Clear previous state
  ctx.fillStyle = color;
  const computedColor = ctx.fillStyle;

  if (computedColor.startsWith('#')) {
    const hex = computedColor.slice(1);
    return [
      parseInt(hex.slice(0, 2), 16), 
      parseInt(hex.slice(2, 4), 16), 
      parseInt(hex.slice(4, 6), 16)
    ];
  }
  if (computedColor.startsWith('rgb')) {
    const matches = computedColor.match(/\d+/g);
    if (!matches) return [0, 0, 0];
    return [parseInt(matches[0]), parseInt(matches[1]), parseInt(matches[2])];
  }
  return [0, 0, 0];
};

/**
 * Convert sRGB color channel (0-255) to linear space (0-1)
 */
export const srgbToLinear = (c: number): number => Math.pow(c / 255.0, 2.2);

/**
 * Convert linear color channel (0-1) back to sRGB (0-255)
 */
export const linearToSrgb = (c: number): number => Math.round(Math.pow(c, 1.0 / 2.2) * 255.0);

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

export const applyThrottledColorJitter = (
  baseColor: string, 
  jitterAmount: number,
  jitterState: JitterState
): string => {
  if (jitterAmount === 0) {
    jitterState.counter = 0; // Reset counter when jitter is off
    return baseColor;
  }

  // Every N points, calculate a new target jitter color
  if (jitterState.counter % jitterState.recalcFrequency === 0) {
    jitterState.lastJitterColor = jitterState.nextJitterColor;
    
    const [r, g, b] = parseColor(baseColor);
    
    // Simplified, faster RGB-based jitter
    const jitter = (jitterAmount / 100) * 128; // Scale jitter amount
    const r_j = r + (Math.random() - 0.5) * jitter;
    const g_j = g + (Math.random() - 0.5) * jitter;
    const b_j = b + (Math.random() - 0.5) * jitter;

    jitterState.nextJitterColor = [
      Math.max(0, Math.min(255, r_j)),
      Math.max(0, Math.min(255, g_j)),
      Math.max(0, Math.min(255, b_j)),
    ];

    // If it's the very first point, use the target color immediately
    if (jitterState.counter === 0) {
      jitterState.lastJitterColor = jitterState.nextJitterColor;
    }
  }

  // Interpolate between the last and next jitter color for smooth transitions
  const progress = (jitterState.counter % jitterState.recalcFrequency) / jitterState.recalcFrequency;
  
  const r_interp = jitterState.lastJitterColor[0] + (jitterState.nextJitterColor[0] - jitterState.lastJitterColor[0]) * progress;
  const g_interp = jitterState.lastJitterColor[1] + (jitterState.nextJitterColor[1] - jitterState.lastJitterColor[1]) * progress;
  const b_interp = jitterState.lastJitterColor[2] + (jitterState.nextJitterColor[2] - jitterState.lastJitterColor[2]) * progress;
  
  jitterState.counter++;
  
  return `rgb(${Math.round(r_interp)}, ${Math.round(g_interp)}, ${Math.round(b_interp)})`;
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