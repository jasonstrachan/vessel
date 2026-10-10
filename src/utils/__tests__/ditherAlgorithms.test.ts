/**
 * Unit tests for pressure-sensitive dithering algorithms
 */

import { createHash } from 'crypto';

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
import { applyDithering, applyDitheringWithFillResolution } from '@/hooks/brushEngine/dithering';
import { resolveLostEdgeTileSize } from '../ditherConstants';

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
  
  it('renders the 4×4 algorithm with the existing matrix and preserves ordered phase', () => {
    const image = createTestImageData(31, 29);
    const settings: DitherSettings = {
      algorithm: 'bayer', pressure: 0.5, intensity: 1,
      bayerMatrixSize: 4, palette: createGrayscalePalette(2),
      phaseOffset: { x: -3, y: 5 },
    };
    const expected = applyBayerDither(image, settings);
    const actual = applyPressureDither(image, { ...settings, algorithm: 'bayer-4x4', bayerMatrixSize: 8 });
    expect(actual.data).toEqual(expected.data);
    expect(applyDithering(image, 2, 'bayer-4x4', undefined, ['#000000', '#ffffff'], settings.phaseOffset).data).toEqual(expected.data);
    expect(actual.data).not.toEqual(applyPressureDither(image, { ...settings, bayerMatrixSize: 8 }).data);
  });

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

  describe('applyPressureDither supports extended algorithms', () => {
    const baseSettings: Omit<DitherSettings, 'algorithm'> = {
      pressure: 0.5,
      intensity: 0.8,
      bayerMatrixSize: 4,
      palette: createGrayscalePalette(2),
    };

    const algorithms = [
      'floyd-steinberg',
      'jarvis-judice-ninke',
      'stucki',
      'burkes',
      'sierra-3',
      'sierra-2',
      'sierra-lite',
      'atkinson',
      'bayer',
      'blue-noise',
      'void-and-cluster',
      'pattern',
    ] as const;

    algorithms.forEach((algorithm) => {
      it(`handles ${algorithm} without throwing`, () => {
        const imageData = createTestImageData(4, 4);
        expect(() =>
          applyPressureDither(imageData, { ...baseSettings, algorithm })
        ).not.toThrow();
      });
    });
  });

  describe('applySierraLiteLostEdgeMask', () => {
    const makeCoverage = (size: number, alpha: number = 255) => {
      const coverage = new Uint8Array(size * size);
      coverage.fill(alpha);
      return coverage;
    };

    const makeInsetCoverage = (size: number, border: number) => {
      const coverage = makeCoverage(size);
      for (let i = 0; i < size; i++) {
        for (let b = 0; b < border; b++) {
          coverage[b * size + i] = 0;
          coverage[(size - 1 - b) * size + i] = 0;
          coverage[i * size + b] = 0;
          coverage[i * size + (size - 1 - b)] = 0;
        }
      }
      return coverage;
    };

    const removedRatio = (mask: Uint8ClampedArray, coverage: Uint8Array) => {
      let covered = 0;
      let removed = 0;
      for (let index = 0; index < mask.length; index += 1) {
        if (coverage[index] === 0) continue;
        covered += 1;
        if (mask[index] < 128) {
          removed += 1;
        }
      }
      return covered > 0 ? removed / covered : 0;
    };

    const outerEdgeKeepRatio = (mask: Uint8ClampedArray, coverage: Uint8Array, size: number) => {
      let edgePixels = 0;
      let kept = 0;
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          const index = y * size + x;
          if (coverage[index] === 0) continue;
          const touchesOutside =
            x === 0 ||
            y === 0 ||
            x === size - 1 ||
            y === size - 1 ||
            coverage[index - 1] === 0 ||
            coverage[index + 1] === 0 ||
            coverage[index - size] === 0 ||
            coverage[index + size] === 0;
          if (!touchesOutside) continue;
          edgePixels += 1;
          if (mask[index] >= 128) {
            kept += 1;
          }
        }
      }
      return edgePixels > 0 ? kept / edgePixels : 0;
    };

    it('returns full keep mask when lostEdge is zero', () => {
      const coverage = makeCoverage(8);
      const mask = applySierraLiteLostEdgeMask(coverage, 8, 8, 0, 4);
      expect(mask.every((v) => v === 255)).toBe(true);
    });

    it('reduces edge alpha when lostEdge is high', () => {
      const size = 64;
      const coverage = makeInsetCoverage(size, 8);

      const mask = applySierraLiteLostEdgeMask(coverage, size, size, 100, 4);
      const minAlpha = mask.reduce((min, v) => Math.min(min, v), 255);
      const maxAlpha = mask.reduce((max, v) => Math.max(max, v), 0);
      expect(minAlpha).toBeLessThan(255);
      expect(maxAlpha).toBeGreaterThan(0);
    });

    it('ramps lost-edge removal density smoothly across slider values', () => {
      const size = 96;
      const coverage = makeInsetCoverage(size, 8);
      const low = removedRatio(applySierraLiteLostEdgeMask(coverage, size, size, 10), coverage);
      const mid = removedRatio(applySierraLiteLostEdgeMask(coverage, size, size, 50), coverage);
      const high = removedRatio(applySierraLiteLostEdgeMask(coverage, size, size, 100), coverage);

      expect(low).toBeGreaterThan(0);
      expect(low).toBeLessThan(0.18);
      expect(mid).toBeGreaterThan(low);
      expect(mid).toBeLessThan(0.5);
      expect(high).toBeGreaterThan(mid);
    });

    it('leaves only sparse pixels on the very outer edge at max lostEdge', () => {
      const size = 96;
      const coverage = makeInsetCoverage(size, 8);
      const mask = applySierraLiteLostEdgeMask(coverage, size, size, 100);
      const keepRatio = outerEdgeKeepRatio(mask, coverage, size);

      expect(keepRatio).toBeGreaterThan(0);
      expect(keepRatio).toBeLessThan(0.25);
    });

    it('uses pxl-edge sized cells for max lostEdge when a larger tile is supplied', () => {
      const size = 96;
      const tileSize = 12;
      const coverage = makeInsetCoverage(size, tileSize);
      const mask = applySierraLiteLostEdgeMask(coverage, size, size, 100, tileSize);
      const keepRatio = outerEdgeKeepRatio(mask, coverage, size);

      expect(keepRatio).toBeGreaterThan(0);
      expect(keepRatio).toBeLessThan(0.25);

      for (let y = 0; y < size; y += tileSize) {
        for (let x = 0; x < size; x += tileSize) {
          const first = mask[y * size + x];
          for (let yy = y; yy < Math.min(size, y + tileSize); yy += 1) {
            for (let xx = x; xx < Math.min(size, x + tileSize); xx += 1) {
              expect(mask[yy * size + xx]).toBe(first);
            }
          }
        }
      }
    });

    it('aligns Lostedge cells to the fill grid for off-grid regions', () => {
      const size = 96;
      const tileSize = 8;
      const origin = { x: 3, y: 5 };
      const coverage = makeInsetCoverage(size, 8);
      const mask = applySierraLiteLostEdgeMask(
        coverage,
        size,
        size,
        100,
        tileSize,
        origin,
      );
      const valuesByWorldCell = new Map<string, number>();

      for (let y = 0; y < size; y += 1) {
        for (let x = 0; x < size; x += 1) {
          const cellKey = `${Math.floor((origin.x + x) / tileSize)}:${Math.floor((origin.y + y) / tileSize)}`;
          const value = mask[y * size + x];
          const existing = valuesByWorldCell.get(cellKey);
          if (existing === undefined) {
            valuesByWorldCell.set(cellKey, value);
          } else {
            expect(value).toBe(existing);
          }
        }
      }
    });

    it('preserves the full Res range for Lostedge cells', () => {
      expect(resolveLostEdgeTileSize(1)).toBe(1);
      expect(resolveLostEdgeTileSize(28)).toBe(28);
      expect(resolveLostEdgeTileSize(999)).toBe(999);
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

    it.each([
      'floyd-steinberg',
      'jarvis-judice-ninke',
      'stucki',
      'burkes',
      'sierra-3',
      'sierra-2',
      'sierra-lite',
      'atkinson',
    ] as const)('%s ignores transparent padding during diffusion', (algorithm) => {
      const input = new ImageData(
        new Uint8ClampedArray([
          0, 0, 0, 0,
          170, 170, 170, 255,
        ]),
        2,
        1
      );
      const result = applyPressureDither(input, {
        algorithm,
        pressure: 0.5,
        intensity: 1,
        bayerMatrixSize: 8,
        palette: [
          [100, 100, 100],
          [200, 200, 200],
        ],
        sierraLiteVariety: { diversity: 1, seed: 0 },
      });

      expect(Array.from(result.data.slice(0, 4))).toEqual([0, 0, 0, 0]);
      expect(Array.from(result.data.slice(4, 8))).toEqual([200, 200, 200, 255]);
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

    it('should quantize colors to the provided palette', () => {
      const imageData = createTestImageData(6, 6);
      const palette = createGrayscalePalette(2);
      const paletteValues = new Set(palette.map((c) => c[0]));

      const result = applySierraLitePressureDither(imageData, {
        ...testSettings,
        palette,
        pressure: 0.5,
        intensity: 1,
      });

      for (let i = 0; i < result.data.length; i += 4) {
        const r = result.data[i];
        const g = result.data[i + 1];
        const b = result.data[i + 2];
        expect(paletteValues.has(r)).toBe(true);
        expect(r).toBe(g);
        expect(g).toBe(b);
      }
    });

    it('does not diffuse transparent padding into opaque shape pixels', () => {
      const data = new Uint8ClampedArray([
        0, 0, 0, 0,
        170, 170, 170, 255,
      ]);
      const result = applySierraLitePressureDither(
        new ImageData(data, 2, 1),
        {
          ...testSettings,
          palette: [
            [100, 100, 100],
            [200, 200, 200],
          ],
          pressure: 0.5,
          intensity: 1,
          sierraLiteVariety: { diversity: 1, seed: 0 },
        }
      );

      expect(Array.from(result.data.slice(0, 4))).toEqual([0, 0, 0, 0]);
      expect(Array.from(result.data.slice(4, 8))).toEqual([200, 200, 200, 255]);
    });

    it('keeps solid palette endpoints solid at zero Variety', () => {
      const renderSolid = (value: number) => {
        const data = new Uint8ClampedArray(4 * 4 * 4);
        for (let index = 0; index < data.length; index += 4) {
          data[index] = value;
          data[index + 1] = value;
          data[index + 2] = value;
          data[index + 3] = 255;
        }
        return applySierraLitePressureDither(
          new ImageData(data, 4, 4),
          {
            ...testSettings,
            palette: [
              [100, 100, 100],
              [200, 200, 200],
            ],
            sierraLiteVariety: { diversity: 0, seed: 8128 },
          },
        );
      };

      expect(Array.from(renderSolid(100).data).every((value, index) => (
        index % 4 === 3 ? value === 255 : value === 100
      ))).toBe(true);
      expect(Array.from(renderSolid(200).data).every((value, index) => (
        index % 4 === 3 ? value === 255 : value === 200
      ))).toBe(true);
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

    it('keeps interior opaque with coarse tiling', () => {
      const coverage = buildCoverage(64, 64, 16, 48);
      const mask = applySierraLiteLostEdgeMask(coverage, 64, 64, 40, 4);
      const center = mask[32 * 64 + 32];
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
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
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
      warnSpy.mockRestore();
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
      
      // This test runs in Jest on shared runners; keep it loose enough to catch
      // regressions without flaking on CPU contention.
      expect(end - start).toBeLessThan(400);
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


describe('alpha coverage signal', () => {
  const algorithms = [
    'sierra-lite', 'bayer', 'bayer-4x4', 'void-and-cluster', 'blue-noise',
    'floyd-steinberg', 'jarvis-judice-ninke', 'stucki', 'burkes', 'atkinson',
    'sierra-3', 'sierra-2',
  ] as const;

  const renderCoverage = (alpha: number, algorithm: typeof algorithms[number], pressure: number) => {
    const source = new ImageData(128, 128);
    for (let i = 0; i < source.data.length; i += 4) source.data.set([alpha, alpha, alpha, 255], i);
    return applyPressureDither(source, {
      algorithm, pressure, intensity: 1, bayerMatrixSize: 8,
      palette: [[0, 0, 0], [255, 255, 255]], signal: 'alpha',
    } as DitherSettings);
  };

  it.each(algorithms)('preserves mean opacity using the selected %s algorithm', (algorithm) => {
    for (const alpha of [0, 64, 128, 192, 255]) {
      const output = renderCoverage(alpha, algorithm, 0.5);
      let total = 0;
      for (let i = 0; i < output.data.length; i += 4) total += output.data[i];
      expect(Math.abs(total / (128 * 128) - alpha)).toBeLessThan(6);
      if (alpha === 0 || alpha === 255) expect(total).toBe(alpha * 128 * 128);
      expect(renderCoverage(alpha, algorithm, 1).data).toEqual(output.data);
    }
  });

  it.each([
    'sierra-lite', 'floyd-steinberg', 'jarvis-judice-ninke', 'stucki',
    'burkes', 'atkinson', 'sierra-3', 'sierra-2',
  ] as const)(
    'retains coverage on finite and disconnected support with %s',
    (algorithm) => {
      const supports = [
        { width: 5, height: 5, includes: () => true },
        { width: 31, height: 1, includes: () => true },
        { width: 1, height: 31, includes: () => true },
        { width: 29, height: 9, includes: (x: number, y: number) => y >= 2 && y < 7 && x % 12 < 5 },
        { width: 16, height: 16, includes: (x: number, y: number) => x <= y },
      ];
      for (const support of supports) {
        for (const alpha of [0, 64, 192, 255]) {
          const source = new ImageData(support.width, support.height);
          let supportedCount = 0;
          for (let y = 0; y < support.height; y += 1) {
            for (let x = 0; x < support.width; x += 1) {
              if (!support.includes(x, y)) continue;
              source.data.set([alpha, alpha, alpha, 255], (y * support.width + x) * 4);
              supportedCount += 1;
            }
          }
          const before = source.data.slice();
          const output = applyPressureDither(source, {
            algorithm, pressure: 0.5, intensity: 1, bayerMatrixSize: 8,
            palette: [[0, 0, 0], [255, 255, 255]], signal: 'alpha',
          });
          let total = 0;
          for (let i = 0; i < output.data.length; i += 4) {
            expect(output.data[i + 3]).toBe(before[i + 3]);
            expect(output.data[i]).toBe(before[i + 3] ? output.data[i + 1] : 0);
            expect([0, 255]).toContain(output.data[i]);
            total += output.data[i];
          }
          expect(Math.abs(total / supportedCount - alpha)).toBeLessThan(6);
          expect(source.data).toEqual(before);
        }
      }
    },
  );
});


it('preserves the existing complete color output for every algorithm at both resolutions', () => {
  const expected: Record<string, [string, string]> = {
    'sierra-lite': ['0af97d1fe66e4d35', 'a040c2fd7e796551'],
    bayer: ['0b6401d813fab24b', 'f9b751ac60cda6d3'],
    'bayer-4x4': ['caec3da5d8f2de76', 'f9b751ac60cda6d3'],
    pattern: ['5a87d2a15890285e', 'f9286b43742de224'],
    'floyd-steinberg': ['92f24798a3463511', 'a7e3e7862e368e8f'],
    'jarvis-judice-ninke': ['c9618538b78d1036', '1c1d98b13e65f8b0'],
    stucki: ['aa085961c3431cfd', '91820a096fc3a01b'],
    burkes: ['db9d5c8b1b10d52b', '4c0591534e52651a'],
    atkinson: ['9e5c911ea4240995', '8472acafaaebe577'],
    'blue-noise': ['7fbe139cf86e4b7c', '307b4124a8fdb8eb'],
    'void-and-cluster': ['d64c9adb344278fc', '87144d15fae25ef1'],
    'sierra-3': ['bbd21e82ca6eb1de', '1c1d98b13e65f8b0'],
    'sierra-2': ['50057739253b5989', 'b3f026eb1db1d966'],
  };
  const image = new ImageData(48, 48);
  for (let y = 0; y < 48; y += 1) {
    for (let x = 0; x < 48; x += 1) {
      image.data.set([
        (x * 7 + y * 3) % 256, (x * 2 + y * 11) % 256, (x * 17 + y) % 256,
        (x + y) % 5 ? ((x * 13 + y * 7) % 255) + 1 : 0,
      ], (y * 48 + x) * 4);
    }
  }
  for (const [algorithm, hashes] of Object.entries(expected)) {
    for (const [index, resolution] of [1, 4].entries()) {
      const output = applyDitheringWithFillResolution(
        image, 2, resolution, algorithm, 'lines', ['#123456', '#eac908'],
        { x: -3, y: 5 }, undefined, { diversity: 0.7, seed: 11 },
      );
      expect(createHash('sha256').update(output.data).digest('hex').slice(0, 16)).toBe(hashes[index]);
    }
  }
});

it('uses native full-range pattern thresholds for coverage without pressure attenuation', () => {
  const source = new ImageData(64, 1);
  for (let i = 0; i < source.data.length; i += 4) source.data.set([64, 64, 64, 255], i);
  const resolver = (x: number) => (x + 0.5) / 64;
  const output = applyPressureDither(source, {
    algorithm: 'pattern', pressure: 1, intensity: 1, bayerMatrixSize: 8,
    palette: [[0, 0, 0], [255, 255, 255]], signal: 'alpha',
    patternStyle: 'image-tile', imageTileThresholdResolver: resolver,
  });
  for (let x = 0; x < 64; x += 1) expect(output.data[x * 4]).toBe(x < 16 ? 255 : 0);
});

it('passes coverage tone through the selected cumulative image-pattern policy', () => {
  const source = new ImageData(64, 1);
  for (let i = 0; i < source.data.length; i += 4) source.data.set([64, 64, 64, 255], i);
  const resolveTone = jest.fn((tone: number) => tone);
  const resolver = Object.assign((x: number) => (x + 0.5) / 64, {
    payloadHash: 'fixture', resolveTone,
  });
  const output = applyPressureDither(source, {
    algorithm: 'pattern', pressure: 1, intensity: 1, bayerMatrixSize: 8,
    palette: [[0, 0, 0], [255, 255, 255]], signal: 'alpha',
    patternStyle: 'image-tile', imageTileThresholdResolver: resolver,
  });
  expect(resolveTone).toHaveBeenCalledWith(64 / 255);
  for (let x = 0; x < 64; x += 1) expect(output.data[x * 4]).toBe(x < 16 ? 255 : 0);
});
