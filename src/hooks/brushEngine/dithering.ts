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
    console.log('No colors found in image, using default palette');
    return DITHER_PALETTE.slice(0, numColors);
  }
  
  // Sort colors by frequency and diversity
  const colors = Array.from(colorMap.values());
  colors.sort((a, b) => b.count - a.count);
  
  console.log('Colors found in image:', colors.slice(0, 10).map(c => ({
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
  
  console.log('Final selected palette for dithering:', selectedColors.map(c => 
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
  // Convert custom palette strings to RGB tuples, or use dynamic extraction
  let palette: [number, number, number][];
  
  if (customPalette && customPalette.length > 0) {
    // console.log('Using custom palette:', customPalette);
    // Parse the custom palette colors
    const parsedColors = customPalette.map(color => {
      // Parse hex or rgb color strings
      if (color.startsWith('#')) {
        const hex = color.slice(1);
        const r = parseInt(hex.substr(0, 2), 16);
        const g = parseInt(hex.substr(2, 2), 16);
        const b = parseInt(hex.substr(4, 2), 16);
        return [r, g, b] as [number, number, number];
      } else if (color.startsWith('rgb')) {
        const match = color.match(/\d+/g);
        if (match && match.length >= 3) {
          return [parseInt(match[0]), parseInt(match[1]), parseInt(match[2])] as [number, number, number];
        }
      }
      // Fallback to black if parsing fails
      return [0, 0, 0] as [number, number, number];
    });
    
    // Reduce palette to numColors using color quantization
    if (parsedColors.length > numColors) {
      palette = quantizeColors(parsedColors, numColors);
    } else {
      palette = parsedColors;
    }
    
    // console.log(`Reduced palette from ${customPalette.length} to ${palette.length} colors`);
  } else {
    palette = selectDynamicPalette(imageData, numColors);
  }
  
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
  patternStyle?: string,
  customPalette?: string[]  // Accept custom palette
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
  const ditheredBlockImage = applyDithering(blockImageData, numColors, algorithm, patternStyle, customPalette);
  
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