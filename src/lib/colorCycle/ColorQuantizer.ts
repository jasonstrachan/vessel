/**
 * ColorQuantizer - Fast RGB332 and quality OKLab quantization
 * Converts RGBA images to indexed color (256 colors max)
 * Based on the color cycling recolor feature specification
 * 
 * Enhanced with MedianCut algorithm and spatial hashing for quality mode
 */

import { MedianCut, MedianCutOptions } from './quantization/MedianCut';
import { SpatialColorHash } from './optimization/SpatialColorHash';
import { BayerDithering, DitherOptions } from './dithering/BayerDithering';

export interface QuantizedResult {
  indices: Uint8Array;
  palette: Uint32Array; // 256 RGBA colors as packed 32-bit values
  actualColors: number; // Number of unique colors used
  colorMap?: Map<number, number>; // RGB -> palette index mapping
  stats?: {
    processingTime: number;
    compressionRatio: number;
    avgError: number;
    method: string;
  };
}

export interface QuantizationOptions {
  method: 'rgb332' | 'oklab-median-cut';
  ditherMode: 'off' | 'bayer4' | 'bayer8';
  quality: 'fast' | 'balanced' | 'best';
  maxColors: number;
  useSpatialHash: boolean;
}

export class ColorQuantizer {
  private static spatialHash = new SpatialColorHash();
  private static bayerDithering = new BayerDithering();
  private static medianCut = new MedianCut();

  /**
   * Enhanced quantization with multiple algorithms and dithering
   */
  static quantize(imageData: ImageData, options: Partial<QuantizationOptions> = {}): QuantizedResult {
    const config: QuantizationOptions = {
      method: 'rgb332',
      ditherMode: 'off',
      quality: 'balanced',
      maxColors: 256,
      useSpatialHash: true,
      ...options
    };

    const startTime = performance.now();
    let result: QuantizedResult;

    if (config.method === 'oklab-median-cut') {
      result = this.quantizeMedianCut(imageData, config);
    } else {
      result = this.quantizeRGB332(imageData);
    }

    // Apply dithering if requested
    if (config.ditherMode !== 'off') {
      result = this.applyDithering(imageData, result, config);
    }

    // Add processing statistics
    const processingTime = performance.now() - startTime;
    result.stats = {
      processingTime,
      compressionRatio: (imageData.width * imageData.height) / result.actualColors,
      avgError: result.stats?.avgError || 0,
      method: `${config.method}${config.ditherMode !== 'off' ? '+' + config.ditherMode : ''}`
    };

    return result;
  }

  /**
   * High-quality quantization using median cut algorithm
   */
  private static quantizeMedianCut(imageData: ImageData, options: QuantizationOptions): QuantizedResult {
    const medianCutOptions: Partial<MedianCutOptions> = {
      colorSpace: 'oklab',
      maxColors: options.maxColors,
      quality: options.quality,
      preserveImportant: true
    };

    this.medianCut = new MedianCut(medianCutOptions);
    const medianResult = this.medianCut.quantize(imageData);

    // Build spatial hash for fast lookups if enabled
    if (options.useSpatialHash) {
      const hashOptions = this.spatialHash.optimizeForPalette(medianResult.palette);
      this.spatialHash = new SpatialColorHash(hashOptions);
      this.spatialHash.buildHash(medianResult.palette);
    }

    // Convert to index buffer
    const indices = this.buildIndexBuffer(imageData, medianResult.palette, medianResult.colorMap, options.useSpatialHash);

    return {
      indices,
      palette: medianResult.palette,
      actualColors: medianResult.stats.finalColors,
      colorMap: medianResult.colorMap,
      stats: {
        processingTime: medianResult.stats.processingTime,
        compressionRatio: medianResult.stats.compressionRatio,
        avgError: medianResult.stats.avgError,
        method: 'median-cut'
      }
    };
  }

  /**
   * Apply dithering to quantized result
   */
  private static applyDithering(
    originalImage: ImageData,
    quantizedResult: QuantizedResult,
    options: QuantizationOptions
  ): QuantizedResult {
    const ditherOptions: Partial<DitherOptions> = {
      matrixSize: options.ditherMode === 'bayer8' ? 8 : 4,
      intensity: 0.5,
      colorSpace: options.method === 'oklab-median-cut' ? 'perceptual' : 'rgb',
      errorDiffusion: options.quality === 'best',
      adaptiveThreshold: options.quality !== 'fast'
    };

    this.bayerDithering = new BayerDithering(ditherOptions);
    const ditherResult = this.bayerDithering.dither(originalImage, quantizedResult.palette, quantizedResult.colorMap);

    // Convert dithered image back to index buffer
    const indices = this.imageDataToIndices(ditherResult.imageData, quantizedResult.palette);

    return {
      ...quantizedResult,
      indices,
      stats: {
        ...quantizedResult.stats!,
        avgError: quantizedResult.stats!.avgError * (1 - ditherResult.stats.errorReduction),
        method: quantizedResult.stats!.method + '+dithered'
      }
    };
  }

  /**
   * Build index buffer from image data and palette
   */
  private static buildIndexBuffer(
    imageData: ImageData,
    palette: Uint32Array,
    colorMap?: Map<number, number>,
    useSpatialHash: boolean = false
  ): Uint8Array {
    const { data, width, height } = imageData;
    const indices = new Uint8Array(width * height);

    for (let i = 0, idx = 0; i < data.length; i += 4, idx++) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const a = data[i + 3];

      if (a < 128) {
        indices[idx] = 0; // Transparent
        continue;
      }

      let paletteIndex = 0;

      if (colorMap) {
        const colorKey = (r << 16) | (g << 8) | b;
        paletteIndex = colorMap.get(colorKey) || 0;
      } else if (useSpatialHash) {
        paletteIndex = this.spatialHash.findNearestColor(r, g, b);
      } else {
        paletteIndex = this.findNearestColorLinear(r, g, b, palette);
      }

      indices[idx] = paletteIndex;
    }

    return indices;
  }

  /**
   * Convert dithered ImageData back to index buffer
   */
  private static imageDataToIndices(imageData: ImageData, palette: Uint32Array): Uint8Array {
    const { data, width, height } = imageData;
    const indices = new Uint8Array(width * height);

    for (let i = 0, idx = 0; i < data.length; i += 4, idx++) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const a = data[i + 3];

      if (a < 128) {
        indices[idx] = 0;
        continue;
      }

      // Find exact palette match (should exist since this is quantized)
      let paletteIndex = 0;
      for (let j = 0; j < palette.length; j += 4) {
        if (palette[j] === r && palette[j + 1] === g && palette[j + 2] === b) {
          paletteIndex = j / 4;
          break;
        }
      }

      indices[idx] = paletteIndex;
    }

    return indices;
  }

  /**
   * Linear search for nearest palette color (fallback)
   */
  private static findNearestColorLinear(r: number, g: number, b: number, palette: Uint32Array): number {
    let minDistance = Infinity;
    let nearestIndex = 0;

    for (let i = 0; i < palette.length; i += 4) {
      const pr = palette[i];
      const pg = palette[i + 1];
      const pb = palette[i + 2];

      const dr = r - pr;
      const dg = g - pg;
      const db = b - pb;

      const distance = dr * dr + dg * dg + db * db;

      if (distance < minDistance) {
        minDistance = distance;
        nearestIndex = i / 4;
      }
    }

    return nearestIndex;
  }
  /**
   * Fast RGB332 quantization - <50ms at 1080p, <100ms at 4K
   * Uses 3-3-2 bit distribution (3 bits red, 3 bits green, 2 bits blue = 256 colors)
   */
  static quantizeRGB332(imageData: ImageData): QuantizedResult {
    const { data, width, height } = imageData;
    const pixelCount = width * height;
    const indices = new Uint8Array(pixelCount);
    
    // Build RGB332 palette (256 fixed colors)
    const palette = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      const r = ((i >> 5) & 0x07) * 36;  // 0-252 in steps of 36
      const g = ((i >> 2) & 0x07) * 36;  // 0-252 in steps of 36  
      const b = (i & 0x03) * 85;         // 0-255 in steps of 85
      
      // Pack as ABGR for little-endian systems (standard ImageData format)
      palette[i] = (255 << 24) | (b << 16) | (g << 8) | r;
    }
    
    // Map each pixel to nearest RGB332 color
    for (let i = 0, idx = 0; i < data.length; i += 4, idx++) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const a = data[i + 3];
      
      if (a === 0) {
        // Transparent pixel
        indices[idx] = 0;
        // Ensure palette[0] is transparent
        palette[0] = 0;
      } else {
        // Quantize to RGB332
        const r3 = r >> 5;  // Top 3 bits (0-7)
        const g3 = g >> 5;  // Top 3 bits (0-7)
        const b2 = b >> 6;  // Top 2 bits (0-3)
        
        indices[idx] = (r3 << 5) | (g3 << 2) | b2;
      }
    }
    
    return { 
      indices, 
      palette, 
      actualColors: 256 // RGB332 always uses all 256 colors
    };
  }
  
  /**
   * Quality mode - OKLab with median cut algorithm
   * Better gradients and perceptually uniform colors
   * Performance: <200ms at 4K
   */
  static quantizeOKLabMedianCut(imageData: ImageData, maxColors: number = 256): QuantizedResult {
    // For Phase 1, implement a simplified version
    // TODO: Full median cut algorithm in Phase 4
    
    // Extract unique colors first
    const uniqueColors = this.extractUniqueColors(imageData);
    
    if (uniqueColors.length <= maxColors) {
      // No quantization needed
      return this.buildDirectPalette(imageData, uniqueColors);
    }
    
    // For now, fall back to RGB332 for Phase 1
    // Will implement proper median cut in Phase 4
    console.warn('[ColorQuantizer] OKLab median cut not fully implemented, falling back to RGB332');
    return this.quantizeRGB332(imageData);
  }
  
  /**
   * Extract all unique RGBA colors from image
   */
  private static extractUniqueColors(imageData: ImageData): Uint32Array {
    const { data } = imageData;
    const colorSet = new Set<number>();
    
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const a = data[i + 3];
      
      // Pack RGBA into 32-bit value
      const packed = (a << 24) | (b << 16) | (g << 8) | r;
      colorSet.add(packed);
    }
    
    return new Uint32Array(colorSet);
  }
  
  /**
   * Build palette directly from unique colors (no quantization needed)
   */
  private static buildDirectPalette(imageData: ImageData, uniqueColors: Uint32Array): QuantizedResult {
    const { data, width, height } = imageData;
    const pixelCount = width * height;
    const indices = new Uint8Array(pixelCount);
    
    // Create color-to-index lookup
    const colorToIndex = new Map<number, number>();
    const palette = new Uint32Array(256);
    
    // Ensure index 0 is transparent
    palette[0] = 0;
    colorToIndex.set(0, 0);
    
    let nextIndex = 1;
    for (let i = 0; i < uniqueColors.length; i++) {
      const color = uniqueColors[i];
      if (color !== 0) { // Skip transparent (already handled)
        colorToIndex.set(color, nextIndex);
        palette[nextIndex] = color;
        nextIndex++;
        if (nextIndex >= 256) break;
      }
    }
    
    // Map pixels to indices
    for (let i = 0, idx = 0; i < data.length; i += 4, idx++) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const a = data[i + 3];
      
      const packed = (a << 24) | (b << 16) | (g << 8) | r;
      const paletteIndex = colorToIndex.get(packed) || 0;
      indices[idx] = paletteIndex;
    }
    
    return {
      indices,
      palette,
      actualColors: nextIndex
    };
  }
  
  /**
   * Apply Bayer dithering to reduce banding
   * Called after quantization to improve visual quality
   */
  static applyBayerDithering(
    indices: Uint8Array, 
    width: number, 
    height: number, 
    mode: 'bayer4' | 'bayer8'
  ): Uint8Array {
    if (mode === 'bayer4') {
      return this.applyBayer4x4(indices, width, height);
    } else {
      return this.applyBayer8x8(indices, width, height);
    }
  }
  
  /**
   * 4x4 Bayer dithering matrix
   */
  private static readonly BAYER_4x4 = [
    [ 0,  8,  2, 10],
    [12,  4, 14,  6],
    [ 3, 11,  1,  9],
    [15,  7, 13,  5]
  ].map(row => row.map(v => (v / 16) - 0.5));
  
  private static applyBayer4x4(indices: Uint8Array, width: number, height: number): Uint8Array {
    const dithered = new Uint8Array(indices.length);
    
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = y * width + x;
        const threshold = this.BAYER_4x4[y % 4][x % 4];
        
        // Apply dither noise to index selection
        const originalIndex = indices[i];
        const ditheredIndex = Math.min(255, 
          Math.max(0, originalIndex + threshold * 16)
        );
        dithered[i] = Math.round(ditheredIndex);
      }
    }
    
    return dithered;
  }
  
  /**
   * 8x8 Bayer dithering matrix (higher quality)
   */
  private static readonly BAYER_8x8 = [
    [ 0, 32,  8, 40,  2, 34, 10, 42],
    [48, 16, 56, 24, 50, 18, 58, 26],
    [12, 44,  4, 36, 14, 46,  6, 38],
    [60, 28, 52, 20, 62, 30, 54, 22],
    [ 3, 35, 11, 43,  1, 33,  9, 41],
    [51, 19, 59, 27, 49, 17, 57, 25],
    [15, 47,  7, 39, 13, 45,  5, 37],
    [63, 31, 55, 23, 61, 29, 53, 21]
  ].map(row => row.map(v => (v / 64) - 0.5));
  
  private static applyBayer8x8(indices: Uint8Array, width: number, height: number): Uint8Array {
    const dithered = new Uint8Array(indices.length);
    
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = y * width + x;
        const threshold = this.BAYER_8x8[y % 8][x % 8];
        
        // Apply dither noise
        const originalIndex = indices[i];
        const ditheredIndex = Math.min(255, 
          Math.max(0, originalIndex + threshold * 16)
        );
        dithered[i] = Math.round(ditheredIndex);
      }
    }
    
    return dithered;
  }
}