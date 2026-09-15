import { advanceDistanceBand } from '@/hooks/brushEngine/colorCycleStrokeTimingRuntime';
import { createLayerStrokeState } from '@/hooks/brushEngine/colorCycleLayerStrokeBuffers';
import { alignSampledStampPositions, buildSampledInkPalettes, measureSampledInkCoverage } from '../alignSampledStroke';
import { OKLabConverter } from '@/lib/colorCycle/colorSpace/OKLabConverter';
import { TEMP_SAMPLE_SLOT } from '@/constants/colorCycle';
import { parseCssColorToRgba } from '@/hooks/canvas/utils/colorCycleHelpers';

it.each([25, 50, 100])('keeps neighbouring near-neutral samples continuous at spread %s', (spread) => {
  for (const channel of [0, 1, 2]) {
    let previous: ReturnType<typeof buildSampledInkPalettes> | undefined;
    for (let value = 110; value <= 150; value++) {
      const rgb = [128, 128, 128];
      rgb[channel] = value;
      const next = buildSampledInkPalettes([{ position: 0, color: `rgb(${rgb.join(',')})` }], spread);
      if (previous) {
        for (const key of ['primary', 'secondary'] as const) {
          const before = parseCssColorToRgba(previous[key][0].color);
          const after = parseCssColorToRgba(next[key][0].color);
          const a = OKLabConverter.rgbToOKLab({ r: before[0], g: before[1], b: before[2] });
          const b = OKLabConverter.rgbToOKLab({ r: after[0], g: after[1], b: after[2] });
          expect(Math.hypot(a.L - b.L, a.a - b.a, a.b - b.b)).toBeLessThan(0.025);
        }
      }
      previous = next;
    }
  }
});

it('preserves distance-authored ink positions, the mask, and other strokes', () => {
  const paint = new Uint8Array([1, 65, 80, 144, 150, 214, 0, 9]);
  const gids = new Uint8Array([254, 254, 254, 254, 254, 254, 254, 3]);
  const snapshot = { paintBuffer: paint.buffer, gradientIdBuffer: gids.buffer,
    phaseBuffer: new Uint8Array(8).fill(57).buffer };
  const result = alignSampledStampPositions(snapshot, {
    tags: new Uint32Array([65537, 65537, 65538, 65538, 65539, 65539, 0, 0]),
    epoch: 1, primary: new Uint8Array([1, 1, 80, 80, 150, 150, 0, 0]),
  }, { slot: 5, defId: 11 }, 17);
  const indices = new Uint8Array(result.paintBuffer);
  expect([...indices]).toEqual([1, 1, 80, 80, 150, 150, 0, 9]);
  expect([...new Uint8Array(result.gradientIdBuffer!)]).toEqual([254, 5, 254, 5, 254, 5, 254, 3]);
  expect([...new Uint8Array(result.phaseBuffer!)]).toEqual([0, 0, 0, 0, 0, 0, 57, 57]);
  expect([...new Uint8Array(result.speedBuffer!)]).toEqual([17, 17, 17, 17, 17, 17, 0, 0]);
  expect(paint).toEqual(new Uint8Array([1, 65, 80, 144, 150, 214, 0, 9]));
});

it('uses the owning stamp colour at crossings', () => {
  const result = alignSampledStampPositions({
    paintBuffer: new Uint8Array([1, 1, 1]).buffer,
    gradientIdBuffer: new Uint8Array(3).fill(TEMP_SAMPLE_SLOT).buffer,
  }, { tags: new Uint32Array([65539, 65537, 65538]), epoch: 1,
    primary: new Uint8Array([150, 1, 1]) });
  expect([...new Uint8Array(result.paintBuffer)]).toEqual([150, 1, 1]);
});

it('increases ink separation within the target colour gamut', () => {
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
    expect(distance(full.primary[i].color, full.secondary[i].color)).toBeGreaterThan(0.01);
    expect(distance(full.primary[i].color, full.secondary[i].color))
      .toBeGreaterThan(distance(middle.primary[i].color, middle.secondary[i].color));
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

it('assigns ordinary Sample inks without changing band positions, speed, flow or phase', () => {
  const snapshot = {
    paintBuffer: new Uint8Array([20, 147, 80, 207, 0, 9]).buffer,
    gradientIdBuffer: new Uint8Array([254, 254, 254, 254, 254, 3]).buffer,
    phaseBuffer: new Uint8Array([1, 2, 3, 4, 5, 6]).buffer,
    speedBuffer: new Uint8Array([10, 11, 12, 13, 14, 15]).buffer,
    flowBuffer: new Uint8Array([2, 2, 3, 3, 1, 1]).buffer,
  };
  const result = alignSampledStampPositions(snapshot, {
    tags: new Uint32Array([65537, 65537, 65538, 65538, 0, 0]),
    epoch: 1, primary: new Uint8Array([20, 20, 80, 80, 0, 0]),
  }, { slot: 5, defId: 11 });
  expect([...new Uint8Array(result.paintBuffer)]).toEqual([20, 20, 80, 80, 0, 9]);
  expect([...new Uint8Array(result.gradientIdBuffer!)]).toEqual([254, 5, 254, 5, 254, 3]);
  expect([...new Uint16Array(result.gradientDefIdBuffer!)]).toEqual([0, 11, 0, 11, 0, 0]);
  expect(result.phaseBuffer).toEqual(snapshot.phaseBuffer);
  expect(result.speedBuffer).toEqual(snapshot.speedBuffer);
  expect(result.flowBuffer).toEqual(snapshot.flowBuffer);
});

const linear = (byte: number) => byte <= 10.31475 ? byte / 3294.6 : ((byte / 255 + 0.055) / 1.055) ** 2.4;
const encoded = (value: number) => 255 * (value <= 0.0031308 ? value * 12.92 : 1.055 * value ** (1 / 2.4) - 0.055);

it.each([0.1, 0.25, 0.5, 0.75, 0.9])('reconstructs sampled colours with primary area %s at every spread', (coverage) => {
  for (const spread of [0, 25, 50, 75, 100]) {
    for (const r of [0, 16, 64, 128, 224, 255]) {
      for (const g of [0, 64, 128, 255]) {
        for (const b of [0, 64, 128, 255]) {
          const inks = buildSampledInkPalettes([{ position: 0, color: `rgb(${r},${g},${b})` }], spread, coverage);
          const a = parseCssColorToRgba(inks.primary[0].color);
          const other = parseCssColorToRgba(inks.secondary[0].color);
          [r, g, b].forEach((target, channel) => {
            const mixed = encoded(coverage * linear(a[channel]) + (1 - coverage) * linear(other[channel]));
            expect(Math.abs(mixed - target)).toBeLessThanOrEqual(1);
          });
        }
      }
    }
  }
});

it('uses only this stroke’s visible ink area, including asymmetric masks', () => {
  expect(measureSampledInkCoverage(new Uint8Array([20, 20, 84, 84, 0, 20]),
    new Uint8Array([254, 254, 254, 3, 254, 254]), {
      tags: new Uint32Array([65537, 65537, 65537, 65537, 65537, 131073]),
      primary: new Uint8Array(6).fill(20), epoch: 1,
    })).toBeCloseTo(2 / 3);
});

it.each([0, 1])('retains the target when only one ink is visible (%s)', (coverage) => {
  const stops = [{ position: 0, color: '#6080a0' }];
  expect(buildSampledInkPalettes(stops, 100, coverage)).toEqual({ primary: stops, secondary: stops });
});

it('adapts the opposing ink axis to red, green and blue targets', () => {
  for (let dominant = 0; dominant < 3; dominant++) {
    const rgb = [96, 96, 96];
    rgb[dominant] = 160;
    const pair = buildSampledInkPalettes([{ position: 0, color: `rgb(${rgb.join(',')})` }], 80);
    const a = parseCssColorToRgba(pair.primary[0].color);
    const b = parseCssColorToRgba(pair.secondary[0].color);
    expect(a[dominant]).toBeLessThan(rgb[dominant]);
    expect(b[dominant]).toBeGreaterThan(rgb[dominant]);
  }
});

it.each(['#6080a0', '#a06060', '#60a060', '#808080'])('uses the available ink separation at full spread for %s', (color) => {
  const full = buildSampledInkPalettes([{ position: 0, color }], 100);
  const channels = [full.primary[0], full.secondary[0]].flatMap(stop => parseCssColorToRgba(stop.color).slice(0, 3));
  expect(channels.some(value => value === 0 || value === 255)).toBe(true);
});


it('preserves strand phases on both Unresolve inks and rejected pixels', () => {
  const snapshot = {
    paintBuffer: new Uint8Array([20, 84, 40, 104, 9]).buffer,
    gradientIdBuffer: new Uint8Array([254, 254, 254, 254, 3]).buffer,
    phaseBuffer: new Uint8Array([240, 240, 17, 17, 99]).buffer,
    flowBuffer: new Uint8Array([2, 2, 2, 2, 3]).buffer,
  };
  const aligned = alignSampledStampPositions(snapshot, {
    tags: new Uint32Array([65537, 65537, 65538, 65538, 0]), epoch: 1,
    primary: new Uint8Array([20, 20, 40, 40, 0]),
  }, { slot: 5, defId: 11 }, 17, true);
  expect(aligned.phaseBuffer).toEqual(snapshot.phaseBuffer);
  expect([...new Uint8Array(aligned.paintBuffer)]).toEqual([20, 20, 40, 40, 9]);
  expect([...new Uint8Array(aligned.gradientIdBuffer!)]).toEqual([254, 5, 254, 5, 3]);
  expect([...new Uint8Array(aligned.flowBuffer!)]).toEqual([1, 1, 1, 1, 3]);
  expect([...new Uint8Array(aligned.speedBuffer!)]).toEqual([17, 17, 17, 17, 0]);
});


it.each([1, 20, 256])('keeps ordinary %s px bands fixed when a stroke grows', (spacing) => {
  const mapStroke = (length: number) => {
    const stroke = createLayerStrokeState({ strokeCycleSpeed: 0.1, strokeSpeedByte: 17 });
    const primary = new Uint8Array(length * 2);
    const paint = new Uint8Array(length * 2);
    const tags = new Uint32Array(length * 2);
    for (let x = 0; x < length; x++) {
      const index = advanceDistanceBand(stroke, { x, y: 0 }, spacing, 12);
      stroke.lastPoint = { x, y: 0 };
      primary.fill(index, x * 2, x * 2 + 2);
      paint[x * 2] = index;
      paint[x * 2 + 1] = 1 + ((index - 1 + 64) % 255);
      tags.fill(65536 + x + 1, x * 2, x * 2 + 2);
    }
    const mapped = alignSampledStampPositions({
      paintBuffer: paint.buffer,
      gradientIdBuffer: new Uint8Array(paint.length).fill(TEMP_SAMPLE_SLOT).buffer,
    }, { primary, tags, epoch: 1 }, { slot: 5, defId: 11 }, 17);
    return { primary, mapped: new Uint8Array(mapped.paintBuffer) };
  };
  const short = mapStroke(spacing * 13);
  const long = mapStroke(spacing * 29);
  expect(short.mapped).toEqual(short.primary);
  expect(long.mapped.slice(0, short.mapped.length)).toEqual(short.mapped);
  // After twelve physical bands, the full palette repeats at the same spacing.
  expect(long.mapped[spacing * 12 * 2]).toBe(long.mapped[0]);
});
