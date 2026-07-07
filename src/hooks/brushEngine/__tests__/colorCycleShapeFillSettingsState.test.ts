import { ColorCycleShapeFillSettingsState } from '../colorCycleShapeFillSettingsState';

describe('ColorCycleShapeFillSettingsState', () => {
  it('owns shape-fill settings defaults', () => {
    const state = new ColorCycleShapeFillSettingsState();

    expect(state.getSettings()).toEqual({
      gradientBands: 12,
      bandSpacing: 5,
      ditherEnabled: false,
      ditherStrength: 1,
      ditherPixelSize: 1,
      pxlEdgeEnabled: false,
      perceptualDither: false,
    });
  });

  it('normalizes gradient bands while preserving gradientBands=1 compatibility', () => {
    const state = new ColorCycleShapeFillSettingsState();

    expect(state.setGradientBands(1)).toBe(1);
    expect(state.getGradientBands()).toBe(1);
    expect(state.deriveBandCountFromDistance(320, 8)).toBe(2);

    expect(state.setGradientBands(300.8)).toBe(254);
    expect(state.getGradientBands()).toBe(254);
    expect(state.setGradientBands(0)).toBeNull();
    expect(state.getGradientBands()).toBe(254);
  });

  it('normalizes band spacing and distance-derived band counts', () => {
    const state = new ColorCycleShapeFillSettingsState();

    expect(state.setBandSpacing(8.6)).toBe(9);
    expect(state.getBandSpacing()).toBe(9);
    expect(state.normalizeBandSpacingValue(999)).toBe(512);
    expect(state.normalizeBandSpacingValue(-1)).toBe(9);
    expect(state.setBandSpacing(0)).toBeNull();
  });

  it('owns dither and edge toggles', () => {
    const state = new ColorCycleShapeFillSettingsState();

    state.setDitherStrength(0.25);
    expect(state.getDitherStrength()).toBe(0.25);
    expect(state.setDitherEnabled(true)).toBe(true);
    expect(state.getDitherStrength()).toBe(1);

    state.setDitherStrength(2);
    expect(state.getDitherStrength()).toBe(1);
    state.setDitherStrength(-1);
    expect(state.getDitherStrength()).toBe(0);

    state.setDitherPixelSize(3.8);
    expect(state.getDitherPixelSize()).toBe(3);

    state.setPxlEdgeEnabled(true);
    state.setPerceptualDither(true);
    expect(state.isPxlEdgeEnabled()).toBe(true);
    expect(state.isPerceptualDitherEnabled()).toBe(true);
  });
});
