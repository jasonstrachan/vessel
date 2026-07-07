import { debugLog } from '@/utils/debug';

import { DITHER_COLOR_NAMES, DITHER_PALETTE } from './constants';

export type RgbColor = [number, number, number];

/**
 * Select a diverse palette of colors for dithering
 */
export const selectDiversePalette = (numColors: number): RgbColor[] => {
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
      DITHER_PALETTE[1],  // White
    ];
  }

  // For 5+ colors, include some browns/colors
  const selectedColors: RgbColor[] = [];

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
  const colorDistances: Array<{
    index: number;
    distance: number;
    color: RgbColor;
    name: string;
  }> = DITHER_PALETTE.map(([r, g, b], index) => {
    // Use weighted Euclidean distance for better perceptual accuracy
    // Human eyes are more sensitive to green, then red, then blue
    const dr = targetR - r;
    const dg = targetG - g;
    const db = targetB - b;
    const distance = Math.sqrt(dr * dr * 0.3 + dg * dg * 0.59 + db * db * 0.11);
    return { index, distance, color: [r, g, b] as RgbColor, name: DITHER_COLOR_NAMES[index] };
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
    ratio,
    usedColorIndices,
  };
};

/**
 * Quantize a set of colors down to a smaller palette
 * Uses k-means-like clustering to find representative colors
 */
const quantizeColors = (
  colors: RgbColor[],
  targetCount: number
): RgbColor[] => {
  if (colors.length <= targetCount) return colors;

  // Remove duplicates first
  const uniqueColors = new Map<string, RgbColor>();
  colors.forEach(color => {
    const key = `${color[0]},${color[1]},${color[2]}`;
    if (!uniqueColors.has(key)) {
      uniqueColors.set(key, color);
    }
  });

  const unique = Array.from(uniqueColors.values());
  if (unique.length <= targetCount) return unique;

  // Select colors that represent the gradient well
  const selected: RgbColor[] = [];

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

const parseCustomPaletteColors = (paletteStrings: string[]): RgbColor[] => {
  return paletteStrings.map((color) => {
    if (color.startsWith('#')) {
      const hex = color.slice(1);
      const r = parseInt(hex.substring(0, 2), 16);
      const g = parseInt(hex.substring(2, 4), 16);
      const b = parseInt(hex.substring(4, 6), 16);
      return [r, g, b] as RgbColor;
    }
    if (color.startsWith('rgb')) {
      const match = color.match(/\d+/g);
      if (match && match.length >= 3) {
        return [parseInt(match[0], 10), parseInt(match[1], 10), parseInt(match[2], 10)] as RgbColor;
      }
    }
    return [0, 0, 0];
  });
};

export const resolveDitherPalette = (
  imageData: ImageData,
  numColors: number,
  customPalette?: string[]
): RgbColor[] => {
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
export const selectDynamicPalette = (
  imageData: ImageData,
  numColors: number
): RgbColor[] => {
  const data = imageData.data;
  const colorMap = new Map<string, { color: RgbColor; count: number }>();

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
    count: c.count,
  })));

  // Select colors based on both frequency and color diversity
  const selectedColors: RgbColor[] = [];
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
