/**
 * Pressure-sensitive dithering algorithms for Vessel
 * Implements Floyd-Steinberg and Bayer matrix dithering with pressure control
 */

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

// Pre-computed 16x16 blue noise pattern for dithering
// This provides organic-looking dithering without visible patterns
const BLUE_NOISE_16x16 = [
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

export type DitherAlgorithm = 'floyd-steinberg' | 'bayer' | 'sierra-lite' | 'atkinson' | 'blue-noise' | 'pattern';
export type BayerMatrixSize = 2 | 4 | 8;
export type PatternStyle = 'dots' | 'lines' | 'vertical-lines' | 'horizontal-lines' | 'crosshatch' | 'diagonal';

export interface DitherSettings {
  algorithm: DitherAlgorithm;
  pressure: number; // 0-1
  intensity: number; // 0-1
  bayerMatrixSize: BayerMatrixSize;
  palette: [number, number, number][];
  patternStyle?: PatternStyle; // For pattern dithering
}

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
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      
      // Get Bayer threshold for this position
      const bayerValue = matrix[y % matrixSize][x % matrixSize];
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
    for (let x = 0; x < width; x++) {
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
  
  const matrixSize = BLUE_NOISE_16x16.length;
  
  // Pressure affects threshold sensitivity
  const thresholdMultiplier = calculatePressureDitherThreshold(settings.pressure, settings.intensity, 0.2, 1.0);
  
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      
      // Get blue noise threshold for this position
      const noiseValue = BLUE_NOISE_16x16[y % matrixSize][x % matrixSize];
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

/**
 * Enhanced Sierra Lite dithering (reuses existing implementation concept but with pressure)
 * Error distribution matrix:
 *     X  2/4
 * 1/4 1/4
 */
export const applySierraLitePressureDither = (
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
      
      // Distribute error using Sierra Lite weights
      // Right pixel (2/4)
      if (x < width - 1) {
        const rightIdx = (y * width + (x + 1)) * 4;
        data[rightIdx] = Math.max(0, Math.min(255, data[rightIdx] + errorR * 2 / 4));
        data[rightIdx + 1] = Math.max(0, Math.min(255, data[rightIdx + 1] + errorG * 2 / 4));
        data[rightIdx + 2] = Math.max(0, Math.min(255, data[rightIdx + 2] + errorB * 2 / 4));
      }
      
      // Bottom-left pixel (1/4)
      if (y < height - 1 && x > 0) {
        const bottomLeftIdx = ((y + 1) * width + (x - 1)) * 4;
        data[bottomLeftIdx] = Math.max(0, Math.min(255, data[bottomLeftIdx] + errorR * 1 / 4));
        data[bottomLeftIdx + 1] = Math.max(0, Math.min(255, data[bottomLeftIdx + 1] + errorG * 1 / 4));
        data[bottomLeftIdx + 2] = Math.max(0, Math.min(255, data[bottomLeftIdx + 2] + errorB * 1 / 4));
      }
      
      // Bottom pixel (1/4)
      if (y < height - 1) {
        const bottomIdx = ((y + 1) * width + x) * 4;
        data[bottomIdx] = Math.max(0, Math.min(255, data[bottomIdx] + errorR * 1 / 4));
        data[bottomIdx + 1] = Math.max(0, Math.min(255, data[bottomIdx + 1] + errorG * 1 / 4));
        data[bottomIdx + 2] = Math.max(0, Math.min(255, data[bottomIdx + 2] + errorB * 1 / 4));
      }
    }
  }
  
  return new ImageData(data, width, height);
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
  
  // Pressure affects pattern density
  const thresholdMultiplier = calculatePressureDitherThreshold(settings.pressure, settings.intensity, 0.2, 1.0);
  
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      
      // Get pattern threshold based on style
      let patternValue = 0;
      
      switch (patternStyle) {
        case 'dots': {
          // Circular dot pattern
          const dotSize = 4;
          const dx = x % dotSize - dotSize / 2;
          const dy = y % dotSize - dotSize / 2;
          const distance = Math.sqrt(dx * dx + dy * dy) / (dotSize / 2);
          patternValue = Math.min(1, distance);
          break;
        }
        case 'lines': {
          // Diagonal line pattern
          const lineSpacing = 4;
          const diagonal = (x + y) % lineSpacing;
          patternValue = diagonal / lineSpacing;
          break;
        }
        case 'vertical-lines': {
          // Vertical line pattern
          const lineSpacing = 4;
          patternValue = (x % lineSpacing) / lineSpacing;
          break;
        }
        case 'horizontal-lines': {
          // Horizontal line pattern
          const lineSpacing = 4;
          patternValue = (y % lineSpacing) / lineSpacing;
          break;
        }
        case 'crosshatch': {
          // Crosshatch pattern
          const spacing = 4;
          const vertical = (x % spacing) / spacing;
          const horizontal = (y % spacing) / spacing;
          patternValue = Math.min(vertical, horizontal);
          break;
        }
        case 'diagonal': {
          // Diamond/diagonal pattern
          const spacing = 8;
          const dx = Math.abs((x % spacing) - spacing / 2);
          const dy = Math.abs((y % spacing) - spacing / 2);
          patternValue = (dx + dy) / spacing;
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
    case 'bayer':
      return applyBayerDither(imageData, settings);
    case 'sierra-lite':
      return applySierraLitePressureDither(imageData, settings);
    case 'atkinson':
      return applyAtkinsonDither(imageData, settings);
    case 'blue-noise':
      return applyBlueNoiseDither(imageData, settings);
    case 'pattern':
      return applyPatternDither(imageData, settings);
    default:
      console.warn(`Unknown dithering algorithm: ${settings.algorithm}`);
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