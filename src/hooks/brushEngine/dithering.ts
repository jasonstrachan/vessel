/**
 * Dithering algorithms and palette selection
 * Extracted from useBrushEngine for better modularity
 */

import type { 
  DitherSettings, 
  DitherAlgorithm as DitherAlgorithmType,
  PatternStyle 
} from '@/utils/ditherAlgorithms';
import { 
  applyFloydSteinbergDither,
  applyBayerDither,
  applyAtkinsonDither,
  applyBlueNoiseDither,
  applyPatternDither
} from '@/utils/ditherAlgorithms';
import { srgbToLinear } from './colorUtils';
import { DITHER_PALETTE, DITHER_COLOR_NAMES } from './constants';

// Lookup table to avoid pow() per pixel in hot dithering paths
const SRGB_TO_LINEAR_LUT: Float32Array = new Float32Array(256);
for (let i = 0; i < 256; i++) {
  SRGB_TO_LINEAR_LUT[i] = srgbToLinear(i);
}

/**
 * Select a diverse palette of colors for dithering
 */
export const selectDiversePalette = (numColors: number): [number, number, number][] => {
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

/**
 * Find the two best colors for dithering a target color
 */
export const findDitherColors = (targetR: number, targetG: number, targetB: number) => {
  // Track which colors have been used (for debugging)
  const usedColorIndices = new Set<number>();
  
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
    ratio: ratio,
    usedColorIndices
  };
};

/**
 * Quantize a set of colors down to a smaller palette
 * Uses k-means-like clustering to find representative colors
 */
const quantizeColors = (
  colors: [number, number, number][],
  targetCount: number
): [number, number, number][] => {
  if (colors.length <= targetCount) return colors;
  
  // Remove duplicates first
  const uniqueColors = new Map<string, [number, number, number]>();
  colors.forEach(color => {
    const key = `${color[0]},${color[1]},${color[2]}`;
    if (!uniqueColors.has(key)) {
      uniqueColors.set(key, color);
    }
  });
  
  const unique = Array.from(uniqueColors.values());
  if (unique.length <= targetCount) return unique;
  
  // Select colors that represent the gradient well
  const selected: [number, number, number][] = [];
  
  // Always include first and last colors (gradient endpoints)
  if (unique.length > 0) {
    selected.push(unique[0]);
    if (targetCount > 1 && unique.length > 1) {
      selected.push(unique[unique.length - 1]);
    }
  }
  
  // Fill in intermediate colors
  if (targetCount > 2) {
    // Sample evenly from the remaining colors
    const step = Math.max(1, Math.floor((unique.length - 2) / (targetCount - 2)));
    for (let i = 1; i < unique.length - 1 && selected.length < targetCount; i += step) {
      selected.push(unique[i]);
    }
  }
  
  // If we still need more colors, add the most different ones
  const remaining = unique.filter(c => !selected.some(s => 
    s[0] === c[0] && s[1] === c[1] && s[2] === c[2]
  ));
  
  while (selected.length < targetCount && remaining.length > 0) {
    let maxMinDistance = -1;
    let bestIndex = 0;
    
    for (let i = 0; i < remaining.length; i++) {
      const candidate = remaining[i];
      let minDistance = Infinity;
      
      // Find minimum distance to any selected color
      for (const selectedColor of selected) {
        const dr = candidate[0] - selectedColor[0];
        const dg = candidate[1] - selectedColor[1];
        const db = candidate[2] - selectedColor[2];
        const distance = Math.sqrt(dr * dr + dg * dg + db * db);
        minDistance = Math.min(minDistance, distance);
      }
      
      // Track the candidate that's furthest from all selected colors
      if (minDistance > maxMinDistance) {
        maxMinDistance = minDistance;
        bestIndex = i;
      }
    }
    
    // Add the best candidate
    selected.push(remaining[bestIndex]);
    remaining.splice(bestIndex, 1);
  }
  
  return selected;
};

const parseCustomPaletteColors = (paletteStrings: string[]): [number, number, number][] => {
  return paletteStrings.map((color) => {
    if (color.startsWith('#')) {
      const hex = color.slice(1);
      const r = parseInt(hex.substring(0, 2), 16);
      const g = parseInt(hex.substring(2, 4), 16);
      const b = parseInt(hex.substring(4, 6), 16);
      return [r, g, b] as [number, number, number];
    }
    if (color.startsWith('rgb')) {
      const match = color.match(/\d+/g);
      if (match && match.length >= 3) {
        return [parseInt(match[0], 10), parseInt(match[1], 10), parseInt(match[2], 10)] as [number, number, number];
      }
    }
    return [0, 0, 0];
  });
};

const resolveDitherPalette = (
  imageData: ImageData,
  numColors: number,
  customPalette?: string[]
): [number, number, number][] => {
  if (customPalette && customPalette.length > 0) {
    const parsed = parseCustomPaletteColors(customPalette);
    if (parsed.length > numColors) {
      return quantizeColors(parsed, numColors);
    }
    return parsed;
  }
  return selectDynamicPalette(imageData, numColors);
};

/**
 * Select a dynamic palette based on image content
 * Extracts actual colors from the gradient instead of using predefined palette
 */
const selectDynamicPalette = (
  imageData: ImageData, 
  numColors: number
): [number, number, number][] => {
  const data = imageData.data;
  const colorMap = new Map<string, { color: [number, number, number], count: number }>();
  
  // Sample colors from the image
  const sampleStep = Math.max(1, Math.floor(data.length / (4 * 10000))); // Sample more points
  
  for (let i = 0; i < data.length; i += sampleStep * 4) {
    if (data[i + 3] > 128) { // Only consider opaque pixels
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      
      // Quantize to reduce similar colors (group into buckets of 8)
      const qr = Math.round(r / 8) * 8;
      const qg = Math.round(g / 8) * 8;
      const qb = Math.round(b / 8) * 8;
      
      const key = `${qr},${qg},${qb}`;
      const existing = colorMap.get(key);
      if (existing) {
        existing.count++;
      } else {
        colorMap.set(key, { color: [qr, qg, qb], count: 1 });
      }
    }
  }
  
  // If no colors found, fall back to default palette
  if (colorMap.size === 0) {
    debugLog('dithering', 'No colors found in image, using default palette');
    return DITHER_PALETTE.slice(0, numColors);
  }
  
  // Sort colors by frequency and diversity
  const colors = Array.from(colorMap.values());
  colors.sort((a, b) => b.count - a.count);
  
  debugLog('dithering', 'Colors found in image:', colors.slice(0, 10).map(c => ({
    color: `rgb(${c.color[0]}, ${c.color[1]}, ${c.color[2]})`,
    count: c.count
  })));
  
  // Select colors based on both frequency and color diversity
  const selectedColors: [number, number, number][] = [];
  const usedColorKeys = new Set<string>();
  
  // K-means clustering to find representative colors
  if (colors.length <= numColors) {
    // If we have fewer unique colors than requested, use them all
    colors.forEach(c => selectedColors.push(c.color));
  } else {
    // Use a simple color selection algorithm
    // 1. Add the most frequent color
    if (colors.length > 0 && numColors > 0) {
      selectedColors.push(colors[0].color);
      usedColorKeys.add(`${colors[0].color[0]},${colors[0].color[1]},${colors[0].color[2]}`);
    }
    
    // 2. Add colors that are most different from already selected ones
    while (selectedColors.length < numColors && colors.length > selectedColors.length) {
      let bestCandidate = null;
      let maxMinDistance = -1;
      
      for (const candidate of colors) {
        const key = `${candidate.color[0]},${candidate.color[1]},${candidate.color[2]}`;
        if (usedColorKeys.has(key)) continue;
        
        // Find minimum distance to already selected colors
        let minDistance = Infinity;
        for (const selected of selectedColors) {
          const dr = candidate.color[0] - selected[0];
          const dg = candidate.color[1] - selected[1];
          const db = candidate.color[2] - selected[2];
          const distance = Math.sqrt(dr * dr + dg * dg + db * db);
          minDistance = Math.min(minDistance, distance);
        }
        
        // Weight by both distance and frequency
        const weightedScore = minDistance * Math.sqrt(candidate.count);
        
        if (weightedScore > maxMinDistance) {
          maxMinDistance = weightedScore;
          bestCandidate = candidate;
        }
      }
      
      if (bestCandidate) {
        selectedColors.push(bestCandidate.color);
        const key = `${bestCandidate.color[0]},${bestCandidate.color[1]},${bestCandidate.color[2]}`;
        usedColorKeys.add(key);
      } else {
        break;
      }
    }
  }
  
  // If we still don't have enough colors, add some from the default palette
  if (selectedColors.length < numColors) {
    const remaining = numColors - selectedColors.length;
    const defaultColors = DITHER_PALETTE.slice(0, remaining);
    defaultColors.forEach(c => {
      const key = `${c[0]},${c[1]},${c[2]}`;
      if (!usedColorKeys.has(key)) {
        selectedColors.push(c);
      }
    });
  }
  
  debugLog('dithering', 'Final selected palette for dithering:', selectedColors.map(c => 
    `rgb(${c[0]}, ${c[1]}, ${c[2]})`
  ));
  
  return selectedColors;
};

/**
 * Universal dithering function that routes to the appropriate algorithm
 */
export const applyDithering = (
  imageData: ImageData, 
  numColors: number, 
  algorithm?: string,
  patternStyle?: string,
  customPalette?: string[]  // Accept custom palette
): ImageData => {
  const palette = resolveDitherPalette(imageData, numColors, customPalette);
  
  // Create dither settings
  const ditherSettings: DitherSettings = {
    algorithm: (algorithm as DitherAlgorithmType) || 'sierra-lite',
    pressure: 0.5,
    intensity: 1.0,
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
      return applySierraLiteDither(imageData, numColors, palette);
  }
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
  customPalette?: string[]  // Accept custom palette
): ImageData => {
  const pixelSize = Math.max(1, Math.floor(fillResolution));
  const resolvedAlgorithm = algorithm || 'sierra-lite';

  if (pixelSize <= 1) {
    return applyDithering(imageData, numColors, resolvedAlgorithm, patternStyle, customPalette);
  }

  if (resolvedAlgorithm === 'sierra-lite') {
    return applySierraLiteDitherWithPixelSize(
      imageData,
      numColors,
      pixelSize,
      customPalette
    );
  }

  return downsampleDitherAndScale(
    imageData,
    numColors,
    pixelSize,
    resolvedAlgorithm,
    patternStyle,
    customPalette
  );
};

const applySierraLiteDitherWithPixelSize = (
  imageData: ImageData,
  numColors: number,
  pixelSize: number,
  customPalette?: string[]
): ImageData => {
  return downsampleDitherAndScale(
    imageData,
    numColors,
    pixelSize,
    'sierra-lite',
    undefined,
    customPalette
  );
};

const downsampleDitherAndScale = (
  imageData: ImageData,
  numColors: number,
  pixelSize: number,
  algorithm: string,
  patternStyle?: string,
  customPalette?: string[]
): ImageData => {
  const downsampled = createDownsampledImageData(imageData, pixelSize);
  const dithered = applyDithering(downsampled, numColors, algorithm, patternStyle, customPalette);
  return expandNearestNeighbor(dithered, imageData.width, imageData.height, pixelSize);
};

const createDownsampledImageData = (imageData: ImageData, blockSize: number): ImageData => {
  const width = imageData.width;
  const height = imageData.height;
  const blockWidth = Math.max(1, Math.ceil(width / blockSize));
  const blockHeight = Math.max(1, Math.ceil(height / blockSize));
  const blockData = new Uint8ClampedArray(blockWidth * blockHeight * 4);
  const source = imageData.data;

  for (let by = 0; by < blockHeight; by++) {
    const startY = by * blockSize;
    const endY = Math.min(startY + blockSize, height);
    for (let bx = 0; bx < blockWidth; bx++) {
      const startX = bx * blockSize;
      const endX = Math.min(startX + blockSize, width);
      let sumR = 0;
      let sumG = 0;
      let sumB = 0;
      let sumA = 0;
      let count = 0;
      for (let y = startY; y < endY; y++) {
        for (let x = startX; x < endX; x++) {
          const idx = (y * width + x) * 4;
          sumR += source[idx];
          sumG += source[idx + 1];
          sumB += source[idx + 2];
          sumA += source[idx + 3];
          count++;
        }
      }
      const target = (by * blockWidth + bx) * 4;
      if (count === 0) {
        blockData[target] = 0;
        blockData[target + 1] = 0;
        blockData[target + 2] = 0;
        blockData[target + 3] = 0;
      } else {
        blockData[target] = Math.round(sumR / count);
        blockData[target + 1] = Math.round(sumG / count);
        blockData[target + 2] = Math.round(sumB / count);
        blockData[target + 3] = Math.round(sumA / count);
      }
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
import { debugLog } from '@/utils/debug';
