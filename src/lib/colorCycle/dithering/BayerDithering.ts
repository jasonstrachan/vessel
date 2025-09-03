/**
 * BayerDithering - Advanced Bayer matrix dithering implementation
 * 
 * Supports multiple matrix sizes (2x2, 4x4, 8x8, 16x16) with optimized
 * threshold calculation and error distribution patterns.
 */

export interface DitherOptions {
  matrixSize: 2 | 4 | 8 | 16;
  intensity: number; // 0.0 to 1.0
  colorSpace: 'rgb' | 'perceptual';
  errorDiffusion: boolean;
  adaptiveThreshold: boolean;
}

export interface DitherResult {
  imageData: ImageData;
  stats: {
    originalColors: number;
    quantizedColors: number;
    ditherStrength: number;
    processingTime: number;
    errorReduction: number;
  };
}

export class BayerDithering {
  private matrices: Map<number, number[][]>;
  private options: DitherOptions;
  
  constructor(options: Partial<DitherOptions> = {}) {
    this.options = {
      matrixSize: 4,
      intensity: 0.5,
      colorSpace: 'rgb',
      errorDiffusion: false,
      adaptiveThreshold: true,
      ...options
    };
    
    this.matrices = new Map();
    this.initializeBayerMatrices();
  }

  /**
   * Initialize all Bayer matrices
   */
  private initializeBayerMatrices(): void {
    // 2x2 Bayer matrix
    this.matrices.set(2, [
      [0, 2],
      [3, 1]
    ]);
    
    // 4x4 Bayer matrix
    this.matrices.set(4, [
      [ 0,  8,  2, 10],
      [12,  4, 14,  6],
      [ 3, 11,  1,  9],
      [15,  7, 13,  5]
    ]);
    
    // 8x8 Bayer matrix (generated recursively)
    this.matrices.set(8, this.generateBayerMatrix(8));
    
    // 16x16 Bayer matrix (generated recursively)
    this.matrices.set(16, this.generateBayerMatrix(16));
  }

  /**
   * Generate Bayer matrix of given size using recursive construction
   */
  private generateBayerMatrix(size: number): number[][] {
    if (size === 2) {
      return [
        [0, 2],
        [3, 1]
      ];
    }
    
    const halfSize = size / 2;
    const subMatrix = this.generateBayerMatrix(halfSize);
    const matrix: number[][] = Array(size).fill(0).map(() => Array(size).fill(0));
    
    // Fill quadrants using recursive pattern
    for (let i = 0; i < halfSize; i++) {
      for (let j = 0; j < halfSize; j++) {
        const baseValue = subMatrix[i][j];
        
        // Top-left quadrant: base * 4
        matrix[i][j] = baseValue * 4;
        
        // Top-right quadrant: base * 4 + 2
        matrix[i][j + halfSize] = baseValue * 4 + 2;
        
        // Bottom-left quadrant: base * 4 + 3
        matrix[i + halfSize][j] = baseValue * 4 + 3;
        
        // Bottom-right quadrant: base * 4 + 1
        matrix[i + halfSize][j + halfSize] = baseValue * 4 + 1;
      }
    }
    
    return matrix;
  }

  /**
   * Apply Bayer dithering to image data with palette
   */
  dither(
    imageData: ImageData, 
    palette: Uint32Array, 
    colorMap?: Map<number, number>
  ): DitherResult {
    const startTime = performance.now();
    
    const { width, height, data } = imageData;
    const matrix = this.matrices.get(this.options.matrixSize)!;
    const matrixSize = this.options.matrixSize;
    const matrixMax = matrixSize * matrixSize - 1;
    
    // Create result image data
    const result = new ImageData(new Uint8ClampedArray(data), width, height);
    
    // Track statistics
    const originalColors = new Set<number>();
    const quantizedColors = new Set<number>();
    let totalError = 0;
    let totalPixels = 0;
    
    // Error diffusion buffers (if enabled)
    const errorBufferR = this.options.errorDiffusion ? new Float32Array(width * height) : null;
    const errorBufferG = this.options.errorDiffusion ? new Float32Array(width * height) : null;
    const errorBufferB = this.options.errorDiffusion ? new Float32Array(width * height) : null;
    
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const pixelIndex = (y * width + x) * 4;
        
        let r = data[pixelIndex];
        let g = data[pixelIndex + 1];
        let b = data[pixelIndex + 2];
        const a = data[pixelIndex + 3];
        
        // Skip transparent pixels
        if (a < 128) {
          result.data[pixelIndex] = r;
          result.data[pixelIndex + 1] = g;
          result.data[pixelIndex + 2] = b;
          result.data[pixelIndex + 3] = a;
          continue;
        }
        
        // Add accumulated error (if error diffusion is enabled)
        if (this.options.errorDiffusion && errorBufferR && errorBufferG && errorBufferB) {
          const errorIndex = y * width + x;
          r = Math.max(0, Math.min(255, r + errorBufferR[errorIndex]));
          g = Math.max(0, Math.min(255, g + errorBufferG[errorIndex]));
          b = Math.max(0, Math.min(255, b + errorBufferB[errorIndex]));
        }
        
        // Record original color
        originalColors.add((r << 16) | (g << 8) | b);
        
        // Get Bayer threshold for this pixel
        const bayerX = x % matrixSize;
        const bayerY = y % matrixSize;
        const threshold = matrix[bayerY][bayerX] / matrixMax;
        
        // Apply dithering with adaptive threshold
        let ditherR = r, ditherG = g, ditherB = b;
        
        if (this.options.adaptiveThreshold) {
          // Adaptive threshold based on local contrast
          const localContrast = this.calculateLocalContrast(data, x, y, width, height);
          const adaptedIntensity = this.options.intensity * (0.5 + localContrast * 0.5);
          
          ditherR = this.applyDitherThreshold(r, threshold, adaptedIntensity);
          ditherG = this.applyDitherThreshold(g, threshold, adaptedIntensity);
          ditherB = this.applyDitherThreshold(b, threshold, adaptedIntensity);
        } else {
          ditherR = this.applyDitherThreshold(r, threshold, this.options.intensity);
          ditherG = this.applyDitherThreshold(g, threshold, this.options.intensity);
          ditherB = this.applyDitherThreshold(b, threshold, this.options.intensity);
        }
        
        // Find nearest palette color
        let paletteIndex = 0;
        if (colorMap) {
          const originalColorKey = (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(b);
          paletteIndex = colorMap.get(originalColorKey) || 0;
        } else {
          paletteIndex = this.findNearestPaletteColor(ditherR, ditherG, ditherB, palette);
        }
        
        // Get quantized color
        const quantR = palette[paletteIndex * 4];
        const quantG = palette[paletteIndex * 4 + 1];
        const quantB = palette[paletteIndex * 4 + 2];
        
        // Record quantized color
        quantizedColors.add((quantR << 16) | (quantG << 8) | quantB);
        
        // Calculate quantization error
        const errorR = ditherR - quantR;
        const errorG = ditherG - quantG;
        const errorB = ditherB - quantB;
        
        totalError += Math.sqrt(errorR * errorR + errorG * errorG + errorB * errorB);
        totalPixels++;
        
        // Distribute error to neighboring pixels (if error diffusion enabled)
        if (this.options.errorDiffusion && errorBufferR && errorBufferG && errorBufferB) {
          this.distributeError(
            errorR, errorG, errorB,
            x, y, width, height,
            errorBufferR, errorBufferG, errorBufferB
          );
        }
        
        // Set result pixel
        result.data[pixelIndex] = quantR;
        result.data[pixelIndex + 1] = quantG;
        result.data[pixelIndex + 2] = quantB;
        result.data[pixelIndex + 3] = a;
      }
    }
    
    const processingTime = performance.now() - startTime;
    const avgError = totalPixels > 0 ? totalError / totalPixels : 0;
    
    return {
      imageData: result,
      stats: {
        originalColors: originalColors.size,
        quantizedColors: quantizedColors.size,
        ditherStrength: this.options.intensity,
        processingTime,
        errorReduction: Math.max(0, 1 - (avgError / 128)) // Normalized error reduction
      }
    };
  }

  /**
   * Apply dither threshold to a single color component
   */
  private applyDitherThreshold(value: number, threshold: number, intensity: number): number {
    const noise = (threshold - 0.5) * 255 * intensity;
    return Math.max(0, Math.min(255, value + noise));
  }

  /**
   * Calculate local contrast for adaptive thresholding
   */
  private calculateLocalContrast(
    data: Uint8ClampedArray,
    x: number,
    y: number,
    width: number,
    height: number
  ): number {
    const radius = 1;
    let minLum = 255;
    let maxLum = 0;
    
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        const nx = Math.max(0, Math.min(width - 1, x + dx));
        const ny = Math.max(0, Math.min(height - 1, y + dy));
        const idx = (ny * width + nx) * 4;
        
        // Calculate luminance
        const r = data[idx];
        const g = data[idx + 1];
        const b = data[idx + 2];
        const lum = 0.299 * r + 0.587 * g + 0.114 * b;
        
        minLum = Math.min(minLum, lum);
        maxLum = Math.max(maxLum, lum);
      }
    }
    
    return (maxLum - minLum) / 255; // Normalized contrast
  }

  /**
   * Find nearest color in palette
   */
  private findNearestPaletteColor(r: number, g: number, b: number, palette: Uint32Array): number {
    let minDistance = Infinity;
    let nearestIndex = 0;
    
    for (let i = 0; i < palette.length; i += 4) {
      const pr = palette[i];
      const pg = palette[i + 1];
      const pb = palette[i + 2];
      
      const distance = this.calculateColorDistance(r, g, b, pr, pg, pb);
      
      if (distance < minDistance) {
        minDistance = distance;
        nearestIndex = i / 4;
      }
    }
    
    return nearestIndex;
  }

  /**
   * Calculate color distance (perceptual or euclidean)
   */
  private calculateColorDistance(r1: number, g1: number, b1: number, r2: number, g2: number, b2: number): number {
    if (this.options.colorSpace === 'perceptual') {
      // Weighted RGB distance for better perceptual accuracy
      const dr = r1 - r2;
      const dg = g1 - g2;
      const db = b1 - b2;
      
      return 0.299 * dr * dr + 0.587 * dg * dg + 0.114 * db * db;
    } else {
      // Standard euclidean distance
      const dr = r1 - r2;
      const dg = g1 - g2;
      const db = b1 - b2;
      
      return dr * dr + dg * dg + db * db;
    }
  }

  /**
   * Distribute quantization error to neighboring pixels (Floyd-Steinberg pattern)
   */
  private distributeError(
    errorR: number,
    errorG: number,
    errorB: number,
    x: number,
    y: number,
    width: number,
    height: number,
    bufferR: Float32Array,
    bufferG: Float32Array,
    bufferB: Float32Array
  ): void {
    // Floyd-Steinberg error diffusion weights
    const weights = [
      { dx: 1, dy: 0, weight: 7/16 },  // Right
      { dx: -1, dy: 1, weight: 3/16 }, // Bottom-left
      { dx: 0, dy: 1, weight: 5/16 },  // Bottom
      { dx: 1, dy: 1, weight: 1/16 }   // Bottom-right
    ];
    
    for (const { dx, dy, weight } of weights) {
      const nx = x + dx;
      const ny = y + dy;
      
      if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
        const errorIndex = ny * width + nx;
        
        bufferR[errorIndex] += errorR * weight;
        bufferG[errorIndex] += errorG * weight;
        bufferB[errorIndex] += errorB * weight;
      }
    }
  }

  /**
   * Preview dithering effect without full processing
   */
  previewDither(
    imageData: ImageData,
    sampleRegion: { x: number; y: number; width: number; height: number }
  ): ImageData {
    const { x, y, width: regionWidth, height: regionHeight } = sampleRegion;
    const { width, height, data } = imageData;
    
    // Extract sample region
    const sampleData = new Uint8ClampedArray(regionWidth * regionHeight * 4);
    
    for (let sy = 0; sy < regionHeight; sy++) {
      for (let sx = 0; sx < regionWidth; sx++) {
        const sourceX = Math.min(width - 1, x + sx);
        const sourceY = Math.min(height - 1, y + sy);
        const sourceIndex = (sourceY * width + sourceX) * 4;
        const sampleIndex = (sy * regionWidth + sx) * 4;
        
        sampleData[sampleIndex] = data[sourceIndex];
        sampleData[sampleIndex + 1] = data[sourceIndex + 1];
        sampleData[sampleIndex + 2] = data[sourceIndex + 2];
        sampleData[sampleIndex + 3] = data[sourceIndex + 3];
      }
    }
    
    const sampleImage = new ImageData(sampleData, regionWidth, regionHeight);
    
    // Create simple palette from sample
    const palette = this.createPreviewPalette(sampleImage);
    
    // Apply dithering to sample
    return this.dither(sampleImage, palette).imageData;
  }

  /**
   * Create a simple preview palette from image sample
   */
  private createPreviewPalette(imageData: ImageData): Uint32Array {
    // Simple RGB332 palette for preview
    const palette = new Uint32Array(256 * 4);
    
    for (let i = 0; i < 256; i++) {
      const r = ((i >> 5) & 0x7) * 36; // 3 bits -> 0-252
      const g = ((i >> 2) & 0x7) * 36; // 3 bits -> 0-252
      const b = (i & 0x3) * 85;        // 2 bits -> 0-255
      
      palette[i * 4] = r;
      palette[i * 4 + 1] = g;
      palette[i * 4 + 2] = b;
      palette[i * 4 + 3] = 255;
    }
    
    return palette;
  }

  /**
   * Update dithering options
   */
  updateOptions(newOptions: Partial<DitherOptions>): void {
    this.options = { ...this.options, ...newOptions };
  }

  /**
   * Get current options
   */
  getOptions(): DitherOptions {
    return { ...this.options };
  }

  /**
   * Get available matrix sizes
   */
  getAvailableMatrixSizes(): number[] {
    return Array.from(this.matrices.keys()).sort((a, b) => a - b);
  }

  /**
   * Benchmark different matrix sizes
   */
  benchmarkMatrixSizes(imageData: ImageData, palette: Uint32Array): {
    size: number;
    processingTime: number;
    errorReduction: number;
    quality: number;
  }[] {
    const results = [];
    const originalOptions = { ...this.options };
    
    for (const size of this.getAvailableMatrixSizes()) {
      this.options.matrixSize = size as 2 | 4 | 8 | 16;
      
      const result = this.dither(imageData, palette);
      const quality = result.stats.errorReduction * (1 - result.stats.processingTime / 1000);
      
      results.push({
        size,
        processingTime: result.stats.processingTime,
        errorReduction: result.stats.errorReduction,
        quality
      });
    }
    
    // Restore original options
    this.options = originalOptions;
    
    return results.sort((a, b) => b.quality - a.quality);
  }
}