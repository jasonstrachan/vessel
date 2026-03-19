import { BrushShape, type BrushSettings } from '@/types';
import {
  quantizeToRasterPoint,
  resolveColorCycleRasterAnchor,
  shouldPixelAlignBrush,
} from '../strokeRasterPolicy';

const withBrushSettings = (
  partial: Partial<Pick<BrushSettings, 'brushShape' | 'antialiasing' | 'colorCycleStampShape'>>
): Pick<BrushSettings, 'brushShape' | 'antialiasing' | 'colorCycleStampShape'> => ({
  brushShape: BrushShape.SQUARE,
  antialiasing: false,
  colorCycleStampShape: 'square',
  ...partial,
});

describe('strokeRasterPolicy', () => {
  it('flags color-cycle stroke brushes for pixel alignment', () => {
    expect(shouldPixelAlignBrush(withBrushSettings({ brushShape: BrushShape.COLOR_CYCLE }))).toBe(true);
    expect(shouldPixelAlignBrush(withBrushSettings({ brushShape: BrushShape.COLOR_CYCLE_TRIANGLE }))).toBe(true);
  });

  it('resolves square color-cycle stamps to square-center anchoring', () => {
    expect(
      resolveColorCycleRasterAnchor(
        withBrushSettings({
          brushShape: BrushShape.COLOR_CYCLE,
          colorCycleStampShape: 'square',
        })
      )
    ).toBe('pixel-square-center');
  });

  it('resolves center anchor for non-square color-cycle stamps', () => {
    expect(
      resolveColorCycleRasterAnchor(
        withBrushSettings({
          brushShape: BrushShape.COLOR_CYCLE,
          colorCycleStampShape: 'round',
        })
      )
    ).toBe('pixel-center');
  });

  it('quantizes center-anchor coordinates to half pixels', () => {
    expect(quantizeToRasterPoint(12.2, 7.9, 1, 1, 'pixel-center')).toEqual({ x: 12.5, y: 7.5 });
  });

  it('quantizes square-center coordinates to nearest integer stamp centers', () => {
    expect(quantizeToRasterPoint(12.7, 7.2, 1, 1, 'pixel-square-center')).toEqual({ x: 13, y: 7 });
  });
});
