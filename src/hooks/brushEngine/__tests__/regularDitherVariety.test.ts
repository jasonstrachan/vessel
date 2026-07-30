import { BrushShape } from '@/types';
import {
  applyRegularDitherVarietyToImageData,
  resolveRegularDitherVariety,
} from '../regularDitherVariety';
import { computeStrokeDitherPaletteForSettings } from '../engineShared';
import { applyDitheringWithFillResolution } from '../dithering';

import type { BrushSettings } from '@/types';

const makeSolidImage = (
  color: [number, number, number],
  width = 16,
  height = 16
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
  ditherPatternDiversity = 100
): BrushSettings => ({
  brushShape: BrushShape.PIXEL_DITHER,
  color,
  ditherAlgorithm: 'sierra-lite',
  patternStyle: 'dots',
  ditherPaletteSpread: 3,
  ditherPatternDiversity,
  fillResolution: 7,
} as BrushSettings);

describe('regularDitherVariety', () => {
  it('produces one stable variety from visible settings alone', () => {
    const settings = makeSettings('#b34a22');
    const palette = computeStrokeDitherPaletteForSettings(settings);

    expect(resolveRegularDitherVariety({ settings, palette })).toEqual(
      resolveRegularDitherVariety({ settings, palette })
    );
  });

  it('allows visible color changes to alter the stable dither mix', () => {
    const warmSettings = makeSettings('#b34a22');
    const coolSettings = makeSettings('#226db3');
    const warmPalette = computeStrokeDitherPaletteForSettings(warmSettings);
    const coolPalette = computeStrokeDitherPaletteForSettings(coolSettings);

    expect(resolveRegularDitherVariety({
      settings: warmSettings,
      palette: warmPalette,
    })).not.toEqual(resolveRegularDitherVariety({
      settings: coolSettings,
      palette: coolPalette,
    }));
  });

  it('neutralizes variety when ditherPatternDiversity is zero', () => {
    const settings = makeSettings('#b34a22', 0);
    const palette = computeStrokeDitherPaletteForSettings(settings);
    const source = makeSolidImage([179, 74, 34]);
    const variety = resolveRegularDitherVariety({ settings, palette });
    const varied = applyRegularDitherVarietyToImageData(source, variety);

    expect(variety).toEqual({ toneBias: 0 });
    expect(Array.from(varied.data)).toEqual(Array.from(source.data));
  });

  it('keeps dark endpoint colors inside a ditherable range', () => {
    const settings = makeSettings('#0e0f14');
    const palette = computeStrokeDitherPaletteForSettings(settings);
    const variety = resolveRegularDitherVariety({ settings, palette });

    expect(variety.toneBias).toBeGreaterThanOrEqual(18);
  });

  it('keeps white endpoint fills textured', () => {
    const settings = makeSettings('#ffffff');
    const palette = computeStrokeDitherPaletteForSettings(settings);
    const variety = resolveRegularDitherVariety({ settings, palette });
    const varied = applyRegularDitherVarietyToImageData(
      makeSolidImage([255, 255, 255], 70, 70),
      variety
    );
    const dithered = applyDitheringWithFillResolution(
      varied,
      palette.length,
      settings.fillResolution ?? 7,
      settings.ditherAlgorithm,
      settings.patternStyle,
      palette,
      variety.phaseOffset
    );

    let interiorPixels = 0;
    let texturedPixels = 0;
    for (let y = 14; y < 56; y += 1) {
      for (let x = 14; x < 56; x += 1) {
        const idx = (y * dithered.width + x) * 4;
        interiorPixels += 1;
        if (
          dithered.data[idx] < 250 ||
          dithered.data[idx + 1] < 250 ||
          dithered.data[idx + 2] < 250
        ) {
          texturedPixels += 1;
        }
      }
    }

    expect(variety.toneBias).toBeLessThanOrEqual(-28);
    expect(texturedPixels / interiorPixels).toBeGreaterThan(0.1);
  });
});
