'use client';

import { useCallback, useRef } from 'react';
import { useAppStore } from '../stores/useAppStore';
import { BrushComponent, ComponentType, BrushShape, CustomBrush } from '../types';
import { shouldApplyGridSnap, snapToGrid, getGridPositionsBetween, calculateGridDimensions, snapToRectangularGrid, getRectangularGridPositionsBetween } from '../utils/gridSnap';
import { canvasPool } from '../utils/canvasPool';
import { brushCache } from '../utils/brushCache';
import { scaledBrushCache } from '../utils/scaledBrushCache';
import { pressureOptimizer } from '../utils/pressureOptimizer';
import { memoryManager } from '../utils/memoryCleanup';
import { performanceMonitor } from '../utils/performanceMonitor';
import { adjustHueAndSaturation } from '../utils/imageProcessing';

// Cache for pre-rendered pixel circle stamps
const pixelCircleStampCache = new Map<string, HTMLCanvasElement>();

// Color jitter utility function
// Cache for color jitter canvas context (reused across all calls)
let jitterCanvas: HTMLCanvasElement | null = null;
let jitterCtx: CanvasRenderingContext2D | null = null;

// Cache for pattern rendering temp canvas (reused for all pattern operations)
let patternTempCanvas: HTMLCanvasElement | null = null;
let patternTempCtx: CanvasRenderingContext2D | null = null;

// Risograph texture cache
let risographTexture: HTMLCanvasElement | null = null;
let risographTextureData: Uint8ClampedArray | null = null;

// Reusable texture canvas for riso operations
let risoTextureCanvas: HTMLCanvasElement | null = null;
let risoTextureCtx: CanvasRenderingContext2D | null = null;

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

// --- OPTIMIZATION: Riso Effect Throttling ---
// Throttle riso operations to improve performance during continuous drawing
const risoThrottleState = {
  lastProcessTime: 0,
  throttleInterval: 16, // ~60fps throttling for riso operations
  aggressiveThrottleInterval: 33, // ~30fps for continuous strokes
  lastRisoCanvas: null as HTMLCanvasElement | null,
  lastRisoSettings: { intensity: 0, size: 0, x: 0, y: 0 },
  continuousStrokeCount: 0,
};

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

/**
 * Creates a tileable, monochromatic noise texture for film grain effect.
 * This is cached and reused for performance. Used by gradient functions.
 */
const createNoiseTexture = (): HTMLCanvasElement => {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d', { colorSpace: 'srgb' });

  if (!ctx) return canvas;

  const imageData = ctx.createImageData(size, size);
  const data = imageData.data;

  for (let i = 0; i < data.length; i += 4) {
    const value = Math.random() * 255;
    data[i] = value;
    data[i + 1] = value;
    data[i + 2] = value;
    data[i + 3] = 255;
  }

  ctx.putImageData(imageData, 0, 0);
  return canvas;
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
  
  // Authentic Apple II color palette (RGB values)
  const appleIIPalette: [number, number, number][] = [
    [0, 0, 0],         // Black
    [148, 41, 66],     // Magenta
    [33, 33, 165],     // Dark Blue
    [195, 65, 229],    // Purple
    [0, 99, 66],       // Dark Green
    [99, 99, 99],      // Dark Gray
    [33, 132, 229],    // Medium Blue
    [148, 165, 255],   // Light Blue
    [99, 66, 0],       // Brown
    [229, 99, 0],      // Orange
    [148, 148, 148],   // Light Gray
    [255, 148, 148],   // Pink
    [0, 195, 0],       // Green
    [195, 195, 0],     // Yellow
    [148, 255, 148],   // Aquamarine
    [255, 255, 255]    // White
  ];
  
  // Select best Apple II colors for this image based on content
  const selectBestColors = (imageData: ImageData, numColors: number): [number, number, number][] => {
    if (numColors >= appleIIPalette.length) return appleIIPalette;
    
    // Sample pixels from the image to find dominant colors
    const sampleColors: [number, number, number][] = [];
    const data = imageData.data;
    const step = Math.max(1, Math.floor(data.length / (4 * 100))); // Sample ~100 pixels
    
    for (let i = 0; i < data.length; i += step * 4) {
      sampleColors.push([data[i], data[i + 1], data[i + 2]]);
    }
    
    // Score each Apple II color by how well it represents the image
    const colorScores = appleIIPalette.map((appleColor, index) => {
      let totalDistance = 0;
      let bestMatches = 0;
      
      sampleColors.forEach(sampleColor => {
        const distance = Math.sqrt(
          (sampleColor[0] - appleColor[0])**2 + 
          (sampleColor[1] - appleColor[1])**2 + 
          (sampleColor[2] - appleColor[2])**2
        );
        
        // Check if this Apple II color is the best match for this sample
        const isBestMatch = appleIIPalette.every(otherColor => {
          const otherDistance = Math.sqrt(
            (sampleColor[0] - otherColor[0])**2 + 
            (sampleColor[1] - otherColor[1])**2 + 
            (sampleColor[2] - otherColor[2])**2
          );
          return distance <= otherDistance;
        });
        
        if (isBestMatch) bestMatches++;
        totalDistance += distance;
      });
      
      return { color: appleColor, score: bestMatches - totalDistance / 1000, index };
    });
    
    // Sort by score and take top numColors
    return colorScores
      .sort((a, b) => b.score - a.score)
      .slice(0, numColors)
      .map(item => item.color);
  };
  
  const palette = selectBestColors(imageData, numColors);
  
  // Find nearest palette color for RGB values
  const findNearestColor = (r: number, g: number, b: number): [number, number, number] => {
    let nearest = palette[0];
    let minDiff = Math.sqrt((r - nearest[0])**2 + (g - nearest[1])**2 + (b - nearest[2])**2);
    
    for (let i = 1; i < palette.length; i++) {
      const color = palette[i];
      const diff = Math.sqrt((r - color[0])**2 + (g - color[1])**2 + (b - color[2])**2);
      if (diff < minDiff) {
        minDiff = diff;
        nearest = color;
      }
    }
    
    // Debug logging - more frequent for diagnosis
    if (Math.random() < 0.01) { // Log 1% of color matches
      console.log(`Apple II Dither: (${r},${g},${b}) -> (${nearest[0]},${nearest[1]},${nearest[2]}) distance: ${minDiff.toFixed(1)}`);
    }
    
    return nearest;
  };
  
  // Apply Sierra Lite dithering
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      
      // Get original RGB values
      const oldR = data[idx];
      const oldG = data[idx + 1]; 
      const oldB = data[idx + 2];
      
      // Find nearest color in Apple II palette
      const [newR, newG, newB] = findNearestColor(oldR, oldG, oldB);
      
      // Calculate error for each channel
      const errorR = oldR - newR;
      const errorG = oldG - newG;
      const errorB = oldB - newB;
      
      // Set new color
      data[idx] = newR;
      data[idx + 1] = newG;
      data[idx + 2] = newB;
      
      // Distribute error using Sierra Lite weights
      // Right pixel (2/4 of error)
      if (x < width - 1) {
        const rightIdx = (y * width + (x + 1)) * 4;
        data[rightIdx] = Math.max(0, Math.min(255, data[rightIdx] + errorR * 2 / 4));
        data[rightIdx + 1] = Math.max(0, Math.min(255, data[rightIdx + 1] + errorG * 2 / 4));
        data[rightIdx + 2] = Math.max(0, Math.min(255, data[rightIdx + 2] + errorB * 2 / 4));
      }
      
      // Bottom-left pixel (1/4 of error)
      if (y < height - 1 && x > 0) {
        const bottomLeftIdx = ((y + 1) * width + (x - 1)) * 4;
        data[bottomLeftIdx] = Math.max(0, Math.min(255, data[bottomLeftIdx] + errorR * 1 / 4));
        data[bottomLeftIdx + 1] = Math.max(0, Math.min(255, data[bottomLeftIdx + 1] + errorG * 1 / 4));
        data[bottomLeftIdx + 2] = Math.max(0, Math.min(255, data[bottomLeftIdx + 2] + errorB * 1 / 4));
      }
      
      // Bottom pixel (1/4 of error)  
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
 * Applies block-based Sierra Lite dithering with customizable fill resolution.
 * Instead of dithering individual pixels, this works on blocks of pixels for a chunky effect.
 */
const applySierraLiteDitherWithFillResolution = (imageData: ImageData, numColors: number, fillResolution: number): ImageData => {
  if (fillResolution <= 1) {
    return applySierraLiteDither(imageData, numColors);
  }

  const data = new Uint8ClampedArray(imageData.data);
  const width = imageData.width;
  const height = imageData.height;
  const blockSize = fillResolution;
  
  // Authentic Apple II color palette (RGB values)
  const appleIIPalette: [number, number, number][] = [
    [0, 0, 0],         // Black
    [148, 41, 66],     // Magenta
    [33, 33, 165],     // Dark Blue
    [195, 65, 229],    // Purple
    [0, 99, 66],       // Dark Green
    [99, 99, 99],      // Dark Gray
    [33, 132, 229],    // Medium Blue
    [148, 165, 255],   // Light Blue
    [99, 66, 0],       // Brown
    [229, 99, 0],      // Orange
    [148, 148, 148],   // Light Gray
    [255, 148, 148],   // Pink
    [0, 195, 0],       // Green
    [195, 195, 0],     // Yellow
    [148, 255, 148],   // Aquamarine
    [255, 255, 255]    // White
  ];
  
  // Select best Apple II colors for this image based on content
  const selectBestColors = (imageData: ImageData, numColors: number): [number, number, number][] => {
    if (numColors >= appleIIPalette.length) return appleIIPalette;
    
    // Sample pixels from the image to find dominant colors
    const sampleColors: [number, number, number][] = [];
    const data = imageData.data;
    const step = Math.max(1, Math.floor(data.length / (4 * 100))); // Sample ~100 pixels
    
    for (let i = 0; i < data.length; i += step * 4) {
      sampleColors.push([data[i], data[i + 1], data[i + 2]]);
    }
    
    // Score each Apple II color by how well it represents the image
    const colorScores = appleIIPalette.map((appleColor, index) => {
      let totalDistance = 0;
      let bestMatches = 0;
      
      sampleColors.forEach(sampleColor => {
        const distance = Math.sqrt(
          (sampleColor[0] - appleColor[0])**2 + 
          (sampleColor[1] - appleColor[1])**2 + 
          (sampleColor[2] - appleColor[2])**2
        );
        
        // Check if this Apple II color is the best match for this sample
        const isBestMatch = appleIIPalette.every(otherColor => {
          const otherDistance = Math.sqrt(
            (sampleColor[0] - otherColor[0])**2 + 
            (sampleColor[1] - otherColor[1])**2 + 
            (sampleColor[2] - otherColor[2])**2
          );
          return distance <= otherDistance;
        });
        
        if (isBestMatch) bestMatches++;
        totalDistance += distance;
      });
      
      return { color: appleColor, score: bestMatches - totalDistance / 1000, index };
    });
    
    // Sort by score and take top numColors
    return colorScores
      .sort((a, b) => b.score - a.score)
      .slice(0, numColors)
      .map(item => item.color);
  };
  
  const palette = selectBestColors(imageData, numColors);
  
  const findNearestColor = (r: number, g: number, b: number): [number, number, number] => {
    let nearest = palette[0];
    let minDiff = Math.sqrt((r - nearest[0])**2 + (g - nearest[1])**2 + (b - nearest[2])**2);
    for (let i = 1; i < palette.length; i++) {
      const color = palette[i];
      const diff = Math.sqrt((r - color[0])**2 + (g - color[1])**2 + (b - color[2])**2);
      if (diff < minDiff) {
        minDiff = diff;
        nearest = color;
      }
    }
    
    // Debug logging - more frequent for diagnosis
    if (Math.random() < 0.01) { // Log 1% of color matches
      console.log(`Apple II Dither Block: (${r},${g},${b}) -> (${nearest[0]},${nearest[1]},${nearest[2]}) distance: ${minDiff.toFixed(1)}`);
    }
    
    return nearest;
  };
  
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
  
  // Apply Sierra Lite dithering to blocks
  const ditheredBlocks: number[][][] = JSON.parse(JSON.stringify(blockData));
  
  for (let by = 0; by < blockHeight; by++) {
    for (let bx = 0; bx < blockWidth; bx++) {
      // Get original RGB values
      const oldR = ditheredBlocks[by][bx][0];
      const oldG = ditheredBlocks[by][bx][1];
      const oldB = ditheredBlocks[by][bx][2];
      
      // Find nearest color in Apple II palette
      const [newR, newG, newB] = findNearestColor(oldR, oldG, oldB);
      
      // Calculate error for each channel
      const errorR = oldR - newR;
      const errorG = oldG - newG;
      const errorB = oldB - newB;
      
      // Set new color
      ditheredBlocks[by][bx] = [newR, newG, newB];
      
      // Distribute error to neighboring blocks using Sierra Lite weights
      if (bx < blockWidth - 1) {
        ditheredBlocks[by][bx + 1][0] = Math.max(0, Math.min(255, ditheredBlocks[by][bx + 1][0] + errorR * 2 / 4));
        ditheredBlocks[by][bx + 1][1] = Math.max(0, Math.min(255, ditheredBlocks[by][bx + 1][1] + errorG * 2 / 4));
        ditheredBlocks[by][bx + 1][2] = Math.max(0, Math.min(255, ditheredBlocks[by][bx + 1][2] + errorB * 2 / 4));
      }
      
      if (by < blockHeight - 1 && bx > 0) {
        ditheredBlocks[by + 1][bx - 1][0] = Math.max(0, Math.min(255, ditheredBlocks[by + 1][bx - 1][0] + errorR * 1 / 4));
        ditheredBlocks[by + 1][bx - 1][1] = Math.max(0, Math.min(255, ditheredBlocks[by + 1][bx - 1][1] + errorG * 1 / 4));
        ditheredBlocks[by + 1][bx - 1][2] = Math.max(0, Math.min(255, ditheredBlocks[by + 1][bx - 1][2] + errorB * 1 / 4));
      }
      
      if (by < blockHeight - 1) {
        ditheredBlocks[by + 1][bx][0] = Math.max(0, Math.min(255, ditheredBlocks[by + 1][bx][0] + errorR * 1 / 4));
        ditheredBlocks[by + 1][bx][1] = Math.max(0, Math.min(255, ditheredBlocks[by + 1][bx][1] + errorG * 1 / 4));
        ditheredBlocks[by + 1][bx][2] = Math.max(0, Math.min(255, ditheredBlocks[by + 1][bx][2] + errorB * 1 / 4));
      }
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

/**
 * Creates a tileable, structured noise texture that mimics a mezzotint or risograph screen.
 * It does this by generating noise, blurring it to create clumps, and increasing contrast.
 * This is cached and reused for high performance.
 */
const createRisographTexture = (): HTMLCanvasElement => {
  if (risographTexture) {
    return risographTexture;
  }

  const size = 256; // A 256x256 texture is a good balance of detail and performance
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d', { colorSpace: 'srgb' });

  if (!ctx) return canvas;

  // 1. Create initial grayscale noise
  const imageData = ctx.createImageData(size, size);
  const data = imageData.data;
  for (let i = 0; i < data.length; i += 4) {
    const value = Math.random() * 255;
    data[i] = data[i + 1] = data[i + 2] = value;
    data[i + 3] = 255;
  }
  ctx.putImageData(imageData, 0, 0);

  // 2. Blur the noise to create clumps
  ctx.filter = 'blur(1px)';
  ctx.drawImage(canvas, 0, 0);
  ctx.filter = 'none'; // Reset filter

  // 3. Increase contrast to create the hard-edged "dissolve" pattern
  const contrastedImageData = ctx.getImageData(0, 0, size, size);
  const contrastedData = contrastedImageData.data;
  for (let i = 0; i < contrastedData.length; i += 4) {
      // This is a simple contrast curve - pixels below mid-gray become darker, above become lighter
      const value = contrastedData[i];
      const contrastedValue = value > 128 ? 255 : 0;
      contrastedData[i] = contrastedData[i + 1] = contrastedData[i + 2] = contrastedValue;
  }
  ctx.putImageData(contrastedImageData, 0, 0);

  risographTexture = canvas;
  // Cache the texture data to avoid repeated getImageData calls
  risographTextureData = contrastedData;
  return risographTexture;
};


// Base sizes for standard brushes (100% = these sizes in pixels)
const BRUSH_BASE_SIZES = {
  [BrushShape.PIXEL_ROUND]: 1,
  [BrushShape.ROUND]: 10,
  [BrushShape.SQUARE]: 10,
  [BrushShape.TRIANGLE]: 10,
  [BrushShape.CUSTOM]: 32, // Default for custom brushes
  [BrushShape.RECTANGLE_GRADIENT]: 10,
  [BrushShape.POLYGON_GRADIENT]: 10
} as const;

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
    const halfSize = size / 2;
    
    // --- RISOGRAPH EFFECT LOGIC ---
    // If riso is active, we draw the shape to a temporary canvas first
    // to manipulate its pixels before drawing to the main canvas.
    const isRisoActive = risographIntensity > 0 && !pattern;
    const targetCtx = isRisoActive ? canvasPool.acquire(Math.ceil(size) + 4, Math.ceil(size) + 4).getContext('2d')! : ctx;
    const tempCanvas = isRisoActive ? targetCtx.canvas : null;

    // Adjust coordinates to be local to the temp canvas if we're using one
    // When using riso, maintain the relative position within the temp canvas bounds
    const drawX = isRisoActive ? tempCanvas!.width / 2 : x;
    const drawY = isRisoActive ? tempCanvas!.height / 2 : y;
    
    if (!targetCtx) {
      if (tempCanvas) canvasPool.release(tempCanvas);
      return;
    }

    // Check transparency lock before drawing
    if ((window as any).transparencyLockEnabled) {
      // Sample the center pixel to check if we can draw here
      const centerX = Math.floor(x);
      const centerY = Math.floor(y);
      
      try {
        const imageData = ctx.getImageData(centerX, centerY, 1, 1);
        const alpha = imageData.data[3]; // Alpha channel
        
        // If transparency lock is enabled and pixel is fully transparent, skip drawing
        if (alpha === 0) {
          if (tempCanvas) canvasPool.release(tempCanvas);
          return;
        }
      } catch (error) {
        // If we can't read the pixel data, allow drawing
      }
    }
    
    targetCtx.save();

    if (isRisoActive) {
      targetCtx.clearRect(0, 0, tempCanvas!.width, tempCanvas!.height);
      targetCtx.fillStyle = ctx.fillStyle;
      targetCtx.globalAlpha = ctx.globalAlpha;
    }
    
    if (!antiAliasing) {
      targetCtx.imageSmoothingEnabled = false;
      // Round to pixel boundaries for pixel-perfect drawing
      if (!isRisoActive) {
        x = Math.round(x);
        y = Math.round(y);
      }
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
    
    // Handle custom pattern rendering
    if (pattern && pattern.width > 0 && pattern.height > 0) {
      
      // Use cached temporary canvas for pattern
      const tempCtx = getPatternTempContext(pattern.width, pattern.height);
      const tempCanvas = patternTempCanvas!;
      
      if (tempCtx) {
        try {
          // Configure temp canvas context to match main context
          tempCtx.imageSmoothingEnabled = targetCtx.imageSmoothingEnabled;
          tempCtx.putImageData(pattern, 0, 0);
          
          // Use pattern at original pixel size
          const scaledWidth = pattern.width;
          const scaledHeight = pattern.height;
          
          // Calculate position based on alignment
          let patternDrawX = drawX;
          let patternDrawY = drawY;
          
          if (centerAlignment) {
            patternDrawX = drawX - scaledWidth / 2;
            patternDrawY = drawY - scaledHeight / 2;
          }
          
          // Round coordinates to prevent sub-pixel positioning
          patternDrawX = Math.round(patternDrawX);
          patternDrawY = Math.round(patternDrawY);
          
          // Draw the pattern at original size
          targetCtx.drawImage(tempCanvas, patternDrawX, patternDrawY);
        } catch (error) {
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
          
        case BrushShape.ROUND:
          // Always use perfect circles for antialiased round brushes
          targetCtx.beginPath();
          targetCtx.arc(drawX, drawY, halfSize, 0, Math.PI * 2);
          targetCtx.fill();
          break;
          
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

    // --- APPLY RISOGRAPH DISSOLVE ---
    if (isRisoActive && tempCanvas) {
        // Throttle riso operations for performance during continuous drawing
        const now = performance.now();
        const settingsChanged = risoThrottleState.lastRisoSettings.intensity !== risographIntensity ||
                               risoThrottleState.lastRisoSettings.size !== size ||
                               Math.abs(risoThrottleState.lastRisoSettings.x - x) > 2 ||
                               Math.abs(risoThrottleState.lastRisoSettings.y - y) > 2;
        
        // Adaptive throttling: use aggressive throttling during continuous strokes
        risoThrottleState.continuousStrokeCount++;
        const currentThrottleInterval = risoThrottleState.continuousStrokeCount > 10 
            ? risoThrottleState.aggressiveThrottleInterval 
            : risoThrottleState.throttleInterval;
        
        // Only process riso if enough time has passed or settings changed significantly
        if (now - risoThrottleState.lastProcessTime > currentThrottleInterval || settingsChanged) {
            const risoTexture = createRisographTexture();
            const threshold = 1 - (risographIntensity / 100);
            
            risoThrottleState.lastProcessTime = now;
            risoThrottleState.lastRisoSettings = { intensity: risographIntensity, size, x, y };

            const stampImageData = targetCtx.getImageData(0, 0, tempCanvas.width, tempCanvas.height);
            const data = stampImageData.data;

            // Use optimized reusable texture canvas
            if (!risoTextureCanvas || risoTextureCanvas.width !== tempCanvas.width || risoTextureCanvas.height !== tempCanvas.height) {
                risoTextureCanvas = document.createElement('canvas');
                risoTextureCanvas.width = tempCanvas.width;
                risoTextureCanvas.height = tempCanvas.height;
                risoTextureCtx = risoTextureCanvas.getContext('2d')!;
            }
            risoTextureCtx!.drawImage(risoTexture, 0, 0, tempCanvas.width, tempCanvas.height);
            const textureData = risoTextureCtx!.getImageData(0, 0, tempCanvas.width, tempCanvas.height).data;
            
            // This loop simulates the "Dissolve" blend mode
            for (let i = 0; i < data.length; i += 4) {
                // If the pixel in the shape is visible...
                if (data[i + 3] > 0) {
                    // ...check the brightness of the corresponding noise pixel.
                    const noiseBrightness = textureData[i] / 255;
                    // If the noise brightness is below our slider threshold, "punch a hole"
                    // in the shape by making the pixel fully transparent.
                    if (noiseBrightness < threshold) {
                        data[i + 3] = 0;
                    }
                }
            }

            // Put the modified, dissolved pixel data back onto the temp canvas
            targetCtx.putImageData(stampImageData, 0, 0);
            
            // Draw the final, dissolved shape onto the main canvas
            ctx.drawImage(tempCanvas, x - tempCanvas.width / 2, y - tempCanvas.height / 2);

            // Release only the temp canvas (texture canvas is reused globally)
            canvasPool.release(tempCanvas);
        } else {
            // Skip expensive riso processing, just draw the shape directly
            ctx.drawImage(tempCanvas, x - tempCanvas.width / 2, y - tempCanvas.height / 2);
            canvasPool.release(tempCanvas);
        }
    } else {
      ctx.restore();
    }
  }, [getPixelCircleStamp]);
  
  const calculateSizeModification = useCallback((
    component: BrushComponent,
    input: StrokeInput,
    baseSize: number
  ): number => {
    const params = component.parameters as any;
    const pressure = input.pressure || 0.5;
    
    // Apply pressure influence
    const pressureEffect = (pressure - 0.5) * (params.pressureInfluence || 0);
    const modifiedSize = baseSize * (1 + pressureEffect);
    
    // Apply min/max constraints from component
    return Math.max(
      params.minSize || 1,
      Math.min(params.maxSize || 1000, modifiedSize)
    );
  }, []);
  
  const calculateOpacityModification = useCallback((
    component: BrushComponent,
    input: StrokeInput,
    baseOpacity: number
  ): number => {
    const params = component.parameters as any;
    const pressure = input.pressure || 0.5;
    
    // Apply pressure influence to opacity
    const pressureEffect = (pressure - 0.5) * (params.pressureInfluence || 0);
    const modifiedOpacity = baseOpacity * (1 + pressureEffect);
    
    return Math.max(0, Math.min(1, modifiedOpacity));
  }, []);
  
  const calculatePressureEffects = useCallback((
    component: BrushComponent,
    input: StrokeInput,
    settings: RenderSettings
  ): RenderSettings => {
    const params = component.parameters as any;
    const pressure = input.pressure || 0.5;
    
    const newSettings = { ...settings };
    
    // Apply pressure to size if enabled
    if (params.sizeInfluence) {
      const sizeEffect = (pressure - 0.5) * params.sizeInfluence;
      newSettings.size = Math.max(1, settings.size * (1 + sizeEffect));
    }
    
    // Apply pressure to opacity if enabled
    if (params.opacityInfluence) {
      const opacityEffect = (pressure - 0.5) * params.opacityInfluence;
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
    
    // Apply pressure-based size modification if enabled
    let finalSize = activeSettings.size;
    if (activeSettings.pressureEnabled) {
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
      blendMode: activeSettings.blendMode || 'source-over'
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
    
    // Mark stroke as inactive and trigger memory cleanup
    brushCache.markStrokeInactive();
    memoryManager.runCleanup();
    
    // Reset riso throttling state for new stroke
    risoThrottleState.continuousStrokeCount = 0;
  }, []);

  // Helper function to determine if we should draw the current stamp (cursor-speed independent)
  const shouldDrawStamp = useCallback((brushSettings: any, queue: any, actualSize?: number, isGridSnapping: boolean = false): boolean => {
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

          // 8. Apply film grain if enabled
          const filmGrainIntensity = tools.brushSettings.risographIntensity || 0;
          if (filmGrainIntensity > 0) {
            const noiseCanvas = createNoiseTexture();
            const noisePattern = ctx.createPattern(noiseCanvas, 'repeat');
            if (noisePattern) {
              const originalGCO = ctx.globalCompositeOperation;
              const originalAlpha = ctx.globalAlpha;

              ctx.globalCompositeOperation = 'source-atop';
              ctx.globalAlpha = filmGrainIntensity / 100;
              ctx.fillStyle = noisePattern;
              ctx.fillRect(centerX, centerY, scaledWidth, scaledHeight);

              ctx.globalCompositeOperation = originalGCO;
              ctx.globalAlpha = originalAlpha;
            }
          }
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

        // Apply film grain if enabled
        const filmGrainIntensity = tools.brushSettings.risographIntensity || 0;
        if (filmGrainIntensity > 0) {
          const noiseCanvas = createNoiseTexture();
          const noisePattern = ctx.createPattern(noiseCanvas, 'repeat');
          if (noisePattern) {
            const originalGCO = ctx.globalCompositeOperation;
            const originalAlpha = ctx.globalAlpha;

            ctx.globalCompositeOperation = 'source-atop';
            ctx.globalAlpha = filmGrainIntensity / 100;
            ctx.fillStyle = noisePattern;
            ctx.fillRect(centerX, centerY, scaledCanvas.width, scaledCanvas.height);

            ctx.globalCompositeOperation = originalGCO;
            ctx.globalAlpha = originalAlpha;
          }
        }
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

  const renderBrushStroke = useCallback((
    ctx: CanvasRenderingContext2D,
    from: { x: number; y: number },
    to: { x: number; y: number },
    cursor: { pressure: number }, // Accept cursor data directly
    components: BrushComponent[] = activeBrushComponents
  ) => {
    // Mark stroke as active for cache retention
    brushCache.markStrokeActive();
    
    // Performance monitoring for brush strokes
    const strokeStartTime = process.env.NODE_ENV === 'development' ? performance.now() : 0;
    
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
    if (tools.brushSettings.currentBrushTip && tools.brushSettings.currentBrushTip.brushId === currentBrushId) {
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
      const customBrushPreset = brushPresets.find(p => 
        p.id === tools.brushSettings.selectedCustomBrush && p.isCustomBrush && p.customBrushData
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
      // Calculate actual brush size using unified percentage scaling
      const baseSize = BRUSH_BASE_SIZES[tools.brushSettings.brushShape || BrushShape.ROUND];
      const baseBrushSize = (tools.brushSettings.size / 100) * baseSize;
      
      // Use optimized pressure calculation
      const pressureResult = pressureOptimizer.calculatePressureSize(baseBrushSize, {
        pressureEnabled: tools.brushSettings.pressureEnabled,
        minPressure: tools.brushSettings.minPressure,
        maxPressure: tools.brushSettings.maxPressure,
        rawPressure: cursorPressure
      });
      
      actualBrushSize = pressureResult.adjustedSize;
      
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
    } catch (error) {
      return; // Exit early to prevent further issues
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
    
    // Initialize distance tracking state if needed
    const queue = pixelQueueRef.current;
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
    
    if (customBrush) {
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
      
      const scaleFactor = pressureOptimizer.calculateScaleFactor(
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
            const remaining = queue.accumulatedDistance - settings.spacing;
            const progress = (distance - remaining) / distance;
            const x = queue.lastStrokePosition.x + (snappedTo.x - queue.lastStrokePosition.x) * progress;
            const y = queue.lastStrokePosition.y + (snappedTo.y - queue.lastStrokePosition.y) * progress;
            
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
            const remaining = queue.accumulatedDistance - settings.spacing;
            const progress = (distance - remaining) / distance;
            const x = queue.lastStrokePosition.x + (snappedTo.x - queue.lastStrokePosition.x) * progress;
            const y = queue.lastStrokePosition.y + (snappedTo.y - queue.lastStrokePosition.y) * progress;
            
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
      performance.now() - strokeStartTime;
    }
  }, [executeComponents, tools, activeBrushComponents, perfectPixels, drawPixelPerfectLine, drawShape, project, brushPresets, drawCustomBrushLine, drawCustomBrushStamp]);
  
  // Draw rectangle gradient brush
  const drawRectangleGradient = useCallback((ctx: CanvasRenderingContext2D, rectangleState: any, isPreview: boolean = false) => {
    const { startPos, endPos, width, startColor, endColor, colors } = rectangleState;
    const { brushSettings } = useAppStore.getState().tools;
    
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
    ctx.globalAlpha = brushSettings.opacity;
    ctx.globalCompositeOperation = brushSettings.blendMode || 'source-over';
    
    // Create linear gradient
    const gradient = ctx.createLinearGradient(startPos.x, startPos.y, endPos.x, endPos.y);
    
    // Use provided colors array or fall back to start/end colors
    if (colors && colors.length > 0) {
      // Use the provided sampled colors
      colors.forEach((color: string, index: number) => {
        // Handle single color case to avoid division by zero
        const position = colors.length === 1 ? 0 : index / (colors.length - 1);
        gradient.addColorStop(position, color);
      });
      
      // For single color, add the same color at position 1 to ensure solid fill
      if (colors.length === 1) {
        gradient.addColorStop(1, colors[0]);
      }
    } else {
      // Fallback to original behavior if no colors array provided
      const numColors = Math.max(2, brushSettings.colors || 2);
      if (numColors === 1) {
        // Single color - use solid fill
        gradient.addColorStop(0, startColor);
        gradient.addColorStop(1, startColor);
      } else if (numColors === 2) {
        gradient.addColorStop(0, startColor);
        gradient.addColorStop(1, endColor);
      } else {
        // Interpolate between start and end
        for (let i = 0; i < numColors; i++) {
          const position = i / (numColors - 1);
          
          const start = startColor.match(/^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i);
          const end = endColor.match(/^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i);
          
          if (start && end) {
            const r = Math.round(parseInt(start[1], 16) + (parseInt(end[1], 16) - parseInt(start[1], 16)) * position);
            const g = Math.round(parseInt(start[2], 16) + (parseInt(end[2], 16) - parseInt(start[2], 16)) * position);
            const b = Math.round(parseInt(start[3], 16) + (parseInt(end[3], 16) - parseInt(start[3], 16)) * position);
            
            const interpolatedColor = `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
            gradient.addColorStop(position, interpolatedColor);
          } else {
            gradient.addColorStop(position, position < 0.5 ? startColor : endColor);
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
    
    // Apply film grain effect if enabled
    const noise = brushSettings.risographIntensity || 0;
    if (noise > 0) {
      const noiseCanvas = createNoiseTexture();
      
      // Save current composite operation
      const prevComposite = ctx.globalCompositeOperation;
      
      // Create a pattern from the noise texture
      const pattern = ctx.createPattern(noiseCanvas, 'repeat');
      if (pattern) {
        // Set up grain blending
        ctx.globalCompositeOperation = 'overlay';
        ctx.globalAlpha = noise / 100 * 0.3; // Scale down for subtlety
        
        // Apply grain to the rectangle area
        ctx.beginPath();
        ctx.moveTo(corners[0].x, corners[0].y);
        corners.slice(1).forEach(corner => ctx.lineTo(corner.x, corner.y));
        ctx.closePath();
        ctx.fillStyle = pattern;
        ctx.fill();
        
        // Restore composite operation
        ctx.globalCompositeOperation = prevComposite;
      }
    }

    // Apply Sierra Lite dither effect if enabled (only for final drawing, not preview)
    const ditherEnabled = brushSettings.ditherEnabled || false;
    const numColors = Math.max(2, brushSettings.colors || 2);
    if (ditherEnabled && !isPreview) {
      // Get the bounds of the rectangle for dithering
      const minX = Math.floor(Math.min(...corners.map(c => c.x)));
      const minY = Math.floor(Math.min(...corners.map(c => c.y)));
      const maxX = Math.ceil(Math.max(...corners.map(c => c.x)));
      const maxY = Math.ceil(Math.max(...corners.map(c => c.y)));
      const boundWidth = maxX - minX;
      const boundHeight = maxY - minY;
      
      if (boundWidth > 0 && boundHeight > 0) {
        // Get the current image data from the bounding area
        const imageData = ctx.getImageData(minX, minY, boundWidth, boundHeight);
        
        // Create a temporary canvas for clipping
        const tempCanvas = canvasPool.acquire(boundWidth, boundHeight);
        const tempCtx = tempCanvas.getContext('2d', { willReadFrequently: true, colorSpace: 'srgb' });
        
        if (tempCtx) {
          // Put the original image data on temp canvas
          tempCtx.putImageData(imageData, 0, 0);
          
          // Create clipping mask for the rectangle shape
          const maskCanvas = canvasPool.acquire(boundWidth, boundHeight);
          const maskCtx = maskCanvas.getContext('2d', { colorSpace: 'srgb' });
          
          if (maskCtx) {
            // Draw the rectangle shape as a mask (translated to local coordinates)
            maskCtx.fillStyle = 'white';
            maskCtx.beginPath();
            maskCtx.moveTo(corners[0].x - minX, corners[0].y - minY);
            corners.slice(1).forEach(corner => maskCtx.lineTo(corner.x - minX, corner.y - minY));
            maskCtx.closePath();
            maskCtx.fill();
            
            // Get mask data
            const maskData = maskCtx.getImageData(0, 0, boundWidth, boundHeight);
            
            // Apply dithering only to pixels inside the rectangle
            const fillResolution = brushSettings.fillResolution || 1;
            const ditheredData = applySierraLiteDitherWithFillResolution(imageData, numColors, fillResolution);
            
            // Composite: use dithered data only where mask is white
            const finalData = new Uint8ClampedArray(imageData.data);
            for (let i = 0; i < maskData.data.length; i += 4) {
              if (maskData.data[i + 3] > 0) { // If mask pixel is not transparent
                finalData[i] = ditheredData.data[i];
                finalData[i + 1] = ditheredData.data[i + 1];
                finalData[i + 2] = ditheredData.data[i + 2];
                finalData[i + 3] = ditheredData.data[i + 3];
              }
            }
            
            // Put the final composited data back
            const finalImageData = new ImageData(finalData, boundWidth, boundHeight);
            ctx.putImageData(finalImageData, minX, minY);
            
            canvasPool.release(maskCanvas);
          }
          
          canvasPool.release(tempCanvas);
        }
      }
    }
    
    ctx.restore();
  }, []);

  // Draw polygon gradient brush
  const drawPolygonGradient = useCallback((ctx: CanvasRenderingContext2D, options: { vertices: Array<{ x: number; y: number }>, colors: string[] }, isPreview: boolean = false) => {
    const { vertices, colors } = options;
    const { brushSettings } = useAppStore.getState().tools;
    
    if (!vertices || vertices.length < 3 || !colors || colors.length < 1) return;
    
    ctx.save();
    ctx.globalAlpha = brushSettings.opacity;
    ctx.globalCompositeOperation = brushSettings.blendMode || 'source-over';
    
    // Create gradient along the path from first to last vertex (cursor path direction)
    const startPoint = vertices[0];
    const endPoint = vertices[vertices.length - 1];
    
    // Create linear gradient from start to end
    const gradient = ctx.createLinearGradient(startPoint.x, startPoint.y, endPoint.x, endPoint.y);
    
    // Add color stops for each sampled color
    colors.forEach((color, index) => {
      // Handle single color case to avoid division by zero
      const position = colors.length === 1 ? 0 : index / (colors.length - 1);
      gradient.addColorStop(position, color);
    });
    
    // For single color, add the same color at position 1 to ensure solid fill
    if (colors.length === 1) {
      gradient.addColorStop(1, colors[0]);
    }
    
    // Create polygon path
    ctx.beginPath();
    ctx.moveTo(vertices[0].x, vertices[0].y);
    for (let i = 1; i < vertices.length; i++) {
      ctx.lineTo(vertices[i].x, vertices[i].y);
    }
    ctx.closePath();
    
    // Fill the polygon once with the complete gradient
    ctx.fillStyle = gradient;
    ctx.fill();
    
    // Apply film grain effect if enabled
    const noise = brushSettings.risographIntensity || 0;
    if (noise > 0) {
      const noiseCanvas = createNoiseTexture();
      
      // Save current composite operation
      const prevComposite = ctx.globalCompositeOperation;
      
      // Create a pattern from the noise texture
      const pattern = ctx.createPattern(noiseCanvas, 'repeat');
      if (pattern) {
        // Set up grain blending
        ctx.globalCompositeOperation = 'overlay';
        ctx.globalAlpha = noise / 100 * 0.3; // Scale down for subtlety
        
        // Apply grain to the polygon area
        ctx.fillStyle = pattern;
        ctx.fill();
        
        // Restore composite operation
        ctx.globalCompositeOperation = prevComposite;
      }
    }

    // Apply Sierra Lite dither effect if enabled (only for final drawing, not preview)
    const ditherEnabled = brushSettings.ditherEnabled || false;
    const numColors = Math.max(2, brushSettings.colors || 2);
    if (ditherEnabled && !isPreview) {
      // Get the bounds of the polygon for dithering
      const minX = Math.floor(Math.min(...vertices.map(v => v.x)));
      const minY = Math.floor(Math.min(...vertices.map(v => v.y)));
      const maxX = Math.ceil(Math.max(...vertices.map(v => v.x)));
      const maxY = Math.ceil(Math.max(...vertices.map(v => v.y)));
      const boundWidth = maxX - minX;
      const boundHeight = maxY - minY;
      
      if (boundWidth > 0 && boundHeight > 0) {
        // Get the current image data from the bounding area
        const imageData = ctx.getImageData(minX, minY, boundWidth, boundHeight);
        
        // Create a temporary canvas for clipping
        const tempCanvas = canvasPool.acquire(boundWidth, boundHeight);
        const tempCtx = tempCanvas.getContext('2d', { willReadFrequently: true, colorSpace: 'srgb' });
        
        if (tempCtx) {
          // Put the original image data on temp canvas
          tempCtx.putImageData(imageData, 0, 0);
          
          // Create clipping mask for the polygon shape
          const maskCanvas = canvasPool.acquire(boundWidth, boundHeight);
          const maskCtx = maskCanvas.getContext('2d', { colorSpace: 'srgb' });
          
          if (maskCtx) {
            // Draw the polygon shape as a mask (translated to local coordinates)
            maskCtx.fillStyle = 'white';
            maskCtx.beginPath();
            maskCtx.moveTo(vertices[0].x - minX, vertices[0].y - minY);
            vertices.slice(1).forEach(v => maskCtx.lineTo(v.x - minX, v.y - minY));
            maskCtx.closePath();
            maskCtx.fill();
            
            // Get mask data
            const maskData = maskCtx.getImageData(0, 0, boundWidth, boundHeight);
            
            // Apply dithering only to pixels inside the polygon
            const fillResolution = brushSettings.fillResolution || 1;
            const ditheredData = applySierraLiteDitherWithFillResolution(imageData, numColors, fillResolution);
            
            // Composite: use dithered data only where mask is white
            const finalData = new Uint8ClampedArray(imageData.data);
            for (let i = 0; i < maskData.data.length; i += 4) {
              if (maskData.data[i + 3] > 0) { // If mask pixel is not transparent
                finalData[i] = ditheredData.data[i];
                finalData[i + 1] = ditheredData.data[i + 1];
                finalData[i + 2] = ditheredData.data[i + 2];
                finalData[i + 3] = ditheredData.data[i + 3];
              }
            }
            
            // Put the final composited data back
            const finalImageData = new ImageData(finalData, boundWidth, boundHeight);
            ctx.putImageData(finalImageData, minX, minY);
            
            canvasPool.release(maskCanvas);
          }
          
          canvasPool.release(tempCanvas);
        }
      }
    }
    
    ctx.restore();
  }, []);

  return {
    executeComponents,
    executeComponent,
    renderBrushStroke,
    resetPixelQueue,
    drawRectangleGradient,
    drawPolygonGradient
  };
};