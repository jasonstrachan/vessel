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
 * Select a dynamic palette based on image content
 */
const selectDynamicPalette = (
  imageData: ImageData, 
  numColors: number
): [number, number, number][] => {
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

/**
 * Universal dithering function that routes to the appropriate algorithm
 */
export const applyDithering = (
  imageData: ImageData, 
  numColors: number, 
  algorithm?: string,
  patternStyle?: string
): ImageData => {
  const palette = selectDynamicPalette(imageData, numColors);
  
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
      return applySierraLiteDither(imageData, numColors);
  }
};

/**
 * Apply Sierra Lite dithering algorithm
 */
export const applySierraLiteDither = (imageData: ImageData, numColors: number): ImageData => {
  const data = new Uint8ClampedArray(imageData.data);
  const width = imageData.width;
  const height = imageData.height;
  
  const palette = selectDynamicPalette(imageData, numColors);
  
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
 * Apply dithering with fill resolution (for gradient fills)
 */
export const applyDitheringWithFillResolution = (
  imageData: ImageData, 
  numColors: number, 
  fillResolution: number,
  algorithm?: string,
  patternStyle?: string
): ImageData => {
  // First scale down the image data
  const scaledWidth = Math.max(1, Math.floor(imageData.width / fillResolution));
  const scaledHeight = Math.max(1, Math.floor(imageData.height / fillResolution));
  
  // Create a smaller canvas for the block image
  const blockCanvas = document.createElement('canvas');
  blockCanvas.width = scaledWidth;
  blockCanvas.height = scaledHeight;
  const blockCtx = blockCanvas.getContext('2d')!;
  
  // Draw the original image scaled down
  const tempCanvas = document.createElement('canvas');
  tempCanvas.width = imageData.width;
  tempCanvas.height = imageData.height;
  const tempCtx = tempCanvas.getContext('2d')!;
  tempCtx.putImageData(imageData, 0, 0);
  
  blockCtx.imageSmoothingEnabled = false;
  blockCtx.drawImage(tempCanvas, 0, 0, scaledWidth, scaledHeight);
  
  const blockImageData = blockCtx.getImageData(0, 0, scaledWidth, scaledHeight);
  
  // Apply dithering to the scaled-down image
  const ditheredBlockImage = applyDithering(blockImageData, numColors, algorithm, patternStyle);
  
  // Scale back up to original resolution
  blockCtx.putImageData(ditheredBlockImage, 0, 0);
  
  const finalCanvas = document.createElement('canvas');
  finalCanvas.width = imageData.width;
  finalCanvas.height = imageData.height;
  const finalCtx = finalCanvas.getContext('2d')!;
  
  finalCtx.imageSmoothingEnabled = false;
  finalCtx.drawImage(blockCanvas, 0, 0, imageData.width, imageData.height);
  
  return finalCtx.getImageData(0, 0, imageData.width, imageData.height);
};