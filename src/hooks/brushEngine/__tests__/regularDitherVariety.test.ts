import { BrushShape } from '@/types';
import {
  applyRegularDitherVarietyToImageData,
  computeRegularDitherShapeSeed,
  resolveRegularDitherVariety,
} from '../regularDitherVariety';
import { computeStrokeDitherPaletteForSettings } from '../engineShared';
import { applyDithering } from '../dithering';

import type { BrushSettings } from '@/types';

const makeSolidImage = (color: [number, number, number]): ImageData => {
  const imageData = new ImageData(16, 16);
  for (let i = 0; i < imageData.data.length; i += 4) {
    imageData.data[i] = color[0];
    imageData.data[i + 1] = color[1];
    imageData.data[i + 2] = color[2];
    imageData.data[i + 3] = 255;
  }
  return imageData;
};

const renderDither = ({
  color,
  rgb,
  diversity,
  seed,
}: {
  color: string;
  rgb: [number, number, number];
  diversity: number;
  seed: number;
}): Uint8ClampedArray => {
  const settings = {
    brushShape: BrushShape.PIXEL_DITHER,
    color,
    ditherAlgorithm: 'bayer',
    patternStyle: 'dots',
    ditherPaletteSpread: 85,
    ditherPatternDiversity: diversity,
  } as BrushSettings;
  const palette = computeStrokeDitherPaletteForSettings(settings);
  const variety = resolveRegularDitherVariety({ settings, palette, seed });
  const varied = applyRegularDitherVarietyToImageData(makeSolidImage(rgb), variety);
  return applyDithering(
    varied,
    palette.length,
    settings.ditherAlgorithm,
    settings.patternStyle,
    palette,
    variety.phaseOffset
  ).data;
};

describe('regularDitherVariety', () => {
  it('derives a deterministic seed from the same shape geometry', () => {
    const points = [
      { x: 10, y: 10 },
      { x: 40, y: 10 },
      { x: 40, y: 40 },
      { x: 10, y: 40 },
    ];

    expect(computeRegularDitherShapeSeed(points)).toBe(computeRegularDitherShapeSeed(points));
  });

  it('produces deterministic output for the same color and seed', () => {
    const seed = 12345;
    const first = renderDither({ color: '#b34a22', rgb: [179, 74, 34], diversity: 100, seed });
    const second = renderDither({ color: '#b34a22', rgb: [179, 74, 34], diversity: 100, seed });

    expect(Array.from(first)).toEqual(Array.from(second));
  });

  it('lets selected color change the high-variety dither output', () => {
    const seed = 12345;
    const warm = renderDither({ color: '#b34a22', rgb: [179, 74, 34], diversity: 100, seed });
    const cool = renderDither({ color: '#226db3', rgb: [34, 109, 179], diversity: 100, seed });

    expect(Array.from(warm)).not.toEqual(Array.from(cool));
  });

  it('neutralizes variety when ditherPatternDiversity is zero', () => {
    const settings = {
      brushShape: BrushShape.PIXEL_DITHER,
      color: '#b34a22',
      ditherAlgorithm: 'bayer',
      patternStyle: 'dots',
      ditherPaletteSpread: 85,
      ditherPatternDiversity: 0,
    } as BrushSettings;
    const palette = computeStrokeDitherPaletteForSettings(settings);
    const source = makeSolidImage([179, 74, 34]);
    const variety = resolveRegularDitherVariety({ settings, palette, seed: 12345 });
    const varied = applyRegularDitherVarietyToImageData(source, variety);

    expect(variety.phaseOffset).toBeUndefined();
    expect(variety.toneBias).toBe(0);
    expect(Array.from(varied.data)).toEqual(Array.from(source.data));
  });
});
