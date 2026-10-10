import {
  __TESTING__,
  ditherRegionWithCurrentPressure,
} from '@/hooks/brushEngine/strokeDitherRegion';
import { BrushShape, type BrushSettings } from '@/types';

describe('strokeDitherRegion', () => {
  it.each([
    { mergeExisting: false },
    { overridePixelSize: 1, bgOffMode: 'direct' as const, bgOffComposite: 'copy' as const },
  ])('replaces BG-off pixels without retaining old holes or clearing outside the region: %j', (options) => {
    const makeContext = () => {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 8;
      return canvas.getContext('2d')!;
    };
    const target = makeContext();
    const source = makeContext();
    const temp = makeContext();
    const hole = makeContext();
    target.fillStyle = '#ff0000';
    target.fillRect(0, 0, 8, 8);
    source.fillStyle = '#808080';
    source.fillRect(2, 2, 4, 4);
    // An obsolete accumulated hole must not erase the newly resolved pattern.
    hole.fillStyle = '#000000';
    hole.fillRect(0, 0, 8, 8);
    const getHole = jest.fn(() => ({ canvas: hole.canvas, ctx: hole }));
    const settings = {
      brushShape: BrushShape.PIXEL_DITHER, color: '#808080',
      ditherEnabled: true, ditherAlgorithm: 'bayer', ditherBackgroundFill: false,
      fillResolution: 1,
    } as BrushSettings;
    const args = {
      ctx: target, sampleCtx: source, region: { x: 2, y: 2, width: 4, height: 4 },
      options, toolsBrushSettings: settings, strokeDitherPalette: ['#000000', '#ffffff'],
      transparentInk: [0, 0, 0] as [number, number, number],
      computeStrokeDitherPaletteForSettings: () => ['#000000', '#ffffff'],
      pickTransparentInk: (): [number, number, number] => [0, 0, 0],
      computePressureScaledResolution: () => 1, getStrokeDitherPixelSize: () => 1,
      applyLostEdgeToStrokeAlpha: jest.fn(),
      ensureBgOffTemp: () => ({ canvas: temp.canvas, ctx: temp }),
      ensureBgOffHole: getHole, bgOffMaskImageRef: { current: null },
      strokePhaseOriginRef: { current: null }, DD: jest.fn(),
    };
    ditherRegionWithCurrentPressure(args);
    const first = target.getImageData(2, 2, 4, 4).data;
    expect(Array.from(first).filter((value, index) => index % 4 === 3 && value > 0)).toHaveLength(8);
    expect(getHole).not.toHaveBeenCalled();
    ditherRegionWithCurrentPressure(args);
    expect(target.getImageData(2, 2, 4, 4).data).toEqual(first);
    expect(Array.from(target.getImageData(0, 0, 1, 1).data)).toEqual([255, 0, 0, 255]);
    source.clearRect(2, 2, 4, 4);
    ditherRegionWithCurrentPressure(args);
    expect(Array.from(target.getImageData(2, 2, 4, 4).data).every((value) => value === 0)).toBe(true);
    expect(Array.from(target.getImageData(0, 0, 1, 1).data)).toEqual([255, 0, 0, 255]);
  });

  it.each([false, true])('preserves older pressure islands and replaces owned holes (BG=%s)', (fillBackground) => {
    const makeContext = () => {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 8;
      return canvas.getContext('2d')!;
    };
    const target = makeContext();
    const source = makeContext();
    const support = new ImageData(8, 8);
    target.fillStyle = '#ff0000';
    target.fillRect(0, 0, 8, 8);
    source.fillStyle = '#808080';
    source.fillRect(0, 0, 8, 8);
    // A disconnected run encloses an older island; its bounding rectangle is
    // insufficient to decide which pixels this pressure is allowed to replace.
    for (let y = 0; y < 8; y += 1) {
      for (let x = 0; x < 8; x += 1) {
        if (x < 2 || x >= 6 || y >= 6) support.data[(y * 8 + x) * 4 + 3] = 255;
      }
    }
    const settings = {
      brushShape: BrushShape.PIXEL_DITHER, color: '#808080',
      ditherEnabled: true, ditherAlgorithm: 'bayer', ditherBackgroundFill: fillBackground,
    } as BrushSettings;
    const args = {
      ctx: target, sampleCtx: source, region: { x: 0, y: 0, width: 8, height: 8 },
      options: { overridePixelSize: 1, writeSupportMask: support },
      toolsBrushSettings: settings, strokeDitherPalette: ['#000000', '#ffffff'],
      transparentInk: [0, 0, 0] as [number, number, number],
      computeStrokeDitherPaletteForSettings: () => ['#000000', '#ffffff'],
      pickTransparentInk: (): [number, number, number] => [0, 0, 0],
      computePressureScaledResolution: () => 1, getStrokeDitherPixelSize: () => 1,
      applyLostEdgeToStrokeAlpha: jest.fn(), ensureBgOffTemp: jest.fn(), ensureBgOffHole: jest.fn(),
      bgOffMaskImageRef: { current: null }, strokePhaseOriginRef: { current: null }, DD: jest.fn(),
    };
    ditherRegionWithCurrentPressure(args);
    const first = target.getImageData(0, 0, 8, 8).data;
    let ownedHoles = 0;
    for (let i = 0; i < first.length; i += 4) {
      if (support.data[i + 3] === 0) {
        expect(Array.from(first.slice(i, i + 4))).toEqual([255, 0, 0, 255]);
      } else {
        expect(first[i + 1]).toBe(first[i]);
        expect(first[i + 3]).toBe(fillBackground || first[i] === 255 ? 255 : 0);
        if (!first[i + 3]) ownedHoles += 1;
      }
    }
    expect(ownedHoles > 0).toBe(!fillBackground);
    ditherRegionWithCurrentPressure(args);
    expect(target.getImageData(0, 0, 8, 8).data).toEqual(first);
  });

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


describe('eraser alpha dithering', () => {
  const renderMask = (
    alpha: number | ((x: number, y: number) => number),
    pixelSize = 1,
    settingsOverride: Partial<BrushSettings> = {},
    signal: 'color' | 'alpha' = 'alpha',
    imageTileThresholdResolver?: (x: number, y: number) => number | null,
  ) => {
    const source = new ImageData(64, 64);
    for (let y = 8; y < 56; y += 1) {
      for (let x = 8; x < 56; x += 1) {
        const i = (y * 64 + x) * 4;
        source.data.set([255, 255, 255, typeof alpha === 'number' ? alpha : alpha(x, y)], i);
      }
    }
    const putImageData = jest.fn();
    const ctx = {
      canvas: { width: 64, height: 64 },
      getImageData: () => source,
      putImageData,
      imageSmoothingEnabled: true,
    } as unknown as CanvasRenderingContext2D;
    const settings = {
      brushShape: BrushShape.SQUARE,
      color: '#ffffff',
      ditherEnabled: true,
      ditherAlgorithm: 'sierra-lite',
      ditherBackgroundFill: false,
      fillResolution: pixelSize,
      ...settingsOverride,
    } as BrushSettings;
    ditherRegionWithCurrentPressure({
      ctx,
      region: { x: 0, y: 0, width: 64, height: 64 },
      signal,
      toolsBrushSettings: settings,
      strokeDitherPalette: ['#ffffff', '#000000'],
      transparentInk: [0, 0, 0],
      computeStrokeDitherPaletteForSettings: () => ['#ffffff', '#000000'],
      pickTransparentInk: () => [0, 0, 0],
      computePressureScaledResolution: () => pixelSize,
      getStrokeDitherPixelSize: () => pixelSize,
      applyLostEdgeToStrokeAlpha: jest.fn(),
      ensureBgOffTemp: jest.fn(),
      ensureBgOffHole: jest.fn(),
      bgOffMaskImageRef: { current: null },
      strokePhaseOriginRef: { current: null },
      imageTileThresholdResolver,
      DD: jest.fn(),
    });
    const output = putImageData.mock.calls.at(-1)?.[0] as ImageData;
    expect(output).toBeDefined();
    return { source, output };
  };

  it.each([1, 4])('spatially dithers opacity without applying it twice at resolution %i', (resolution) => {
    const strengths = [0, 64, 128, 192, 255].map((alpha) => {
      const { output } = renderMask(alpha, resolution);
      let total = 0;
      for (let y = 0; y < 64; y += 1) {
        for (let x = 0; x < 64; x += 1) {
          const i = (y * 64 + x) * 4;
          const value = output.data[i + 3];
          expect([0, 255]).toContain(value);
          if (x < 8 || x >= 56 || y < 8 || y >= 56) expect(value).toBe(0);
          else total += value;
          if (value) expect(Array.from(output.data.subarray(i, i + 3))).toEqual([255, 255, 255]);
        }
      }
      const mean = total / (48 * 48);
      expect(Math.abs(mean - alpha)).toBeLessThan(12);
      return mean;
    });
    expect(strengths[0]).toBe(0);
    expect(strengths.at(-1)).toBe(255);
    expect(strengths).toEqual([...strengths].sort((a, b) => a - b));
  });

  it.each([
    'bayer', 'bayer-4x4', 'void-and-cluster', 'blue-noise',
    'floyd-steinberg', 'jarvis-judice-ninke', 'stucki', 'burkes', 'atkinson',
  ] as const)('preserves low and high erase strength with %s', (algorithm) => {
    for (const resolution of [1, 4]) {
      for (const alpha of [64, 192]) {
        const { output } = renderMask(alpha, resolution, { ditherAlgorithm: algorithm });
        let total = 0;
        for (let i = 3; i < output.data.length; i += 4) total += output.data[i];
        expect(Math.abs(total / (48 * 48) - alpha)).toBeLessThan(20);
      }
    }
  });

  it('averages nonzero coverage within coarse cells without extending zero geometry', () => {
    const { source, output } = renderMask((x) => x % 4 === 0 ? 255 : x % 4 === 3 ? 0 : 1, 4);
    let sourceTotal = 0;
    let total = 0;
    for (let i = 3; i < output.data.length; i += 4) {
      sourceTotal += source.data[i];
      total += output.data[i];
      if (source.data[i] === 0) expect(output.data[i]).toBe(0);
    }
    expect(Math.abs(total - sourceTotal) / (48 * 48)).toBeLessThan(12);
  });

  it('keeps solid continuous opacity when background fill is on', () => {
    const { source, output } = renderMask(128, 4, { ditherBackgroundFill: true });
    expect(output.data).toEqual(source.data);
  });

  it('ignores painting tint and palette spread and is deterministic', () => {
    const plain = renderMask(128, 4).output;
    const tinted = renderMask(128, 4, { color: '#123456', ditherPaletteSpread: 100 }).output;
    expect(tinted.data).toEqual(plain.data);
    expect(renderMask(128, 4).output.data).toEqual(plain.data);
  });

  it.each(['bayer', 'pattern', 'sierra-lite'])('uses the selected %s algorithm for coverage', (algorithm) => {
    const resolver = jest.fn((x: number) => x % 2 ? 1 : 0);
    const { output } = renderMask(128, 1, {
      ditherAlgorithm: algorithm as BrushSettings['ditherAlgorithm'],
      patternStyle: 'image-tile',
    }, 'alpha', resolver);
    const alphas = Array.from(output.data).filter((_, i) => i % 4 === 3);
    expect(alphas.filter(value => value === 255).length).toBeGreaterThan(500);
    expect(alphas.filter(value => value === 255).length).toBeLessThan(1800);
    if (algorithm === 'pattern') expect(resolver).toHaveBeenCalled();
  });

  it('retains the default color-brush source alpha contract', () => {
    const { output } = renderMask(128, 1, { ditherBackgroundFill: true }, 'color');
    expect(output.data[(12 * 64 + 12) * 4 + 3]).toBe(128);
    expect(output.data[3]).toBe(0);
  });
});
