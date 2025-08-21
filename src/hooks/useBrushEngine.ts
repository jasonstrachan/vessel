'use client';

import { useCallback, useRef, useMemo, useEffect } from 'react';
import { useAppStore } from '../stores/useAppStore';
import { BrushComponent, ComponentType, BrushShape, CustomBrush, BrushSettings } from '../types';
import { shouldApplyGridSnap, snapToGrid, getGridPositionsBetween, calculateGridDimensions, snapToRectangularGrid, getRectangularGridPositionsBetween } from '../utils/gridSnap';
import { canvasPool } from '../utils/canvasPool';
import { getRisographPattern, preloadRisographTexture, FastSoftBrush, UltraFastBrush } from '../utils/risographTexture';
import { brushCache } from '../utils/brushCache';
import { scaledBrushCache } from '../utils/scaledBrushCache';
import { pressureOptimizer } from '../utils/pressureOptimizer';
import { memoryManager } from '../utils/memoryCleanup';
import { performanceMonitor } from '../utils/performanceMonitor';
import { 
  applyFloydSteinbergDither,
  applyBayerDither,
  applyAtkinsonDither,
  applyBlueNoiseDither,
  applyPatternDither,
  DitherSettings,
  DitherAlgorithm as DitherAlgorithmType,
  PatternStyle
} from '../utils/ditherAlgorithms';

// Combined dithering palette with browns, neutrals, and Apple II colors
const DITHER_PALETTE: [number, number, number][] = [
  // Core neutrals (shared between both palettes)
  [0, 0, 0],          // Black
  [255, 255, 255],    // White
  [128, 128, 128],    // Medium Grey
  [192, 192, 192],    // Light Grey
  [64, 64, 64],       // Dark Grey
  
  // Browns and earth tones
  [139, 69, 19],      // Saddle Brown
  [160, 82, 45],      // Sienna
  [205, 133, 63],     // Peru
  [210, 180, 140],    // Tan
  [222, 184, 135],    // Burlywood
  [245, 222, 179],    // Wheat
  [255, 228, 196],    // Bisque
  [101, 67, 33],      // Dark Brown
  [92, 51, 23],       // Russet
  [61, 43, 31],       // Dark Coffee
  
  // Warm neutrals
  [188, 143, 143],    // Rosy Brown
  [244, 164, 96],     // Sandy Brown
  [255, 218, 185],    // Peach Puff
  [250, 235, 215],    // Antique White
  [245, 245, 220],    // Beige
  
  // Apple II vibrant colors (excluding duplicates)
  [114, 38, 64],      // A2 Dark Red/Magenta
  [64, 51, 127],      // A2 Dark Blue
  [228, 52, 254],     // A2 Purple/Violet
  [14, 89, 64],       // A2 Dark Green
  [27, 154, 254],     // A2 Medium Blue
  [191, 179, 255],    // A2 Light Blue
  [64, 76, 0],        // A2 Brown (different from other browns)
  [228, 101, 1],      // A2 Orange
  [155, 161, 155],    // A2 Light Gray (slightly different)
  [255, 129, 236],    // A2 Pink
  [27, 203, 1],       // A2 Green
  [191, 204, 128],    // A2 Yellow
  [141, 217, 191],    // A2 Aqua
];

// Color names for logging
const DITHER_COLOR_NAMES = [
  'Black', 'White', 'Medium Grey', 'Light Grey', 'Dark Grey',
  'Saddle Brown', 'Sienna', 'Peru', 'Tan', 'Burlywood', 'Wheat', 'Bisque',
  'Dark Brown', 'Russet', 'Dark Coffee',
  'Rosy Brown', 'Sandy Brown', 'Peach Puff', 'Antique White', 'Beige',
  'A2 Magenta', 'A2 Dark Blue', 'A2 Purple', 'A2 Dark Green',
  'A2 Medium Blue', 'A2 Light Blue', 'A2 Brown', 'A2 Orange',
  'A2 Light Gray', 'A2 Pink', 'A2 Green', 'A2 Yellow', 'A2 Aqua'
];

// Track which colors have been used (for debugging)
const usedColorIndices = new Set<number>();

// Test function code removed to eliminate unused variables

// Smart palette selection that distributes colors across the spectrum
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const selectDiversePalette = (numColors: number): [number, number, number][] => {
  if (numColors >= DITHER_PALETTE.length) {
    return DITHER_PALETTE;
  }
  
  // For very small palettes, strategically pick colors
  if (numColors === 1) {
    return [DITHER_PALETTE[0]]; // Just black
  } else if (numColors === 2) {
    return [DITHER_PALETTE[0], DITHER_PALETTE[1]]; // Black and white
  } else if (numColors === 3) {
    return [DITHER_PALETTE[0], DITHER_PALETTE[2], DITHER_PALETTE[1]]; // Black, medium grey, white
  } else if (numColors === 4) {
    return [
      DITHER_PALETTE[0],  // Black
      DITHER_PALETTE[4],  // Dark grey
      DITHER_PALETTE[3],  // Light grey
      DITHER_PALETTE[1]   // White
    ];
  }
  
  // For 5+ colors, include some browns/colors
  const selectedColors: [number, number, number][] = [];
  
  // Always start with black and white
  selectedColors.push(DITHER_PALETTE[0]); // Black
  selectedColors.push(DITHER_PALETTE[1]); // White
  
  if (numColors > 2) {
    // Add a middle grey
    selectedColors.push(DITHER_PALETTE[2]); // Medium grey
  }
  
  if (numColors > 3) {
    // Start adding browns and colors
    const colorIndices = [
      6,  // Sienna (brown)
      8,  // Peru (brown)
      9,  // Tan (light brown)
      11, // Wheat
      3,  // Light grey
      4,  // Dark grey
      5,  // Saddle brown
      7,  // Sienna
      10, // Burlywood
      12, // Bisque
      13, // Dark brown
      14, // Russet
      15, // Dark coffee
      16, // Rosy brown
      17, // Sandy brown
      18, // Peach puff
      19, // Antique white
    ];
    
    // Add colors from our priority list until we reach numColors
    for (const idx of colorIndices) {
      if (selectedColors.length >= numColors) break;
      if (idx < DITHER_PALETTE.length) {
        // Check if not already added
        const color = DITHER_PALETTE[idx];
        if (!selectedColors.some(c => c[0] === color[0] && c[1] === color[1] && c[2] === color[2])) {
          selectedColors.push(color);
        }
      }
    }
  }
  
  // Fill any remaining slots
  while (selectedColors.length < numColors && selectedColors.length < DITHER_PALETTE.length) {
    // Find first color not yet selected
    let added = false;
    for (let i = 0; i < DITHER_PALETTE.length; i++) {
      const color = DITHER_PALETTE[i];
      if (!selectedColors.some(c => c[0] === color[0] && c[1] === color[1] && c[2] === color[2])) {
        selectedColors.push(color);
        added = true;
        break;
      }
    }
    if (!added) {
      break;
    }
  }
  
  return selectedColors;
};

// Shared function to find the two best colors for dithering a target color
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const findDitherColors = (targetR: number, targetG: number, targetB: number) => {
  // Find the two closest colors in the palette to the target color
  const colorDistances = DITHER_PALETTE.map(([r, g, b], index) => {
    // Use weighted Euclidean distance for better perceptual accuracy
    // Human eyes are more sensitive to green, then red, then blue
    const dr = targetR - r;
    const dg = targetG - g;
    const db = targetB - b;
    const distance = Math.sqrt(dr * dr * 0.3 + dg * dg * 0.59 + db * db * 0.11);
    return { index, distance, color: [r, g, b] as [number, number, number], name: DITHER_COLOR_NAMES[index] };
  });
  
  // Sort by distance and get the two closest colors
  colorDistances.sort((a, b) => a.distance - b.distance);
  const closest = colorDistances[0];
  const secondClosest = colorDistances[1];
  
  // Track which colors are being used
  usedColorIndices.add(closest.index);
  usedColorIndices.add(secondClosest.index);
  
  // Calculate the mix ratio based on relative distances
  const totalDist = closest.distance + secondClosest.distance;
  const ratio = totalDist > 0 ? closest.distance / totalDist : 0.5;
  
  return {
    baseColor: closest.color,
    mixColor: secondClosest.color,
    ratio: ratio
  };
};

// Authentic Apple II Hi-Res color palette (RGB values based on NTSC composite output)
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const AUTHENTIC_APPLE_II_PALETTE: [number, number, number][] = [
  [0, 0, 0],         // Black
  [114, 38, 64],     // Dark Red/Magenta
  [64, 51, 127],     // Dark Blue  
  [228, 52, 254],    // Purple/Violet
  [14, 89, 64],      // Dark Green
  [128, 128, 128],   // Gray
  [27, 154, 254],    // Medium Blue
  [191, 179, 255],   // Light Blue
  [64, 76, 0],       // Brown
  [228, 101, 1],     // Orange
  [155, 161, 155],   // Light Gray
  [255, 129, 236],   // Pink
  [27, 203, 1],      // Green
  [191, 204, 128],   // Yellow
  [141, 217, 191],   // Aqua
  [255, 255, 255]    // White
];

// Internal types for this hook
interface PixelQueue {
  initialized: boolean;
  lastDrawnX: number;
  lastDrawnY: number;
  waitingPixelX: number;
  waitingPixelY: number;
  spacingCounter: number;
  lastStrokePosition: { x: number; y: number };
  accumulatedDistance: number;
  stampedGridPositions: Set<string>;
  dashStampCounter: number;
}

interface RectangleState {
  startPos: { x: number; y: number };
  endPos: { x: number; y: number };
  width: number;
  startColor?: string;
  endColor?: string;
  colors?: string[];
  ditherEnabled?: boolean;
  ditherIntensity?: number;
  risographIntensity?: number;
}

// Cache for pre-rendered pixel circle stamps
const pixelCircleStampCache = new Map<string, HTMLCanvasElement>();

// Color jitter utility function
// Cache for color jitter canvas context (reused across all calls)
let jitterCanvas: HTMLCanvasElement | null = null;
let jitterCtx: CanvasRenderingContext2D | null = null;

// Cache for pattern rendering temp canvas (reused for all pattern operations)
let patternTempCanvas: HTMLCanvasElement | null = null;
let patternTempCtx: CanvasRenderingContext2D | null = null;

// Risograph pattern caching is now handled in risographTexture.ts using WeakMap

// Cache for riso effect settings to avoid recalculation
let cachedRisoAlpha = 0;
let cachedRisoIntensity = -1;
let cachedRisoIsPixel = false;

// --- OPTIMIZATION: Throttled and Interpolated Color Jitter ---
// This object manages jitter state to avoid expensive calculations on every point.
const jitterState = {
  lastJitterColor: [0, 0, 0],
  nextJitterColor: [0, 0, 0],
  counter: 0,
  // Recalculate the target jitter color every N points.
  // A value of 5-10 provides good randomization without high cost.
  recalcFrequency: 8, 
};

// Removed - throttling no longer needed with GPU-based risograph approach

const getJitterContext = (): CanvasRenderingContext2D => {
  if (!jitterCanvas || !jitterCtx) {
    jitterCanvas = document.createElement('canvas');
    jitterCanvas.width = 1;
    jitterCanvas.height = 1;
    jitterCtx = jitterCanvas.getContext('2d', { colorSpace: 'srgb' })!;
  }
  return jitterCtx;
};

const getPatternTempContext = (width: number, height: number): CanvasRenderingContext2D => {
  if (!patternTempCanvas || !patternTempCtx || 
      patternTempCanvas.width < width || patternTempCanvas.height < height) {
    patternTempCanvas = document.createElement('canvas');
    patternTempCanvas.width = Math.max(width, patternTempCanvas?.width || 0);
    patternTempCanvas.height = Math.max(height, patternTempCanvas?.height || 0);
    patternTempCtx = patternTempCanvas.getContext('2d', { willReadFrequently: true, colorSpace: 'srgb' })!;
  }
  // Clear and resize for this pattern
  patternTempCtx.clearRect(0, 0, width, height);
  return patternTempCtx;
};

// Helper to parse color string to [r, g, b] array
const parseColor = (color: string): [number, number, number] => {
  if (!jitterCtx) jitterCtx = getJitterContext();
  jitterCtx.fillStyle = '#000'; // Clear previous state
  jitterCtx.fillStyle = color;
  const computedColor = jitterCtx.fillStyle;

  if (computedColor.startsWith('#')) {
    const hex = computedColor.slice(1);
    return [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16)];
  }
  if (computedColor.startsWith('rgb')) {
    const matches = computedColor.match(/\d+/g);
    if (!matches) return [0, 0, 0];
    return [parseInt(matches[0]), parseInt(matches[1]), parseInt(matches[2])];
  }
  return [0, 0, 0];
};

const applyThrottledColorJitter = (baseColor: string, jitterAmount: number): string => {
  if (jitterAmount === 0) {
    jitterState.counter = 0; // Reset counter when jitter is off
    return baseColor;
  }

  // Every N points, calculate a new target jitter color
  if (jitterState.counter % jitterState.recalcFrequency === 0) {
    jitterState.lastJitterColor = jitterState.nextJitterColor;
    
    const [r, g, b] = parseColor(baseColor);
    
    // Simplified, faster RGB-based jitter. HSL is too slow for real-time.
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

// Noise texture creation has been moved to risographTexture.ts for better performance

// Converts a single sRGB color channel (0-255) to linear space (0-1)
const srgbToLinear = (c: number): number => Math.pow(c / 255.0, 2.2);

// Converts a linear color channel (0-1) back to sRGB (0-255)
const linearToSrgb = (c: number): number => Math.round(Math.pow(c, 1.0 / 2.2) * 255.0);

/**
 * Universal dithering function that routes to the appropriate algorithm
 */
const applyDithering = (
  imageData: ImageData, 
  numColors: number, 
  algorithm?: string,
  patternStyle?: string
): ImageData => {
  // Improved palette selection that guarantees gradient endpoints
  const selectDynamicPalette = (numColors: number): [number, number, number][] => {
    if (numColors >= DITHER_PALETTE.length) return DITHER_PALETTE;

    const data = imageData.data;
    const sampledColors: [number, number, number][] = [];
    const sampleStep = Math.max(1, Math.floor(data.length / (4 * 1000)));

    let darkestSample = { color: [255, 255, 255] as [number, number, number], luma: 255 };
    let lightestSample = { color: [0, 0, 0] as [number, number, number], luma: 0 };

    for (let i = 0; i < data.length; i += sampleStep * 4) {
      if (data[i + 3] > 128) {
        const r = data[i], g = data[i + 1], b = data[i + 2];
        const color: [number, number, number] = [r, g, b];
        sampledColors.push(color);

        // Find the darkest and lightest sampled colors by luminance
        const luma = 0.299 * r + 0.587 * g + 0.114 * b;
        if (luma < darkestSample.luma) darkestSample = { color, luma };
        if (luma > lightestSample.luma) lightestSample = { color, luma };
      }
    }

    if (sampledColors.length === 0) return DITHER_PALETTE.slice(0, numColors);

    // Helper to find the single closest palette color to a target
    const findClosestPaletteColor = (target: [number, number, number]): [number, number, number] => {
      let bestMatch: [number, number, number] = DITHER_PALETTE[0];
      let minDistanceSq = Infinity;
      DITHER_PALETTE.forEach(pColor => {
        const distSq = (target[0] - pColor[0]) ** 2 + (target[1] - pColor[1]) ** 2 + (target[2] - pColor[2]) ** 2;
        if (distSq < minDistanceSq) {
          minDistanceSq = distSq;
          bestMatch = pColor;
        }
      });
      return bestMatch;
    };

    const selectedColors = new Set<string>();
    const selectedColorsList: [number, number, number][] = [];

    // Forcibly add the best matches for the gradient's endpoints
    if (numColors >= 1) {
      const darkest = findClosestPaletteColor(darkestSample.color);
      const key = `${darkest[0]},${darkest[1]},${darkest[2]}`;
      if (!selectedColors.has(key)) {
        selectedColors.add(key);
        selectedColorsList.push(darkest);
      }
    }
    if (numColors >= 2) {
      const lightest = findClosestPaletteColor(lightestSample.color);
      const key = `${lightest[0]},${lightest[1]},${lightest[2]}`;
      if (!selectedColors.has(key)) {
        selectedColors.add(key);
        selectedColorsList.push(lightest);
      }
    }

    // Now, fill the rest of the palette using the scoring logic for best fit
    if (numColors > selectedColorsList.length) {
      const remainingPalette = DITHER_PALETTE.filter(pColor => {
        const key = `${pColor[0]},${pColor[1]},${pColor[2]}`;
        return !selectedColors.has(key);
      });
      
      const colorScores = remainingPalette.map(pColor => {
        let totalDistanceSq = 0;
        sampledColors.forEach(sample => {
          totalDistanceSq += (sample[0] - pColor[0]) ** 2 + (sample[1] - pColor[1]) ** 2 + (sample[2] - pColor[2]) ** 2;
        });
        return { color: pColor, score: -totalDistanceSq }; // Simple average distance scoring
      });
      colorScores.sort((a, b) => b.score - a.score);
      
      const needed = numColors - selectedColorsList.length;
      for(let i = 0; i < needed && i < colorScores.length; i++) {
        selectedColorsList.push(colorScores[i].color);
      }
    }
    
    return selectedColorsList;
  };
  
  const palette = selectDynamicPalette(numColors);
  
  // Create dither settings
  const ditherSettings: DitherSettings = {
    algorithm: (algorithm as DitherAlgorithmType) || 'sierra-lite',
    pressure: 0.5,
    intensity: 0.75,
    bayerMatrixSize: 8,
    palette: palette,
    patternStyle: (patternStyle as PatternStyle) || 'dots'
  };
  
  // Route to the appropriate algorithm
  switch (algorithm) {
    case 'floyd-steinberg':
      return applyFloydSteinbergDither(imageData, ditherSettings);
    case 'bayer':
      return applyBayerDither(imageData, ditherSettings);
    case 'atkinson':
      return applyAtkinsonDither(imageData, ditherSettings);
    case 'blue-noise':
      return applyBlueNoiseDither(imageData, ditherSettings);
    case 'pattern':
      return applyPatternDither(imageData, ditherSettings);
    case 'sierra-lite':
    default:
      // Keep the existing Sierra Lite implementation as default
      return applySierraLiteDither(imageData, numColors);
  }
};

/**
 * Applies Sierra Lite dithering to image data using a limited color palette
 * Sierra Lite uses a simplified error diffusion matrix:
 *     X  2
 *  1  1
 * Errors are distributed with weights: current pixel gets corrected,
 * right pixel gets 2/4 of error, bottom-left gets 1/4, bottom gets 1/4
 */
const applySierraLiteDither = (imageData: ImageData, numColors: number): ImageData => {
  const data = new Uint8ClampedArray(imageData.data);
  const width = imageData.width;
  const height = imageData.height;
  
  // Improved palette selection that guarantees gradient endpoints
  const selectDynamicPalette = (numColors: number): [number, number, number][] => {
    if (numColors >= DITHER_PALETTE.length) return DITHER_PALETTE;

    const sampledColors: [number, number, number][] = [];
    const sampleStep = Math.max(1, Math.floor(data.length / (4 * 1000)));

    let darkestSample = { color: [255, 255, 255] as [number, number, number], luma: 255 };
    let lightestSample = { color: [0, 0, 0] as [number, number, number], luma: 0 };

    for (let i = 0; i < data.length; i += sampleStep * 4) {
      if (data[i + 3] > 128) {
        const r = data[i], g = data[i + 1], b = data[i + 2];
        const color: [number, number, number] = [r, g, b];
        sampledColors.push(color);

        // Find the darkest and lightest sampled colors by luminance
        const luma = 0.299 * r + 0.587 * g + 0.114 * b;
        if (luma < darkestSample.luma) darkestSample = { color, luma };
        if (luma > lightestSample.luma) lightestSample = { color, luma };
      }
    }

    if (sampledColors.length === 0) return DITHER_PALETTE.slice(0, numColors);

    // Helper to find the single closest palette color to a target
    const findClosestPaletteColor = (target: [number, number, number]): [number, number, number] => {
      let bestMatch: [number, number, number] = DITHER_PALETTE[0];
      let minDistanceSq = Infinity;
      DITHER_PALETTE.forEach(pColor => {
        const distSq = (target[0] - pColor[0]) ** 2 + (target[1] - pColor[1]) ** 2 + (target[2] - pColor[2]) ** 2;
        if (distSq < minDistanceSq) {
          minDistanceSq = distSq;
          bestMatch = pColor;
        }
      });
      return bestMatch;
    };

    const selectedColors = new Set<string>();
    const selectedColorsList: [number, number, number][] = [];

    // Forcibly add the best matches for the gradient's endpoints
    if (numColors >= 1) {
      const darkest = findClosestPaletteColor(darkestSample.color);
      const key = `${darkest[0]},${darkest[1]},${darkest[2]}`;
      if (!selectedColors.has(key)) {
        selectedColors.add(key);
        selectedColorsList.push(darkest);
      }
    }
    if (numColors >= 2) {
      const lightest = findClosestPaletteColor(lightestSample.color);
      const key = `${lightest[0]},${lightest[1]},${lightest[2]}`;
      if (!selectedColors.has(key)) {
        selectedColors.add(key);
        selectedColorsList.push(lightest);
      }
    }

    // Now, fill the rest of the palette using the scoring logic for best fit
    if (numColors > selectedColorsList.length) {
      const remainingPalette = DITHER_PALETTE.filter(pColor => {
        const key = `${pColor[0]},${pColor[1]},${pColor[2]}`;
        return !selectedColors.has(key);
      });
      
      const colorScores = remainingPalette.map(pColor => {
        let totalDistanceSq = 0;
        sampledColors.forEach(sample => {
          totalDistanceSq += (sample[0] - pColor[0]) ** 2 + (sample[1] - pColor[1]) ** 2 + (sample[2] - pColor[2]) ** 2;
        });
        return { color: pColor, score: -totalDistanceSq }; // Simple average distance scoring
      });
      colorScores.sort((a, b) => b.score - a.score);
      
      const needed = numColors - selectedColorsList.length;
      for(let i = 0; i < needed && i < colorScores.length; i++) {
        selectedColorsList.push(colorScores[i].color);
      }
    }
    
    return selectedColorsList;
  };
  
  const palette = selectDynamicPalette(numColors);
  
  // Find nearest palette color using linear color space for accurate comparison
  const findNearestColor = (r: number, g: number, b: number): [number, number, number] => {
    let nearest = palette[0];
    let minDiff = Infinity;

    // Convert the source pixel color to linear space once
    const lr = srgbToLinear(r);
    const lg = srgbToLinear(g);
    const lb = srgbToLinear(b);
    
    for (let i = 0; i < palette.length; i++) {
      const color = palette[i];
      
      // Convert the palette color to linear space for comparison
      const plr = srgbToLinear(color[0]);
      const plg = srgbToLinear(color[1]);
      const plb = srgbToLinear(color[2]);

      // Compare distance in linear space for gamma-correct matching
      const dr = lr - plr;
      const dg = lg - plg;
      const db = lb - plb;
      
      // Using simple squared distance is accurate in linear space
      const diff = dr * dr + dg * dg + db * db;
      
      if (diff < minDiff) {
        minDiff = diff;
        nearest = color; // Still return the original sRGB palette color
      }
    }
    return nearest;
  };
  
  // Create a working copy for error accumulation
  const workingData = new Float32Array(data.length);
  for (let i = 0; i < data.length; i++) {
    workingData[i] = data[i];
  }
  
  // Apply Sierra Lite dithering
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      
      // Get current RGB values (with accumulated error)
      const oldR = Math.max(0, Math.min(255, workingData[idx]));
      const oldG = Math.max(0, Math.min(255, workingData[idx + 1]));
      const oldB = Math.max(0, Math.min(255, workingData[idx + 2]));
      
      // Find nearest color in selected palette
      const [newR, newG, newB] = findNearestColor(oldR, oldG, oldB);
      
      // Calculate error for each channel
      const errorR = oldR - newR;
      const errorG = oldG - newG;
      const errorB = oldB - newB;
      
      // Set new color in output
      data[idx] = newR;
      data[idx + 1] = newG;
      data[idx + 2] = newB;
      
      // Distribute error using Sierra Lite weights
      // Pre-calculate noise values for better performance
      const noiseAmount = 2; // Small noise to break up patterns
      const noise1 = (Math.random() - 0.5) * noiseAmount;
      const noise2 = (Math.random() - 0.5) * noiseAmount;
      const noise3 = (Math.random() - 0.5) * noiseAmount;
      
      // Right pixel (2/4 of error)
      if (x < width - 1) {
        const rightIdx = (y * width + (x + 1)) * 4;
        workingData[rightIdx] += errorR * 0.5 + noise1;
        workingData[rightIdx + 1] += errorG * 0.5 + noise1;
        workingData[rightIdx + 2] += errorB * 0.5 + noise1;
      }
      
      // Bottom-left pixel (1/4 of error)
      if (y < height - 1 && x > 0) {
        const bottomLeftIdx = ((y + 1) * width + (x - 1)) * 4;
        workingData[bottomLeftIdx] += errorR * 0.25 + noise2;
        workingData[bottomLeftIdx + 1] += errorG * 0.25 + noise2;
        workingData[bottomLeftIdx + 2] += errorB * 0.25 + noise2;
      }
      
      // Bottom pixel (1/4 of error)  
      if (y < height - 1) {
        const bottomIdx = ((y + 1) * width + x) * 4;
        workingData[bottomIdx] += errorR * 0.25 + noise3;
        workingData[bottomIdx + 1] += errorG * 0.25 + noise3;
        workingData[bottomIdx + 2] += errorB * 0.25 + noise3;
      }
    }
  }
  
  return new ImageData(data, width, height);
};

/**
 * Snaps near-black and near-white colors to pure black/white for cleaner dithering.
 * This ensures that dark grays become pure black and light grays become pure white.
 */
const snapColorToExtremes = (r: number, g: number, b: number, threshold: number = 20): [number, number, number] => {
  // If all channels are below threshold, snap to black
  if (r <= threshold && g <= threshold && b <= threshold) {
    return [0, 0, 0];
  }
  // If all channels are above 255-threshold, snap to white
  if (r >= 255 - threshold && g >= 255 - threshold && b >= 255 - threshold) {
    return [255, 255, 255];
  }
  // Otherwise return the original color
  return [r, g, b];
};

/**
 * Calculates the average color from an array of colors.
 * Used for 1-color mode to create a flat solid fill.
 */
const getAverageColor = (colors: string[]): string => {
  if (colors.length === 0) return 'rgb(128, 128, 128)';
  if (colors.length === 1) return colors[0];
  
  let totalR = 0, totalG = 0, totalB = 0;
  let validCount = 0;
  
  colors.forEach(color => {
    const match = color.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
    if (match) {
      totalR += parseInt(match[1]);
      totalG += parseInt(match[2]);
      totalB += parseInt(match[3]);
      validCount++;
    } else {
      // Fallback for hex colors
      const hexMatch = color.match(/#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i);
      if (hexMatch) {
        totalR += parseInt(hexMatch[1], 16);
        totalG += parseInt(hexMatch[2], 16);
        totalB += parseInt(hexMatch[3], 16);
        validCount++;
      }
    }
  });
  
  if (validCount === 0) return 'rgb(128, 128, 128)';
  
  const avgR = Math.round(totalR / validCount);
  const avgG = Math.round(totalG / validCount);
  const avgB = Math.round(totalB / validCount);
  
  return `rgb(${avgR}, ${avgG}, ${avgB})`;
};

/**
 * Quantizes a set of colors to a limited palette.
 * This creates distinct color bands for gradient dithering.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const quantizeColorPalette = (colors: string[], targetColors: number): string[] => {
  if (colors.length === 0 || targetColors <= 1) {
    return colors;
  }
  
  // For simple gradient dithering, just use the first and last sampled colors
  // This creates a clean linear gradient that dithering can work with
  if (targetColors === 2 && colors.length >= 2) {
    return [colors[0], colors[colors.length - 1]];
  }
  
  // Parse all colors to RGB
  const rgbColors = colors.map(color => {
    const match = color.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
    if (match) {
      return {
        r: parseInt(match[1]),
        g: parseInt(match[2]),
        b: parseInt(match[3])
      };
    }
    // Fallback for hex colors
    const hexMatch = color.match(/#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i);
    if (hexMatch) {
      return {
        r: parseInt(hexMatch[1], 16),
        g: parseInt(hexMatch[2], 16),
        b: parseInt(hexMatch[3], 16)
      };
    }
    return { r: 128, g: 128, b: 128 }; // Default gray
  });
  
  // Find min and max values for each channel
  const minR = Math.min(...rgbColors.map(c => c.r));
  const maxR = Math.max(...rgbColors.map(c => c.r));
  const minG = Math.min(...rgbColors.map(c => c.g));
  const maxG = Math.max(...rgbColors.map(c => c.g));
  const minB = Math.min(...rgbColors.map(c => c.b));
  const maxB = Math.max(...rgbColors.map(c => c.b));
  
  // Create evenly spaced colors between min and max
  const quantizedPalette: string[] = [];
  for (let i = 0; i < targetColors; i++) {
    const t = targetColors === 1 ? 0.5 : i / (targetColors - 1);
    const r = Math.round(minR + (maxR - minR) * t);
    const g = Math.round(minG + (maxG - minG) * t);
    const b = Math.round(minB + (maxB - minB) * t);
    quantizedPalette.push(`rgb(${r}, ${g}, ${b})`);
  }
  
  return quantizedPalette;
};

/**
 * Applies any dithering algorithm with customizable fill resolution.
 * Instead of dithering individual pixels, this works on blocks of pixels for a chunky effect.
 */
const applyDitheringWithFillResolution = (
  imageData: ImageData, 
  numColors: number, 
  fillResolution: number,
  algorithm: string,
  patternStyle?: string
): ImageData => {
  if (fillResolution <= 1) {
    return applyDithering(imageData, numColors, algorithm, patternStyle);
  }

  const data = new Uint8ClampedArray(imageData.data);
  const width = imageData.width;
  const height = imageData.height;
  const blockSize = fillResolution;
  
  // Calculate block dimensions
  const blockWidth = Math.ceil(width / blockSize);
  const blockHeight = Math.ceil(height / blockSize);
  
  // Create block average data
  const blockData: number[][][] = [];
  for (let by = 0; by < blockHeight; by++) {
    blockData[by] = [];
    for (let bx = 0; bx < blockWidth; bx++) {
      // Average all pixels in this block for each channel
      let r = 0, g = 0, b = 0, count = 0;
      
      for (let dy = 0; dy < blockSize; dy++) {
        for (let dx = 0; dx < blockSize; dx++) {
          const pixelX = bx * blockSize + dx;
          const pixelY = by * blockSize + dy;
          
          if (pixelX < width && pixelY < height) {
            const idx = (pixelY * width + pixelX) * 4;
            r += data[idx];
            g += data[idx + 1];
            b += data[idx + 2];
            count++;
          }
        }
      }
      
      if (count > 0) {
        blockData[by][bx] = [r / count, g / count, b / count];
      } else {
        blockData[by][bx] = [0, 0, 0];
      }
    }
  }
  
  // Create a temporary image from the block data to apply dithering
  const blockImageData = new ImageData(blockWidth, blockHeight);
  for (let by = 0; by < blockHeight; by++) {
    for (let bx = 0; bx < blockWidth; bx++) {
      const idx = (by * blockWidth + bx) * 4;
      blockImageData.data[idx] = blockData[by][bx][0];
      blockImageData.data[idx + 1] = blockData[by][bx][1];
      blockImageData.data[idx + 2] = blockData[by][bx][2];
      blockImageData.data[idx + 3] = 255;
    }
  }
  
  // Apply the selected dithering algorithm to the block-averaged data
  const ditheredBlockImage = applyDithering(blockImageData, numColors, algorithm, patternStyle);
  
  // Extract dithered blocks from the result
  const ditheredBlocks: number[][][] = Array(blockHeight).fill(null).map(() => 
    Array(blockWidth).fill(null).map(() => [0, 0, 0])
  );
  
  for (let by = 0; by < blockHeight; by++) {
    for (let bx = 0; bx < blockWidth; bx++) {
      const idx = (by * blockWidth + bx) * 4;
      ditheredBlocks[by][bx] = [
        ditheredBlockImage.data[idx],
        ditheredBlockImage.data[idx + 1],
        ditheredBlockImage.data[idx + 2]
      ];
    }
  }
  
  // Expand dithered blocks back to full resolution
  for (let by = 0; by < blockHeight; by++) {
    for (let bx = 0; bx < blockWidth; bx++) {
      const blockColor = ditheredBlocks[by][bx];
      
      // Fill all pixels in this block with the dithered color
      for (let dy = 0; dy < blockSize; dy++) {
        for (let dx = 0; dx < blockSize; dx++) {
          const pixelX = bx * blockSize + dx;
          const pixelY = by * blockSize + dy;
          
          if (pixelX < width && pixelY < height) {
            const idx = (pixelY * width + pixelX) * 4;
            data[idx] = blockColor[0];
            data[idx + 1] = blockColor[1];
            data[idx + 2] = blockColor[2];
            // Keep original alpha
          }
        }
      }
    }
  }
  
  return new ImageData(data, width, height);
};



// Base sizes for standard brushes (100% = these sizes in pixels)
const BRUSH_BASE_SIZES: Record<BrushShape, number> = {
  [BrushShape.PIXEL_ROUND]: 1,
  [BrushShape.ROUND]: 10,
  [BrushShape.SQUARE]: 10,
  [BrushShape.TRIANGLE]: 10,
  [BrushShape.CUSTOM]: 32, // Default for custom brushes
  [BrushShape.RECTANGLE_GRADIENT]: 10,
  [BrushShape.POLYGON_GRADIENT]: 10,
  [BrushShape.RISOGRAPH_SOFT]: 10, // Soft risograph brush
  [BrushShape.RISOGRAPH_ULTRA]: 10 // Ultra-fast risograph brush
};

export interface StrokeInput {
  position: { x: number; y: number };
  pressure: number;
  velocity: number;
  timestamp: number;
  direction?: number; // Angle in radians from movement vector
}

export interface RenderSettings {
  size: number;
  opacity: number;
  color: string;
  antiAliasing: boolean;
  pixelAlignment: boolean;
  spacing: number;
  rotation: number;
  shape: BrushShape;
  risographIntensity: number;
  pattern?: ImageData;
  centerAlignment?: boolean;
  blendMode?: GlobalCompositeOperation;
}


export const useBrushEngine = () => {
  const { tools, activeBrushComponents, project, brushPresets, temporaryCustomBrush } = useAppStore();
  
  // Pre-create risograph texture on first mount to avoid lag
  useEffect(() => {
    // Create the texture in idle time to avoid blocking
    const timeoutId = setTimeout(() => {
      preloadRisographTexture();
    }, 100);
    
    return () => clearTimeout(timeoutId);
  }, []); // Run once on mount
  
  // Fast brush stamp cache for optimized rendering (like pixel brushes)
  const brushStampCacheRef = useRef<Map<string, HTMLCanvasElement>>(new Map());
  
  // Pixel queue state for perfect pixel drawing with distance-based spacing
  const pixelQueueRef = useRef({
    lastDrawnX: 0,
    lastDrawnY: 0,
    waitingPixelX: 0,
    waitingPixelY: 0,
    initialized: false,
    spacingCounter: 0,
    // Distance-based spacing state
    accumulatedDistance: 0,
    lastStrokePosition: { x: 0, y: 0 },
    // Dashed brush state
    dashStampCounter: 0,
    // Grid position tracking to prevent multiple stamps per grid cell
    stampedGridPositions: new Set<string>()
  });

  // Direction smoothing for rotation
  const directionHistoryRef = useRef<number[]>([]);
  const lastDirectionRef = useRef<number>(0);
  
  // Velocity smoothing for ink brush
  const velocityHistoryRef = useRef<number[]>([]);
  const strokeStateRef = useRef<'idle' | 'starting' | 'drawing'>('idle');
  const strokeStartTimeRef = useRef<number>(0);

  // --- START FIX 1 ---
  // Create a ref to hold a reusable input object.
  const strokeInputRef = useRef<StrokeInput>({
    position: { x: 0, y: 0 },
    pressure: 0,
    velocity: 0,
    timestamp: 0,
    direction: 0,
  });
  // --- END FIX 1 ---

  // Quantize brush size to prevent micro-variations when using grid snap + pressure
  const quantizeBrushSize = useCallback((size: number, stepSize: number = 0.5): number => {
    const invStepSize = 1 / stepSize; // Avoid division in hot path
    return Math.round(size * invStepSize) / invStepSize;
  }, []);
  
  // Calculate smoothed velocity for ink brush
  const calculateSmoothedVelocity = useCallback((rawVelocity: number): number => {
    // Add to velocity history
    velocityHistoryRef.current.push(rawVelocity);
    
    // Keep only last 5 samples for smoothing
    if (velocityHistoryRef.current.length > 5) {
      velocityHistoryRef.current.shift();
    }
    
    // Calculate weighted average (more recent = higher weight)
    const weights = [0.1, 0.15, 0.2, 0.25, 0.3];
    let weightedSum = 0;
    let weightSum = 0;
    
    for (let i = 0; i < velocityHistoryRef.current.length; i++) {
      const weight = weights[i] || weights[weights.length - 1];
      weightedSum += velocityHistoryRef.current[i] * weight;
      weightSum += weight;
    }
    
    return weightSum > 0 ? weightedSum / weightSum : rawVelocity;
  }, []);

  // Calculate and smooth direction from movement vector
  const calculateSmoothDirection = useCallback((from: { x: number; y: number }, to: { x: number; y: number }): number => {
    const deltaX = to.x - from.x;
    const deltaY = to.y - from.y;
    const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
    
    // Get current pressure to detect stylus vs mouse input
    const cursorPressure = useAppStore.getState().canvas.cursor.pressure ?? 1.0;
    const isStylusInput = cursorPressure < 0.98; // Stylus typically has variable pressure
    
    // Adaptive smoothing based on input type
    const minDistance = isStylusInput ? 1.5 : 3; // Stylus: more responsive, Mouse: more filtered
    const historySize = isStylusInput ? 4 : 7; // Stylus: shorter history, Mouse: longer history
    
    // If movement is very small, keep last direction to avoid jitter
    if (distance < minDistance) {
      return lastDirectionRef.current;
    }
    
    // Calculate direction angle (radians)
    const direction = Math.atan2(deltaY, deltaX);
    
    // Add to history for smoothing
    directionHistoryRef.current.push(direction);
    
    // Keep adaptive history size
    if (directionHistoryRef.current.length > historySize) {
      directionHistoryRef.current.shift();
    }
    
    // Smooth direction using weighted average with adaptive weights
    let smoothedDirection = direction;
    if (directionHistoryRef.current.length > 1) {
      // Adaptive weight distribution based on input type
      const weights = isStylusInput 
        ? [0.45, 0.30, 0.20, 0.05] // Stylus: more emphasis on recent directions
        : [0.25, 0.20, 0.18, 0.15, 0.12, 0.07, 0.03]; // Mouse: gradual smoothing
      
      let weightSum = 0;
      let sinSum = 0;
      let cosSum = 0;
      
      // Use circular averaging to handle angle wraparound properly
      for (let i = 0; i < directionHistoryRef.current.length; i++) {
        const weight = weights[directionHistoryRef.current.length - 1 - i] || 0.02;
        const angle = directionHistoryRef.current[i];
        sinSum += Math.sin(angle) * weight;
        cosSum += Math.cos(angle) * weight;
        weightSum += weight;
      }
      
      // Convert back to angle using atan2 for proper quadrant
      smoothedDirection = Math.atan2(sinSum / weightSum, cosSum / weightSum);
    }
    
    // Apply adaptive final smoothing
    if (lastDirectionRef.current !== 0) {
      let angleDiff = smoothedDirection - lastDirectionRef.current;
      
      // Normalize angle difference to [-PI, PI]
      while (angleDiff > Math.PI) angleDiff -= 2 * Math.PI;
      while (angleDiff < -Math.PI) angleDiff += 2 * Math.PI;
      
      // Adaptive smoothing factor: stylus more responsive, mouse smoother
      const smoothingFactor = isStylusInput ? 0.35 : 0.15;
      smoothedDirection = lastDirectionRef.current + angleDiff * smoothingFactor;
    }
    
    lastDirectionRef.current = smoothedDirection;
    return smoothedDirection;
  }, []);

  // Pixel-perfect circle patterns based on reference image
  const getPixelCircleStamp = useCallback((size: number): HTMLCanvasElement => {
    const cacheKey = `${size}`;
    
    // Check cache first
    if (pixelCircleStampCache.has(cacheKey)) {
      return pixelCircleStampCache.get(cacheKey)!;
    }

    // Define hardcoded patterns for small sizes (1-8)
    const patterns: Record<number, Array<{x: number, y: number}>> = {
      1: [{x: 0, y: 0}],
      2: [{x: 0, y: 0}, {x: 1, y: 0}, {x: 0, y: 1}, {x: 1, y: 1}],
      3: [{x: 0, y: 1}, {x: 1, y: 0}, {x: 1, y: 1}, {x: 1, y: 2}, {x: 2, y: 1}],
      4: [
        {x: 0, y: 1}, {x: 0, y: 2},
        {x: 1, y: 0}, {x: 1, y: 1}, {x: 1, y: 2}, {x: 1, y: 3},
        {x: 2, y: 0}, {x: 2, y: 1}, {x: 2, y: 2}, {x: 2, y: 3},
        {x: 3, y: 1}, {x: 3, y: 2}
      ],
      5: [
        {x: 0, y: 2},
        {x: 1, y: 1}, {x: 1, y: 2}, {x: 1, y: 3},
        {x: 2, y: 0}, {x: 2, y: 1}, {x: 2, y: 2}, {x: 2, y: 3}, {x: 2, y: 4},
        {x: 3, y: 1}, {x: 3, y: 2}, {x: 3, y: 3},
        {x: 4, y: 2}
      ],
      6: [
        {x: 0, y: 2}, {x: 0, y: 3},
        {x: 1, y: 1}, {x: 1, y: 2}, {x: 1, y: 3}, {x: 1, y: 4},
        {x: 2, y: 0}, {x: 2, y: 1}, {x: 2, y: 2}, {x: 2, y: 3}, {x: 2, y: 4}, {x: 2, y: 5},
        {x: 3, y: 0}, {x: 3, y: 1}, {x: 3, y: 2}, {x: 3, y: 3}, {x: 3, y: 4}, {x: 3, y: 5},
        {x: 4, y: 1}, {x: 4, y: 2}, {x: 4, y: 3}, {x: 4, y: 4},
        {x: 5, y: 2}, {x: 5, y: 3}
      ],
      7: [
        {x: 0, y: 2}, {x: 0, y: 3}, {x: 0, y: 4},
        {x: 1, y: 1}, {x: 1, y: 2}, {x: 1, y: 3}, {x: 1, y: 4}, {x: 1, y: 5},
        {x: 2, y: 0}, {x: 2, y: 1}, {x: 2, y: 2}, {x: 2, y: 3}, {x: 2, y: 4}, {x: 2, y: 5}, {x: 2, y: 6},
        {x: 3, y: 0}, {x: 3, y: 1}, {x: 3, y: 2}, {x: 3, y: 3}, {x: 3, y: 4}, {x: 3, y: 5}, {x: 3, y: 6},
        {x: 4, y: 0}, {x: 4, y: 1}, {x: 4, y: 2}, {x: 4, y: 3}, {x: 4, y: 4}, {x: 4, y: 5}, {x: 4, y: 6},
        {x: 5, y: 1}, {x: 5, y: 2}, {x: 5, y: 3}, {x: 5, y: 4}, {x: 5, y: 5},
        {x: 6, y: 2}, {x: 6, y: 3}, {x: 6, y: 4}
      ],
      8: [
        {x: 0, y: 2}, {x: 0, y: 3}, {x: 0, y: 4}, {x: 0, y: 5},
        {x: 1, y: 1}, {x: 1, y: 2}, {x: 1, y: 3}, {x: 1, y: 4}, {x: 1, y: 5}, {x: 1, y: 6},
        {x: 2, y: 0}, {x: 2, y: 1}, {x: 2, y: 2}, {x: 2, y: 3}, {x: 2, y: 4}, {x: 2, y: 5}, {x: 2, y: 6}, {x: 2, y: 7},
        {x: 3, y: 0}, {x: 3, y: 1}, {x: 3, y: 2}, {x: 3, y: 3}, {x: 3, y: 4}, {x: 3, y: 5}, {x: 3, y: 6}, {x: 3, y: 7},
        {x: 4, y: 0}, {x: 4, y: 1}, {x: 4, y: 2}, {x: 4, y: 3}, {x: 4, y: 4}, {x: 4, y: 5}, {x: 4, y: 6}, {x: 4, y: 7},
        {x: 5, y: 0}, {x: 5, y: 1}, {x: 5, y: 2}, {x: 5, y: 3}, {x: 5, y: 4}, {x: 5, y: 5}, {x: 5, y: 6}, {x: 5, y: 7},
        {x: 6, y: 1}, {x: 6, y: 2}, {x: 6, y: 3}, {x: 6, y: 4}, {x: 6, y: 5}, {x: 6, y: 6},
        {x: 7, y: 2}, {x: 7, y: 3}, {x: 7, y: 4}, {x: 7, y: 5}
      ]
    };

    let pixels: Array<{x: number, y: number}>;

    if (patterns[size]) {
      pixels = patterns[size];
    } else {
      // Fallback to calculated circle for larger sizes
      pixels = [];
      const radius = size / 2;
      const centerX = radius - 0.5;
      const centerY = radius - 0.5;
      
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          const dx = x - centerX;
          const dy = y - centerY;
          if (dx * dx + dy * dy <= radius * radius) {
            pixels.push({x, y});
          }
        }
      }
    }

    // Create an offscreen canvas for the stamp
    const stampCanvas = document.createElement('canvas');
    stampCanvas.width = size;
    stampCanvas.height = size;
    const stampCtx = stampCanvas.getContext('2d', { colorSpace: 'srgb' })!;

    // Draw the pixel pattern in white (color will be applied during drawing)
    stampCtx.fillStyle = 'white';
    stampCtx.imageSmoothingEnabled = false;
    pixels.forEach(pixel => {
      stampCtx.fillRect(pixel.x, pixel.y, 1, 1);
    });

    // Store the new stamp in the cache and return it
    pixelCircleStampCache.set(cacheKey, stampCanvas);
    return stampCanvas;
  }, []);
  
  const drawShape = useCallback((
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    size: number,
    shape: BrushShape,
    antiAliasing: boolean,
    rotation: number = 0,
    risographIntensity: number = 0,
    pattern?: ImageData,
    centerAlignment?: boolean
  ) => {
    // Canvas clipping (ctx.clip) automatically handles bounds restriction
    // No manual bounds checking needed - canvas won't draw outside clipped region
    
    const halfSize = size / 2;
    
    // --- RISOGRAPH EFFECT LOGIC ---
    // Draw directly to main canvas for performance
    const targetCtx = ctx;
    const drawX = x;
    const drawY = y;
    
    if (!targetCtx) {
      return;
    }

    // Check transparency lock before drawing
    if ((window as Window & { transparencyLockEnabled?: boolean }).transparencyLockEnabled) {
      // Sample the center pixel to check if we can draw here
      const centerX = Math.floor(x);
      const centerY = Math.floor(y);
      
      // Ensure coordinates are within canvas bounds before getImageData
      const canvasWidth = ctx.canvas.width;
      const canvasHeight = ctx.canvas.height;
      
      if (centerX >= 0 && centerX < canvasWidth && centerY >= 0 && centerY < canvasHeight) {
        try {
          const imageData = ctx.getImageData(centerX, centerY, 1, 1);
          const alpha = imageData.data[3]; // Alpha channel
          
          // If transparency lock is enabled and pixel is fully transparent, skip drawing
          if (alpha === 0) {
            return;
          }
        } catch {
          // If we can't read the pixel data, allow drawing
        }
      }
    }
    
    // Save the current composite operation before save() overwrites it
    const currentCompositeOp = ctx.globalCompositeOperation;
    
    // Skip white background - will be handled by main canvas compositing
    
    targetCtx.save();

    // Preserve the globalCompositeOperation from the main context
    targetCtx.globalCompositeOperation = currentCompositeOp;
    
    // Special handling for pixel brushes - they should NEVER be smoothed
    if (shape === BrushShape.PIXEL_ROUND) {
      targetCtx.imageSmoothingEnabled = false;
      // Always round to pixel boundaries for pixel brushes
      x = Math.round(x);
      y = Math.round(y);
    } else if (!antiAliasing) {
      targetCtx.imageSmoothingEnabled = false;
      // Round to pixel boundaries for pixel-perfect drawing
      x = Math.round(x);
      y = Math.round(y);
    } else {
      // Ensure smoothing is enabled for antialiased drawing
      targetCtx.imageSmoothingEnabled = true;
    }
    
    // Apply rotation if specified
    if (rotation !== 0) {
      targetCtx.translate(drawX, drawY);
      targetCtx.rotate(rotation);
      targetCtx.translate(-drawX, -drawY);
    }
    
    // Handle custom pattern rendering - use pattern as fill for the shape
    if (pattern && pattern.width > 0 && pattern.height > 0) {
      
      // Use cached temporary canvas for pattern
      const tempCtx = getPatternTempContext(pattern.width, pattern.height);
      const tempCanvas = patternTempCanvas!;
      
      if (tempCtx) {
        try {
          // Configure temp canvas context to match main context
          tempCtx.imageSmoothingEnabled = targetCtx.imageSmoothingEnabled;
          tempCtx.putImageData(pattern, 0, 0);
          
          // Create a pattern from the custom brush texture
          const brushPattern = targetCtx.createPattern(tempCanvas, 'repeat');
          
          if (brushPattern) {
            // Save current fill style
            const originalFillStyle = targetCtx.fillStyle;
            
            // Use pattern as fill style for the shape
            targetCtx.fillStyle = brushPattern;
            
            // Now draw the shape with the pattern fill
            switch (shape) {
              case BrushShape.SQUARE:
                if (antiAliasing) {
                  targetCtx.fillRect(drawX - halfSize, drawY - halfSize, size, size);
                } else {
                  // Pixel-perfect square
                  const offset = Math.floor(size / 2);
                  targetCtx.fillRect(drawX - offset, drawY - offset, size, size);
                }
                break;
                
              case BrushShape.ROUND:
                // Always use perfect circles for antialiased round brushes
                targetCtx.beginPath();
                targetCtx.arc(drawX, drawY, halfSize, 0, Math.PI * 2);
                targetCtx.fill();
                break;
                
              case BrushShape.TRIANGLE:
                targetCtx.beginPath();
                if (antiAliasing) {
                  targetCtx.moveTo(drawX, drawY - halfSize);
                  targetCtx.lineTo(drawX - halfSize, drawY + halfSize);
                  targetCtx.lineTo(drawX + halfSize, drawY + halfSize);
                } else {
                  // Pixel-perfect triangle
                  const height = Math.floor(size * 0.866); // sqrt(3)/2
                  targetCtx.moveTo(drawX, drawY - Math.floor(height / 2));
                  targetCtx.lineTo(drawX - Math.floor(size / 2), drawY + Math.floor(height / 2));
                  targetCtx.lineTo(drawX + Math.floor(size / 2), drawY + Math.floor(height / 2));
                }
                targetCtx.closePath();
                targetCtx.fill();
                break;
                
              default:
                // For other shapes or custom brush, draw the pattern directly
                const scaledWidth = pattern.width;
                const scaledHeight = pattern.height;
                
                let patternDrawX = drawX;
                let patternDrawY = drawY;
                
                if (centerAlignment) {
                  patternDrawX = drawX - scaledWidth / 2;
                  patternDrawY = drawY - scaledHeight / 2;
                }
                
                patternDrawX = Math.round(patternDrawX);
                patternDrawY = Math.round(patternDrawY);
                
                // Restore original fill style to draw the pattern image
                targetCtx.fillStyle = originalFillStyle;
                targetCtx.drawImage(tempCanvas, patternDrawX, patternDrawY);
                break;
            }
            
            // Restore original fill style if we didn't use it above
            if (shape !== BrushShape.PIXEL_ROUND && shape !== BrushShape.CUSTOM) {
              targetCtx.fillStyle = originalFillStyle;
            }
          }
        } catch {
        }
      }
    } else {
      // Original shape rendering
      switch (shape) {
        case BrushShape.SQUARE:
          if (antiAliasing) {
            targetCtx.fillRect(drawX - halfSize, drawY - halfSize, size, size);
          } else {
            // Pixel-perfect square
            const offset = Math.floor(size / 2);
            targetCtx.fillRect(drawX - offset, drawY - offset, size, size);
          }
          break;
          
        case BrushShape.ROUND: {
          // Optimized rendering using pre-cached circular stamps (like pixel brushes)
          const brushSettings = tools.brushSettings;
          const roundedSize = Math.round(size);
          const useFastRender = roundedSize > 2 && !pattern;
          
          if (useFastRender && antiAliasing) {
            // Soft brush with pre-rendered CIRCULAR stamps for performance
            const cacheKey = `soft_circle_${roundedSize}`;
            let stampCanvas = brushStampCacheRef.current.get(cacheKey);
            
            if (!stampCanvas) {
              // Create a soft CIRCULAR brush stamp once and cache it
              stampCanvas = document.createElement('canvas');
              const padding = 4; // Extra pixels for soft edge
              stampCanvas.width = roundedSize + padding;
              stampCanvas.height = roundedSize + padding;
              const stampCtx = stampCanvas.getContext('2d', { alpha: true });
              
              if (stampCtx) {
                const center = stampCanvas.width / 2;
                const radius = roundedSize / 2;
                
                // Create circular soft edge gradient (done once per size)
                const gradient = stampCtx.createRadialGradient(
                  center, center, radius * 0.3,
                  center, center, radius
                );
                gradient.addColorStop(0, 'rgba(255, 255, 255, 1)');
                gradient.addColorStop(0.7, 'rgba(255, 255, 255, 0.8)');
                gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
                
                // IMPORTANT: Draw a circle, not a rectangle!
                stampCtx.beginPath();
                stampCtx.arc(center, center, radius, 0, Math.PI * 2);
                stampCtx.fillStyle = gradient;
                stampCtx.fill();
                
                brushStampCacheRef.current.set(cacheKey, stampCanvas);
              }
            }
            
            // Draw the cached circular stamp with proper blending
            if (stampCanvas) {
              const stampOffset = stampCanvas.width / 2;
              
              // Use a temporary canvas to apply color to the stamp
              const tempSize = stampCanvas.width;
              const tempCanvas = canvasPool.acquire(tempSize, tempSize);
              const tempCtx = tempCanvas.getContext('2d');
              
              if (tempCtx) {
                // Clear and draw the white stamp
                tempCtx.clearRect(0, 0, tempSize, tempSize);
                tempCtx.drawImage(stampCanvas, 0, 0);
                
                // Apply color using source-in (preserves alpha)
                tempCtx.globalCompositeOperation = 'source-in';
                tempCtx.fillStyle = targetCtx.fillStyle;
                tempCtx.fillRect(0, 0, tempSize, tempSize);
                
                // Draw the colored stamp to target
                targetCtx.drawImage(tempCanvas, drawX - stampOffset, drawY - stampOffset);
              }
              
              canvasPool.release(tempCanvas);
            }
          } else if (useFastRender && !antiAliasing) {
            // Use pre-rendered pixel circle stamp for consistency
            const stampCanvas = getPixelCircleStamp(Math.max(1, roundedSize));
            const stampSize = stampCanvas.width;
            const offsetX = Math.round(drawX - stampSize / 2);
            const offsetY = Math.round(drawY - stampSize / 2);
            
            // Fast pixel-perfect circle using cached stamp
            const tempCanvas = canvasPool.acquire(stampSize, stampSize);
            const tempCtx = tempCanvas.getContext('2d');
            if (tempCtx) {
              tempCtx.clearRect(0, 0, stampSize, stampSize);
              tempCtx.drawImage(stampCanvas, 0, 0);
              tempCtx.globalCompositeOperation = 'source-in';
              tempCtx.fillStyle = targetCtx.fillStyle;
              tempCtx.fillRect(0, 0, stampSize, stampSize);
              targetCtx.drawImage(tempCanvas, offsetX, offsetY);
            }
            canvasPool.release(tempCanvas);
          } else {
            // Fallback for complex cases (patterns, very small sizes)
            targetCtx.beginPath();
            targetCtx.arc(drawX, drawY, halfSize, 0, Math.PI * 2);
            targetCtx.fill();
          }
          break;
        }
          
        case BrushShape.PIXEL_ROUND: {
          // Get the colorless pre-rendered stamp canvas
          const stampCanvas = getPixelCircleStamp(Math.max(1, Math.round(size)));
          const stampSize = stampCanvas.width;

          // Acquire a canvas from the pool. It will be reused across calls.
          const pixelTempCanvas = canvasPool.acquire(stampSize, stampSize);
          const pixelTempCtx = pixelTempCanvas.getContext('2d', { colorSpace: 'srgb' });

          if (!pixelTempCtx) {
            canvasPool.release(pixelTempCanvas);
            break;
          }

          try {
            // Use the potentially clamped coordinates (drawX/drawY are already adjusted)
            const offsetX = Math.round(drawX - stampSize / 2);
            const offsetY = Math.round(drawY - stampSize / 2);

            // Clear previous content from the pooled canvas
            pixelTempCtx.clearRect(0, 0, stampSize, stampSize);
            
            // Draw the white stamp to temp canvas
            pixelTempCtx.drawImage(stampCanvas, 0, 0);
            
            // Apply color using source-in (only affects existing pixels)
            pixelTempCtx.globalCompositeOperation = 'source-in';
            pixelTempCtx.fillStyle = targetCtx.fillStyle;
            pixelTempCtx.fillRect(0, 0, stampSize, stampSize);
            
            // Draw the colored stamp to the target canvas
            targetCtx.drawImage(pixelTempCanvas, offsetX, offsetY);
          } finally {
            // IMPORTANT: Release the canvas back to the pool for reuse
            canvasPool.release(pixelTempCanvas);
          }
          break;
        }
          
        case BrushShape.TRIANGLE:
          targetCtx.beginPath();
          if (antiAliasing) {
            targetCtx.moveTo(drawX, drawY - halfSize);
            targetCtx.lineTo(drawX - halfSize, drawY + halfSize);
            targetCtx.lineTo(drawX + halfSize, drawY + halfSize);
          } else {
            // Pixel-perfect triangle
            const height = Math.floor(size * 0.866); // sqrt(3)/2
            
            // Draw filled triangle pixel by pixel
            for (let row = 0; row < height; row++) {
              const width = Math.floor((row + 1) * size / height);
              const startX = Math.round(drawX - Math.floor(width / 2));
              const startY = Math.round(drawY - Math.floor(height / 2));
              for (let col = 0; col < width; col++) {
                targetCtx.fillRect(startX + col, startY + row, 1, 1);
              }
            }
          }
          if (antiAliasing) {
            targetCtx.closePath();
            targetCtx.fill();
          }
          break;
      }
    }

    targetCtx.restore();
    
    // Restore the composite operation after restore() cleared it
    targetCtx.globalCompositeOperation = currentCompositeOp;

    // Apply risograph effect per-stamp for real-time feedback
    if (risographIntensity > 0 && !pattern) {
        // Get cached pattern using improved caching
        const risoPattern = getRisographPattern(ctx);
        
        if (risoPattern) {
            // Check if we need to recalculate cached values
            const isPixelBrush = shape === BrushShape.PIXEL_ROUND || (shape === BrushShape.SQUARE && !antiAliasing);
            
            if (cachedRisoIntensity !== risographIntensity || cachedRisoIsPixel !== isPixelBrush) {
                cachedRisoIntensity = risographIntensity;
                cachedRisoIsPixel = isPixelBrush;
                cachedRisoAlpha = isPixelBrush 
                    ? (risographIntensity / 100) * 0.6
                    : (risographIntensity / 100) * 0.35;
            }
            
            // Store original values (much faster than save/restore)
            const originalAlpha = ctx.globalAlpha;
            const originalComposite = ctx.globalCompositeOperation;
            const needsSmoothingRestore = isPixelBrush && ctx.imageSmoothingEnabled;
            
            // Apply riso without clipping (much faster)
            if (needsSmoothingRestore) {
                ctx.imageSmoothingEnabled = false;
            }
            
            ctx.globalCompositeOperation = 'multiply';
            ctx.globalAlpha = cachedRisoAlpha;
            ctx.fillStyle = risoPattern;
            
            // Draw slightly larger to cover the shape
            const risoSize = size * 1.1;
            ctx.fillRect(drawX - risoSize/2, drawY - risoSize/2, risoSize, risoSize);
            
            // Restore only what we changed (faster than ctx.restore)
            ctx.globalAlpha = originalAlpha;
            ctx.globalCompositeOperation = originalComposite;
            if (needsSmoothingRestore) {
                ctx.imageSmoothingEnabled = true;
            }
        }
    }
    // Note: We don't need ctx.restore() here because:
    // 1. For non-riso path, targetCtx === ctx and we already did targetCtx.restore()
    // 2. For riso path, we're working with a different context and don't need to restore ctx
  }, [getPixelCircleStamp]);
  
  const calculateSizeModification = useCallback((
    component: BrushComponent,
    input: StrokeInput,
    baseSize: number
  ): number => {
    const params = component.parameters;
    
    // Check if this is the ink brush (high pressure influence)
    const pressureInfluence = typeof params.pressureInfluence === 'number' ? params.pressureInfluence : 0;
    const isInkBrush = pressureInfluence >= 100;
    
    if (isInkBrush) {
      // For ink brush: use velocity-based sizing with ink blob effects
      
      // Get smoothed velocity for more natural transitions
      const smoothedVelocity = calculateSmoothedVelocity(input.velocity);
      
      // Check stroke state for blob effects
      const currentTime = Date.now();
      const timeSinceStart = currentTime - strokeStartTimeRef.current;
      
      // Detect stroke start (first few milliseconds)
      if (strokeStateRef.current === 'idle') {
        strokeStateRef.current = 'starting';
        strokeStartTimeRef.current = currentTime;
      }
      
      // Calculate base size from velocity
      const maxVelocity = 20; // pixels per frame - VERY low so even slight movement triggers thinning
      const normalizedVelocity = Math.min(smoothedVelocity / maxVelocity, 1.0);
      
      // Apply an aggressive exponential curve to make thinning happen VERY early
      // This makes the transition from thick to thin happen almost immediately
      const curvedVelocity = Math.pow(normalizedVelocity, 0.15); // Very aggressive curve - even tiny movement = thin
      
      // More dramatic velocity effect
      // Slow drawing (velocity near 0): thick strokes (up to 2x size)
      // Fast drawing (high velocity): VERY thin strokes (down to 0.1x size)
      const minMultiplier = 0.1;  // Fast = 10% of base size (very thin!)
      const maxMultiplier = 2.0;  // Slow = 200% of base size
      
      // Invert velocity: slow = thick, fast = thin (using curved velocity)
      let sizeMultiplier = maxMultiplier - (curvedVelocity * (maxMultiplier - minMultiplier));
      
      // Add ink blob at stroke start (first 150ms)
      if (strokeStateRef.current === 'starting' && timeSinceStart < 150) {
        // Start with a blob that quickly reduces
        const blobFactor = 1.0 - (timeSinceStart / 150); // 1.0 to 0.0 over 150ms
        sizeMultiplier += blobFactor * 1.0; // Add up to 100% extra size for initial blob
        
        if (timeSinceStart >= 150) {
          strokeStateRef.current = 'drawing';
        }
      }
      
      // When completely stopped, use similar blob size
      if (strokeStateRef.current === 'drawing' && smoothedVelocity < 2) {
        // When stopped or nearly stopped, add blob effect
        sizeMultiplier = 3.0; // Consistent blob size when stopped
      }
      
      // Add more randomness for natural ink feel
      const jitter = (Math.random() - 0.5) * 0.4; // ±20% random variation for sketchy effect
      sizeMultiplier += jitter;
      
      const modifiedSize = baseSize * sizeMultiplier;
      
      // Apply min/max constraints
      const minSize = typeof params.minSize === 'number' ? params.minSize : 1;
      const maxSize = typeof params.maxSize === 'number' ? params.maxSize : 1000;
      return Math.max(minSize, Math.min(maxSize, modifiedSize));
    } else {
      // Regular pressure-based sizing for other brushes
      const pressure = input.pressure || 0.5;
      
      // Apply pressure influence
      const pressureEffect = (pressure - 0.5) * pressureInfluence;
      const modifiedSize = baseSize * (1 + pressureEffect);
      
      // Apply min/max constraints from component
      const minSize = typeof params.minSize === 'number' ? params.minSize : 1;
      const maxSize = typeof params.maxSize === 'number' ? params.maxSize : 1000;
      return Math.max(minSize, Math.min(maxSize, modifiedSize));
    }
  }, [calculateSmoothedVelocity]);
  
  const calculateOpacityModification = useCallback((
    component: BrushComponent,
    input: StrokeInput,
    baseOpacity: number
  ): number => {
    const params = component.parameters;
    const pressure = input.pressure || 0.5;
    
    // Apply pressure influence to opacity
    const pressureInfluence = typeof params.pressureInfluence === 'number' ? params.pressureInfluence : 0;
    const pressureEffect = (pressure - 0.5) * pressureInfluence;
    const modifiedOpacity = baseOpacity * (1 + pressureEffect);
    
    return Math.max(0, Math.min(1, modifiedOpacity));
  }, []);
  
  const calculatePressureEffects = useCallback((
    component: BrushComponent,
    input: StrokeInput,
    settings: RenderSettings
  ): RenderSettings => {
    const params = component.parameters;
    const pressure = input.pressure || 0.5;
    
    const newSettings = { ...settings };
    
    // Apply pressure to size if enabled
    const sizeInfluence = typeof params.sizeInfluence === 'number' ? params.sizeInfluence : 0;
    if (sizeInfluence) {
      const sizeEffect = (pressure - 0.5) * sizeInfluence;
      newSettings.size = Math.max(1, settings.size * (1 + sizeEffect));
    }
    
    // Apply pressure to opacity if enabled
    const opacityInfluence = typeof params.opacityInfluence === 'number' ? params.opacityInfluence : 0;
    if (opacityInfluence) {
      const opacityEffect = (pressure - 0.5) * opacityInfluence;
      newSettings.opacity = Math.max(0, Math.min(1, settings.opacity * (1 + opacityEffect)));
    }
    
    return newSettings;
  }, []);
  
  const executeComponent = useCallback((
    component: BrushComponent,
    input: StrokeInput,
    currentSettings: RenderSettings
  ): RenderSettings => {
    switch (component.type) {
      case ComponentType.SIZE_MODIFIER:
        return {
          ...currentSettings,
          size: calculateSizeModification(component, input, currentSettings.size)
        };
        
      case ComponentType.OPACITY_MODIFIER:
        return {
          ...currentSettings,
          opacity: calculateOpacityModification(component, input, currentSettings.opacity)
        };
        
      case ComponentType.PRESSURE_HANDLER:
        return calculatePressureEffects(component, input, currentSettings);
        
      case ComponentType.ANTI_ALIASING:
        return {
          ...currentSettings,
          antiAliasing: component.parameters.mode === 'antialiased',
          pixelAlignment: component.parameters.mode === 'pixel'
        };
        
      case ComponentType.SHAPE_RENDERER:
        return {
          ...currentSettings,
          shape: component.parameters.shape as BrushShape
        };
        
      case ComponentType.PATTERN_RENDERER:
        const pattern = component.parameters.pattern as ImageData;
        const centerAlignment = component.parameters.centerAlignment as boolean;
        return {
          ...currentSettings,
          pattern,
          centerAlignment
        };
        
      case ComponentType.ROTATION_TRANSFORM:
        // Apply rotation based on movement direction if enabled
        const { brushSettings } = tools;
        if (!brushSettings.rotationEnabled || input.direction === undefined) {
          return currentSettings;
        }
        return {
          ...currentSettings,
          rotation: input.direction
        };
        
      default:
        return currentSettings;
    }
  }, [calculateSizeModification, calculateOpacityModification, calculatePressureEffects]);
  
  const executeComponents = useCallback((
    components: BrushComponent[], 
    input: StrokeInput
  ): RenderSettings => {
    const { brushSettings, eraserSettings, currentTool } = tools;
    const activeSettings = currentTool === 'eraser' ? eraserSettings : brushSettings;
    
    // Check if this is the ink brush (will use velocity instead of pressure)
    // Note: This check was removed due to selectedBrushPreset not existing on BrushSettings
    const isInkBrush = false;
    
    // Apply pressure-based size modification if enabled (but not for ink brush)
    let finalSize = activeSettings.size;
    if (activeSettings.pressureEnabled && !isInkBrush) {
      // Map pressure (0.0-1.0) to size range based on maxPressure setting
      // maxPressure directly sets the max pixel size at full pressure
      const minSizePx = activeSettings.minPressure || 1;
      const maxSizePx = activeSettings.maxPressure || activeSettings.size;
      
      // Add pressure deadzone for better low-pressure control
      const pressureThreshold = 0.2;
      const adjustedPressure = input.pressure < pressureThreshold ? 0 : 
        (input.pressure - pressureThreshold) / (1.0 - pressureThreshold);
      
      finalSize = minSizePx + (adjustedPressure * (maxSizePx - minSizePx));
      
      // Quantize brush size when using grid snap + pressure to prevent multiple stamps per grid cell
      if (shouldApplyGridSnap(activeSettings)) {
        finalSize = quantizeBrushSize(finalSize, 0.5);
      }
    }
    
    // Start with base settings (don't override pixelAlignment - let components control it)
    let settings: RenderSettings = {
      size: finalSize,
      opacity: activeSettings.opacity,
      color: activeSettings.color,
      antiAliasing: activeSettings.antialiasing,
      pixelAlignment: !activeSettings.antialiasing, // Default fallback
      spacing: activeSettings.spacing,
      rotation: activeSettings.rotationEnabled && input.direction !== undefined ? input.direction : 0,
      shape: activeSettings.brushShape || BrushShape.ROUND, // Use actual brush shape from settings
      risographIntensity: activeSettings.risographIntensity || 0,
      blendMode: activeSettings.blendMode || 'source-over' // Never use destination-out here
    };    
    
    // Add pattern if using a brush tip from mini canvas
    if (activeSettings.currentBrushTip && 
        activeSettings.currentBrushTip.brushId === activeSettings.selectedCustomBrush) {
      settings.pattern = activeSettings.currentBrushTip.imageData;
    }
    
    // Sort components by priority
    const sortedComponents = components
      .filter(comp => comp.enabled)
      .sort((a, b) => a.priority - b.priority);
    
    // Execute each component in order
    for (const component of sortedComponents) {
      const newSettings = executeComponent(component, input, settings);
      settings = newSettings;
    }
    
    return settings;
  }, [tools, executeComponent]);
  
  
  const resetPixelQueue = useCallback(() => {
    pixelQueueRef.current = {
      lastDrawnX: 0,
      lastDrawnY: 0,
      waitingPixelX: 0,
      waitingPixelY: 0,
      initialized: false,
      spacingCounter: 0,
      // Reset distance-based spacing state
      accumulatedDistance: 0,
      lastStrokePosition: { x: 0, y: 0 },
      // Reset dashed brush state
      dashStampCounter: 0,
      // Clear grid position tracking
      stampedGridPositions: new Set<string>()
    };
    // Reset direction history for rotation
    directionHistoryRef.current = [];
    lastDirectionRef.current = 0;
    
    // Reset velocity and stroke state for ink brush
    velocityHistoryRef.current = [];
    strokeStateRef.current = 'idle';
    strokeStartTimeRef.current = 0;
    
    // Mark stroke as inactive and trigger memory cleanup
    brushCache.markStrokeInactive();
    memoryManager.runCleanup();
    
    // Clear brush stamp cache if it's getting too large (keep memory usage low)
    if (brushStampCacheRef.current.size > 50) {
      brushStampCacheRef.current.clear();
    }
    
    // Reset riso throttling state for new stroke
    // Removed - no longer tracking continuous strokes for riso throttling
  }, []);

  // Helper function to determine if we should draw the current stamp (cursor-speed independent)
  const shouldDrawStamp = useCallback((brushSettings: BrushSettings, queue: PixelQueue, actualSize?: number, isGridSnapping: boolean = false): boolean => {
    // Defensive checks for brush settings
    if (!brushSettings || typeof brushSettings !== 'object') {
      return true;
    }
    
    const dashedEnabled = brushSettings.dashedEnabled;
    const dashLength = brushSettings.dashLength;
    const dashGap = brushSettings.dashGap;
    
    // When grid snapping is enabled, prioritize grid positioning over dash patterns
    if (isGridSnapping) {
      // For grid snapping, we always draw (grid position tracking handles duplicates)
      return true;
    }
    
    if (!dashedEnabled) {
      return true; // Always draw when dashing is disabled
    }
    
    // More defensive checks
    const baseDashLen = Number(dashLength) || 3;
    const baseDashGapLen = Number(dashGap) || 2;
    
    if (baseDashLen <= 0 || baseDashGapLen <= 0) {
      return true; // Invalid settings, default to drawing
    }
    
    // Scale dash length and gap with brush size for consistent visual proportions
    // Use actual render size (including pressure effects) for accurate dash scaling
    const brushSize = Number(actualSize || brushSettings.size) || 4;
    
    let dashLen: number;
    let dashGapLen: number;
    
    if (brushSize <= 2) {
      // For very small brushes (1-2px), use original values to ensure visible dashing
      dashLen = baseDashLen;
      dashGapLen = baseDashGapLen;
    } else {
      // For larger brushes, scale proportionally
      const sizeScaleFactor = brushSize / 4; // No minimum to allow proper scaling
      dashLen = Math.max(1, Math.round(baseDashLen * sizeScaleFactor));
      dashGapLen = Math.max(1, Math.round(baseDashGapLen * sizeScaleFactor));
    }
    
    // Calculate total cycle length in stamps
    const totalCycleLength = dashLen + dashGapLen;
    
    // Get current position in dash cycle
    const cyclePosition = queue.dashStampCounter % totalCycleLength;
    
    // Determine if we're in dash or gap segment
    const isInDashSegment = cyclePosition < dashLen;
    
    // Debug logging (disabled)
    
    // Advance counter for next stamp (happens regardless of whether we draw)
    queue.dashStampCounter++;
    
    return isInDashSegment;
  }, []);


  const drawPixelPerfectLine = useCallback((
    ctx: CanvasRenderingContext2D,
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    settings: RenderSettings
  ) => {
    // Bresenham's line algorithm for pixel-perfect lines with distance-based spacing
    // Note: Color jitter will be applied per stamp, not per line
    
    const dx = Math.abs(x1 - x0);
    const dy = Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx - dy;
    
    let x = x0;
    let y = y0;
    let lastX = x0;
    let lastY = y0;
    
    // Use queue's accumulated distance for consistent spacing
    const queue = pixelQueueRef.current;
    
    while (true) {
      // Calculate distance from last position
      const distance = Math.sqrt(Math.pow(x - lastX, 2) + Math.pow(y - lastY, 2));
      queue.accumulatedDistance += distance;
      
      // Draw shape at position only if accumulated distance exceeds spacing
      if (queue.accumulatedDistance >= settings.spacing) {
        // Check if we should draw this stamp (cursor-speed independent)
        const brushSettings = tools.brushSettings;
        if (shouldDrawStamp(brushSettings, queue, settings.size)) {
          // --- OPTIMIZATION: Use throttled jitter ---
          const jitteredColor = applyThrottledColorJitter(settings.color, brushSettings.colorJitter || 0);
          ctx.fillStyle = jitteredColor;
          drawShape(ctx, x, y, settings.size, settings.shape, false, settings.rotation, settings.risographIntensity, settings.pattern, settings.centerAlignment);
        }
        queue.accumulatedDistance -= settings.spacing;
      }
      
      if (x === x1 && y === y1) break;
      
      lastX = x;
      lastY = y;
      
      const e2 = 2 * err;
      if (e2 > -dy) {
        err -= dy;
        x += sx;
      }
      if (e2 < dx) {
        err += dx;
        y += sy;
      }
    }
  }, [drawShape, tools]);

  const perfectPixels = useCallback((
    ctx: CanvasRenderingContext2D,
    currentX: number,
    currentY: number,
    settings: RenderSettings
  ) => {
    const queue = pixelQueueRef.current;
    const roundedX = Math.round(currentX);
    const roundedY = Math.round(currentY);
    
    // Note: Color jitter will be applied per stamp, not once per function call
    
    if (!queue.initialized) {
      // First pixel - initialize queue with distance-based state
      queue.lastDrawnX = roundedX;
      queue.lastDrawnY = roundedY;
      queue.waitingPixelX = roundedX;
      queue.waitingPixelY = roundedY;
      queue.initialized = true;
      queue.spacingCounter = 0;
      queue.lastStrokePosition = { x: roundedX, y: roundedY };
      queue.accumulatedDistance = 0;
      
      // Draw the first shape (check dash state)
      if (shouldDrawStamp(tools.brushSettings, queue, settings.size, false)) {
        // --- OPTIMIZATION: Use throttled jitter ---
        const jitteredColor = applyThrottledColorJitter(settings.color, tools.brushSettings.colorJitter || 0);
        ctx.fillStyle = jitteredColor;
        drawShape(ctx, roundedX, roundedY, settings.size, settings.shape, false, settings.rotation, settings.risographIntensity, settings.pattern, settings.centerAlignment);
      }
      return;
    }
    
    // Calculate distance from last stroke position to current position
    const distance = Math.sqrt(
      Math.pow(roundedX - queue.lastStrokePosition.x, 2) + 
      Math.pow(roundedY - queue.lastStrokePosition.y, 2)
    );
    queue.accumulatedDistance += distance;
    
    // If current pixel not neighbor to lastDrawn, draw waiting pixel
    if (Math.abs(roundedX - queue.lastDrawnX) > 1 || Math.abs(roundedY - queue.lastDrawnY) > 1) {
      // Draw the waiting shape only if accumulated distance exceeds spacing
      if (queue.accumulatedDistance >= settings.spacing) {
        // Check if we should draw this stamp (cursor-speed independent)
        if (shouldDrawStamp(tools.brushSettings, queue, settings.size, false)) {
          // --- OPTIMIZATION: Use throttled jitter ---
          const jitteredColor = applyThrottledColorJitter(settings.color, tools.brushSettings.colorJitter || 0);
          ctx.fillStyle = jitteredColor;
          drawShape(ctx, queue.waitingPixelX, queue.waitingPixelY, settings.size, settings.shape, false, settings.rotation, settings.risographIntensity, settings.pattern, settings.centerAlignment);
        }
        queue.accumulatedDistance -= settings.spacing;
        queue.lastStrokePosition = { x: queue.waitingPixelX, y: queue.waitingPixelY };
      }
      
      // Update queue
      queue.lastDrawnX = queue.waitingPixelX;
      queue.lastDrawnY = queue.waitingPixelY;
      queue.waitingPixelX = roundedX;
      queue.waitingPixelY = roundedY;
    } else {
      // Update waiting pixel to current position
      queue.waitingPixelX = roundedX;
      queue.waitingPixelY = roundedY;
    }
    
    // Update last stroke position for distance calculation
    queue.lastStrokePosition = { x: roundedX, y: roundedY };
  }, [drawShape]);

  // Note: Previously used a reusable canvas, but this caused race conditions.
  // Now we create a new canvas for each stamp to ensure isolation and correctness.

  // Custom brush drawing functions
  const drawCustomBrushStamp = useCallback((
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    customBrush: CustomBrush,
    scale: number = 1,
    rotation: number = 0,
    color?: string,
    isColorizable?: boolean,
    isPressureSensitive?: boolean
  ) => {
    // Canvas clipping (ctx.clip) automatically handles bounds restriction
    // No manual bounds checking needed - canvas won't draw outside clipped region
    
    performanceMonitor.measureStampTime(() => {
      const colorJitterAmount = tools.brushSettings.colorJitter || 0;

      // Jitter is disabled when tinting the brush with a solid color.
      if (colorJitterAmount > 0 && !isColorizable) {
        // --- OPTIMIZED JITTER PATH ---

        // 1. Get the base brush canvas (fast, cached, no CPU/GPU transfer).
        const baseBrushCanvas = scaledBrushCache.getBaseBrushCanvas(customBrush);
        
        // 2. Calculate randomized filter values.
        let jitteredHueShift = tools.brushSettings.hueShift || 0;
        let jitteredSaturationAdjust = tools.brushSettings.saturationAdjust || 100;
        
        const normalizedJitter = colorJitterAmount / 100;
        const jitterFactor = normalizedJitter * normalizedJitter;
        jitteredHueShift += (Math.random() - 0.5) * jitterFactor * 360;
        jitteredSaturationAdjust = Math.max(0, Math.min(200, jitteredSaturationAdjust + (Math.random() - 0.5) * jitterFactor * 100));

        // 3. Prepare a temporary canvas from the pool for this stamp.
        const scaledWidth = Math.ceil(customBrush.width * scale);
        const scaledHeight = Math.ceil(customBrush.height * scale);
        const stampCanvas = canvasPool.acquire(scaledWidth, scaledHeight);
        const stampCtx = stampCanvas.getContext('2d', { colorSpace: 'srgb' });

        if (!stampCtx) {
          canvasPool.release(stampCanvas);
          return;
        }

        try {
          // 4. Apply the random filter to the context.
          stampCtx.filter = `hue-rotate(${jitteredHueShift}deg) saturate(${jitteredSaturationAdjust}%)`;

          // 5. Apply rotation if needed.
          if (rotation !== 0) {
            stampCtx.translate(scaledWidth / 2, scaledHeight / 2);
            stampCtx.rotate(rotation);
            stampCtx.translate(-scaledWidth / 2, -scaledHeight / 2);
          }
          
          // 6. Draw the base brush onto the stamp canvas. The GPU applies the filter here.
          stampCtx.imageSmoothingEnabled = false;
          stampCtx.drawImage(baseBrushCanvas, 0, 0, scaledWidth, scaledHeight);
          
          // 7. Draw the final, jittered stamp to the main canvas.
          const centerX = x - scaledWidth / 2;
          const centerY = y - scaledHeight / 2;
          
          ctx.imageSmoothingEnabled = false;
          ctx.drawImage(stampCanvas, centerX, centerY);
          
          // Removed - risograph effect is now handled by drawShape function
        } finally {
          canvasPool.release(stampCanvas);
        }

      } else {
        // --- NON-JITTER PATH (uses the existing fast cache) ---
        const scaledCanvas = scaledBrushCache.createScaledBrush(
          customBrush, scale, rotation, color, isColorizable, isPressureSensitive,
          tools.brushSettings.hueShift || 0, tools.brushSettings.saturationAdjust || 100
        );
        
        const centerX = x - scaledCanvas.width / 2;
        const centerY = y - scaledCanvas.height / 2;
        
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(scaledCanvas, centerX, centerY);
        
        // Removed - risograph effect is now handled by drawShape function
      }
    });
  }, [
    tools.brushSettings.colorJitter, 
    tools.brushSettings.hueShift, 
    tools.brushSettings.saturationAdjust,
    tools.brushSettings.pressureEnabled,
    tools.brushSettings.risographIntensity
  ]);

  const drawCustomBrushLine = useCallback((ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number, customBrush: CustomBrush, scale: number = 1, rotation: number = 0, color?: string, isColorizable?: boolean) => {
    const distance = Math.sqrt(Math.pow(x2 - x1, 2) + Math.pow(y2 - y1, 2));
    const spacing = Math.max(1, Math.min(customBrush.width, customBrush.height) * scale * 0.5);
    const steps = Math.max(1, Math.ceil(distance / spacing));
    
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const x = x1 + (x2 - x1) * t;
      const y = y1 + (y2 - y1) * t;
      drawCustomBrushStamp(ctx, x, y, customBrush, scale, rotation, color, isColorizable, tools.brushSettings.pressureEnabled);
    }
  }, [drawCustomBrushStamp]);

  // Note: Removed clampToEditingBounds function - users should be able to draw 
  // on the entire canvas even when brush editor modal is open

  const renderBrushStroke = useCallback((
    ctx: CanvasRenderingContext2D,
    from: { x: number; y: number },
    to: { x: number; y: number },
    cursor: { pressure: number }, // Accept cursor data directly
    components: BrushComponent[] = activeBrushComponents,
    clipBounds?: { x: number; y: number; width: number; height: number } | null
  ) => {
    // Mark stroke as active for cache retention
    brushCache.markStrokeActive();

    // --- START PROPOSED FIX ---
    const queue = pixelQueueRef.current;
    // The distance between the start of this segment (`from`) and the engine's last known drawing position.
    const jumpDistance = Math.hypot(
      from.x - (queue.lastStrokePosition.x || from.x),
      from.y - (queue.lastStrokePosition.y || from.y)
    );

    // A "jump" occurs if this is the first point of a stroke OR if the start
    // of this new line segment is not contiguous with the end of the last one.
    // This happens when drawing off-canvas and re-entering.
    // We reset the engine's internal position tracker to prevent it from drawing
    // a line connecting the old exit point to the new entry point.
    if (!queue.initialized || jumpDistance > 2.0) {
      queue.lastStrokePosition = { x: from.x, y: from.y };
      queue.accumulatedDistance = 0;
      queue.initialized = true;
    }
    // --- END PROPOSED FIX ---
    
    // Performance monitoring for brush strokes
    const strokeStartTime = process.env.NODE_ENV === 'development' ? performance.now() : 0;
    
    // Allow drawing anywhere on canvas - no position clamping needed
    
    // Use passed-in pressure
    const cursorPressure = cursor.pressure;
    
    const isCustomBrush = tools.brushSettings.brushShape === BrushShape.CUSTOM;
    
    // Look for custom brush early to include dimensions in cache key
    let customBrush = null;
    
    // Create current brush ID
    const currentBrushId = isCustomBrush && tools.brushSettings.selectedCustomBrush 
      ? tools.brushSettings.selectedCustomBrush // Use raw format (matches BrushControls/MiniCanvas)
      : `standard_${tools.brushSettings.brushShape}`;
    
    
    // Check if there's a currentBrushTip for this specific brush
    // CRITICAL FIX: For custom brushes, always use currentBrushTip if available, regardless of ID
    // This ensures custom brushes loaded from project work correctly
    if (isCustomBrush && tools.brushSettings.currentBrushTip) {
      // Create a temporary custom brush from the current brush tip
      const imageData = tools.brushSettings.currentBrushTip.imageData;
      
      // Use the actual dimensions from currentBrushTip if available, otherwise fall back to imageData dimensions
      const actualWidth = tools.brushSettings.currentBrushTip.width || imageData.width;
      const actualHeight = tools.brushSettings.currentBrushTip.height || imageData.height;
      
      customBrush = {
        id: 'current-brush-tip',
        name: 'Current Brush Tip',
        imageData: imageData,
        thumbnail: '',
        width: actualWidth,
        height: actualHeight,
        createdAt: Date.now()
      };
    } else if (tools.brushSettings.currentBrushTip && tools.brushSettings.currentBrushTip.brushId === currentBrushId) {
      // For non-custom brushes with currentBrushTip (shouldn't happen normally)
      const imageData = tools.brushSettings.currentBrushTip.imageData;
      const actualWidth = tools.brushSettings.currentBrushTip.width || imageData.width;
      const actualHeight = tools.brushSettings.currentBrushTip.height || imageData.height;
      
      customBrush = {
        id: 'current-brush-tip',
        name: 'Current Brush Tip',
        imageData: imageData,
        thumbnail: '',
        width: actualWidth,
        height: actualHeight,
        createdAt: Date.now()
      };
    } else if (isCustomBrush && tools.brushSettings.selectedCustomBrush) {
      
      // Check temporary custom brush first
      if (temporaryCustomBrush && temporaryCustomBrush.id === tools.brushSettings.selectedCustomBrush) {
        customBrush = temporaryCustomBrush;
      } else if (project) {
        // Check project custom brushes
        customBrush = project.customBrushes.find(b => b.id === tools.brushSettings.selectedCustomBrush);
      }
    }
    
    // If not found in project custom brushes, check brush presets for custom brush presets
    if (!customBrush && isCustomBrush && tools.brushSettings.selectedCustomBrush) {
      // CRITICAL BUG FIX: Handle ID mismatch between selectedCustomBrush and brushPresets
      // selectedCustomBrush contains the original ID, but brushPresets may have "custom_" prefix
      const customBrushPreset = brushPresets.find(p => 
        (p.id === tools.brushSettings.selectedCustomBrush || 
         p.id === `custom_${tools.brushSettings.selectedCustomBrush}`) &&
        p.isCustomBrush && p.customBrushData
      );
      if (customBrushPreset?.customBrushData) {
        // Convert preset to custom brush format
        customBrush = {
          id: customBrushPreset.id,
          name: customBrushPreset.name,
          imageData: customBrushPreset.customBrushData.imageData,
          thumbnail: customBrushPreset.thumbnail,
          width: customBrushPreset.customBrushData.width,
          height: customBrushPreset.customBrushData.height,
          createdAt: customBrushPreset.createdAt.getTime()
        };
      }
    }
    
    
    
    // Check cache for expensive size/pressure calculations
    const cacheKey = brushCache.getCacheKey(
      tools.brushSettings.brushShape || BrushShape.ROUND,
      tools.brushSettings.size,
      cursorPressure,
      0, // rotation handled separately
      undefined, // grid spacing
      isCustomBrush ? (tools.brushSettings.selectedCustomBrush || undefined) : undefined,
      tools.brushSettings.pressureEnabled,
      tools.brushSettings.minPressure,
      tools.brushSettings.maxPressure,
      customBrush?.width,
      customBrush?.height
    );
    
    let actualBrushSize;
    const cached = brushCache.get(cacheKey);
    
    if (cached) {
      // Use cached calculations
      actualBrushSize = cached.actualSize;
    } else {
      // For regular brushes, tools.brushSettings.size is already in pixels (1-500 from UI)
      // No need to scale by base size
      const baseBrushSize = tools.brushSettings.size;
      
      // Use optimized pressure calculation
      const pressureResult = pressureOptimizer.calculatePressureSize(baseBrushSize, {
        pressureEnabled: tools.brushSettings.pressureEnabled,
        minPressure: tools.brushSettings.minPressure,
        maxPressure: tools.brushSettings.maxPressure,
        rawPressure: cursorPressure
      });
      
      actualBrushSize = pressureResult.adjustedSize;
      
      // Debug: Log the calculated brush size
      if (tools.brushSettings.pressureEnabled) {
        console.log('[Brush Engine Size Debug]', {
          baseBrushSize,
          actualBrushSize,
          settingsSize: tools.brushSettings.size,
          pressureEnabled: tools.brushSettings.pressureEnabled,
          minPressure: tools.brushSettings.minPressure,
          maxPressure: tools.brushSettings.maxPressure,
          cursorPressure
        });
      }
      
      // Cache the calculated size
      brushCache.set(cacheKey, {
        scaleFactor: 1, // Will be updated for custom brushes
        actualSize: actualBrushSize,
        rotation: 0
      });
    }
    
    
    // Now recalculate actualBrushSize with the correct customBrush information
    if (tools.brushSettings.currentBrushTip && tools.brushSettings.currentBrushTip.brushId === currentBrushId && customBrush) {
      // For currentBrushTip, use the max dimension of the brush tip as base size
      const brushTipBaseSize = Math.max(customBrush.width, customBrush.height);
      // Custom brushes use percentage scaling
      const baseBrushSize = (tools.brushSettings.size / 100) * brushTipBaseSize;
      
      // For currentBrushTip, if maxPressure is not set, use the calculated brush size
      // This ensures 100% pressure shows the brush at its intended size
      const effectiveMaxPressure = tools.brushSettings.maxPressure || baseBrushSize;
      
      // Use optimized pressure calculation
      const pressureResult = pressureOptimizer.calculatePressureSize(baseBrushSize, {
        pressureEnabled: tools.brushSettings.pressureEnabled,
        minPressure: tools.brushSettings.minPressure,
        maxPressure: effectiveMaxPressure,
        rawPressure: cursorPressure
      });
      
      actualBrushSize = pressureResult.adjustedSize;
    } else if (isCustomBrush && customBrush) {
      // For custom brushes, calculate base size from the brush's actual dimensions
      const customBrushMaxDimension = Math.max(customBrush.width, customBrush.height);
      // Custom brushes use percentage scaling
      const baseBrushSize = (tools.brushSettings.size / 100) * customBrushMaxDimension;
      
      // For custom brushes, if maxPressure is not set, use the calculated brush size
      // This ensures 100% pressure shows the brush at its intended size
      const effectiveMaxPressure = tools.brushSettings.maxPressure || baseBrushSize;
      
      // Use optimized pressure calculation
      const pressureResult = pressureOptimizer.calculatePressureSize(baseBrushSize, {
        pressureEnabled: tools.brushSettings.pressureEnabled,
        minPressure: tools.brushSettings.minPressure,
        maxPressure: effectiveMaxPressure,
        rawPressure: cursorPressure
      });
      
      actualBrushSize = pressureResult.adjustedSize;
      
      
    }
    
    // Apply grid snapping if enabled using the actual brush size
    let snappedTo = { x: to.x, y: to.y };
    let snappedFrom = { x: from.x, y: from.y };
    const isGridSnapping = shouldApplyGridSnap(tools.brushSettings);
    let gridSize = 0;
    
    // Calculate smooth direction for rotation using snapped positions
    const direction = calculateSmoothDirection(snappedFrom, snappedTo);
    
    // --- START FIX 2 ---
    // Instead of creating a new object, update the properties of the reusable one.
    const input = strokeInputRef.current;
    input.position.x = snappedTo.x;
    input.position.y = snappedTo.y;
    input.pressure = cursorPressure;
    input.velocity = Math.sqrt(Math.pow(snappedTo.x - snappedFrom.x, 2) + Math.pow(snappedTo.y - snappedFrom.y, 2));
    input.timestamp = Date.now();
    input.direction = direction;
    // --- END FIX 2 ---
    
    let settings;
    try {
      settings = executeComponents(components, input);
    } catch {
      return; // Exit early to prevent further issues
    }
    
    // Override the size with our pressure-calculated actualBrushSize
    // This ensures the pressure calculation from pressureOptimizer is used
    const originalSize = settings.size;
    settings.size = actualBrushSize;
    
    // Debug: Log size override
    if (tools.brushSettings.pressureEnabled && originalSize !== actualBrushSize) {
      console.log('[Size Override Debug]', {
        originalSize,
        actualBrushSize,
        pressureEnabled: tools.brushSettings.pressureEnabled
      });
    }
    
    // Apply grid snapping after settings are calculated so we can use actual brush size
    if (isGridSnapping) {
      if (isCustomBrush && customBrush) {
        // For custom brushes, use rectangular grid based on brush dimensions with pressure-modified size
        // Check cache for grid dimensions calculation
        const gridCacheKey = brushCache.getCacheKey(
          tools.brushSettings.brushShape || BrushShape.CUSTOM,
          actualBrushSize,
          cursorPressure,
          0,
          undefined, // gridSpacing not available in BrushSettings
          customBrush.id,
          tools.brushSettings.pressureEnabled,
          undefined, // minPressure
          undefined, // maxPressure
          customBrush.width,
          customBrush.height
        );
        
        
        let gridDimensions;
        const gridCached = brushCache.get(gridCacheKey);
        
        if (gridCached && gridCached.gridDimensions) {
          gridDimensions = gridCached.gridDimensions;
        } else {
          
          gridDimensions = calculateGridDimensions(tools.brushSettings, customBrush, actualBrushSize);
          
          // Cache the grid dimensions
          brushCache.set(gridCacheKey, {
            scaleFactor: 1,
            actualSize: actualBrushSize,
            rotation: 0,
            gridDimensions
          });
        }
        
        gridSize = Math.max(gridDimensions.width, gridDimensions.height); // Keep for backward compatibility
        
        const snappedToPos = snapToRectangularGrid(to.x, to.y, gridDimensions.width, gridDimensions.height);
        const snappedFromPos = snapToRectangularGrid(from.x, from.y, gridDimensions.width, gridDimensions.height);
        snappedTo = { x: snappedToPos.x, y: snappedToPos.y };
        snappedFrom = { x: snappedFromPos.x, y: snappedFromPos.y };
      } else {
        // For regular brushes, use square grid with pressure-modified size
        gridSize = settings.size; // Use pressure-modified size directly
        
        const snappedToPos = snapToGrid(to.x, to.y, gridSize);
        const snappedFromPos = snapToGrid(from.x, from.y, gridSize);
        snappedTo = { x: snappedToPos.x, y: snappedToPos.y };
        snappedFrom = { x: snappedFromPos.x, y: snappedFromPos.y };
      }
    }
    
    ctx.save();
    
    // Apply clipping if specified (after save to preserve context)
    if (clipBounds) {
      ctx.beginPath();
      ctx.rect(clipBounds.x, clipBounds.y, clipBounds.width, clipBounds.height);
      ctx.clip();
      
      // ADDITIONAL FIX: Ensure clipping is strictly enforced for brush editing
      // Don't override the composite operation - it's already set correctly above
    }
    
    // Initialize distance tracking state if needed
    // (queue already declared at the top of the function)
    if (!queue.initialized) {
      queue.lastStrokePosition = { x: snappedFrom.x, y: snappedFrom.y };
      queue.accumulatedDistance = 0;
      queue.initialized = true;
    }
    
    // Apply rendering settings
    ctx.globalCompositeOperation = settings.blendMode || 'source-over';
    ctx.globalAlpha = settings.opacity;
    ctx.lineWidth = settings.size;
    ctx.lineCap = settings.pixelAlignment ? 'butt' : 'round';
    ctx.lineJoin = settings.pixelAlignment ? 'miter' : 'round';
    
    // Custom brush is already found above
    
    // Handle custom brush rendering with spacing support
    // Also use custom brush rendering if we have a currentBrushTip
    // BUT: Never use custom brush path for pixel round brushes - they need special handling
    
    if (customBrush && tools.brushSettings.brushShape !== BrushShape.PIXEL_ROUND) {
      // Determine if this brush should use swatch color or support jitter
      // Always respect the useSwatchColor setting for custom brushes
      const originalIsColorizable = tools.brushSettings.brushShape === BrushShape.CUSTOM 
        ? tools.brushSettings.useSwatchColor 
        : true;
      
      // For custom brushes: allow jitter even when useSwatchColor is false
      // But only apply color tint when useSwatchColor is explicitly enabled
      const shouldApplyColorTint = originalIsColorizable;
      const brushColor = shouldApplyColorTint ? settings.color : undefined;
      
      
      // Scale custom brush using pressure-modified actualBrushSize
      // Use optimized scale factor calculation
      const isCurrentBrushTip = tools.brushSettings.currentBrushTip && 
        tools.brushSettings.currentBrushTip.brushId === currentBrushId;
      const brushTipBaseSize = isCurrentBrushTip ? Math.max(customBrush.width, customBrush.height) : undefined;
      
      // Calculate scale factor using the brush's actual dimensions, not the fixed base size
      const customBrushMaxDimension = Math.max(customBrush.width, customBrush.height);
      
      // CRITICAL FIX: For custom brushes at 100% size, use scale factor of 1.0
      // The size=100 means "use at natural size", not "scale down"
      const scaleFactor = tools.brushSettings.size === 100 
        ? 1.0  // At 100%, no scaling - use natural size
        : pressureOptimizer.calculateScaleFactor(
            actualBrushSize,
            customBrushMaxDimension,
            !!isCurrentBrushTip,
            brushTipBaseSize
          );
      
      // For grid snapping, the scale factor should still preserve pressure effects
      // (actualBrushSize already includes pressure modifications)
      
      if (isGridSnapping) {
        // Grid snapping mode: draw at all grid positions between last and current position
        // Use cached grid dimensions calculation
        const gridCacheKey = brushCache.getCacheKey(
          tools.brushSettings.brushShape || BrushShape.CUSTOM,
          actualBrushSize,
          cursorPressure,
          0,
          undefined, // gridSpacing not available in BrushSettings
          customBrush.id,
          tools.brushSettings.pressureEnabled,
          undefined, // minPressure
          undefined, // maxPressure
          customBrush.width,
          customBrush.height
        );
        
        
        let gridDimensions;
        const gridCached = brushCache.get(gridCacheKey);
        
        if (gridCached && gridCached.gridDimensions) {
          gridDimensions = gridCached.gridDimensions;
        } else {
          
          gridDimensions = calculateGridDimensions(tools.brushSettings, customBrush, actualBrushSize);
          
          // Cache the grid dimensions
          brushCache.set(gridCacheKey, {
            scaleFactor,
            actualSize: actualBrushSize,
            rotation: 0,
            gridDimensions
          });
        }
        
        // Fill in grid positions between last and current position for fast movement
        const gridPositions = getRectangularGridPositionsBetween(
          queue.lastStrokePosition.x || snappedFrom.x, 
          queue.lastStrokePosition.y || snappedFrom.y, 
          snappedTo.x, 
          snappedTo.y, 
          gridDimensions.width,
          gridDimensions.height
        );
        
        // Draw at each grid position that hasn't been stamped
        for (const pos of gridPositions) {
          const posKey = `${pos.x},${pos.y}`;
          if (!queue.stampedGridPositions.has(posKey) && shouldDrawStamp(tools.brushSettings, queue, settings.size, isGridSnapping)) {
            drawCustomBrushStamp(ctx, pos.x, pos.y, customBrush, scaleFactor, settings.rotation, brushColor, shouldApplyColorTint, tools.brushSettings.pressureEnabled);
            queue.stampedGridPositions.add(posKey);
          }
        }
      } else {
        // Normal mode: Apply spacing system to custom brushes using snapped positions
        const distance = Math.sqrt(Math.pow(snappedTo.x - queue.lastStrokePosition.x, 2) + Math.pow(snappedTo.y - queue.lastStrokePosition.y, 2));
        queue.accumulatedDistance += distance;
        
        // Draw custom brush stamps along the path only when accumulated distance exceeds spacing
        while (queue.accumulatedDistance >= settings.spacing) {
          // Check if we should draw this stamp (cursor-speed independent)
          if (shouldDrawStamp(tools.brushSettings, queue, settings.size, false)) {
            // Calculate the position where we should place the next stamp
            // Fix: Calculate progress based on how far we need to go back from current position
            const stepBack = queue.accumulatedDistance - settings.spacing;
            const progress = distance > 0 ? (distance - stepBack) / distance : 1;
            // Clamp progress to valid range to handle edge cases
            const clampedProgress = Math.max(0, Math.min(1, progress));
            const x = queue.lastStrokePosition.x + (snappedTo.x - queue.lastStrokePosition.x) * clampedProgress;
            const y = queue.lastStrokePosition.y + (snappedTo.y - queue.lastStrokePosition.y) * clampedProgress;
            
            drawCustomBrushStamp(ctx, x, y, customBrush, scaleFactor, settings.rotation, brushColor, shouldApplyColorTint, tools.brushSettings.pressureEnabled);
          }
          
          queue.accumulatedDistance -= settings.spacing;
        }
      }
      
      // Update last stroke position for next call
      queue.lastStrokePosition = { x: snappedTo.x, y: snappedTo.y };
      
      ctx.restore();
      return; // Exit early for custom brushes
    }
    
    // Handle tool-specific behavior for regular brushes
    
    // Handle antialiasing and pixel-perfect drawing
    if (settings.pixelAlignment) {
      ctx.imageSmoothingEnabled = false;
      
      
      if (isGridSnapping) {
        // Grid snapping mode: draw at all grid positions between last and current position
        // Use unified grid size calculation
        
        // Fill in grid positions between last and current position for fast movement
        const gridPositions = getGridPositionsBetween(
          queue.lastStrokePosition.x || snappedFrom.x, 
          queue.lastStrokePosition.y || snappedFrom.y, 
          snappedTo.x, 
          snappedTo.y, 
          gridSize
        );
        
        // Draw at each grid position that hasn't been stamped
        for (const pos of gridPositions) {
          const posKey = `${pos.x},${pos.y}`;
          if (!queue.stampedGridPositions.has(posKey) && shouldDrawStamp(tools.brushSettings, queue, settings.size, isGridSnapping)) {
            const jitteredColor = applyThrottledColorJitter(settings.color, tools.brushSettings.colorJitter || 0);
            ctx.fillStyle = jitteredColor;
            drawShape(ctx, pos.x, pos.y, settings.size, settings.shape, false, settings.rotation, settings.risographIntensity, settings.pattern, settings.centerAlignment);
            queue.stampedGridPositions.add(posKey);
          }
        }
      } else {
        // Normal mode: Follow Tom Cantwell's exact algorithm using snapped positions
        const roundedFromX = Math.round(snappedFrom.x);
        const roundedFromY = Math.round(snappedFrom.y);
        const roundedToX = Math.round(snappedTo.x);
        const roundedToY = Math.round(snappedTo.y);
        
        // If movement is > 1 pixel, use line drawing (but not when riso is active)
        if (Math.abs(roundedToX - roundedFromX) > 1 || Math.abs(roundedToY - roundedFromY) > 1) {
          // Fast movement - draw pixel-perfect line using shapes (skip when riso is active)
          if (settings.risographIntensity === 0) {
            drawPixelPerfectLine(ctx, roundedFromX, roundedFromY, roundedToX, roundedToY, settings);
          } else {
            // When riso is active, use individual stamps instead of line drawing
            perfectPixels(ctx, snappedTo.x, snappedTo.y, settings);
          }
        } else {
          // Slow movement - use perfect pixel queue algorithm
          perfectPixels(ctx, snappedTo.x, snappedTo.y, settings);
        }
      }
    } else {
      if (isGridSnapping) {
        // Grid snapping mode: draw at all grid positions between last and current position
        // Use unified grid size calculation
        
        // Fill in grid positions between last and current position for fast movement
        const gridPositions = getGridPositionsBetween(
          queue.lastStrokePosition.x || snappedFrom.x, 
          queue.lastStrokePosition.y || snappedFrom.y, 
          snappedTo.x, 
          snappedTo.y, 
          gridSize
        );
        
        // Draw at each grid position that hasn't been stamped
        for (const pos of gridPositions) {
          const posKey = `${pos.x},${pos.y}`;
          if (!queue.stampedGridPositions.has(posKey) && shouldDrawStamp(tools.brushSettings, queue, settings.size, isGridSnapping)) {
            const jitteredColor = applyThrottledColorJitter(settings.color, tools.brushSettings.colorJitter || 0);
            ctx.fillStyle = jitteredColor;
            drawShape(ctx, pos.x, pos.y, settings.size, settings.shape, true, settings.rotation, settings.risographIntensity, settings.pattern, settings.centerAlignment);
            queue.stampedGridPositions.add(posKey);
          }
        }
      } else {
        // Normal mode: For antialiased drawing, use distance-based spacing with accumulated distance using snapped positions
        const distance = Math.sqrt(Math.pow(snappedTo.x - queue.lastStrokePosition.x, 2) + Math.pow(snappedTo.y - queue.lastStrokePosition.y, 2));
        queue.accumulatedDistance += distance;
        
        // Draw shapes along the path only when accumulated distance exceeds spacing
        while (queue.accumulatedDistance >= settings.spacing) {
          // Check if we should draw this stamp (cursor-speed independent)
          if (shouldDrawStamp(tools.brushSettings, queue, settings.size, false)) {
            // Calculate the position where we should place the next shape
            // Fix: Calculate progress based on how far we need to go back from current position
            const stepBack = queue.accumulatedDistance - settings.spacing;
            const progress = distance > 0 ? (distance - stepBack) / distance : 1;
            // Clamp progress to valid range to handle edge cases
            const clampedProgress = Math.max(0, Math.min(1, progress));
            const x = queue.lastStrokePosition.x + (snappedTo.x - queue.lastStrokePosition.x) * clampedProgress;
            const y = queue.lastStrokePosition.y + (snappedTo.y - queue.lastStrokePosition.y) * clampedProgress;
            
            const jitteredColor = applyThrottledColorJitter(settings.color, tools.brushSettings.colorJitter || 0);
            ctx.fillStyle = jitteredColor;
            drawShape(ctx, x, y, settings.size, settings.shape, true, settings.rotation, settings.risographIntensity, settings.pattern, settings.centerAlignment);
          }
          
          queue.accumulatedDistance -= settings.spacing;
        }
      }
    }
    
    // Update last stroke position for next call
    queue.lastStrokePosition = { x: snappedTo.x, y: snappedTo.y };
    
    ctx.restore();
    
    // Performance monitoring (silent - data available in dev tools if needed)
    if (process.env.NODE_ENV === 'development' && strokeStartTime) {
      const strokeDuration = performance.now() - strokeStartTime;
      // Performance data available in dev tools if needed
      void strokeDuration;
    }
  }, [executeComponents, tools, activeBrushComponents, perfectPixels, drawPixelPerfectLine, drawShape, project, brushPresets, drawCustomBrushLine, drawCustomBrushStamp]);
  
  // Draw rectangle gradient brush
  const drawRectangleGradient = useCallback((ctx: CanvasRenderingContext2D, rectangleState: RectangleState, isPreview: boolean = false) => {
    const { startPos, endPos, width, startColor, endColor, colors } = rectangleState;
    const { brushSettings, currentTool } = useAppStore.getState().tools;
    
    // Use provided colors or fall back to default brush color
    const defaultColor = brushSettings.color;
    const finalStartColor = startColor || defaultColor;
    const finalEndColor = endColor || defaultColor;
    
    // Calculate rectangle geometry
    const dx = endPos.x - startPos.x;
    const dy = endPos.y - startPos.y;
    const length = Math.hypot(dx, dy);
    
    if (length === 0 || width === 0) return;
    
    // Calculate perpendicular vector for width
    const perpX = -dy / length * (width / 2);
    const perpY = dx / length * (width / 2);
    
    // Rectangle corners
    const corners = [
      { x: startPos.x + perpX, y: startPos.y + perpY },
      { x: startPos.x - perpX, y: startPos.y - perpY },
      { x: endPos.x - perpX, y: endPos.y - perpY },
      { x: endPos.x + perpX, y: endPos.y + perpY }
    ];
    
    ctx.save();
    // Disable antialiasing for clean edges
    ctx.imageSmoothingEnabled = false;
    // CRITICAL FIX: Eraser must always use full opacity to completely remove pixels
    ctx.globalAlpha = brushSettings.opacity;
    ctx.globalCompositeOperation = brushSettings.blendMode || 'source-over';
    
    // Get the actual number of colors (default to 2 if not set)
    const numColors = brushSettings.colors || 2;
    
    // Check if we should use dithering for 2-color mode when colors are the same
    const shouldUseDither = colors && colors.length === 2 && 
                           colors[0] === colors[1] && 
                           numColors === 2 &&
                           !isPreview; // Don't dither in preview mode for performance
    
    // For single color mode, always use solid fill
    const shouldUseSolidFill = numColors === 1 || (colors && colors.length === 1);
    
    // Log dithering decision (only on final draw, not preview)
    if (!isPreview && numColors === 2) {
      if (shouldUseDither) {
      } else if (colors && colors.length === 2) {
      }
    }
    
    // Check if we'll be applying dithering later (to avoid double-drawing)
    const willApplyDithering = brushSettings.ditherEnabled && numColors >= 2 && !isPreview;
    
    if (shouldUseSolidFill && !willApplyDithering) {
      // For single color mode, use solid fill without gradient (skip if dithering will be applied)
      const solidColor = colors && colors.length > 0 ? colors[0] : finalStartColor;
      
      ctx.fillStyle = solidColor;
      ctx.beginPath();
      ctx.moveTo(corners[0].x, corners[0].y);
      corners.slice(1).forEach(corner => ctx.lineTo(corner.x, corner.y));
      ctx.closePath();
      ctx.fill();
    } else if (!willApplyDithering) {
      // Original gradient code
      const gradient = ctx.createLinearGradient(startPos.x, startPos.y, endPos.x, endPos.y);
      
      // Use provided colors array or fall back to start/end colors
      if (colors && colors.length > 0) {
        // Use the provided sampled colors with smooth gradient
        // Filter out undefined colors first
        const validColors = colors.filter((c: string | undefined) => c !== undefined && c !== null);
        if (validColors.length === 0) {
          // Fallback to current brush color if no valid colors
          const fallbackColor = brushSettings.color || '#000000';
          gradient.addColorStop(0, fallbackColor);
          gradient.addColorStop(1, fallbackColor);
        } else {
          validColors.forEach((color: string, index: number) => {
            // Handle single color case to avoid division by zero
            const position = validColors.length === 1 ? 0 : index / (validColors.length - 1);
            gradient.addColorStop(position, color);
          });
          
          // For single color, add the same color at position 1 to ensure solid fill
          if (validColors.length === 1) {
            gradient.addColorStop(1, validColors[0]);
          }
        }
      } else {
        // Fallback to original behavior if no colors array provided
        const numColors = Math.max(2, brushSettings.colors || 2);
        if (numColors === 1) {
          // Single color - use solid fill
          gradient.addColorStop(0, finalStartColor);
          gradient.addColorStop(1, finalStartColor);
        } else if (numColors === 2) {
          // Smooth gradient between two colors
          gradient.addColorStop(0, finalStartColor);
          gradient.addColorStop(1, finalEndColor);
        } else {
          // Interpolate smoothly between start and end
          for (let i = 0; i < numColors; i++) {
            const position = i / (numColors - 1);
            
            const start = finalStartColor.match(/^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i);
            const end = finalEndColor.match(/^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i);
            
            if (start && end) {
              const r = Math.round(parseInt(start[1], 16) + (parseInt(end[1], 16) - parseInt(start[1], 16)) * position);
              const g = Math.round(parseInt(start[2], 16) + (parseInt(end[2], 16) - parseInt(start[2], 16)) * position);
              const b = Math.round(parseInt(start[3], 16) + (parseInt(end[3], 16) - parseInt(start[3], 16)) * position);
              
              const interpolatedColor = `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
              gradient.addColorStop(position, interpolatedColor);
            } else {
              gradient.addColorStop(position, position < 0.5 ? finalStartColor : finalEndColor);
            }
          }
        }
      }
      
      // Draw rectangle with gradient
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.moveTo(corners[0].x, corners[0].y);
      corners.slice(1).forEach(corner => ctx.lineTo(corner.x, corner.y));
      ctx.closePath();
      ctx.fill();
    }
    
    // Apply dithering with manual gamma-correct gradient rendering
    if (brushSettings.ditherEnabled && numColors >= 2 && !isPreview) {
      // Get the bounds of the rectangle for dithering
      const minX = Math.floor(Math.min(...corners.map(c => c.x)));
      const minY = Math.floor(Math.min(...corners.map(c => c.y)));
      const maxX = Math.ceil(Math.max(...corners.map(c => c.x)));
      const maxY = Math.ceil(Math.max(...corners.map(c => c.y)));
      const boundWidth = maxX - minX;
      const boundHeight = maxY - minY;
      
      if (boundWidth > 0 && boundHeight > 0) {
        // Create a temporary canvas for manual gradient rendering
        const tempCanvas = canvasPool.acquire(boundWidth, boundHeight);
        const tempCtx = tempCanvas.getContext('2d', { willReadFrequently: true, colorSpace: 'srgb' });
        
        if (tempCtx) {
          
          // Parse start and end colors
          let startColorRGB: [number, number, number];
          let endColorRGB: [number, number, number];
          
          if (colors && colors.length > 0) {
            const validColors = colors.filter(c => c !== undefined && c !== null);
            if (validColors.length > 0) {
              startColorRGB = parseColor(validColors[0]);
              endColorRGB = parseColor(validColors[validColors.length - 1]);
            } else {
              const fallbackColor = brushSettings.color || '#000000';
              startColorRGB = parseColor(fallbackColor);
              endColorRGB = startColorRGB;
            }
          } else {
            startColorRGB = parseColor(finalStartColor);
            endColorRGB = parseColor(finalEndColor);
          }
          
          // Convert to linear space for correct interpolation
          const l_startR = srgbToLinear(startColorRGB[0]);
          const l_startG = srgbToLinear(startColorRGB[1]);
          const l_startB = srgbToLinear(startColorRGB[2]);
          const l_endR = srgbToLinear(endColorRGB[0]);
          const l_endG = srgbToLinear(endColorRGB[1]);
          const l_endB = srgbToLinear(endColorRGB[2]);
          
          // Calculate gradient vector
          const gradientVector = { x: endPos.x - startPos.x, y: endPos.y - startPos.y };
          const gradientLength = Math.hypot(gradientVector.x, gradientVector.y);
          
          // Convert corners to local coordinates
          const localCorners = corners.map(c => ({ x: c.x - minX, y: c.y - minY }));
          
          // First, render the gradient using Canvas API for proper edge handling
          tempCtx.save();
          tempCtx.imageSmoothingEnabled = false;
          
          // Create the gradient
          const gradient = tempCtx.createLinearGradient(
            startPos.x - minX, startPos.y - minY,
            endPos.x - minX, endPos.y - minY
          );
          
          // Add all colors from the array as gradient stops
          if (colors && colors.length > 0) {
            const validColors = colors.filter(c => c !== undefined && c !== null);
            if (validColors.length > 0) {
              validColors.forEach((color: string, index: number) => {
                const position = validColors.length === 1 ? 0 : index / (validColors.length - 1);
                gradient.addColorStop(position, color);
              });
              // For single color, add the same color at position 1 to ensure solid fill
              if (validColors.length === 1) {
                gradient.addColorStop(1, validColors[0]);
              }
            } else {
              // Fallback to start/end colors
              gradient.addColorStop(0, `rgb(${startColorRGB[0]}, ${startColorRGB[1]}, ${startColorRGB[2]})`);
              gradient.addColorStop(1, `rgb(${endColorRGB[0]}, ${endColorRGB[1]}, ${endColorRGB[2]})`);
            }
          } else {
            // Use start and end colors if no colors array
            gradient.addColorStop(0, `rgb(${startColorRGB[0]}, ${startColorRGB[1]}, ${startColorRGB[2]})`);
            gradient.addColorStop(1, `rgb(${endColorRGB[0]}, ${endColorRGB[1]}, ${endColorRGB[2]})`);
          }
          
          // Draw the rectangle with proper edge handling
          tempCtx.fillStyle = gradient;
          tempCtx.beginPath();
          tempCtx.moveTo(localCorners[0].x, localCorners[0].y);
          for (let i = 1; i < localCorners.length; i++) {
            tempCtx.lineTo(localCorners[i].x, localCorners[i].y);
          }
          tempCtx.closePath();
          tempCtx.fill();
          tempCtx.restore();
          
          // Now get the image data for dithering
          const canvasImageData = tempCtx.getImageData(0, 0, boundWidth, boundHeight);
          
          // Manually apply gamma-correct gradient for better color accuracy during dithering
          if (gradientLength > 0 && colors && colors.length > 1) {
            const canvasData = canvasImageData.data;
            const validColors = colors.filter(c => c !== undefined && c !== null);
            
            if (validColors.length > 1) {
              // Parse all colors for interpolation
              const parsedColors = validColors.map(c => parseColor(c));
              const linearColors = parsedColors.map(rgb => [
                srgbToLinear(rgb[0]),
                srgbToLinear(rgb[1]),
                srgbToLinear(rgb[2])
              ]);
              
              for (let y = 0; y < boundHeight; y++) {
                for (let x = 0; x < boundWidth; x++) {
                  const index = (y * boundWidth + x) * 4;
                  // Only process pixels that were filled by the canvas (alpha > 0)
                  if (canvasData[index + 3] > 0) {
                    const worldX = x + minX;
                    const worldY = y + minY;
                    
                    // Project the current point onto the gradient vector to find its position (t)
                    const pointVec = { x: worldX - startPos.x, y: worldY - startPos.y };
                    const projection = (pointVec.x * gradientVector.x + pointVec.y * gradientVector.y) / (gradientLength * gradientLength);
                    const t = Math.max(0, Math.min(1, projection));
                    
                    // Find which two colors to interpolate between
                    const scaledT = t * (validColors.length - 1);
                    const colorIndex = Math.floor(scaledT);
                    const localT = scaledT - colorIndex;
                    
                    let r, g, b;
                    if (colorIndex >= validColors.length - 1) {
                      // Use last color
                      const lastColor = linearColors[linearColors.length - 1];
                      r = lastColor[0];
                      g = lastColor[1];
                      b = lastColor[2];
                    } else {
                      // Interpolate between two colors
                      const color1 = linearColors[colorIndex];
                      const color2 = linearColors[colorIndex + 1];
                      r = color1[0] + (color2[0] - color1[0]) * localT;
                      g = color1[1] + (color2[1] - color1[1]) * localT;
                      b = color1[2] + (color2[2] - color1[2]) * localT;
                    }
                    
                    // Convert back to sRGB for display
                    canvasData[index] = linearToSrgb(r);
                    canvasData[index + 1] = linearToSrgb(g);
                    canvasData[index + 2] = linearToSrgb(b);
                    // Keep alpha as-is from canvas rendering
                  }
                }
              }
            }
          }
          
          // Apply dithering to the gradient image data
          const fillResolution = brushSettings.fillResolution || 1;
          const algorithm = brushSettings.ditherAlgorithm || 'sierra-lite';
          const patternStyle = brushSettings.patternStyle || 'dots';
          
          const ditheredData = fillResolution > 1 
            ? applyDitheringWithFillResolution(canvasImageData, numColors, fillResolution, algorithm, patternStyle)
            : applyDithering(canvasImageData, numColors, algorithm, patternStyle);
          
          // Draw the final result
          tempCtx.putImageData(ditheredData, 0, 0);
          ctx.drawImage(tempCanvas, minX, minY);
          
          canvasPool.release(tempCanvas);
        }
      }
    }
    
    // Apply risograph effect if enabled (AFTER dithering so it's not overwritten)
    const risographIntensity = brushSettings.risographIntensity || 0;
    if (risographIntensity > 0 && !isPreview) {
      // Use GPU-accelerated risograph effect with cached pattern
      const pattern = getRisographPattern(ctx);
      
      if (pattern) {
        // Save current state
        ctx.save();
        
        // Add misregistration offset
        const effectStrength = risographIntensity / 100;
        const misregX = (Math.random() - 0.5) * effectStrength * 2;
        const misregY = (Math.random() - 0.5) * effectStrength * 2;
        ctx.translate(misregX, misregY);
        
        // Create clipping path for the rectangle with slight roughness
        ctx.beginPath();
        ctx.moveTo(corners[0].x, corners[0].y);
        corners.slice(1).forEach(corner => {
          // Add slight roughness to edges
          const roughX = corner.x + (Math.random() - 0.5) * effectStrength;
          const roughY = corner.y + (Math.random() - 0.5) * effectStrength;
          ctx.lineTo(roughX, roughY);
        });
        ctx.closePath();
        ctx.clip();
        
        // Apply texture with multiply blend mode
        ctx.globalCompositeOperation = 'multiply';
        ctx.fillStyle = pattern;
        ctx.globalAlpha = risographIntensity / 100 * 0.35; // Slightly stronger effect
        
        // Fill the clipped area with the pattern
        const minX = Math.floor(Math.min(...corners.map(c => c.x)));
        const minY = Math.floor(Math.min(...corners.map(c => c.y)));
        const maxX = Math.ceil(Math.max(...corners.map(c => c.x)));
        const maxY = Math.ceil(Math.max(...corners.map(c => c.y)));
        ctx.fillRect(minX, minY, maxX - minX, maxY - minY);
        
        // Restore state
        ctx.restore();
      }
    }
    
    ctx.restore();
  }, []);

  // Draw polygon gradient brush
  const drawPolygonGradient = useCallback((ctx: CanvasRenderingContext2D, options: { vertices: Array<{ x: number; y: number }>, colors: string[] }, isPreview: boolean = false) => {
    const { vertices, colors } = options;
    const { brushSettings, currentTool } = useAppStore.getState().tools;
    
    if (!vertices || vertices.length < 3 || !colors || colors.length < 1) return;
    
    // Get the actual number of colors (default to 2 if not set)
    const numColors = brushSettings.colors || 2;
    
    // Check if we should use dithering for 2-color mode when colors are the same
    const shouldUseDither = colors && colors.length === 2 && 
                           colors[0] === colors[1] && 
                           numColors === 2 &&
                           !isPreview;
    
    // Only log when dithering will actually happen
    if (shouldUseDither && !isPreview) {
    }
    
    ctx.save();
    // Disable anti-aliasing for pixel-perfect rendering
    ctx.imageSmoothingEnabled = false;
    // CRITICAL FIX: Eraser must always use full opacity to completely remove pixels
    ctx.globalAlpha = brushSettings.opacity;
    ctx.globalCompositeOperation = brushSettings.blendMode || 'source-over';
    
    // Calculate polygon bounds for better gradient coverage
    const minX = Math.min(...vertices.map(v => v.x));
    const minY = Math.min(...vertices.map(v => v.y));
    const maxX = Math.max(...vertices.map(v => v.x));
    const maxY = Math.max(...vertices.map(v => v.y));
    
    // Calculate polygon dimensions
    const width = maxX - minX;
    const height = maxY - minY;
    
    // Determine gradient direction based on the dominant dimension
    // This ensures the gradient spans the full polygon properly
    let gradient;
    let gradientStartPoint, gradientEndPoint;
    if (width > height * 1.5) {
      // Predominantly horizontal polygon - use horizontal gradient
      gradientStartPoint = { x: minX, y: (minY + maxY) / 2 };
      gradientEndPoint = { x: maxX, y: (minY + maxY) / 2 };
      gradient = ctx.createLinearGradient(gradientStartPoint.x, gradientStartPoint.y, gradientEndPoint.x, gradientEndPoint.y);
    } else if (height > width * 1.5) {
      // Predominantly vertical polygon - use vertical gradient
      gradientStartPoint = { x: (minX + maxX) / 2, y: minY };
      gradientEndPoint = { x: (minX + maxX) / 2, y: maxY };
      gradient = ctx.createLinearGradient(gradientStartPoint.x, gradientStartPoint.y, gradientEndPoint.x, gradientEndPoint.y);
    } else {
      // Roughly square or diagonal - use diagonal gradient from top-left to bottom-right
      gradientStartPoint = { x: minX, y: minY };
      gradientEndPoint = { x: maxX, y: maxY };
      gradient = ctx.createLinearGradient(gradientStartPoint.x, gradientStartPoint.y, gradientEndPoint.x, gradientEndPoint.y);
    }
    
    // Add color stops for a smooth gradient
    // Filter out undefined colors and ensure we have valid colors
    const validColors = colors.filter(c => c !== undefined && c !== null);
    if (validColors.length === 0) {
      // Fallback to current brush color if no valid colors provided
      const fallbackColor = brushSettings.color || '#000000';
      gradient.addColorStop(0, fallbackColor);
      gradient.addColorStop(1, fallbackColor);
    } else {
      // For 1-color mode, always use flat solid fill (average of all sampled colors)
      if (numColors === 1) {
        // Calculate average color from all sampled colors
        const avgColor = getAverageColor(validColors);
        gradient.addColorStop(0, avgColor);
        gradient.addColorStop(1, avgColor);
      } else if (brushSettings.ditherEnabled && numColors >= 2) {
        // When dithering is enabled, we'll skip the gradient and render directly
        // Just create a placeholder gradient for now - we'll handle dithering manually below
        if (validColors.length === 0) {
          gradient.addColorStop(0, 'rgb(0, 0, 0)');
          gradient.addColorStop(1, 'rgb(255, 255, 255)');
        } else if (validColors.length === 1) {
          // Single color - use it for both stops (solid fill)
          gradient.addColorStop(0, validColors[0]);
          gradient.addColorStop(1, validColors[0]);
        } else {
          // Use first and last colors for a clean gradient
          gradient.addColorStop(0, validColors[0]);
          gradient.addColorStop(1, validColors[validColors.length - 1]);
        }
      } else {
        // Original gradient logic for non-dithered or 2-color mode
        // Distribute colors evenly across the gradient
        if (validColors.length >= 3) {
          // Sample key colors to prevent gradient crushing
          // Use first, some middle samples, and last for better distribution
          const keyIndices = [];
          const numStops = Math.min(8, validColors.length); // Limit to 8 stops for performance
          
          for (let i = 0; i < numStops; i++) {
            const index = Math.floor((i / (numStops - 1)) * (validColors.length - 1));
            keyIndices.push(index);
          }
          
          // Add color stops at evenly distributed positions
          keyIndices.forEach((colorIndex, i) => {
            const position = i / (numStops - 1);
            gradient.addColorStop(position, validColors[colorIndex]);
          });
        } else if (validColors.length === 2) {
          // Two colors - simple gradient
          gradient.addColorStop(0, validColors[0]);
          gradient.addColorStop(1, validColors[1]);
        } else {
          // Single color - solid fill
          gradient.addColorStop(0, validColors[0]);
          gradient.addColorStop(1, validColors[0]);
        }
      }
    }
    
    // Create polygon path with processed vertices for better precision
    ctx.beginPath();
    ctx.moveTo(vertices[0].x, vertices[0].y);
    for (let i = 1; i < vertices.length; i++) {
      ctx.lineTo(vertices[i].x, vertices[i].y);
    }
    ctx.closePath();
    
    // Handle dithered gradients specially - create the pattern directly
    if (brushSettings.ditherEnabled && numColors >= 2 && !isPreview) {
      // Get the bounds of the polygon for direct gradient dithering
      const minX = Math.floor(Math.min(...vertices.map(v => v.x)));
      const minY = Math.floor(Math.min(...vertices.map(v => v.y)));
      const maxX = Math.ceil(Math.max(...vertices.map(v => v.x)));
      const maxY = Math.ceil(Math.max(...vertices.map(v => v.y)));
      const boundWidth = maxX - minX;
      const boundHeight = maxY - minY;
      
      if (boundWidth > 0 && boundHeight > 0) {
        // Create a canvas to generate the dithered gradient directly
        const tempCanvas = canvasPool.acquire(boundWidth, boundHeight);
        const tempCtx = tempCanvas.getContext('2d', { willReadFrequently: true, colorSpace: 'srgb' });
        
        if (tempCtx) {
          // Determine gradient colors - use actual sampled colors without shifting
          let startColor, endColor;
          if (validColors.length === 0) {
            // No colors sampled - use black to white as fallback
            startColor = [0, 0, 0];
            endColor = [255, 255, 255];
          } else if (validColors.length === 1) {
            // Single color - use it for both start and end (solid fill)
            const match = validColors[0].match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
            const rawColor = match ? [parseInt(match[1]), parseInt(match[2]), parseInt(match[3])] : [128, 128, 128];
            // Snap near-black/white colors for cleaner dithering
            const color = snapColorToExtremes(rawColor[0], rawColor[1], rawColor[2]);
            startColor = color;
            endColor = color;
          } else {
            // Multiple colors - use first and last as sampled
            const startMatch = validColors[0].match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
            const endMatch = validColors[validColors.length - 1].match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
            const rawStartColor = startMatch ? [parseInt(startMatch[1]), parseInt(startMatch[2]), parseInt(startMatch[3])] : [0, 0, 0];
            const rawEndColor = endMatch ? [parseInt(endMatch[1]), parseInt(endMatch[2]), parseInt(endMatch[3])] : [255, 255, 255];
            // Snap near-black/white colors for cleaner dithering
            startColor = snapColorToExtremes(rawStartColor[0], rawStartColor[1], rawStartColor[2]);
            endColor = snapColorToExtremes(rawEndColor[0], rawEndColor[1], rawEndColor[2]);
          }
          
          // Create an image data for the gradient area
          const imageData = tempCtx.createImageData(boundWidth, boundHeight);
          const data = imageData.data;
          
          // Generate gradient manually pixel by pixel based on the gradient direction
          const gradientVector = {
            x: gradientEndPoint.x - gradientStartPoint.x,
            y: gradientEndPoint.y - gradientStartPoint.y
          };
          const gradientLength = Math.sqrt(gradientVector.x * gradientVector.x + gradientVector.y * gradientVector.y);
          
          if (gradientLength > 0) {
            const normalizedVector = {
              x: gradientVector.x / gradientLength,
              y: gradientVector.y / gradientLength
            };
            
            for (let y = 0; y < boundHeight; y++) {
              for (let x = 0; x < boundWidth; x++) {
                const worldX = x + minX;
                const worldY = y + minY;
                
                // Calculate position along gradient line from start point
                const pointVector = {
                  x: worldX - gradientStartPoint.x,
                  y: worldY - gradientStartPoint.y
                };
                
                // Project point onto gradient line to get position (0 to 1)
                const projectionLength = pointVector.x * normalizedVector.x + pointVector.y * normalizedVector.y;
                const t = Math.max(0, Math.min(1, projectionLength / gradientLength));
                
                // Convert start and end colors to linear space for proper interpolation
                const l_startR = srgbToLinear(startColor[0]);
                const l_startG = srgbToLinear(startColor[1]);
                const l_startB = srgbToLinear(startColor[2]);
                const l_endR = srgbToLinear(endColor[0]);
                const l_endG = srgbToLinear(endColor[1]);
                const l_endB = srgbToLinear(endColor[2]);
                
                // Interpolate in linear space for perceptually correct gradient
                const t_r = l_startR + (l_endR - l_startR) * t;
                const t_g = l_startG + (l_endG - l_startG) * t;
                const t_b = l_startB + (l_endB - l_startB) * t;
                
                // Convert back to sRGB for display
                const r = linearToSrgb(t_r);
                const g = linearToSrgb(t_g);
                const b = linearToSrgb(t_b);
                
                const index = (y * boundWidth + x) * 4;
                data[index] = r;
                data[index + 1] = g;
                data[index + 2] = b;
                data[index + 3] = 255; // Full opacity
              }
            }
          }
          
          // Now apply dithering to this generated gradient
          const fillResolution = brushSettings.fillResolution || 1;
          const algorithm = brushSettings.ditherAlgorithm || 'sierra-lite';
          const patternStyle = brushSettings.patternStyle || 'dots';
          
          const ditheredData = fillResolution > 1 
            ? applyDitheringWithFillResolution(imageData, numColors, fillResolution, algorithm, patternStyle)
            : applyDithering(imageData, numColors, algorithm, patternStyle);
          
          // Apply the polygon clipping mask
          const maskCanvas = canvasPool.acquire(boundWidth, boundHeight);
          const maskCtx = maskCanvas.getContext('2d', { willReadFrequently: true, colorSpace: 'srgb' });
          
          if (maskCtx) {
            // Draw the polygon shape as a mask
            maskCtx.fillStyle = 'white';
            maskCtx.beginPath();
            maskCtx.moveTo(vertices[0].x - minX, vertices[0].y - minY);
            vertices.slice(1).forEach(v => maskCtx.lineTo(v.x - minX, v.y - minY));
            maskCtx.closePath();
            maskCtx.fill();
            
            const maskData = maskCtx.getImageData(0, 0, boundWidth, boundHeight);
            
            // Apply mask to dithered data
            const finalData = new Uint8ClampedArray(ditheredData.data);
            for (let i = 0; i < maskData.data.length; i += 4) {
              if (maskData.data[i + 3] === 0) { // If mask pixel is transparent
                finalData[i + 3] = 0; // Make final pixel transparent
              }
            }
            
            // Render the final result
            const finalImageData = new ImageData(finalData, boundWidth, boundHeight);
            tempCtx.putImageData(finalImageData, 0, 0);
            ctx.drawImage(tempCanvas, minX, minY);
            
            canvasPool.release(maskCanvas);
          }
          
          canvasPool.release(tempCanvas);
        }
      }
    } else {
      // Fill the polygon with the complete gradient (non-dithered case)
      ctx.fillStyle = gradient;
      ctx.fill();
    }
    
    // Apply risograph effect if enabled
    const risographIntensity = brushSettings.risographIntensity || 0;
    if (risographIntensity > 0 && !isPreview) {
      // Use GPU-accelerated risograph effect with cached pattern
      const pattern = getRisographPattern(ctx);
      
      if (pattern) {
        // Save current state
        ctx.save();
        
        // Add misregistration offset
        const effectStrength = risographIntensity / 100;
        const misregX = (Math.random() - 0.5) * effectStrength * 2;
        const misregY = (Math.random() - 0.5) * effectStrength * 2;
        ctx.translate(misregX, misregY);
        
        // Create clipping path for the polygon with slight roughness
        ctx.beginPath();
        ctx.moveTo(vertices[0].x, vertices[0].y);
        for (let i = 1; i < vertices.length; i++) {
          // Add slight roughness to edges
          const roughX = vertices[i].x + (Math.random() - 0.5) * effectStrength;
          const roughY = vertices[i].y + (Math.random() - 0.5) * effectStrength;
          ctx.lineTo(roughX, roughY);
        }
        ctx.closePath();
        ctx.clip();
        
        // Apply texture with multiply blend mode
        ctx.globalCompositeOperation = 'multiply';
        ctx.fillStyle = pattern;
        ctx.globalAlpha = risographIntensity / 100 * 0.35; // Slightly stronger effect
        
        // Fill the clipped area with the pattern
        const minX = Math.floor(Math.min(...vertices.map(v => v.x)));
        const minY = Math.floor(Math.min(...vertices.map(v => v.y)));
        const maxX = Math.ceil(Math.max(...vertices.map(v => v.x)));
        const maxY = Math.ceil(Math.max(...vertices.map(v => v.y)));
        ctx.fillRect(minX, minY, maxX - minX, maxY - minY);
        
        // Restore state
        ctx.restore();
      }
    }

    // Note: Dithering is now handled directly in the gradient generation above
    // This eliminates the hard boundary issues that occurred when dithering
    // was applied to an already-rendered gradient
    
    ctx.restore();
  }, []);

  return useMemo(() => ({
    executeComponents,
    executeComponent,
    renderBrushStroke,
    resetPixelQueue,
    drawRectangleGradient,
    drawPolygonGradient
  }), [executeComponents, executeComponent, renderBrushStroke, resetPixelQueue, drawRectangleGradient, drawPolygonGradient]);
};