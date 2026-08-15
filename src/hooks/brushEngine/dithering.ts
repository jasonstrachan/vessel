import type {
  DitherSettings,
  DitherAlgorithm as DitherAlgorithmType,
  PatternStyle
} from '@/utils/ditherAlgorithms';
import { applyPressureDither } from '@/utils/ditherAlgorithms';
import { resolveDitherPalette, selectDynamicPalette } from './ditherPalette';
import { srgbToLinear } from './colorUtils';
export { findDitherColors, selectDiversePalette } from './ditherPalette';

export type SierraLiteVariety = {
  diversity: number;
  seed: number;
};

// Lookup table to avoid pow() per pixel in hot dithering paths
const SRGB_TO_LINEAR_LUT: Float32Array = new Float32Array(256);
for (let i = 0; i < 256; i++) {
  SRGB_TO_LINEAR_LUT[i] = srgbToLinear(i);
}

/**
 * Universal dithering function that routes to the appropriate algorithm
 */
export const applyDithering = (
  imageData: ImageData, 
  numColors: number, 
  algorithm?: string,
  patternStyle?: string,
  customPalette?: string[],  // Accept custom palette
  phaseOffset?: { x: number; y: number },
  imageTileThresholdResolver?: (x: number, y: number) => number | null,
  sierraLiteVariety?: SierraLiteVariety,
): ImageData => {
  const palette = resolveDitherPalette(imageData, numColors, customPalette);
  const resolvedAlgorithm = (algorithm as DitherAlgorithmType) || 'sierra-lite';
  const offsetX = phaseOffset?.x ?? 0;
  const offsetY = phaseOffset?.y ?? 0;
  const hasPhaseOffset = (offsetX | 0) !== 0 || (offsetY | 0) !== 0;
  const orderedPhaseAlgorithms = new Set(['bayer', 'pattern', 'void-and-cluster', 'blue-noise']);

  const shiftImageData = (source: ImageData, shiftX: number, shiftY: number): ImageData => {
    const { width, height, data } = source;
    const out = new Uint8ClampedArray(data.length);
    const sx = ((shiftX % width) + width) % width;
    const sy = ((shiftY % height) + height) % height;
    if (sx === 0 && sy === 0) {
      return source;
    }

    for (let y = 0; y < height; y += 1) {
      const srcY = (y + sy) % height;
      for (let x = 0; x < width; x += 1) {
        const srcX = (x + sx) % width;
        const srcIdx = (srcY * width + srcX) * 4;
        const dstIdx = (y * width + x) * 4;
        out[dstIdx] = data[srcIdx];
        out[dstIdx + 1] = data[srcIdx + 1];
        out[dstIdx + 2] = data[srcIdx + 2];
        out[dstIdx + 3] = data[srcIdx + 3];
      }
    }

    return new ImageData(out, width, height);
  };

  const input =
    hasPhaseOffset && !orderedPhaseAlgorithms.has(resolvedAlgorithm)
      ? shiftImageData(imageData, offsetX, offsetY)
      : imageData;

  const ditherSettings: DitherSettings = {
    algorithm: resolvedAlgorithm,
    pressure: 0.5,
    intensity: 1.0,
    bayerMatrixSize: 8,
    palette,
    patternStyle: (patternStyle as PatternStyle) || 'dots',
    phaseOffset: orderedPhaseAlgorithms.has(resolvedAlgorithm) || resolvedAlgorithm === 'sierra-lite'
      ? phaseOffset
      : undefined,
    imageTileThresholdResolver,
    sierraLiteVariety,
  };

  const dithered = applyPressureDither(input, ditherSettings);
  return hasPhaseOffset && !orderedPhaseAlgorithms.has(resolvedAlgorithm)
    ? shiftImageData(dithered, -offsetX, -offsetY)
    : dithered;
};

/**
 * Apply Sierra Lite dithering algorithm
 */
export const applySierraLiteDither = (imageData: ImageData, numColors: number, customPalette?: [number, number, number][]): ImageData => {
  const data = new Uint8ClampedArray(imageData.data);
  const width = imageData.width;
  const height = imageData.height;
  
  const palette = customPalette || selectDynamicPalette(imageData, numColors);
  const paletteLinear = new Float32Array(palette.length * 3);
  for (let i = 0; i < palette.length; i++) {
    const [r, g, b] = palette[i];
    const base = i * 3;
    paletteLinear[base] = SRGB_TO_LINEAR_LUT[r];
    paletteLinear[base + 1] = SRGB_TO_LINEAR_LUT[g];
    paletteLinear[base + 2] = SRGB_TO_LINEAR_LUT[b];
  }
  
  // Find nearest palette color using linear color space for accurate comparison
  const findNearestColor = (r: number, g: number, b: number): [number, number, number] => {
    let nearest = palette[0];
    let minDiff = Infinity;

    // Convert the source pixel color to linear space once
    const lr = SRGB_TO_LINEAR_LUT[r];
    const lg = SRGB_TO_LINEAR_LUT[g];
    const lb = SRGB_TO_LINEAR_LUT[b];
    
    for (let i = 0; i < palette.length; i++) {
      const color = palette[i];
      const base = i * 3;
      // Palette already in linear space
      const plr = paletteLinear[base];
      const plg = paletteLinear[base + 1];
      const plb = paletteLinear[base + 2];

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
    // Serpentine scan to avoid vertical banding artifacts
    const leftToRight = (y & 1) === 0;
    const xStart = leftToRight ? 0 : width - 1;
    const xEnd = leftToRight ? width : -1;
    const xStep = leftToRight ? 1 : -1;

    for (let x = xStart; x !== xEnd; x += xStep) {
      const idx = (y * width + x) * 4;
      
      // Get current RGB values (with accumulated error)
      const oldR = workingData[idx] < 0 ? 0 : workingData[idx] > 255 ? 255 : workingData[idx];
      const oldG = workingData[idx + 1] < 0 ? 0 : workingData[idx + 1] > 255 ? 255 : workingData[idx + 1];
      const oldB = workingData[idx + 2] < 0 ? 0 : workingData[idx + 2] > 255 ? 255 : workingData[idx + 2];
      
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
      // Keep noise deterministic during live preview to avoid flicker
      const noise1 = 0;
      const noise2 = 0;
      const noise3 = 0;
      
      if (leftToRight) {
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
      } else {
        // Left pixel (2/4 of error) when scanning right-to-left
        if (x > 0) {
          const leftIdx = (y * width + (x - 1)) * 4;
          workingData[leftIdx] += errorR * 0.5 + noise1;
          workingData[leftIdx + 1] += errorG * 0.5 + noise1;
          workingData[leftIdx + 2] += errorB * 0.5 + noise1;
        }

        // Bottom-right pixel (1/4 of error)
        if (y < height - 1 && x < width - 1) {
          const bottomRightIdx = ((y + 1) * width + (x + 1)) * 4;
          workingData[bottomRightIdx] += errorR * 0.25 + noise2;
          workingData[bottomRightIdx + 1] += errorG * 0.25 + noise2;
          workingData[bottomRightIdx + 2] += errorB * 0.25 + noise2;
        }
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
 * Apply dithering with fill resolution (for gradient fills)
 */
export const applyDitheringWithFillResolution = (
  imageData: ImageData, 
  numColors: number, 
  fillResolution: number,
  algorithm?: string,
  patternStyle?: string,
  customPalette?: string[],  // Accept custom palette
  phaseOffset?: { x: number; y: number },
  imageTileThresholdResolver?: (x: number, y: number) => number | null,
  sierraLiteVariety?: SierraLiteVariety,
): ImageData => {
  const pixelSize = Math.max(1, Math.floor(fillResolution));
  const resolvedAlgorithm = algorithm || 'sierra-lite';

  if (pixelSize <= 1) {
    return applyDithering(
      imageData,
      numColors,
      resolvedAlgorithm,
      patternStyle,
      customPalette,
      phaseOffset,
      imageTileThresholdResolver,
      sierraLiteVariety,
    );
  }

  if (resolvedAlgorithm === 'sierra-lite') {
    return applySierraLiteDitherWithPixelSize(
      imageData,
      numColors,
      pixelSize,
      customPalette,
      sierraLiteVariety,
    );
  }

  return downsampleDitherAndScale(
    imageData,
    numColors,
    pixelSize,
    resolvedAlgorithm,
    patternStyle,
    customPalette,
    phaseOffset,
    imageTileThresholdResolver,
    sierraLiteVariety,
  );
};

const applySierraLiteDitherWithPixelSize = (
  imageData: ImageData,
  numColors: number,
  pixelSize: number,
  customPalette?: string[],
  sierraLiteVariety?: SierraLiteVariety,
): ImageData => {
  return downsampleDitherAndScale(
    imageData,
    numColors,
    pixelSize,
    'sierra-lite',
    undefined,
    customPalette,
    undefined,
    undefined,
    sierraLiteVariety,
  );
};

const downsampleDitherAndScale = (
  imageData: ImageData,
  numColors: number,
  pixelSize: number,
  algorithm: string,
  patternStyle?: string,
  customPalette?: string[],
  phaseOffset?: { x: number; y: number },
  imageTileThresholdResolver?: (x: number, y: number) => number | null,
  sierraLiteVariety?: SierraLiteVariety,
): ImageData => {
  const downsampled = createDownsampledImageData(imageData, pixelSize);
  const resolvedPhase = phaseOffset
    ? {
        x: Math.floor(phaseOffset.x / pixelSize),
        y: Math.floor(phaseOffset.y / pixelSize)
      }
    : undefined;
  const dithered = applyDithering(
    downsampled,
    numColors,
    algorithm,
    patternStyle,
    customPalette,
    resolvedPhase,
    imageTileThresholdResolver,
    sierraLiteVariety,
  );
  return expandNearestNeighbor(dithered, imageData.width, imageData.height, pixelSize);
};

const createDownsampledImageData = (imageData: ImageData, blockSize: number): ImageData => {
  const width = imageData.width;
  const height = imageData.height;
  const blockWidth = Math.max(1, Math.ceil(width / blockSize));
  const blockHeight = Math.max(1, Math.ceil(height / blockSize));
  const blockData = new Uint8ClampedArray(blockWidth * blockHeight * 4);
  const source = imageData.data;

  // Preserve crisp color by sampling the highest-alpha pixel in each block (falls back to first pixel).
  for (let by = 0; by < blockHeight; by++) {
    const startY = by * blockSize;
    const endY = Math.min(startY + blockSize, height);
    for (let bx = 0; bx < blockWidth; bx++) {
      const startX = bx * blockSize;
      const endX = Math.min(startX + blockSize, width);

      let bestA = -1;
      let r = 0, g = 0, b = 0, a = 0;

      for (let y = startY; y < endY; y++) {
        for (let x = startX; x < endX; x++) {
          const idx = (y * width + x) * 4;
          const alpha = source[idx + 3];
          if (alpha > bestA) {
            bestA = alpha;
            r = source[idx];
            g = source[idx + 1];
            b = source[idx + 2];
            a = alpha;
          }
        }
      }

      const target = (by * blockWidth + bx) * 4;
      blockData[target] = r;
      blockData[target + 1] = g;
      blockData[target + 2] = b;
      blockData[target + 3] = a;
    }
  }

  return new ImageData(blockData, blockWidth, blockHeight);
};

const expandNearestNeighbor = (
  source: ImageData,
  targetWidth: number,
  targetHeight: number,
  blockSize: number
): ImageData => {
  const output = new ImageData(targetWidth, targetHeight);
  const out = output.data;
  const src = source.data;
  const blockWidth = source.width;
  const blockHeight = source.height;

  for (let by = 0; by < blockHeight; by++) {
    const startY = by * blockSize;
    const endY = Math.min(startY + blockSize, targetHeight);
    for (let bx = 0; bx < blockWidth; bx++) {
      const startX = bx * blockSize;
      const endX = Math.min(startX + blockSize, targetWidth);
      const srcIdx = (by * blockWidth + bx) * 4;
      const r = src[srcIdx];
      const g = src[srcIdx + 1];
      const b = src[srcIdx + 2];
      const a = src[srcIdx + 3];
      for (let y = startY; y < endY; y++) {
        for (let x = startX; x < endX; x++) {
          const idx = (y * targetWidth + x) * 4;
          out[idx] = r;
          out[idx + 1] = g;
          out[idx + 2] = b;
          out[idx + 3] = a;
        }
      }
    }
  }

  return output;
};
