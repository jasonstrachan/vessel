/**
 * Unit tests for pressure-sensitive dithering algorithms
 */

import {
  applyFloydSteinbergDither,
  applyBayerDither,
  applySierraLitePressureDither,
  applySierraLiteLostEdgeMask,
  applyPressureDither,
  calculatePressureDitherThreshold,
  findNearestPaletteColor,
  createGrayscalePalette,
  APPLE_II_PALETTE,
  BAYER_8x8_MATRIX,
  BAYER_4x4_MATRIX,
  BAYER_2x2_MATRIX,
  DitherSettings
} from '../ditherAlgorithms';

// Mock ImageData for Node.js environment
type ImageDataConstructor = typeof globalThis extends { ImageData: infer T }
  ? T
  : never;

class MockImageData {
  data: Uint8ClampedArray;
  width: number;
  height: number;
  
  constructor(data: Uint8ClampedArray | number, widthOrHeight?: number, height?: number) {
    if (data instanceof Uint8ClampedArray) {
      this.data = data;
      this.width = widthOrHeight!;
      this.height = height!;
    } else {
      this.width = data;
      this.height = widthOrHeight!;
      this.data = new Uint8ClampedArray(this.width * this.height * 4);
    }
  }
}

const originalImageData = globalThis.ImageData as ImageDataConstructor | undefined;

beforeAll(() => {
  globalThis.ImageData = MockImageData as unknown as ImageDataConstructor;
});

afterAll(() => {
  if (originalImageData) {
    globalThis.ImageData = originalImageData;
  }
});

describe('Dithering Algorithms', () => {
  
  // Helper function to create test image data
  const createTestImageData = (width: number, height: number): ImageData => {
    const data = new Uint8ClampedArray(width * height * 4);
    
    // Fill with gradient pattern for testing
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = (y * width + x) * 4;
        const gray = Math.floor((x + y) * 255 / (width + height - 2));
        data[idx] = gray;     // R
        data[idx + 1] = gray; // G
        data[idx + 2] = gray; // B
        data[idx + 3] = 255;  // A
      }
    }
    
    return new globalThis.ImageData(data, width, height);
  };
  
  describe('calculatePressureDitherThreshold', () => {
    it('should return low threshold for light pressure', () => {
      const threshold = calculatePressureDitherThreshold(0.1, 1.0);
      expect(threshold).toBeGreaterThan(0.5); // Light pressure = more dithering
    });
    
    it('should return high threshold for heavy pressure', () => {
      const threshold = calculatePressureDitherThreshold(0.9, 1.0);
      expect(threshold).toBeLessThan(0.5); // Heavy pressure = less dithering  
    });
    
    it('should respect min/max threshold bounds', () => {
      const minThreshold = 0.2;
      const maxThreshold = 0.8;
      const threshold = calculatePressureDitherThreshold(0.5, 1.0, minThreshold, maxThreshold);
      expect(threshold).toBeGreaterThanOrEqual(minThreshold);
      expect(threshold).toBeLessThanOrEqual(maxThreshold);
    });
    
    it('should handle pressure deadzone correctly', () => {
      const lowPressure = calculatePressureDitherThreshold(0.03, 1.0); // Below 5% deadzone
      const aboveDeadzone = calculatePressureDitherThreshold(0.07, 1.0); // Above 5% deadzone
      expect(lowPressure).toBeGreaterThan(aboveDeadzone);
    });
  });
  
  describe('findNearestPaletteColor', () => {
    const testPalette: [number, number, number][] = [
      [0, 0, 0],       // Black
      [255, 255, 255], // White
      [255, 0, 0]      // Red
    ];
    
    it('should find exact color matches', () => {
      const result = findNearestPaletteColor(255, 0, 0, testPalette);
      expect(result).toEqual([255, 0, 0]);
    });
    
    it('should find nearest color for approximate matches', () => {
      const result = findNearestPaletteColor(200, 50, 50, testPalette);
      expect(result).toEqual([255, 0, 0]); // Should match red
    });
    
    it('should handle grayscale correctly', () => {
      const result = findNearestPaletteColor(128, 128, 128, testPalette);
      // Should match either black or white (whichever is closer)
      expect(result).toEqual([255, 255, 255]); // Closer to white
    });
  });
  
  describe('createGrayscalePalette', () => {
    it('should create correct number of colors', () => {
      const palette = createGrayscalePalette(4);
      expect(palette).toHaveLength(4);
    });
    
    it('should create proper grayscale progression', () => {
      const palette = createGrayscalePalette(3);
      expect(palette[0]).toEqual([0, 0, 0]);     // Black
      expect(palette[1]).toEqual([128, 128, 128]); // Mid gray (128 = 255/2 rounded)
      expect(palette[2]).toEqual([255, 255, 255]); // White
    });
    
    it('should handle single color', () => {
      const palette = createGrayscalePalette(1);
      expect(palette).toHaveLength(1);
      expect(palette[0]).toEqual([0, 0, 0]);
    });
  });
  
  describe('Bayer matrices', () => {
    it('should have correct dimensions', () => {
      expect(BAYER_2x2_MATRIX).toHaveLength(2);
      expect(BAYER_2x2_MATRIX[0]).toHaveLength(2);
      
      expect(BAYER_4x4_MATRIX).toHaveLength(4);
      expect(BAYER_4x4_MATRIX[0]).toHaveLength(4);
      
      expect(BAYER_8x8_MATRIX).toHaveLength(8);
      expect(BAYER_8x8_MATRIX[0]).toHaveLength(8);
    });
    
    it('should be normalized to 0-1 range', () => {
      [BAYER_2x2_MATRIX, BAYER_4x4_MATRIX, BAYER_8x8_MATRIX].forEach(matrix => {
        matrix.forEach(row => {
          row.forEach(value => {
            expect(value).toBeGreaterThanOrEqual(0);
            expect(value).toBeLessThanOrEqual(1);
          });
        });
      });
    });
  });
  
  describe('applyBayerDither', () => {
    const testSettings: DitherSettings = {
      algorithm: 'bayer',
      pressure: 0.5,
      intensity: 0.8,
      bayerMatrixSize: 4,
      palette: createGrayscalePalette(2)
    };
    
    it('should process image data without errors', () => {
      const imageData = createTestImageData(16, 16);
      expect(() => applyBayerDither(imageData, testSettings)).not.toThrow();
    });
    
    it('should return ImageData of same dimensions', () => {
      const imageData = createTestImageData(8, 8);
      const result = applyBayerDither(imageData, testSettings);
      expect(result.width).toBe(8);
      expect(result.height).toBe(8);
      expect(result.data.length).toBe(imageData.data.length);
    });
    
    it('should quantize colors to palette', () => {
      const imageData = createTestImageData(4, 4);
      const result = applyBayerDither(imageData, testSettings);
      
      // Check that all pixels are either black or white (our 2-color palette)
      for (let i = 0; i < result.data.length; i += 4) {
        const r = result.data[i];
        const g = result.data[i + 1];
        const b = result.data[i + 2];
        expect(r === 0 || r === 255).toBe(true);
        expect(g === 0 || g === 255).toBe(true);
        expect(b === 0 || b === 255).toBe(true);
        expect(r).toBe(g); // Should be grayscale
        expect(g).toBe(b); // Should be grayscale
      }
    });
  });
  
  describe('applyFloydSteinbergDither', () => {
    const testSettings: DitherSettings = {
      algorithm: 'floyd-steinberg',
      pressure: 0.5,
      intensity: 0.8,
      bayerMatrixSize: 8,
      palette: createGrayscalePalette(4)
    };
    
    it('should process image data without errors', () => {
      const imageData = createTestImageData(10, 10);
      expect(() => applyFloydSteinbergDither(imageData, testSettings)).not.toThrow();
    });
    
    it('should maintain image dimensions', () => {
      const imageData = createTestImageData(6, 6);
      const result = applyFloydSteinbergDither(imageData, testSettings);
      expect(result.width).toBe(6);
      expect(result.height).toBe(6);
    });
    
    it('should quantize to palette colors', () => {
      const imageData = createTestImageData(4, 4);
      const result = applyFloydSteinbergDither(imageData, testSettings);
      const palette = createGrayscalePalette(4);
      const paletteValues = new Set(palette.map(color => color[0])); // Get R values
      
      // Check that all R values are in our palette
      for (let i = 0; i < result.data.length; i += 4) {
        expect(paletteValues.has(result.data[i])).toBe(true);
      }
    });
  });
  
  describe('applySierraLitePressureDither', () => {
    const testSettings: DitherSettings = {
      algorithm: 'sierra-lite',
      pressure: 0.7,
      intensity: 0.6,
      bayerMatrixSize: 8,
      palette: APPLE_II_PALETTE
    };
    
    it('should process image data without errors', () => {
      const imageData = createTestImageData(12, 12);
      expect(() => applySierraLitePressureDither(imageData, testSettings)).not.toThrow();
    });
    
    it('should maintain image dimensions', () => {
      const imageData = createTestImageData(8, 8);
      const result = applySierraLitePressureDither(imageData, testSettings);
      expect(result.width).toBe(8);
      expect(result.height).toBe(8);
    });
    
    it('should respect pressure settings', () => {
      const imageData = createTestImageData(4, 4);
      const lowPressureSettings = { ...testSettings, pressure: 0.1 };
      const highPressureSettings = { ...testSettings, pressure: 0.9 };
      
      const lowPressureResult = applySierraLitePressureDither(imageData, lowPressureSettings);
      const highPressureResult = applySierraLitePressureDither(imageData, highPressureSettings);
      
      // Results should be different (though we can't easily test the exact difference)
      expect(lowPressureResult.data).not.toEqual(highPressureResult.data);
    });
  });

  describe('applySierraLiteLostEdgeMask', () => {
    const buildCoverage = (w: number, h: number, fillStart: number, fillEnd: number) => {
      const arr = new Uint8Array(w * h);
      for (let y = fillStart; y < fillEnd; y++) {
        for (let x = fillStart; x < fillEnd; x++) {
          arr[y * w + x] = 255;
        }
      }
      return arr;
    };

    it('returns full mask when intensity is zero', () => {
      const coverage = buildCoverage(5, 5, 1, 4);
      const mask = applySierraLiteLostEdgeMask(coverage, 5, 5, 0);
      expect(mask.every((v) => v === 255)).toBe(true);
    });

    it('softens edge pixels while keeping the center opaque', () => {
      const coverage = buildCoverage(16, 16, 4, 12);
      const mask = applySierraLiteLostEdgeMask(coverage, 16, 16, 40, 4);
      const center = mask[8 * 16 + 8]; // middle
      const minValue = Math.min(...mask);

      expect(center).toBeGreaterThan(200);
      expect(minValue).toBeLessThan(255);
    });

    it('keeps interior opaque with coarse tiling', () => {
      const coverage = buildCoverage(16, 16, 4, 12);
      const mask = applySierraLiteLostEdgeMask(coverage, 16, 16, 80, 4);
      const center = mask[8 * 16 + 8];
      expect(center).toBeGreaterThan(200);
    });
  });
  
  describe('applyPressureDither (main function)', () => {
    it('should route to correct algorithm', () => {
      const imageData = createTestImageData(4, 4);
      
      const bayerSettings: DitherSettings = {
        algorithm: 'bayer',
        pressure: 0.5,
        intensity: 0.8,
        bayerMatrixSize: 4,
        palette: createGrayscalePalette(2)
      };
      
      const floydSettings: DitherSettings = {
        algorithm: 'floyd-steinberg',
        pressure: 0.5,
        intensity: 0.8,
        bayerMatrixSize: 8,
        palette: createGrayscalePalette(2)
      };
      
      // Both should work without errors
      expect(() => applyPressureDither(imageData, bayerSettings)).not.toThrow();
      expect(() => applyPressureDither(imageData, floydSettings)).not.toThrow();
      
      // Results should be different for different algorithms
      const bayerResult = applyPressureDither(imageData, bayerSettings);
      const floydResult = applyPressureDither(imageData, floydSettings);
      expect(bayerResult.data).not.toEqual(floydResult.data);
    });
    
    it('should handle unknown algorithm gracefully', () => {
      const imageData = createTestImageData(4, 4);
      const invalidSettings = {
        algorithm: 'unknown',
        pressure: 0.5,
        intensity: 0.8,
        bayerMatrixSize: 8,
        palette: createGrayscalePalette(2)
      } as unknown as DitherSettings;
      
      // Should not throw, should return original data
      const result = applyPressureDither(imageData, invalidSettings);
      expect(result).toBe(imageData); // Should return the same object
    });
  });
  
  describe('Performance characteristics', () => {
    it('should complete dithering in reasonable time', () => {
      const largeImageData = createTestImageData(100, 100);
      const settings: DitherSettings = {
        algorithm: 'bayer',
        pressure: 0.5,
        intensity: 0.8,
        bayerMatrixSize: 8,
        palette: createGrayscalePalette(8)
      };
      
      const start = performance.now();
      applyPressureDither(largeImageData, settings);
      const end = performance.now();
      
      // Should complete within 100ms for 100x100 image
      expect(end - start).toBeLessThan(100);
    });
    
    it('should handle edge cases gracefully', () => {
      // Very small image
      const tinyImageData = createTestImageData(1, 1);
      const settings: DitherSettings = {
        algorithm: 'floyd-steinberg',
        pressure: 0.5,
        intensity: 0.8,
        bayerMatrixSize: 8,
        palette: createGrayscalePalette(2)
      };
      
      expect(() => applyPressureDither(tinyImageData, settings)).not.toThrow();
      
      // Empty palette (should be handled by algorithm)
      const emptyPaletteSettings = { ...settings, palette: [] as [number, number, number][] };
      
      // This might throw or handle gracefully depending on implementation
      // At minimum, it shouldn't crash the test runner
      try {
        applyPressureDither(tinyImageData, emptyPaletteSettings);
      } catch (error) {
        // It's okay if it throws a controlled error
        expect(error).toBeInstanceOf(Error);
      }
    });
  });
});
