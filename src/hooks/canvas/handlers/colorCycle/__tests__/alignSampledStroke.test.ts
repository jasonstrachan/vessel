import { alignSampledStampPositions, buildSampledInkPalettes } from '../alignSampledStroke';
import { OKLabConverter } from '@/lib/colorCycle/colorSpace/OKLabConverter';
import { TEMP_SAMPLE_SLOT } from '@/constants/colorCycle';
import { parseCssColorToRgba } from '@/hooks/canvas/utils/colorCycleHelpers';

it('maps the whole sampled sequence once, preserves the ink mask, and leaves other strokes alone', () => {
  const paint = new Uint8Array([1, 65, 80, 144, 150, 214, 0, 9]);
  const gids = new Uint8Array([254, 254, 254, 254, 254, 254, 254, 3]);
  const snapshot = { paintBuffer: paint.buffer, gradientIdBuffer: gids.buffer,
    phaseBuffer: new Uint8Array(8).fill(57).buffer };
  const result = alignSampledStampPositions(snapshot, {
    tags: new Uint32Array([65537, 65537, 65538, 65538, 65539, 65539, 0, 0]),
    epoch: 1, distances: [0, 0, 50, 100], primary: new Uint8Array([1, 1, 80, 80, 150, 150, 0, 0]),
  }, 1, { slot: 5, defId: 11 }, 17);
  const indices = new Uint8Array(result.paintBuffer);
  expect([...indices]).toEqual([2, 2, 129, 129, 255, 255, 0, 9]);
  expect([...new Uint8Array(result.gradientIdBuffer!)]).toEqual([254, 5, 254, 5, 254, 5, 254, 3]);
  expect([...new Uint8Array(result.phaseBuffer!)]).toEqual([0, 0, 0, 0, 0, 0, 57, 57]);
  expect([...new Uint8Array(result.speedBuffer!)]).toEqual([17, 17, 17, 17, 17, 17, 0, 0]);
  expect(paint).toEqual(new Uint8Array([1, 65, 80, 144, 150, 214, 0, 9]));
});

it('uses owning stamps at crossings, with distance-sized groups instead of repeated full palettes', () => {
  const result = alignSampledStampPositions({
    paintBuffer: new Uint8Array([1, 1, 1]).buffer,
    gradientIdBuffer: new Uint8Array(3).fill(TEMP_SAMPLE_SLOT).buffer,
  }, { tags: new Uint32Array([65539, 65537, 65538]), epoch: 1,
    distances: [0, 1, 9, 100], primary: new Uint8Array(3).fill(1) }, 20);
  expect([...new Uint8Array(result.paintBuffer)]).toEqual([255, 26, 26]);
});

it('separates sampled inks perceptually from identical colours to colourful opposing hues', () => {
  const stops = ['#6080a0', '#808080', '#101010', '#eeeeee', '#ce3420'].map((color, i) => ({
    position: i / 4, color, opacity: 0.5,
  }));
  const toLab = (color: string) => {
    const [r, g, b] = parseCssColorToRgba(color);
    return OKLabConverter.rgbToOKLab({ r, g, b });
  };
  const distance = (a: string, b: string) => {
    const x = toLab(a); const y = toLab(b);
    return Math.hypot(x.L - y.L, x.a - y.a, x.b - y.b);
  };
  const zero = buildSampledInkPalettes(stops, 0);
  const middle = buildSampledInkPalettes(stops, 50);
  const full = buildSampledInkPalettes(stops, 100);
  expect(zero.primary).toEqual(stops);
  expect(zero.secondary).toEqual(stops);
  for (let i = 0; i < stops.length; i++) {
    const dark = toLab(full.primary[i].color);
    const light = toLab(full.secondary[i].color);
    expect(distance(full.primary[i].color, full.secondary[i].color)).toBeGreaterThan(0.45);
    expect(distance(full.primary[i].color, full.secondary[i].color))
      .toBeGreaterThan(distance(middle.primary[i].color, middle.secondary[i].color));
    expect(Math.hypot(dark.a, dark.b)).toBeGreaterThan(0.04);
    expect(Math.hypot(light.a, light.b)).toBeGreaterThan(0.04);
    expect(dark.a * light.a + dark.b * light.b).toBeLessThan(0);
    expect(full.primary[i].position).toBe(stops[i].position);
    expect(full.secondary[i].opacity).toBe(0.5);
  }
});

it('preserves CSS alpha and clamps spread without mutating sampled stops', () => {
  const stops = [{ position: 0, color: 'rgba(60, 80, 100, 0.5)' }];
  const original = JSON.stringify(stops);
  const result = buildSampledInkPalettes(stops, 100);
  expect(parseCssColorToRgba(result.primary[0].color)[3]).toBe(128);
  expect(parseCssColorToRgba(result.secondary[0].color)[3]).toBe(128);
  expect(buildSampledInkPalettes(stops, -1)).toEqual(buildSampledInkPalettes(stops, 0));
  expect(buildSampledInkPalettes(stops, 200)).toEqual(result);
  expect(buildSampledInkPalettes(stops, NaN)).toEqual(buildSampledInkPalettes(stops, 0));
  expect(JSON.stringify(stops)).toBe(original);
});
