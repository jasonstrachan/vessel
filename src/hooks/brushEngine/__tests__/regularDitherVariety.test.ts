import { BrushShape } from '@/types';

import { computeStrokeDitherPaletteForSettings } from '../engineShared';
import { applyDitheringWithFillResolution } from '../dithering';
import { resolveRegularDitherVariety } from '../regularDitherVariety';

import type { BrushSettings } from '@/types';

const makeSolidImage = (
  color: [number, number, number],
  width = 32,
  height = 24,
): ImageData => {
  const imageData = new ImageData(width, height);
  for (let i = 0; i < imageData.data.length; i += 4) {
    imageData.data[i] = color[0];
    imageData.data[i + 1] = color[1];
    imageData.data[i + 2] = color[2];
    imageData.data[i + 3] = 255;
  }
  return imageData;
};

const makeSettings = (
  color: string,
  ditherPatternDiversity = 100,
): BrushSettings => ({
  brushShape: BrushShape.PIXEL_DITHER,
  color,
  ditherAlgorithm: 'sierra-lite',
  patternStyle: 'dots',
  ditherPaletteSpread: 0,
  ditherPatternDiversity,
  fillResolution: 1,
} as BrushSettings);

const render = (ditherPatternDiversity: number): ImageData => {
  const settings = makeSettings('#808080', ditherPatternDiversity);
  const palette = computeStrokeDitherPaletteForSettings(settings);
  return applyDitheringWithFillResolution(
    makeSolidImage([128, 128, 128]),
    palette.length,
    1,
    'sierra-lite',
    'dots',
    palette,
    undefined,
    undefined,
    resolveRegularDitherVariety({ settings, palette }),
  );
};

const colorKeyAt = (imageData: ImageData, x: number, y: number): string => {
  const index = (y * imageData.width + x) * 4;
  return `${imageData.data[index]},${imageData.data[index + 1]},${imageData.data[index + 2]}`;
};

const countVerticalTriples = (imageData: ImageData): number => {
  let count = 0;
  for (let y = 0; y < imageData.height - 2; y += 1) {
    for (let x = 0; x < imageData.width; x += 1) {
      const key = colorKeyAt(imageData, x, y);
      if (
        key === colorKeyAt(imageData, x, y + 1) &&
        key === colorKeyAt(imageData, x, y + 2)
      ) {
        count += 1;
      }
    }
  }
  return count;
};

const countHorizontalAlternations = (imageData: ImageData): number => {
  let count = 0;
  for (let y = 0; y < imageData.height; y += 1) {
    for (let x = 0; x < imageData.width - 1; x += 1) {
      if (colorKeyAt(imageData, x, y) !== colorKeyAt(imageData, x + 1, y)) {
        count += 1;
      }
    }
  }
  return count;
};

const countChangedPixels = (left: ImageData, right: ImageData): number => {
  let count = 0;
  for (let index = 0; index < left.data.length; index += 4) {
    if (
      left.data[index] !== right.data[index] ||
      left.data[index + 1] !== right.data[index + 1] ||
      left.data[index + 2] !== right.data[index + 2]
    ) {
      count += 1;
    }
  }
  return count;
};

describe('regularDitherVariety', () => {
  it('produces one stable variety from visible settings alone', () => {
    const settings = makeSettings('#b34a22');
    const palette = computeStrokeDitherPaletteForSettings(settings);

    expect(resolveRegularDitherVariety({ settings, palette })).toEqual(
      resolveRegularDitherVariety({ settings, palette }),
    );
  });

  it('allows visible color changes to alter the stable Sierra seed', () => {
    const warmSettings = makeSettings('#b34a22');
    const coolSettings = makeSettings('#226db3');
    const warmPalette = computeStrokeDitherPaletteForSettings(warmSettings);
    const coolPalette = computeStrokeDitherPaletteForSettings(coolSettings);

    expect(resolveRegularDitherVariety({
      settings: warmSettings,
      palette: warmPalette,
    }).seed).not.toBe(resolveRegularDitherVariety({
      settings: coolSettings,
      palette: coolPalette,
    }).seed);
  });

  it('keeps zero Variety as a classic near-checker with sparse vertical stacks', () => {
    const output = render(0);
    const horizontalEdges = output.height * (output.width - 1);

    expect(countVerticalTriples(output)).toBeGreaterThan(0);
    expect(countHorizontalAlternations(output) / horizontalEdges).toBeGreaterThan(0.9);
  });

  it('adds deterministic Sierra vertical runs as Variety increases', () => {
    const neutral = render(0);
    const medium = render(50);
    const full = render(100);

    expect(Array.from(medium.data)).not.toEqual(Array.from(neutral.data));
    expect(Array.from(full.data)).not.toEqual(Array.from(medium.data));
    expect(countVerticalTriples(medium)).toBeGreaterThan(0);
    expect(countVerticalTriples(full)).toBeGreaterThan(0);
    expect(countChangedPixels(neutral, full)).toBeGreaterThan(countChangedPixels(neutral, medium));
  });

  it('keeps full Variety deterministic and approximately tone-balanced', () => {
    const first = render(100);
    const second = render(100);
    const firstKey = colorKeyAt(first, 0, 0);
    let firstInkCount = 0;

    for (let y = 0; y < first.height; y += 1) {
      for (let x = 0; x < first.width; x += 1) {
        if (colorKeyAt(first, x, y) === firstKey) {
          firstInkCount += 1;
        }
      }
    }

    expect(Array.from(first.data)).toEqual(Array.from(second.data));
    expect(firstInkCount / (first.width * first.height)).toBeGreaterThan(0.4);
    expect(firstInkCount / (first.width * first.height)).toBeLessThan(0.6);
  });
});
