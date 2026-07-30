import {
  __TESTING__,
  ditherRegionWithCurrentPressure,
} from '@/hooks/brushEngine/strokeDitherRegion';
import { BrushShape, type BrushSettings } from '@/types';

describe('strokeDitherRegion', () => {
  it('promotes partially covered edge cells to full cells when pxlEdge is enabled', () => {
    const imageData = new ImageData(4, 2);
    const { data } = imageData;

    // Single painted pixel in the left 2x2 block.
    data[0] = 200;
    data[1] = 20;
    data[2] = 10;
    data[3] = 255;

    __TESTING__.promoteWholePixelCellsForDitherEdges(imageData, 2);

    // Left 2x2 block should now be fully occupied with the painted color.
    const occupiedIndices = [
      0, // (0,0)
      4, // (1,0)
      16, // (0,1)
      20, // (1,1)
    ];
    for (const idx of occupiedIndices) {
      expect(data[idx]).toBe(200);
      expect(data[idx + 1]).toBe(20);
      expect(data[idx + 2]).toBe(10);
      expect(data[idx + 3]).toBe(255);
    }

    // Right 2x2 block remains empty.
    const emptyIndices = [
      8, // (2,0)
      12, // (3,0)
      24, // (2,1)
      28, // (3,1)
    ];
    for (const idx of emptyIndices) {
      expect(data[idx + 3]).toBe(0);
    }
  });

  it('promotes each touched cell independently without color bleeding across cells', () => {
    const imageData = new ImageData(4, 2);
    const { data } = imageData;

    // Touch one pixel in each 2x2 cell with different colors.
    // Left cell: red-ish
    data[0] = 220;
    data[1] = 40;
    data[2] = 20;
    data[3] = 255;
    // Right cell: green-ish at (2,0)
    const rightIdx = (0 * 4 + 2) * 4;
    data[rightIdx] = 15;
    data[rightIdx + 1] = 200;
    data[rightIdx + 2] = 35;
    data[rightIdx + 3] = 255;

    __TESTING__.promoteWholePixelCellsForDitherEdges(imageData, 2);

    // Entire left 2x2 should match left source color.
    const leftIndices = [0, 4, 16, 20];
    for (const idx of leftIndices) {
      expect(data[idx]).toBe(220);
      expect(data[idx + 1]).toBe(40);
      expect(data[idx + 2]).toBe(20);
      expect(data[idx + 3]).toBe(255);
    }

    // Entire right 2x2 should match right source color.
    const rightIndices = [8, 12, 24, 28];
    for (const idx of rightIndices) {
      expect(data[idx]).toBe(15);
      expect(data[idx + 1]).toBe(200);
      expect(data[idx + 2]).toBe(35);
      expect(data[idx + 3]).toBe(255);
    }
  });

  it('quantizes antialiased edge alpha before dither finalization', () => {
    const imageData = new ImageData(3, 1);
    const { data } = imageData;

    data[3] = 24;
    data[7] = 128;
    data[11] = 240;

    __TESTING__.quantizeImageDataAlpha(imageData);

    expect(data[3]).toBe(0);
    expect(data[7]).toBe(255);
    expect(data[11]).toBe(255);
  });

  it('uses the selected project image tile resolver', () => {
    const source = new ImageData(
      new Uint8ClampedArray([128, 128, 128, 255]),
      1,
      1
    );
    const putImageData = jest.fn();
    const ctx = {
      canvas: { width: 1, height: 1 },
      getImageData: jest.fn(() => source),
      putImageData,
      imageSmoothingEnabled: true,
    } as unknown as CanvasRenderingContext2D;
    const resolver = jest.fn(() => 0);
    const settings = {
      brushShape: BrushShape.PIXEL_DITHER,
      color: '#ffffff',
      ditherEnabled: true,
      ditherAlgorithm: 'pattern',
      patternStyle: 'image-tile',
      ditherBackgroundFill: true,
      fillResolution: 1,
    } as BrushSettings;

    ditherRegionWithCurrentPressure({
      ctx,
      region: { x: 0, y: 0, width: 1, height: 1 },
      toolsBrushSettings: settings,
      strokeDitherPalette: ['#ffffff', '#000000'],
      transparentInk: [0, 0, 0],
      computeStrokeDitherPaletteForSettings: () => ['#ffffff', '#000000'],
      pickTransparentInk: () => [0, 0, 0],
      computePressureScaledResolution: () => 1,
      getStrokeDitherPixelSize: () => 1,
      applyLostEdgeToStrokeAlpha: jest.fn(),
      ensureBgOffTemp: jest.fn(),
      ensureBgOffHole: jest.fn(),
      bgOffMaskImageRef: { current: null },
      strokePhaseOriginRef: { current: null },
      imageTileThresholdResolver: resolver,
      DD: jest.fn(),
    });

    expect(resolver).toHaveBeenCalled();
    expect(putImageData).toHaveBeenCalled();
  });

  it('uses the effective fill resolution for Lostedge', () => {
    const source = new ImageData(24, 16);
    const ctx = {
      canvas: { width: 64, height: 64 },
      getImageData: jest.fn(() => source),
      putImageData: jest.fn(),
      imageSmoothingEnabled: true,
    } as unknown as CanvasRenderingContext2D;
    const applyLostEdgeToStrokeAlpha = jest.fn();
    const settings = {
      brushShape: BrushShape.PIXEL_DITHER,
      color: '#ffffff',
      ditherEnabled: true,
      ditherAlgorithm: 'sierra-lite',
      ditherBackgroundFill: true,
      fillResolution: 12,
      lostEdge: 40,
    } as BrushSettings;

    ditherRegionWithCurrentPressure({
      ctx,
      region: { x: 5, y: 7, width: 24, height: 16 },
      toolsBrushSettings: settings,
      strokeDitherPalette: ['#ffffff', '#000000'],
      transparentInk: [0, 0, 0],
      computeStrokeDitherPaletteForSettings: () => ['#ffffff', '#000000'],
      pickTransparentInk: () => [0, 0, 0],
      computePressureScaledResolution: () => 12,
      getStrokeDitherPixelSize: () => 12,
      applyLostEdgeToStrokeAlpha,
      ensureBgOffTemp: jest.fn(),
      ensureBgOffHole: jest.fn(),
      bgOffMaskImageRef: { current: null },
      strokePhaseOriginRef: { current: null },
      DD: jest.fn(),
    });

    expect(applyLostEdgeToStrokeAlpha).toHaveBeenCalledWith(
      source.data,
      24,
      16,
      40,
      12,
    );
  });
});
