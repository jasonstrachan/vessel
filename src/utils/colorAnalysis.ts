// Color analysis utilities for extracting most used colors from canvas

import type { Project, Layer } from '../types';

/**
 * Convert RGB values to hex string
 */
function rgbToHex(r: number, g: number, b: number): string {
  return "#" + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
}

/**
 * Quantize color to reduce similar colors
 * This groups similar colors together to avoid too many tiny variations
 */
function quantizeColor(r: number, g: number, b: number, levels: number = 32): string {
  const step = 256 / levels;
  const quantizedR = Math.floor(r / step) * step;
  const quantizedG = Math.floor(g / step) * step;
  const quantizedB = Math.floor(b / step) * step;
  return rgbToHex(quantizedR, quantizedG, quantizedB);
}

/**
 * Analyze ImageData to extract color frequencies
 */
function analyzeImageData(imageData: ImageData): Map<string, number> {
  const colorCount = new Map<string, number>();
  const data = imageData.data;
  
  // Sample every 4th pixel for performance (can be adjusted)
  const sampleRate = 4;
  
  for (let i = 0; i < data.length; i += 4 * sampleRate) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const a = data[i + 3];
    
    // Skip fully transparent pixels
    if (a < 10) continue;
    
    // Skip near-white pixels (often background)
    if (r > 250 && g > 250 && b > 250) continue;
    
    const color = quantizeColor(r, g, b);
    colorCount.set(color, (colorCount.get(color) || 0) + 1);
  }
  
  return colorCount;
}

/**
 * Extract the most commonly used colors from a project
 */
export function getMostUsedColors(project: Project | null, maxColors: number = 10): string[] {
  if (!project || !project.layers.length) {
    // Return empty array if no project
    return [];
  }
  
  const globalColorCount = new Map<string, number>();
  
  // Analyze all visible layers
  for (const layer of project.layers) {
    if (!layer.visible || !layer.imageData) continue;
    
    const layerColors = analyzeImageData(layer.imageData);
    
    // Merge layer colors into global count, weighted by layer opacity
    for (const [color, count] of layerColors) {
      const weightedCount = Math.round(count * layer.opacity);
      globalColorCount.set(color, (globalColorCount.get(color) || 0) + weightedCount);
    }
  }
  
  // Sort colors by frequency and return top N
  const sortedColors = Array.from(globalColorCount.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, maxColors)
    .map(([color]) => color);
  
  return sortedColors;
}

/**
 * Get a live color palette that updates when the project changes
 * This version analyzes the current canvas state
 */
export function getLiveColorPalette(canvas: HTMLCanvasElement | null, maxColors: number = 10): string[] {
  if (!canvas) {
    return [];
  }
  
  try {
    const ctx = canvas.getContext('2d', { willReadFrequently: true, colorSpace: 'srgb' });
    if (!ctx) return [];
    
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const colorCount = analyzeImageData(imageData);
    
    const sortedColors = Array.from(colorCount.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, maxColors)
      .map(([color]) => color);
    
    return sortedColors;
  } catch (error) {
    console.warn('Failed to analyze canvas colors:', error);
    return [];
  }
}

/**
 * Convert hex color to HSL for sorting
 */
function hexToHsl(hex: string): { h: number; s: number; l: number } {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h, s;
  const l = (max + min) / 2;
  
  if (max === min) {
    h = s = 0; // achromatic
  } else {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      case b: h = (r - g) / d + 4; break;
      default: h = 0;
    }
    h /= 6;
  }
  
  return { h: h * 360, s: s * 100, l: l * 100 };
}

/**
 * Sort colors by hue and lightness for smooth color cycling
 */
function sortColorsForCycling(colors: string[]): string[] {
  return colors.sort((a, b) => {
    const hslA = hexToHsl(a);
    const hslB = hexToHsl(b);
    
    // Sort primarily by hue, then by lightness
    if (Math.abs(hslA.h - hslB.h) > 5) {
      return hslA.h - hslB.h;
    }
    return hslA.l - hslB.l;
  });
}

/**
 * Extract the most commonly used colors from specific layers
 */
export function extractColorsFromLayers(layers: Layer[], maxColors: number = 10): string[] {
  if (!layers.length) {
    return [];
  }
  
  const globalColorCount = new Map<string, number>();
  
  // Analyze only the specified layers
  for (const layer of layers) {
    if (!layer.visible || !layer.imageData) continue;
    
    const layerColors = analyzeImageData(layer.imageData);
    
    // Merge layer colors into global count, weighted by layer opacity
    for (const [color, count] of layerColors) {
      const weightedCount = Math.round(count * layer.opacity);
      globalColorCount.set(color, (globalColorCount.get(color) || 0) + weightedCount);
    }
  }
  
  // Sort colors by frequency and return top N
  const frequentColors = Array.from(globalColorCount.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, maxColors)
    .map(([color]) => color);
  
  // Sort the frequent colors by hue and lightness for smooth cycling
  const sortedColors = sortColorsForCycling(frequentColors);
  
  // Don't add default colors - only return what's actually in the image
  return sortedColors;
}

/**
 * Extract colors from a selection area of ImageData
 */
export function extractColorsFromSelection(imageData: ImageData, bounds: { x: number; y: number; width: number; height: number }, maxColors: number = 10): string[] {
  if (!imageData) {
    return [];
  }
  
  try {
    // Create a new ImageData for just the selection bounds
    const selectionData = new ImageData(bounds.width, bounds.height);
    const sourceData = imageData.data;
    const targetData = selectionData.data;
    
    // Copy pixels from the selection bounds
    for (let y = 0; y < bounds.height; y++) {
      for (let x = 0; x < bounds.width; x++) {
        const sourceX = bounds.x + x;
        const sourceY = bounds.y + y;
        
        // Check bounds
        if (sourceX >= 0 && sourceX < imageData.width && sourceY >= 0 && sourceY < imageData.height) {
          const sourceIndex = (sourceY * imageData.width + sourceX) * 4;
          const targetIndex = (y * bounds.width + x) * 4;
          
          targetData[targetIndex] = sourceData[sourceIndex];
          targetData[targetIndex + 1] = sourceData[sourceIndex + 1];
          targetData[targetIndex + 2] = sourceData[sourceIndex + 2];
          targetData[targetIndex + 3] = sourceData[sourceIndex + 3];
        }
      }
    }
    
    const colorCount = analyzeImageData(selectionData);
    
    const sortedColors = Array.from(colorCount.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, maxColors)
      .map(([color]) => color);
    
    return sortedColors;
  } catch (error) {
    console.warn('Failed to analyze selection colors:', error);
    return [];
  }
}