import { BrushShape, type BrushSettings } from '@/types';

import { resolveBrushPressureRange } from '../pressureSettings';

const settings = (overrides: Partial<BrushSettings>): BrushSettings => ({
  brushShape: BrushShape.COLOR_CYCLE,
  pressureEnabled: true,
  minPressure: 1,
  maxPressure: 98,
  ...overrides,
} as BrushSettings);

describe('resolveBrushPressureRange', () => {
  it('treats authored min and max as direct percentages of brush size', () => {
    expect(resolveBrushPressureRange(settings({}))).toEqual({
      enabled: true,
      minPercent: 1,
      maxPercent: 98,
    });
  });

  it('keeps the maximum at or above the minimum', () => {
    expect(resolveBrushPressureRange(settings({ minPressure: 200, maxPressure: 50 }))).toEqual({
      enabled: true,
      minPercent: 200,
      maxPercent: 200,
    });
  });

  it('uses the direct Color Cycle default when maximum is absent', () => {
    expect(resolveBrushPressureRange(settings({ maxPressure: undefined }))).toEqual({
      enabled: true,
      minPercent: 1,
      maxPercent: 200,
    });
  });
});
