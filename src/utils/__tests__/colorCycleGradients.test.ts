import { GradientPalette } from '@/lib/GradientPalette';
import { parseCssColor } from '@/utils/color/parseCssColor';
import { rgbToHsl } from '@/utils/imageProcessing';
import { buildForegroundColorRampSpec, buildForegroundDerivedGradientSpec, deriveForegroundGradientStops, setSharedColorCycleGradient } from '@/utils/colorCycleGradients';

const applyGradientEditMock = jest.fn();

const storeState = {
  activeLayerId: 'layer-1',
  tools: {
    brushSettings: {
      colorCycleUseForegroundGradient: true,
    },
    eraserSettings: {
      brushShape: 'round',
    },
  },
  setBrushSettings: jest.fn(),
  setEraserSettings: jest.fn(),
};

jest.mock('@/stores/useAppStore', () => ({
  useAppStore: {
    getState: () => storeState,
  },
}));

jest.mock('@/hooks/brushEngine/ccGradientController', () => ({
  applyGradientEdit: (...args: unknown[]) => applyGradientEditMock(...args),
}));

describe('setSharedColorCycleGradient', () => {
  beforeEach(() => {
    storeState.tools.brushSettings = {
      colorCycleUseForegroundGradient: true,
    };
    storeState.setBrushSettings.mockClear();
    storeState.setBrushSettings.mockImplementation((updates: Record<string, unknown>) => {
      storeState.tools.brushSettings = {
        ...storeState.tools.brushSettings,
        ...updates,
      };
    });
    storeState.setEraserSettings.mockClear();
    applyGradientEditMock.mockClear();
  });

  it('forces manual gradient mode and applies edits even when FG mode was active', () => {
    const stops = [
      { position: 0, color: '#112233' },
      { position: 1, color: '#abcdef' },
    ];

    setSharedColorCycleGradient(stops, { fork: true });

    expect(storeState.setBrushSettings).toHaveBeenCalledWith({
      colorCycleGradient: stops,
      ccGradientSource: 'manual',
      colorCycleUseForegroundGradient: false,
      autoSampleGradient: false,
      autoSampleGradientRealtime: false,
    });
    expect(applyGradientEditMock).toHaveBeenCalledWith({
      stops,
      layerId: 'layer-1',
      intent: 'commitFuture',
    });
  });
});


describe('palette foreground gradient', () => {
  it('uses exact palette endpoints including alpha and ignores legacy adjustments', () => {
    const spec = buildForegroundDerivedGradientSpec({
      baseColor: 'rgba(20, 40, 60, 0.4)',
      backgroundColor: 'rgba(80, 100, 120, 0.7)',
      hueShift: 120,
      lightness: 90,
      opacity: 10,
      bands: 6,
    });
    expect(deriveForegroundGradientStops(spec)).toEqual([
      { position: 0, color: 'rgba(20, 40, 60, 0.4)' },
      { position: 1, color: 'rgba(80, 100, 120, 0.7)' },
    ]);
  });

  it('changes the gradient identity when only the background changes', () => {
    const first = buildForegroundDerivedGradientSpec({ baseColor: '#123456', backgroundColor: '#ffffff' });
    const next = buildForegroundDerivedGradientSpec({ baseColor: '#123456', backgroundColor: '#abcdef' });
    expect(next.key).not.toBe(first.key);
    expect(deriveForegroundGradientStops(first)[1].color).toBe('#ffffff');
    expect(deriveForegroundGradientStops(next)[1].color).toBe('#abcdef');
  });

  it('continues to render saved legacy specifications without a background', () => {
    const spec = buildForegroundDerivedGradientSpec({ baseColor: '#ff0000', lightness: 20, bands: 4 });
    expect(deriveForegroundGradientStops(spec)).toHaveLength(4);
  });
});


describe('foreground contrast and colours', () => {
  const ramp = (baseColor: string, contrast = 40, colors = 4) =>
    deriveForegroundGradientStops(buildForegroundColorRampSpec(baseColor, {
      colorCycleFgContrast: contrast, colorCycleFgColors: colors,
    }));
  const lightness = (color: string) => {
    const { r, g, b } = parseCssColor(color);
    return rgbToHsl(r, g, b)[2];
  };

  it.each(['#cc2222', '#2255bb', '#eeee44', '#090909', '#fafafa', '#000000', '#ffffff', '#808080'])(
    'retains the requested colour count in the actual LUT for %s', (color) => {
      for (const count of [2, 4, 6, 16]) {
        const stops = ramp(color, 40, count);
        expect(new Set(stops.map(stop => stop.color)).size).toBe(count);
        const palette = new GradientPalette(stops).getPaletteStrings();
        expect(new Set(palette).size).toBe(count);
        expect(lightness(stops.at(-1)!.color) - lightness(stops[0].color)).toBeCloseTo(40, 0);
      }
    },
  );

  it('keeps endpoints fixed when count changes and increases range with contrast', () => {
    const two = ramp('#336699', 40, 2);
    const six = ramp('#336699', 40, 6);
    expect(two[0].color).toBe(six[0].color);
    expect(two.at(-1)!.color).toBe(six.at(-1)!.color);
    const wider = ramp('#336699', 80, 6);
    expect(new Set(wider.map(stop => stop.color)).size).toBe(6);
    expect(lightness(wider.at(-1)!.color) - lightness(wider[0].color)).toBeCloseTo(80, 0);
  });

  it('inherits hue, saturation and opacity from the selected colour', () => {
    const stops = ramp('rgba(51, 102, 153, 0.4)');
    for (const stop of stops) {
      const { r, g, b } = parseCssColor(stop.color);
      const [h, s] = rgbToHsl(r, g, b);
      expect(h).toBeCloseTo(210, 0);
      // Eight-bit RGB conversion can shift HSL saturation by about one percent.
      expect(Math.abs(s - 50)).toBeLessThan(1.1);
      expect(parseCssColor(stop.color).a / 255).toBeCloseTo(0.4);
    }
    expect(new Set(ramp('#808080').map(stop => {
      const { r, g, b } = parseCssColor(stop.color);
      return rgbToHsl(r, g, b)[1];
    }))).toEqual(new Set([0]));
  });

  it('collapses to the picked colour at zero contrast and survives spec serialization', () => {
    expect(new Set(ramp('#336699', 0).map(stop => stop.color))).toEqual(new Set(['#336699']));
    const spec = buildForegroundColorRampSpec('#336699', { colorCycleFgContrast: 63, colorCycleFgColors: 6 });
    expect(deriveForegroundGradientStops(JSON.parse(JSON.stringify(spec)))).toEqual(deriveForegroundGradientStops(spec));
    expect(buildForegroundColorRampSpec('#336699', { colorCycleFgContrast: NaN, colorCycleFgColors: Infinity }))
      .toMatchObject({ contrast: 40, bands: 4 });
  });
});
