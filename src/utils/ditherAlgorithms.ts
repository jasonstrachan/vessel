/**
 * Pressure-sensitive dithering algorithms for Vessel
 * Implements Floyd-Steinberg and Bayer matrix dithering with pressure control
 */

import { debugWarn } from '@/utils/debug';
import {
  LOST_EDGE_TILE_MIN,
  LOST_EDGE_TILE_MAX,
  LOST_EDGE_TILE_DEFAULT,
  LOST_EDGE_BAND_MIN_PX,
  LOST_EDGE_BAND_MAX_PX,
  LOST_EDGE_MAX_DIM_FRACTION,
  LOST_EDGE_INTENSITY_EXP,
  LOST_EDGE_SEARCH_SCALE,
  LOST_EDGE_FADE_FRACTION,
  LOST_EDGE_MIN_DIM_TILE_MULTIPLIER,
  LOST_EDGE_SOLID_SKIP_BAND_PX,
} from './ditherConstants';

// 8x8 Bayer matrix (normalized to 0-1)
export const BAYER_8x8_MATRIX = [
  [0, 32, 8, 40, 2, 34, 10, 42],
  [48, 16, 56, 24, 50, 18, 58, 26],
  [12, 44, 4, 36, 14, 46, 6, 38],
  [60, 28, 52, 20, 62, 30, 54, 22],
  [3, 35, 11, 43, 1, 33, 9, 41],
  [51, 19, 59, 27, 49, 17, 57, 25],
  [15, 47, 7, 39, 13, 45, 5, 37],
  [63, 31, 55, 23, 61, 29, 53, 21]
].map(row => row.map(v => v / 64)); // Normalize to 0-1

// 4x4 Bayer matrix for faster processing
export const BAYER_4x4_MATRIX = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5]
].map(row => row.map(v => v / 16)); // Normalize to 0-1

// 2x2 Bayer matrix for subtle dithering
export const BAYER_2x2_MATRIX = [
  [0, 2],
  [3, 1]
].map(row => row.map(v => v / 4)); // Normalize to 0-1

// Scratch buffers reused by lost-edge mask to avoid per-stroke allocations
const lostEdgeScratch = {
  coarseCoverage: new Uint8Array(0),
  keepCoarse: new Uint8Array(0),
  interiorCoarse: new Uint8Array(0),
};

const lostEdgeScratchU16 = {
  distCoarse: new Uint16Array(0),
};

const ensureScratch = (key: keyof typeof lostEdgeScratch, size: number) => {
  const buf = lostEdgeScratch[key];
  if (buf.length >= size) return buf;
  const next = new Uint8Array(size);
  lostEdgeScratch[key] = next;
  return next;
};

const ensureScratchU16 = (key: keyof typeof lostEdgeScratchU16, size: number) => {
  const buf = lostEdgeScratchU16[key];
  if (buf.length >= size) return buf;
  const next = new Uint16Array(size);
  lostEdgeScratchU16[key] = next;
  return next;
};

// Pre-computed 16x16 blue noise pattern for dithering
// This provides organic-looking dithering without visible patterns
export const BLUE_NOISE_16x16 = [
  [0.12, 0.94, 0.41, 0.73, 0.18, 0.87, 0.51, 0.65, 0.08, 0.91, 0.35, 0.78, 0.22, 0.96, 0.45, 0.69],
  [0.59, 0.28, 0.82, 0.04, 0.61, 0.31, 0.75, 0.14, 0.55, 0.24, 0.88, 0.02, 0.63, 0.37, 0.84, 0.10],
  [0.71, 0.47, 0.16, 0.92, 0.43, 0.98, 0.20, 0.49, 0.76, 0.39, 0.67, 0.29, 0.90, 0.06, 0.53, 0.25],
  [0.33, 0.86, 0.57, 0.27, 0.80, 0.06, 0.67, 0.35, 0.10, 0.94, 0.14, 0.51, 0.73, 0.41, 0.98, 0.61],
  [0.02, 0.65, 0.39, 0.96, 0.12, 0.53, 0.88, 0.22, 0.57, 0.31, 0.82, 0.04, 0.18, 0.87, 0.29, 0.75],
  [0.78, 0.18, 0.84, 0.49, 0.71, 0.25, 0.45, 0.76, 0.02, 0.69, 0.43, 0.92, 0.55, 0.08, 0.63, 0.37],
  [0.51, 0.92, 0.08, 0.61, 0.35, 0.94, 0.14, 0.59, 0.86, 0.20, 0.27, 0.67, 0.31, 0.78, 0.47, 0.90],
  [0.25, 0.73, 0.31, 0.88, 0.04, 0.67, 0.41, 0.98, 0.33, 0.53, 0.76, 0.10, 0.96, 0.22, 0.16, 0.55],
  [0.82, 0.45, 0.96, 0.20, 0.55, 0.78, 0.24, 0.71, 0.06, 0.92, 0.39, 0.84, 0.49, 0.65, 0.35, 0.73],
  [0.10, 0.63, 0.14, 0.76, 0.37, 0.12, 0.86, 0.47, 0.61, 0.18, 0.57, 0.02, 0.29, 0.88, 0.04, 0.94],
  [0.69, 0.29, 0.51, 0.43, 0.90, 0.59, 0.02, 0.31, 0.80, 0.45, 0.71, 0.25, 0.75, 0.12, 0.53, 0.41],
  [0.37, 0.86, 0.06, 0.98, 0.22, 0.33, 0.69, 0.94, 0.16, 0.08, 0.92, 0.51, 0.39, 0.61, 0.84, 0.20],
  [0.92, 0.57, 0.71, 0.27, 0.65, 0.82, 0.49, 0.10, 0.55, 0.35, 0.63, 0.14, 0.96, 0.27, 0.08, 0.67],
  [0.18, 0.78, 0.35, 0.47, 0.04, 0.16, 0.25, 0.73, 0.88, 0.76, 0.04, 0.82, 0.06, 0.47, 0.76, 0.31],
  [0.49, 0.02, 0.94, 0.12, 0.88, 0.53, 0.61, 0.37, 0.22, 0.43, 0.29, 0.55, 0.69, 0.18, 0.90, 0.59],
  [0.65, 0.24, 0.61, 0.78, 0.31, 0.75, 0.08, 0.90, 0.02, 0.67, 0.98, 0.20, 0.35, 0.86, 0.45, 0.14]
];

// 8x8 void-and-cluster threshold map (normalized 0-1)
// Source: classic V&C mask reordered to reduce regular artifacts
export const VOID_CLUSTER_8x8 = [
  [ 0, 48, 12, 60,  3, 51, 15, 63],
  [32, 16, 44, 28, 35, 19, 47, 31],
  [ 8, 56,  4, 52, 11, 59,  7, 55],
  [40, 24, 36, 20, 43, 27, 39, 23],
  [ 2, 50, 14, 62,  1, 49, 13, 61],
  [34, 18, 46, 30, 33, 17, 45, 29],
  [10, 58,  6, 54,  9, 57,  5, 53],
  [42, 26, 38, 22, 41, 25, 37, 21],
].map(row => row.map(v => v / 64));

type ErrorDiffusionTap = { dx: number; dy: number; weight: number };

const applyErrorDiffusionDither = (
  imageData: ImageData,
  settings: DitherSettings,
  taps: ErrorDiffusionTap[],
  divisor: number,
  serpentine: boolean = true
): ImageData => {
  const data = new Uint8ClampedArray(imageData.data);
  const { width, height } = imageData;
  const palette = settings.palette;
  const errorIntensity = calculatePressureDitherThreshold(settings.pressure, settings.intensity);

  for (let y = 0; y < height; y++) {
    const leftToRight = serpentine ? (y & 1) === 0 : true;
    const xStart = leftToRight ? 0 : width - 1;
    const xEnd = leftToRight ? width : -1;
    const xStep = leftToRight ? 1 : -1;
    const dir = leftToRight ? 1 : -1;

    for (let x = xStart; x !== xEnd; x += xStep) {
      const idx = (y * width + x) * 4;
      const oldR = data[idx];
      const oldG = data[idx + 1];
      const oldB = data[idx + 2];

      const [newR, newG, newB] = findNearestPaletteColor(oldR, oldG, oldB, palette);

      const errR = (oldR - newR) * errorIntensity;
      const errG = (oldG - newG) * errorIntensity;
      const errB = (oldB - newB) * errorIntensity;

      data[idx] = newR;
      data[idx + 1] = newG;
      data[idx + 2] = newB;

      for (const tap of taps) {
        const nx = x + tap.dx * dir;
        const ny = y + tap.dy;
        if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
        const nIdx = (ny * width + nx) * 4;
        const factor = tap.weight / divisor;
        data[nIdx] = Math.max(0, Math.min(255, data[nIdx] + errR * factor));
        data[nIdx + 1] = Math.max(0, Math.min(255, data[nIdx + 1] + errG * factor));
        data[nIdx + 2] = Math.max(0, Math.min(255, data[nIdx + 2] + errB * factor));
      }
    }
  }

  return new ImageData(data, width, height);
};

export type DitherAlgorithm =
  | 'floyd-steinberg'
  | 'jarvis-judice-ninke'
  | 'stucki'
  | 'burkes'
  | 'sierra-3'
  | 'sierra-2'
  | 'sierra-lite'
  | 'atkinson'
  | 'bayer'
  | 'blue-noise'
  | 'void-and-cluster'
  | 'pattern';
export type BayerMatrixSize = 2 | 4 | 8;
export type PatternStyle =
  | 'dots'
  | 'lines'
  | 'vertical-lines'
  | 'horizontal-lines'
  | 'crosshatch'
  | 'diagonal'
  | 'ascii'
  | 'tone-adaptive';

export interface DitherSettings {
  algorithm: DitherAlgorithm;
  pressure: number; // 0-1
  intensity: number; // 0-1
  bayerMatrixSize: BayerMatrixSize;
  palette: [number, number, number][];
  patternStyle?: PatternStyle; // For pattern dithering
  phaseOffset?: { x: number; y: number }; // Optional phase offset for ordered patterns
}

const mod = (value: number, modulo: number) => ((value % modulo) + modulo) % modulo;
const hashCell = (x: number, y: number) => ((x * 73856093) ^ (y * 19349663)) >>> 0;

const ASCII_CELL_WIDTH = 5;
const ASCII_CELL_HEIGHT = 7;
const ASCII_GLYPH_BUCKETS = [
  [
    [
      '00000',
      '00000',
      '00000',
      '00000',
      '00100',
      '00000',
      '00000',
    ],
    [
      '00000',
      '00000',
      '00000',
      '00000',
      '00000',
      '00010',
      '00000',
    ],
  ],
  [
    [
      '00000',
      '00000',
      '00000',
      '00000',
      '01110',
      '00000',
      '00000',
    ],
    [
      '00000',
      '00000',
      '00000',
      '00000',
      '11110',
      '00000',
      '00000',
    ],
  ],
  [
    [
      '00000',
      '00000',
      '01110',
      '00000',
      '00000',
      '00000',
      '00000',
    ],
    [
      '00000',
      '00000',
      '11110',
      '00000',
      '00000',
      '00000',
      '00000',
    ],
  ],
  [
    [
      '01110',
      '10000',
      '01110',
      '00001',
      '00001',
      '10001',
      '01110',
    ],
    [
      '00000',
      '11110',
      '00001',
      '00110',
      '00001',
      '00001',
      '10001',
      '01110',
    ],
  ],
  [
    [
      '00100',
      '00100',
      '11111',
      '00100',
      '11111',
      '00100',
      '00100',
    ],
    [
      '10001',
      '10001',
      '01010',
      '00100',
      '01010',
      '10001',
      '10001',
    ],
  ],
  [
    [
      '11111',
      '10000',
      '11110',
      '00001',
      '00001',
      '10001',
      '01110',
    ],
    [
      '11111',
      '10000',
      '01110',
      '00001',
      '11110',
      '10000',
      '11111',
    ],
  ],
  [
    [
      '00010',
      '00110',
      '01010',
      '10010',
      '11111',
      '00010',
      '00010',
    ],
    [
      '00100',
      '01100',
      '10100',
      '11111',
      '00100',
      '00100',
      '00100',
    ],
  ],
  [
    [
      '01110',
      '10001',
      '10000',
      '11110',
      '10001',
      '10001',
      '01110',
    ],
    [
      '01110',
      '10001',
      '10000',
      '11110',
      '10001',
      '10001',
      '01110',
    ],
  ],
] as const;

/**
 * Calculates pressure-sensitive dither threshold
 * Light pressure = more dithering (lower threshold)
 * Heavy pressure = less dithering (higher threshold)
 */
export const calculatePressureDitherThreshold = (
  rawPressure: number,
  intensity: number = 1.0,
  minThreshold: number = 0.1,
  maxThreshold: number = 0.9
): number => {
  const pressureDeadzone = 0.05; // 5% deadzone

  // Normalize pressure (0-1)
  const normalizedPressure = rawPressure < pressureDeadzone ? 0 :
    (rawPressure - pressureDeadzone) / (1.0 - pressureDeadzone);

  // Invert pressure for dithering (light pressure = more dither)
  const ditherAmount = (1.0 - normalizedPressure) * intensity;

  return minThreshold + (maxThreshold - minThreshold) * ditherAmount;
};

/**
 * Finds the nearest color in a palette using Euclidean distance
 */
export const findNearestPaletteColor = (
  r: number,
  g: number,
  b: number,
  palette: [number, number, number][]
): [number, number, number] => {
  let nearest = palette[0];
  let minDistance = Math.sqrt((r - nearest[0])**2 + (g - nearest[1])**2 + (b - nearest[2])**2);

  for (let i = 1; i < palette.length; i++) {
    const color = palette[i];
    const distance = Math.sqrt((r - color[0])**2 + (g - color[1])**2 + (b - color[2])**2);
    if (distance < minDistance) {
      minDistance = distance;
      nearest = color;
    }
  }

  return nearest;
};

/**
 * Floyd-Steinberg dithering with pressure sensitivity
 * Error distribution matrix:
 *     X   7/16
 * 3/16 5/16 1/16
 */
export const applyFloydSteinbergDither = (
  imageData: ImageData,
  settings: DitherSettings
): ImageData => {
  const data = new Uint8ClampedArray(imageData.data);
  const width = imageData.width;
  const height = imageData.height;
  const palette = settings.palette;

  // Pressure affects error diffusion intensity
  const errorIntensity = calculatePressureDitherThreshold(settings.pressure, settings.intensity);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;

      const oldR = data[idx];
      const oldG = data[idx + 1];
      const oldB = data[idx + 2];

      // Quantize to nearest palette color
      const [newR, newG, newB] = findNearestPaletteColor(oldR, oldG, oldB, palette);

      // Calculate quantization error
      const errorR = (oldR - newR) * errorIntensity;
      const errorG = (oldG - newG) * errorIntensity;
      const errorB = (oldB - newB) * errorIntensity;

      // Set quantized color
      data[idx] = newR;
      data[idx + 1] = newG;
      data[idx + 2] = newB;

      // Distribute error using Floyd-Steinberg weights
      // Right pixel (7/16)
      if (x < width - 1) {
        const rightIdx = (y * width + (x + 1)) * 4;
        data[rightIdx] = Math.max(0, Math.min(255, data[rightIdx] + errorR * 7 / 16));
        data[rightIdx + 1] = Math.max(0, Math.min(255, data[rightIdx + 1] + errorG * 7 / 16));
        data[rightIdx + 2] = Math.max(0, Math.min(255, data[rightIdx + 2] + errorB * 7 / 16));
      }

      // Bottom-left pixel (3/16)
      if (y < height - 1 && x > 0) {
        const bottomLeftIdx = ((y + 1) * width + (x - 1)) * 4;
        data[bottomLeftIdx] = Math.max(0, Math.min(255, data[bottomLeftIdx] + errorR * 3 / 16));
        data[bottomLeftIdx + 1] = Math.max(0, Math.min(255, data[bottomLeftIdx + 1] + errorG * 3 / 16));
        data[bottomLeftIdx + 2] = Math.max(0, Math.min(255, data[bottomLeftIdx + 2] + errorB * 3 / 16));
      }

      // Bottom pixel (5/16)
      if (y < height - 1) {
        const bottomIdx = ((y + 1) * width + x) * 4;
        data[bottomIdx] = Math.max(0, Math.min(255, data[bottomIdx] + errorR * 5 / 16));
        data[bottomIdx + 1] = Math.max(0, Math.min(255, data[bottomIdx + 1] + errorG * 5 / 16));
        data[bottomIdx + 2] = Math.max(0, Math.min(255, data[bottomIdx + 2] + errorB * 5 / 16));
      }

      // Bottom-right pixel (1/16)
      if (y < height - 1 && x < width - 1) {
        const bottomRightIdx = ((y + 1) * width + (x + 1)) * 4;
        data[bottomRightIdx] = Math.max(0, Math.min(255, data[bottomRightIdx] + errorR * 1 / 16));
        data[bottomRightIdx + 1] = Math.max(0, Math.min(255, data[bottomRightIdx + 1] + errorG * 1 / 16));
        data[bottomRightIdx + 2] = Math.max(0, Math.min(255, data[bottomRightIdx + 2] + errorB * 1 / 16));
      }
    }
  }

  return new ImageData(data, width, height);
};

// Jarvis, Judice, Ninke (JJN) error diffusion
export const applyJarvisJudiceNinkeDither = (
  imageData: ImageData,
  settings: DitherSettings
): ImageData => {
  const taps: ErrorDiffusionTap[] = [
    { dx: 1, dy: 0, weight: 7 }, { dx: 2, dy: 0, weight: 5 },
    { dx: -2, dy: 1, weight: 3 }, { dx: -1, dy: 1, weight: 5 }, { dx: 0, dy: 1, weight: 7 }, { dx: 1, dy: 1, weight: 5 }, { dx: 2, dy: 1, weight: 3 },
    { dx: -2, dy: 2, weight: 1 }, { dx: -1, dy: 2, weight: 3 }, { dx: 0, dy: 2, weight: 5 }, { dx: 1, dy: 2, weight: 3 }, { dx: 2, dy: 2, weight: 1 },
  ];
  return applyErrorDiffusionDither(imageData, settings, taps, 48);
};

// Stucki diffusion
export const applyStuckiDither = (
  imageData: ImageData,
  settings: DitherSettings
): ImageData => {
  const taps: ErrorDiffusionTap[] = [
    { dx: 1, dy: 0, weight: 8 }, { dx: 2, dy: 0, weight: 4 },
    { dx: -2, dy: 1, weight: 2 }, { dx: -1, dy: 1, weight: 4 }, { dx: 0, dy: 1, weight: 8 }, { dx: 1, dy: 1, weight: 4 }, { dx: 2, dy: 1, weight: 2 },
    { dx: -2, dy: 2, weight: 1 }, { dx: -1, dy: 2, weight: 2 }, { dx: 0, dy: 2, weight: 4 }, { dx: 1, dy: 2, weight: 2 }, { dx: 2, dy: 2, weight: 1 },
  ];
  return applyErrorDiffusionDither(imageData, settings, taps, 42);
};

// Burkes diffusion
export const applyBurkesDither = (
  imageData: ImageData,
  settings: DitherSettings
): ImageData => {
  const taps: ErrorDiffusionTap[] = [
    { dx: 1, dy: 0, weight: 8 }, { dx: 2, dy: 0, weight: 4 },
    { dx: -2, dy: 1, weight: 2 }, { dx: -1, dy: 1, weight: 4 }, { dx: 0, dy: 1, weight: 8 }, { dx: 1, dy: 1, weight: 4 }, { dx: 2, dy: 1, weight: 2 },
  ];
  return applyErrorDiffusionDither(imageData, settings, taps, 32);
};

// Sierra 3-row diffusion
export const applySierra3Dither = (
  imageData: ImageData,
  settings: DitherSettings
): ImageData => {
  const taps: ErrorDiffusionTap[] = [
    { dx: 1, dy: 0, weight: 5 }, { dx: 2, dy: 0, weight: 3 },
    { dx: -2, dy: 1, weight: 2 }, { dx: -1, dy: 1, weight: 4 }, { dx: 0, dy: 1, weight: 5 }, { dx: 1, dy: 1, weight: 4 }, { dx: 2, dy: 1, weight: 2 },
    { dx: -1, dy: 2, weight: 2 }, { dx: 0, dy: 2, weight: 3 }, { dx: 1, dy: 2, weight: 2 },
  ];
  return applyErrorDiffusionDither(imageData, settings, taps, 32);
};

// Sierra 2-row diffusion
export const applySierra2Dither = (
  imageData: ImageData,
  settings: DitherSettings
): ImageData => {
  const taps: ErrorDiffusionTap[] = [
    { dx: 1, dy: 0, weight: 4 }, { dx: 2, dy: 0, weight: 3 },
    { dx: -2, dy: 1, weight: 1 }, { dx: -1, dy: 1, weight: 2 }, { dx: 0, dy: 1, weight: 3 }, { dx: 1, dy: 1, weight: 2 }, { dx: 2, dy: 1, weight: 1 },
  ];
  return applyErrorDiffusionDither(imageData, settings, taps, 32);
};

/**
 * Bayer matrix ordered dithering with pressure sensitivity
 */
export const applyBayerDither = (
  imageData: ImageData,
  settings: DitherSettings
): ImageData => {
  const data = new Uint8ClampedArray(imageData.data);
  const width = imageData.width;
  const height = imageData.height;
  const palette = settings.palette;
  const offsetX = settings.phaseOffset?.x ?? 0;
  const offsetY = settings.phaseOffset?.y ?? 0;

  // Select Bayer matrix based on size
  let matrix: number[][];
  switch (settings.bayerMatrixSize) {
    case 2:
      matrix = BAYER_2x2_MATRIX;
      break;
    case 4:
      matrix = BAYER_4x4_MATRIX;
      break;
    case 8:
    default:
      matrix = BAYER_8x8_MATRIX;
      break;
  }

  const matrixSize = matrix.length;

  // Pressure affects threshold sensitivity
  const thresholdMultiplier = calculatePressureDitherThreshold(settings.pressure, settings.intensity, 0.2, 1.0);

  for (let y = 0; y < height; y++) {
    const leftToRight = (y & 1) === 0;
    const xStart = leftToRight ? 0 : width - 1;
    const xEnd = leftToRight ? width : -1;
    const xStep = leftToRight ? 1 : -1;

    for (let x = xStart; x !== xEnd; x += xStep) {
      const idx = (y * width + x) * 4;

      // Get Bayer threshold for this position
      const bayerValue = matrix[mod(y + offsetY, matrixSize)][mod(x + offsetX, matrixSize)];
      const threshold = (bayerValue - 0.5) * thresholdMultiplier * 128; // Scale to ±64

      const r = Math.max(0, Math.min(255, data[idx] + threshold));
      const g = Math.max(0, Math.min(255, data[idx + 1] + threshold));
      const b = Math.max(0, Math.min(255, data[idx + 2] + threshold));

      // Quantize to nearest palette color
      const [newR, newG, newB] = findNearestPaletteColor(r, g, b, palette);

      data[idx] = newR;
      data[idx + 1] = newG;
      data[idx + 2] = newB;
    }
  }

  return new ImageData(data, width, height);
};

/**
 * Atkinson dithering with pressure sensitivity
 * Developed by Bill Atkinson for the original Macintosh
 * Only diffuses 75% of the error for higher contrast
 * Error distribution matrix (each gets 1/8 of error):
 *     X   1   1
 *   1   1   1
 *       1
 */
export const applyAtkinsonDither = (
  imageData: ImageData,
  settings: DitherSettings
): ImageData => {
  const data = new Uint8ClampedArray(imageData.data);
  const width = imageData.width;
  const height = imageData.height;
  const palette = settings.palette;

  // Pressure affects error diffusion intensity (75% max for Atkinson)
  const errorIntensity = calculatePressureDitherThreshold(settings.pressure, settings.intensity) * 0.75;

  for (let y = 0; y < height; y++) {
    const leftToRight = (y & 1) === 0;
    const xStart = leftToRight ? 0 : width - 1;
    const xEnd = leftToRight ? width : -1;
    const xStep = leftToRight ? 1 : -1;

    for (let x = xStart; x !== xEnd; x += xStep) {
      const idx = (y * width + x) * 4;

      const oldR = data[idx];
      const oldG = data[idx + 1];
      const oldB = data[idx + 2];

      // Quantize to nearest palette color
      const [newR, newG, newB] = findNearestPaletteColor(oldR, oldG, oldB, palette);

      // Calculate quantization error (only 75% is distributed)
      const errorR = (oldR - newR) * errorIntensity;
      const errorG = (oldG - newG) * errorIntensity;
      const errorB = (oldB - newB) * errorIntensity;

      // Set quantized color
      data[idx] = newR;
      data[idx + 1] = newG;
      data[idx + 2] = newB;

      // Distribute error using Atkinson weights (1/8 each to 6 pixels)
      const weight = 1 / 8;

      // Right pixel
      if (x < width - 1) {
        const rightIdx = (y * width + (x + 1)) * 4;
        data[rightIdx] = Math.max(0, Math.min(255, data[rightIdx] + errorR * weight));
        data[rightIdx + 1] = Math.max(0, Math.min(255, data[rightIdx + 1] + errorG * weight));
        data[rightIdx + 2] = Math.max(0, Math.min(255, data[rightIdx + 2] + errorB * weight));
      }

      // Right+1 pixel
      if (x < width - 2) {
        const right2Idx = (y * width + (x + 2)) * 4;
        data[right2Idx] = Math.max(0, Math.min(255, data[right2Idx] + errorR * weight));
        data[right2Idx + 1] = Math.max(0, Math.min(255, data[right2Idx + 1] + errorG * weight));
        data[right2Idx + 2] = Math.max(0, Math.min(255, data[right2Idx + 2] + errorB * weight));
      }

      // Bottom-left pixel
      if (y < height - 1 && x > 0) {
        const bottomLeftIdx = ((y + 1) * width + (x - 1)) * 4;
        data[bottomLeftIdx] = Math.max(0, Math.min(255, data[bottomLeftIdx] + errorR * weight));
        data[bottomLeftIdx + 1] = Math.max(0, Math.min(255, data[bottomLeftIdx + 1] + errorG * weight));
        data[bottomLeftIdx + 2] = Math.max(0, Math.min(255, data[bottomLeftIdx + 2] + errorB * weight));
      }

      // Bottom pixel
      if (y < height - 1) {
        const bottomIdx = ((y + 1) * width + x) * 4;
        data[bottomIdx] = Math.max(0, Math.min(255, data[bottomIdx] + errorR * weight));
        data[bottomIdx + 1] = Math.max(0, Math.min(255, data[bottomIdx + 1] + errorG * weight));
        data[bottomIdx + 2] = Math.max(0, Math.min(255, data[bottomIdx + 2] + errorB * weight));
      }

      // Bottom-right pixel
      if (y < height - 1 && x < width - 1) {
        const bottomRightIdx = ((y + 1) * width + (x + 1)) * 4;
        data[bottomRightIdx] = Math.max(0, Math.min(255, data[bottomRightIdx] + errorR * weight));
        data[bottomRightIdx + 1] = Math.max(0, Math.min(255, data[bottomRightIdx + 1] + errorG * weight));
        data[bottomRightIdx + 2] = Math.max(0, Math.min(255, data[bottomRightIdx + 2] + errorB * weight));
      }

      // Bottom+1 pixel (2 rows down)
      if (y < height - 2) {
        const bottom2Idx = ((y + 2) * width + x) * 4;
        data[bottom2Idx] = Math.max(0, Math.min(255, data[bottom2Idx] + errorR * weight));
        data[bottom2Idx + 1] = Math.max(0, Math.min(255, data[bottom2Idx + 1] + errorG * weight));
        data[bottom2Idx + 2] = Math.max(0, Math.min(255, data[bottom2Idx + 2] + errorB * weight));
      }
    }
  }

  return new ImageData(data, width, height);
};

/**
 * Blue Noise dithering with pressure sensitivity
 * Uses a pre-computed blue noise pattern for organic-looking results
 * No directional artifacts, excellent for smooth gradients
 */
export const applyBlueNoiseDither = (
  imageData: ImageData,
  settings: DitherSettings
): ImageData => {
  const data = new Uint8ClampedArray(imageData.data);
  const width = imageData.width;
  const height = imageData.height;
  const palette = settings.palette;
  const offsetX = settings.phaseOffset?.x ?? 0;
  const offsetY = settings.phaseOffset?.y ?? 0;

  const matrixSize = BLUE_NOISE_16x16.length;

  // Pressure affects threshold sensitivity
  const thresholdMultiplier = calculatePressureDitherThreshold(settings.pressure, settings.intensity, 0.2, 1.0);

  for (let y = 0; y < height; y++) {
    const leftToRight = (y & 1) === 0;
    const xStart = leftToRight ? 0 : width - 1;
    const xEnd = leftToRight ? width : -1;
    const xStep = leftToRight ? 1 : -1;

    for (let x = xStart; x !== xEnd; x += xStep) {
      const idx = (y * width + x) * 4;

      // Get blue noise threshold for this position
      const noiseValue = BLUE_NOISE_16x16[mod(y + offsetY, matrixSize)][mod(x + offsetX, matrixSize)];
      const threshold = (noiseValue - 0.5) * thresholdMultiplier * 255;

      const r = Math.max(0, Math.min(255, data[idx] + threshold));
      const g = Math.max(0, Math.min(255, data[idx + 1] + threshold));
      const b = Math.max(0, Math.min(255, data[idx + 2] + threshold));

      // Quantize to nearest palette color
      const [newR, newG, newB] = findNearestPaletteColor(r, g, b, palette);

      data[idx] = newR;
      data[idx + 1] = newG;
      data[idx + 2] = newB;
    }
  }

  return new ImageData(data, width, height);
};

// Void-and-cluster ordered dithering (less regular than Bayer)
export const applyVoidAndClusterDither = (
  imageData: ImageData,
  settings: DitherSettings
): ImageData => {
  const data = new Uint8ClampedArray(imageData.data);
  const { width, height } = imageData;
  const palette = settings.palette;
  const matrix = VOID_CLUSTER_8x8;
  const matrixSize = matrix.length;
  const thresholdMultiplier = calculatePressureDitherThreshold(settings.pressure, settings.intensity, 0.2, 1.0);
  const offsetX = settings.phaseOffset?.x ?? 0;
  const offsetY = settings.phaseOffset?.y ?? 0;

  for (let y = 0; y < height; y++) {
    const leftToRight = (y & 1) === 0;
    const xStart = leftToRight ? 0 : width - 1;
    const xEnd = leftToRight ? width : -1;
    const xStep = leftToRight ? 1 : -1;

    for (let x = xStart; x !== xEnd; x += xStep) {
      const idx = (y * width + x) * 4;
      const vcVal = matrix[mod(y + offsetY, matrixSize)][mod(x + offsetX, matrixSize)];
      const threshold = (vcVal - 0.5) * thresholdMultiplier * 128;

      const r = Math.max(0, Math.min(255, data[idx] + threshold));
      const g = Math.max(0, Math.min(255, data[idx + 1] + threshold));
      const b = Math.max(0, Math.min(255, data[idx + 2] + threshold));

      const [newR, newG, newB] = findNearestPaletteColor(r, g, b, palette);
      data[idx] = newR;
      data[idx + 1] = newG;
      data[idx + 2] = newB;
    }
  }

  return new ImageData(data, width, height);
};

/**
 * Enhanced Sierra Lite dithering (reuses existing implementation concept but with pressure)
 * Error distribution matrix:
 *     X  2/4
 * 1/4 1/4
 */
export const applySierraLitePressureDither = (
  imageData: ImageData,
  settings: DitherSettings,
  serpentine: boolean = true
): ImageData => {
  const data = new Uint8ClampedArray(imageData.data);
  const width = imageData.width;
  const height = imageData.height;
  const palette = settings.palette;

  // Pressure affects error diffusion intensity
  const errorIntensity = calculatePressureDitherThreshold(settings.pressure, settings.intensity);

  for (let y = 0; y < height; y++) {
    const leftToRight = serpentine ? (y & 1) === 0 : true;
    const xStart = leftToRight ? 0 : width - 1;
    const xEnd = leftToRight ? width : -1;
    const xStep = leftToRight ? 1 : -1;

    for (let x = xStart; x !== xEnd; x += xStep) {
      const idx = (y * width + x) * 4;

      const oldR = data[idx];
      const oldG = data[idx + 1];
      const oldB = data[idx + 2];

      // Quantize to nearest palette color
      const [newR, newG, newB] = findNearestPaletteColor(oldR, oldG, oldB, palette);

      // Calculate quantization error
      const errorR = (oldR - newR) * errorIntensity;
      const errorG = (oldG - newG) * errorIntensity;
      const errorB = (oldB - newB) * errorIntensity;

      // Set quantized color
      data[idx] = newR;
      data[idx + 1] = newG;
      data[idx + 2] = newB;

      // Distribute error using Sierra Lite weights (mirrored on odd rows)
      if (leftToRight) {
        // Right pixel (2/4)
        if (x < width - 1) {
          const rightIdx = (y * width + (x + 1)) * 4;
          data[rightIdx] = Math.max(0, Math.min(255, data[rightIdx] + (errorR * 2) / 4));
          data[rightIdx + 1] = Math.max(0, Math.min(255, data[rightIdx + 1] + (errorG * 2) / 4));
          data[rightIdx + 2] = Math.max(0, Math.min(255, data[rightIdx + 2] + (errorB * 2) / 4));
        }

        // Bottom-left pixel (1/4)
        if (y < height - 1 && x > 0) {
          const bottomLeftIdx = ((y + 1) * width + (x - 1)) * 4;
          data[bottomLeftIdx] = Math.max(0, Math.min(255, data[bottomLeftIdx] + errorR / 4));
          data[bottomLeftIdx + 1] = Math.max(0, Math.min(255, data[bottomLeftIdx + 1] + errorG / 4));
          data[bottomLeftIdx + 2] = Math.max(0, Math.min(255, data[bottomLeftIdx + 2] + errorB / 4));
        }
      } else {
        // Left pixel (2/4) when scanning right-to-left
        if (x > 0) {
          const leftIdx = (y * width + (x - 1)) * 4;
          data[leftIdx] = Math.max(0, Math.min(255, data[leftIdx] + (errorR * 2) / 4));
          data[leftIdx + 1] = Math.max(0, Math.min(255, data[leftIdx + 1] + (errorG * 2) / 4));
          data[leftIdx + 2] = Math.max(0, Math.min(255, data[leftIdx + 2] + (errorB * 2) / 4));
        }

        // Bottom-right pixel (1/4)
        if (y < height - 1 && x < width - 1) {
          const bottomRightIdx = ((y + 1) * width + (x + 1)) * 4;
          data[bottomRightIdx] = Math.max(0, Math.min(255, data[bottomRightIdx] + errorR / 4));
          data[bottomRightIdx + 1] = Math.max(0, Math.min(255, data[bottomRightIdx + 1] + errorG / 4));
          data[bottomRightIdx + 2] = Math.max(0, Math.min(255, data[bottomRightIdx + 2] + errorB / 4));
        }
      }

      // Bottom pixel (1/4) – direction independent
      if (y < height - 1) {
        const bottomIdx = ((y + 1) * width + x) * 4;
        data[bottomIdx] = Math.max(0, Math.min(255, data[bottomIdx] + errorR / 4));
        data[bottomIdx + 1] = Math.max(0, Math.min(255, data[bottomIdx + 1] + errorG / 4));
        data[bottomIdx + 2] = Math.max(0, Math.min(255, data[bottomIdx + 2] + errorB / 4));
      }
    }
  }

  return new ImageData(data, width, height);
};

/**
 * Generate an edge mask that breaks up stroke boundaries using Sierra Lite dithering.
 * `coverage` is the alpha channel (0-255) for a stroke region.
 * Returns a per-pixel keep mask (0-255) to be multiplied with the existing alpha.
 */
export const applySierraLiteLostEdgeMask = (
  coverage: Uint8Array,
  width: number,
  height: number,
  lostEdge: number,
  tileSize: number = LOST_EDGE_TILE_DEFAULT
): Uint8ClampedArray => {
  const intensity = Math.max(0, Math.min(1, lostEdge / 100));
  const pixelCount = width * height;

  const tile = Math.max(LOST_EDGE_TILE_MIN, Math.min(LOST_EDGE_TILE_MAX, Math.round(tileSize || LOST_EDGE_TILE_DEFAULT)));
  const coarseW = Math.max(1, Math.ceil(width / tile));
  const coarseH = Math.max(1, Math.ceil(height / tile));
  const coarsePixelCount = coarseW * coarseH;

  const keepMask = new Uint8ClampedArray(pixelCount);
  const keepMaskCoarse = ensureScratch('keepCoarse', coarsePixelCount);
  const interiorMaskCoarse = ensureScratch('interiorCoarse', coarsePixelCount);
  const coarseCoverage = ensureScratch('coarseCoverage', coarsePixelCount);
  const distCoarse = ensureScratchU16('distCoarse', coarsePixelCount);
  keepMaskCoarse.fill(255);
  interiorMaskCoarse.fill(0);
  coarseCoverage.fill(0);
  distCoarse.fill(0);

  if (intensity <= 0 || pixelCount === 0 || coverage.length < pixelCount) {
    keepMask.fill(255);
    return keepMask;
  }

  // Downsample coverage into a coarse grid to reduce per-pixel work.
  let minAlpha = 255;
  for (let cy = 0; cy < coarseH; cy++) {
    for (let cx = 0; cx < coarseW; cx++) {
      let maxAlpha = 0;
      const startY = cy * tile;
      const startX = cx * tile;
      const endY = Math.min(height, startY + tile);
      const endX = Math.min(width, startX + tile);
      for (let y = startY; y < endY; y++) {
        const rowOffset = y * width;
        for (let x = startX; x < endX; x++) {
          const alpha = coverage[rowOffset + x];
          if (alpha > maxAlpha) maxAlpha = alpha;
        }
      }
      coarseCoverage[cy * coarseW + cx] = maxAlpha;
      if (maxAlpha < minAlpha) minAlpha = maxAlpha;
    }
  }

  // Edge band grows with intensity; clamp to avoid large kernels.
  // edgeBand is the thickness of the fade zone; bandRadius is search distance for edges.
  // Edge band target: eased mapping up to ~100px at max for dramatic edges, but with softer growth.
  const minDimPx = Math.min(width, height);
  const maxBandPx = Math.max(
    LOST_EDGE_BAND_MIN_PX,
    Math.min(
      LOST_EDGE_BAND_MAX_PX,
      Math.round(minDimPx * LOST_EDGE_MAX_DIM_FRACTION)
    )
  );
  const eased = Math.pow(intensity, LOST_EDGE_INTENSITY_EXP);
  const edgeBandPx = Math.max(
    LOST_EDGE_BAND_MIN_PX,
    Math.min(maxBandPx, Math.round(LOST_EDGE_BAND_MIN_PX + eased * (maxBandPx - LOST_EDGE_BAND_MIN_PX)))
  );
  const edgeBand = Math.max(1, Math.round(edgeBandPx / tile));
  // Search radius slightly larger than the band to find nearby transparency.
  const bandRadius = Math.max(edgeBand, Math.min(140, Math.round(edgeBand * LOST_EDGE_SEARCH_SCALE)));
  const fadeZone = Math.max(1, Math.round(edgeBand * LOST_EDGE_FADE_FRACTION));
  const effectiveFadeZone = Math.max(1, Math.min(fadeZone, Math.floor(Math.min(coarseW, coarseH) / 2)));

  // Early bailout for very small regions: lostedge becomes no-op to avoid overwork and artifacts.
  if (minDimPx < tile * LOST_EDGE_MIN_DIM_TILE_MULTIPLIER || (minAlpha === 255 && edgeBandPx <= LOST_EDGE_SOLID_SKIP_BAND_PX)) {
    keepMask.fill(255);
    return keepMask;
  }

  // Manhattan distance transform to nearest transparent/partial cell (O(N)).
  const INF = 0x3fff; // generous but fits in uint16
  for (let i = 0; i < coarsePixelCount; i++) {
    const alpha = coarseCoverage[i];
    distCoarse[i] = alpha === 0 || alpha < 255 ? 0 : INF;
  }

  // Forward pass
  for (let y = 0; y < coarseH; y++) {
    const rowOffset = y * coarseW;
    for (let x = 0; x < coarseW; x++) {
      const idx = rowOffset + x;
      let d = distCoarse[idx];
      if (d === 0) continue;
      if (x > 0) d = Math.min(d, distCoarse[idx - 1] + 1);
      if (y > 0) d = Math.min(d, distCoarse[rowOffset - coarseW + x] + 1);
      distCoarse[idx] = d;
    }
  }

  // Backward pass
  for (let y = coarseH - 1; y >= 0; y--) {
    const rowOffset = y * coarseW;
    for (let x = coarseW - 1; x >= 0; x--) {
      const idx = rowOffset + x;
      let d = distCoarse[idx];
      if (d === 0) continue;
      if (x + 1 < coarseW) d = Math.min(d, distCoarse[idx + 1] + 1);
      if (y + 1 < coarseH) d = Math.min(d, distCoarse[rowOffset + coarseW + x] + 1);
      distCoarse[idx] = d;
    }
  }

  const edgeField = new ImageData(coarseW, coarseH);
  const edgeData = edgeField.data;

  for (let y = 0; y < coarseH; y++) {
    const rowOffset = y * coarseW;
    for (let x = 0; x < coarseW; x++) {
      const idx = rowOffset + x;
      const alpha = coarseCoverage[idx];
      const rgbaIndex = idx * 4;

      if (alpha === 0) {
        edgeData[rgbaIndex] = 0;
        edgeData[rgbaIndex + 1] = 0;
        edgeData[rgbaIndex + 2] = 0;
        edgeData[rgbaIndex + 3] = 255;
        continue;
      }

      const dist = Math.min(distCoarse[idx], bandRadius);

      if (dist <= effectiveFadeZone) {
        const fade = Math.min(1, Math.max(0, (dist - 1) / effectiveFadeZone));
        const edgeWeight = Math.pow(1 - fade, 1.75);
        const erosion = Math.min(0.72, Math.pow(intensity, 0.25) * edgeWeight);
        const value = Math.max(0, Math.min(255, Math.round(255 * (1 - erosion))));
        edgeData[rgbaIndex] = value;
        edgeData[rgbaIndex + 1] = value;
        edgeData[rgbaIndex + 2] = value;
        edgeData[rgbaIndex + 3] = 255;
      } else {
        edgeData[rgbaIndex] = 255;
        edgeData[rgbaIndex + 1] = 255;
        edgeData[rgbaIndex + 2] = 255;
        edgeData[rgbaIndex + 3] = 255;
        interiorMaskCoarse[idx] = 1;
      }
    }
  }

  // Dither the edge gradient with Sierra Lite to create a patterned falloff.
  const dithered = applySierraLitePressureDither(
    edgeField,
    {
      algorithm: 'sierra-lite',
      pressure: 1 - Math.min(0.9, intensity * 0.8),
      intensity: 1,
      bayerMatrixSize: 4,
      palette: [
        [0, 0, 0],
        [255, 255, 255]
      ]
    },
    false // keep directional diffusion for predictable edge masks
  );

  const ditheredData = dithered.data;
  for (let i = 0; i < coarsePixelCount; i++) {
    keepMaskCoarse[i] = interiorMaskCoarse[i] ? 255 : ditheredData[i * 4];
  }

  // Upsample coarse mask back to source resolution using nearest-neighbor.
  for (let y = 0; y < height; y++) {
    const cy = Math.min(coarseH - 1, Math.floor(y / tile));
    const rowOffset = y * width;
    for (let x = 0; x < width; x++) {
      const cx = Math.min(coarseW - 1, Math.floor(x / tile));
      const coarseIndex = cy * coarseW + cx;
      keepMask[rowOffset + x] = keepMaskCoarse[coarseIndex];
    }
  }

  return keepMask;
};

/**
 * Pattern dithering with various styles
 * Creates texture-like dithering patterns using geometric shapes
 */
export const applyPatternDither = (
  imageData: ImageData,
  settings: DitherSettings
): ImageData => {
  const data = new Uint8ClampedArray(imageData.data);
  const width = imageData.width;
  const height = imageData.height;
  const palette = settings.palette;
  const patternStyle = settings.patternStyle || 'dots';
  const offsetX = settings.phaseOffset?.x ?? 0;
  const offsetY = settings.phaseOffset?.y ?? 0;

  // Pressure affects pattern density
  const thresholdMultiplier = calculatePressureDitherThreshold(settings.pressure, settings.intensity, 0.2, 1.0);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;

      // Get pattern threshold based on style
      let patternValue = 0;

      const px = x + offsetX;
      const py = y + offsetY;

      switch (patternStyle) {
        case 'dots': {
          // Circular dot pattern
          const dotSize = 4;
          const dx = mod(px, dotSize) - dotSize / 2;
          const dy = mod(py, dotSize) - dotSize / 2;
          const distance = Math.sqrt(dx * dx + dy * dy) / (dotSize / 2);
          patternValue = Math.min(1, distance);
          break;
        }
        case 'lines': {
          // Diagonal line pattern
          const lineSpacing = 4;
          const diagonal = mod(px + py, lineSpacing);
          patternValue = diagonal / lineSpacing;
          break;
        }
        case 'vertical-lines': {
          // Vertical line pattern
          const lineSpacing = 4;
          patternValue = mod(px, lineSpacing) / lineSpacing;
          break;
        }
        case 'horizontal-lines': {
          // Horizontal line pattern
          const lineSpacing = 4;
          patternValue = mod(py, lineSpacing) / lineSpacing;
          break;
        }
        case 'crosshatch': {
          // Crosshatch pattern
          const spacing = 4;
          const vertical = mod(px, spacing) / spacing;
          const horizontal = mod(py, spacing) / spacing;
          patternValue = Math.min(vertical, horizontal);
          break;
        }
        case 'diagonal': {
          // Diamond/diagonal pattern
          const spacing = 8;
          const dx = Math.abs(mod(px, spacing) - spacing / 2);
          const dy = Math.abs(mod(py, spacing) - spacing / 2);
          patternValue = (dx + dy) / spacing;
          break;
        }
        case 'ascii': {
          // ASCII-style glyph cells: tone picks a glyph bucket, hashed cells vary symbols.
          const lum = (data[idx] + data[idx + 1] + data[idx + 2]) / (3 * 255);
          const cellX = Math.floor(px / ASCII_CELL_WIDTH);
          const cellY = Math.floor(py / ASCII_CELL_HEIGHT);
          const glyphIndex = Math.max(
            0,
            Math.min(
              ASCII_GLYPH_BUCKETS.length - 1,
              Math.floor((1 - lum) * ASCII_GLYPH_BUCKETS.length)
            )
          );
          const glyphBucket = ASCII_GLYPH_BUCKETS[glyphIndex];
          const glyph = glyphBucket[hashCell(cellX, cellY) % glyphBucket.length];
          const glyphX = mod(px, ASCII_CELL_WIDTH);
          const glyphY = mod(py, ASCII_CELL_HEIGHT);
          const isInk = glyph[glyphY][glyphX] === '1';
          patternValue = isInk ? 0.12 : 0.88;
          break;
        }
        case 'tone-adaptive': {
          // Choose a cheap pattern based on local luminance so dark/mid/high differ.
          const lum = (data[idx] + data[idx + 1] + data[idx + 2]) / (3 * 255);
          if (lum < 0.33) {
            // Shadows: tight vertical lines
            const spacing = 3;
            patternValue = mod(px, spacing) / spacing;
          } else if (lum < 0.66) {
            // Midtones: dotted/diagonal mix
            const spacing = 4;
            const diag = mod(px + py, spacing);
            patternValue = diag / spacing;
          } else {
            // Highlights: horizontal lines, slightly looser
            const spacing = 5;
            patternValue = mod(py, spacing) / spacing;
          }
          break;
        }
      }

      // Apply threshold with pressure sensitivity
      const threshold = (patternValue - 0.5) * thresholdMultiplier * 128;

      const r = Math.max(0, Math.min(255, data[idx] + threshold));
      const g = Math.max(0, Math.min(255, data[idx + 1] + threshold));
      const b = Math.max(0, Math.min(255, data[idx + 2] + threshold));

      // Quantize to nearest palette color
      const [newR, newG, newB] = findNearestPaletteColor(r, g, b, palette);

      data[idx] = newR;
      data[idx + 1] = newG;
      data[idx + 2] = newB;
    }
  }

  return new ImageData(data, width, height);
};

/**
 * Main dithering function that routes to the appropriate algorithm
 */
export const applyPressureDither = (
  imageData: ImageData,
  settings: DitherSettings
): ImageData => {
  switch (settings.algorithm) {
    case 'floyd-steinberg':
      return applyFloydSteinbergDither(imageData, settings);
    case 'jarvis-judice-ninke':
      return applyJarvisJudiceNinkeDither(imageData, settings);
    case 'stucki':
      return applyStuckiDither(imageData, settings);
    case 'burkes':
      return applyBurkesDither(imageData, settings);
    case 'sierra-3':
      return applySierra3Dither(imageData, settings);
    case 'sierra-2':
      return applySierra2Dither(imageData, settings);
    case 'bayer':
      return applyBayerDither(imageData, settings);
    case 'sierra-lite':
      return applySierraLitePressureDither(imageData, settings);
    case 'atkinson':
      return applyAtkinsonDither(imageData, settings);
    case 'blue-noise':
      return applyBlueNoiseDither(imageData, settings);
    case 'void-and-cluster':
      return applyVoidAndClusterDither(imageData, settings);
    case 'pattern':
      return applyPatternDither(imageData, settings);
    default:
      debugWarn('raw-console', `Unknown dithering algorithm: ${settings.algorithm}`);
      return imageData;
  }
};

/**
 * Performance-optimized dithering for real-time drawing
 * Processes in chunks to prevent UI blocking
 */
export const applyPressureDitherChunked = (
  imageData: ImageData,
  settings: DitherSettings,
  chunkSize: number = 64,
  onProgress?: (progress: number) => void
): Promise<ImageData> => {
  return new Promise((resolve) => {
    const result = new ImageData(imageData.width, imageData.height);
    result.data.set(imageData.data);

    const height = imageData.height;
    let currentY = 0;

    const processChunk = () => {
      const endY = Math.min(currentY + chunkSize, height);

      // Create chunk ImageData
      const chunkHeight = endY - currentY;
      const chunkImageData = new ImageData(imageData.width, chunkHeight);
      const sourceStart = currentY * imageData.width * 4;
      const sourceEnd = sourceStart + chunkImageData.data.length;
      chunkImageData.data.set(imageData.data.subarray(sourceStart, sourceEnd));

      // Apply dithering to chunk
      const ditheredChunk = applyPressureDither(chunkImageData, settings);

      // Copy back to result
      result.data.set(ditheredChunk.data, sourceStart);

      currentY = endY;

      if (onProgress) {
        onProgress(currentY / height);
      }

      if (currentY < height) {
        // Continue processing next chunk
        requestAnimationFrame(processChunk);
      } else {
        // Finished
        resolve(result);
      }
    };

    processChunk();
  });
};

/**
 * Create grayscale palette for dithering
 */
export const createGrayscalePalette = (levels: number): [number, number, number][] => {
  const palette: [number, number, number][] = [];

  if (levels <= 0) {
    return [[0, 0, 0]]; // Default to black if invalid input
  }

  if (levels === 1) {
    return [[0, 0, 0]]; // Single level is black
  }

  for (let i = 0; i < levels; i++) {
    const value = Math.round((i / (levels - 1)) * 255);
    palette.push([value, value, value]);
  }
  return palette;
};

/**
 * Apple II authentic palette (reuse from existing system)
 */
export const APPLE_II_PALETTE: [number, number, number][] = [
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
