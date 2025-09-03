/**
 * MedianCut - High-quality color quantization using median cut algorithm
 * 
 * Implements the classic median cut algorithm for optimal palette generation
 * with support for different color spaces and quality levels.
 */

export interface ColorPoint {
  r: number;
  g: number;
  b: number;
  count: number;
  originalIndex?: number;
}

export interface ColorCube {
  colors: ColorPoint[];
  bounds: {
    rMin: number; rMax: number;
    gMin: number; gMax: number;
    bMin: number; bMax: number;
  };
  volume: number;
  variance: number;
}

export interface MedianCutOptions {
  colorSpace: 'rgb' | 'oklab' | 'perceptual';
  maxColors: number;
  quality: 'fast' | 'balanced' | 'best';
  preserveImportant: boolean;
}

export interface MedianCutResult {
  palette: Uint32Array;
  colorMap: Map<number, number>;
  clusters: ColorCube[];
  stats: {
    originalColors: number;
    finalColors: number;
    compressionRatio: number;
    avgError: number;
    processingTime: number;
  };
}

export class MedianCut {
  private options: MedianCutOptions;
  
  constructor(options: Partial<MedianCutOptions> = {}) {
    this.options = {
      colorSpace: 'rgb',
      maxColors: 256,
      quality: 'balanced',
      preserveImportant: false,
      ...options
    };
  }

  /**
   * Quantize image data using median cut algorithm
   */
  quantize(imageData: ImageData): MedianCutResult {
    const startTime = performance.now();
    
    // Step 1: Build color histogram
    const histogram = this.buildHistogram(imageData);
    const originalColors = histogram.size;
    
    // Step 2: Create initial color cube
    const initialCube = this.createColorCube(Array.from(histogram.values()));
    
    // Step 3: Split cubes using median cut
    const cubes = this.medianCutSplit(initialCube, this.options.maxColors);
    
    // Step 4: Generate palette from cube centers
    const palette = this.generatePalette(cubes);
    
    // Step 5: Build color mapping for fast lookup
    const colorMap = this.buildColorMap(histogram, palette);
    
    // Step 6: Calculate statistics
    const avgError = this.calculateAverageError(histogram, palette, colorMap);
    const processingTime = performance.now() - startTime;
    
    return {
      palette,
      colorMap,
      clusters: cubes,
      stats: {
        originalColors,
        finalColors: palette.length / 4,
        compressionRatio: originalColors / (palette.length / 4),
        avgError,
        processingTime
      }
    };
  }

  /**
   * Build color histogram with frequency counting
   */
  private buildHistogram(imageData: ImageData): Map<number, ColorPoint> {
    const { data, width, height } = imageData;
    const histogram = new Map<number, ColorPoint>();
    
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i + 1]; 
      const b = data[i + 2];
      const a = data[i + 3];
      
      // Skip transparent pixels
      if (a < 128) continue;
      
      const colorKey = (r << 16) | (g << 8) | b;
      
      if (histogram.has(colorKey)) {
        histogram.get(colorKey)!.count++;
      } else {
        histogram.set(colorKey, {
          r, g, b,
          count: 1,
          originalIndex: i / 4
        });
      }
    }
    
    return histogram;
  }

  /**
   * Create initial color cube containing all colors
   */
  private createColorCube(colors: ColorPoint[]): ColorCube {
    if (colors.length === 0) {
      throw new Error('Cannot create color cube from empty color array');
    }

    let rMin = 255, rMax = 0;
    let gMin = 255, gMax = 0;  
    let bMin = 255, bMax = 0;
    
    // Find bounding box
    for (const color of colors) {
      rMin = Math.min(rMin, color.r);
      rMax = Math.max(rMax, color.r);
      gMin = Math.min(gMin, color.g);
      gMax = Math.max(gMax, color.g);
      bMin = Math.min(bMin, color.b);
      bMax = Math.max(bMax, color.b);
    }
    
    const volume = (rMax - rMin + 1) * (gMax - gMin + 1) * (bMax - bMin + 1);
    const variance = this.calculateVariance(colors);
    
    return {
      colors: [...colors],
      bounds: { rMin, rMax, gMin, gMax, bMin, bMax },
      volume,
      variance
    };
  }

  /**
   * Split color cubes using median cut algorithm
   */
  private medianCutSplit(initialCube: ColorCube, maxColors: number): ColorCube[] {
    const cubes: ColorCube[] = [initialCube];
    
    while (cubes.length < maxColors) {
      // Find cube with largest volume * variance (priority for splitting)
      let bestCube: ColorCube | null = null;
      let bestScore = 0;
      let bestIndex = -1;
      
      for (let i = 0; i < cubes.length; i++) {
        const cube = cubes[i];
        if (cube.colors.length <= 1) continue;
        
        const score = this.getCubeSplitScore(cube);
        if (score > bestScore) {
          bestScore = score;
          bestCube = cube;
          bestIndex = i;
        }
      }
      
      if (!bestCube) break; // No more cubes can be split
      
      // Split the best cube
      const [cube1, cube2] = this.splitCube(bestCube);
      
      // Replace original cube with two new cubes
      cubes.splice(bestIndex, 1, cube1, cube2);
    }
    
    return cubes;
  }

  /**
   * Calculate split score for cube prioritization
   */
  private getCubeSplitScore(cube: ColorCube): number {
    switch (this.options.quality) {
      case 'fast':
        return cube.volume;
      case 'balanced':
        return cube.volume * Math.sqrt(cube.variance);
      case 'best':
        return cube.volume * cube.variance;
      default:
        return cube.volume;
    }
  }

  /**
   * Split a color cube along its longest dimension
   */
  private splitCube(cube: ColorCube): [ColorCube, ColorCube] {
    const { bounds } = cube;
    
    // Find longest dimension
    const rRange = bounds.rMax - bounds.rMin;
    const gRange = bounds.gMax - bounds.gMin;
    const bRange = bounds.bMax - bounds.bMin;
    
    let splitDimension: 'r' | 'g' | 'b';
    if (rRange >= gRange && rRange >= bRange) {
      splitDimension = 'r';
    } else if (gRange >= bRange) {
      splitDimension = 'g';
    } else {
      splitDimension = 'b';
    }
    
    // Sort colors by split dimension
    const sortedColors = [...cube.colors].sort((a, b) => a[splitDimension] - b[splitDimension]);
    
    // Find median split point (weighted by color frequency)
    const totalWeight = sortedColors.reduce((sum, color) => sum + color.count, 0);
    let leftWeight = 0;
    let splitIndex = 0;
    
    for (let i = 0; i < sortedColors.length - 1; i++) {
      leftWeight += sortedColors[i].count;
      if (leftWeight >= totalWeight / 2) {
        splitIndex = i + 1;
        break;
      }
    }
    
    // Create two new cubes
    const leftColors = sortedColors.slice(0, splitIndex);
    const rightColors = sortedColors.slice(splitIndex);
    
    const leftCube = this.createColorCube(leftColors);
    const rightCube = this.createColorCube(rightColors);
    
    return [leftCube, rightCube];
  }

  /**
   * Calculate color variance within a cube
   */
  private calculateVariance(colors: ColorPoint[]): number {
    if (colors.length <= 1) return 0;
    
    const totalWeight = colors.reduce((sum, color) => sum + color.count, 0);
    
    // Calculate weighted mean
    let meanR = 0, meanG = 0, meanB = 0;
    for (const color of colors) {
      const weight = color.count / totalWeight;
      meanR += color.r * weight;
      meanG += color.g * weight;
      meanB += color.b * weight;
    }
    
    // Calculate variance
    let variance = 0;
    for (const color of colors) {
      const weight = color.count / totalWeight;
      const dr = color.r - meanR;
      const dg = color.g - meanG;
      const db = color.b - meanB;
      variance += weight * (dr * dr + dg * dg + db * db);
    }
    
    return variance;
  }

  /**
   * Generate final palette from color cubes
   */
  private generatePalette(cubes: ColorCube[]): Uint32Array {
    const palette = new Uint32Array(cubes.length * 4);
    
    for (let i = 0; i < cubes.length; i++) {
      const cube = cubes[i];
      const [r, g, b] = this.calculateCubeCenter(cube);
      
      palette[i * 4] = r;
      palette[i * 4 + 1] = g;
      palette[i * 4 + 2] = b;
      palette[i * 4 + 3] = 255;
    }
    
    return palette;
  }

  /**
   * Calculate weighted center of a color cube
   */
  private calculateCubeCenter(cube: ColorCube): [number, number, number] {
    if (cube.colors.length === 0) return [0, 0, 0];
    
    const totalWeight = cube.colors.reduce((sum, color) => sum + color.count, 0);
    
    let r = 0, g = 0, b = 0;
    for (const color of cube.colors) {
      const weight = color.count / totalWeight;
      r += color.r * weight;
      g += color.g * weight;
      b += color.b * weight;
    }
    
    return [
      Math.round(r),
      Math.round(g), 
      Math.round(b)
    ];
  }

  /**
   * Build color mapping for fast pixel lookup
   */
  private buildColorMap(histogram: Map<number, ColorPoint>, palette: Uint32Array): Map<number, number> {
    const colorMap = new Map<number, number>();
    
    for (const [colorKey, colorPoint] of histogram) {
      const nearestIndex = this.findNearestColor(colorPoint, palette);
      colorMap.set(colorKey, nearestIndex);
    }
    
    return colorMap;
  }

  /**
   * Find nearest palette color using euclidean distance
   */
  private findNearestColor(color: ColorPoint, palette: Uint32Array): number {
    let minDistance = Infinity;
    let nearestIndex = 0;
    
    for (let i = 0; i < palette.length; i += 4) {
      const pr = palette[i];
      const pg = palette[i + 1];
      const pb = palette[i + 2];
      
      const dr = color.r - pr;
      const dg = color.g - pg;
      const db = color.b - pb;
      
      const distance = dr * dr + dg * dg + db * db;
      
      if (distance < minDistance) {
        minDistance = distance;
        nearestIndex = i / 4;
      }
    }
    
    return nearestIndex;
  }

  /**
   * Calculate average color error across all pixels
   */
  private calculateAverageError(
    histogram: Map<number, ColorPoint>, 
    palette: Uint32Array,
    colorMap: Map<number, number>
  ): number {
    let totalError = 0;
    let totalPixels = 0;
    
    for (const [colorKey, colorPoint] of histogram) {
      const paletteIndex = colorMap.get(colorKey)!;
      const pr = palette[paletteIndex * 4];
      const pg = palette[paletteIndex * 4 + 1];
      const pb = palette[paletteIndex * 4 + 2];
      
      const dr = colorPoint.r - pr;
      const dg = colorPoint.g - pg;
      const db = colorPoint.b - pb;
      
      const error = Math.sqrt(dr * dr + dg * dg + db * db);
      totalError += error * colorPoint.count;
      totalPixels += colorPoint.count;
    }
    
    return totalPixels > 0 ? totalError / totalPixels : 0;
  }

  /**
   * Apply quantization to image data
   */
  applyQuantization(imageData: ImageData, result: MedianCutResult): ImageData {
    const { data } = imageData;
    const quantized = new ImageData(new Uint8ClampedArray(data), imageData.width, imageData.height);
    
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const a = data[i + 3];
      
      if (a < 128) continue; // Skip transparent pixels
      
      const colorKey = (r << 16) | (g << 8) | b;
      const paletteIndex = result.colorMap.get(colorKey) || 0;
      
      quantized.data[i] = result.palette[paletteIndex * 4];
      quantized.data[i + 1] = result.palette[paletteIndex * 4 + 1];
      quantized.data[i + 2] = result.palette[paletteIndex * 4 + 2];
      quantized.data[i + 3] = a;
    }
    
    return quantized;
  }
}