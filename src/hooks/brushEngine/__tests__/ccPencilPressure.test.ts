import { IndexBuffer } from '@/lib/IndexBuffer';
import { getCcPencilMask, resolveCcPencilPressure } from '../ccPencilPressure';
import { clearStampDitherRuntime, createStampDitherRuntime } from '../strokeStampDither/runtime';
import type { StampDitherConfig } from '../strokeStampDither/coverage';
import { getStampDitherTile, STAMP_DITHER_FLAT_BUCKET } from '../strokeStampDither/tile';

const config: StampDitherConfig = { algorithm: 'bayer', pixelSize: 1, bgFill: false, pressureLinked: false, seed: 0 };
const count = (mask: ReturnType<typeof getCcPencilMask>) => mask.tile.reduce((sum, v) => sum + v, 0);

it('increases coverage with pressure while preserving the selected ordered texture', () => {
  const runtime = createStampDitherRuntime();
  const mask = (pressure: number) => getCcPencilMask({ runtime, config, pressure });
  const light = mask(0.2), medium = mask(0.5), heavy = mask(1);
  expect(count(light)).toBeLessThan(count(medium));
  expect(count(medium)).toBeLessThan(count(heavy));
  expect(count(mask(0))).toBe(0);
  expect(count(heavy)).toBe(128 * 128);
  expect(light.tile.every((v, i) => v === 0 || medium.tile[i] === 1)).toBe(true);
  expect(resolveCcPencilPressure(0.5)).toBeCloseTo(0.308, 3);
  expect(resolveCcPencilPressure(0.2)).toBeCloseTo(0.065, 3);
  expect(resolveCcPencilPressure(1)).toBe(1);
  expect(resolveCcPencilPressure(0.5, 100)).toBeGreaterThan(resolveCcPencilPressure(0.5, 0));
});

it.each(['sierra-lite', 'bayer', 'pattern'] as const)('uses the existing %s texture at half coverage', (algorithm) => {
  const runtime = createStampDitherRuntime();
  const selected = { ...config, algorithm, patternStyle: 'dots' as const };
  const mask = getCcPencilMask({ runtime, config: selected, pressure: 0.5, sensitivity: 85 });
  const texture = getStampDitherTile(runtime, STAMP_DITHER_FLAT_BUCKET, 1, 128, algorithm, 'dots');
  expect(mask.tile).toEqual(Uint8Array.from(texture, (v) => algorithm === 'pattern' ? Number(v !== 0) : Number(v <= 128)));
});

it('changes grain with the selection and respects custom image tile thresholds', () => {
  const runtime = createStampDitherRuntime();
  const options = { runtime, pressure: 0.5, sensitivity: 85 };
  const horizontal = getCcPencilMask({ ...options, config: { ...config, algorithm: 'pattern', patternStyle: 'image-tile', imageTileThresholdResolver: (_, y) => y % 8 / 8 } });
  const vertical = getCcPencilMask({ ...options, config: { ...config, algorithm: 'pattern', patternStyle: 'image-tile', imageTileThresholdResolver: (x) => x % 8 / 8 } });
  expect(horizontal.tile).not.toEqual(vertical.tile);
  expect(horizontal.accepts(0, 0)).toBe(true);
  expect(horizontal.accepts(0, 7)).toBe(false);
  expect(vertical.accepts(7, 0)).toBe(false);
  const floyd = getCcPencilMask({ ...options, pressure: 0.3, config: { ...config, algorithm: 'floyd-steinberg' } });
  const atkinson = getCcPencilMask({ ...options, pressure: 0.3, config: { ...config, algorithm: 'atkinson' } });
  expect(floyd.tile).not.toEqual(atkinson.tile);
});

it('uses the shared dither resolution to scale grain and caches repeated pressure events', () => {
  const runtime = createStampDitherRuntime();
  const options = { runtime, config, pressure: 0.5 };
  const mask = getCcPencilMask(options);
  const larger = getCcPencilMask({ ...options, config: { ...config, pixelSize: 4 } });
  expect(getCcPencilMask(options)).toBe(mask);
  expect(mask.accepts(3, 8)).toBe(mask.accepts(131, 136));
  expect(larger.size).toBe(256);
  for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++) {
    expect(larger.accepts(x * 4, y * 4)).toBe(mask.accepts(x, y));
  }
});

it('preserves earlier paint through grain holes as pressure changes', () => {
  const runtime = createStampDitherRuntime(), buffer = new IndexBuffer(128, 128);
  buffer.setPalette(Array.from({ length: 32 }, () => '#1166aa'));
  const first = getCcPencilMask({ runtime, config, pressure: 0.7 });
  buffer.paintSquareWithIndex(64, 64, 128, 10, first.tile, first.size, false);
  const before = new Uint8Array(buffer.getDirectData());
  const second = getCcPencilMask({ runtime, config, pressure: 0.3 });
  buffer.paintSquareWithIndex(64, 64, 128, 20, second.tile, second.size, false);
  expect(before.every((v, i) => v === 0 || buffer.getDirectData()[i] > 0)).toBe(true);
});

it('invalidates custom texture masks when the dither runtime resets', () => {
  const runtime = createStampDitherRuntime();
  const options = { runtime, pressure: 0.5 };
  const mask = (threshold: number) => getCcPencilMask({ ...options, config: {
    ...config, algorithm: 'pattern', patternStyle: 'image-tile', imageTileThresholdResolver: () => threshold,
  } });
  expect(count(mask(0))).toBe(128 * 128);
  clearStampDitherRuntime(runtime);
  expect(count(mask(1))).toBe(0);
});

it('supports the shared Res maximum without reseeding cells between stamps', () => {
  const runtime = createStampDitherRuntime();
  const options = { runtime, config: { ...config, pixelSize: 64 }, pressure: 0.5 };
  const mask = getCcPencilMask(options);
  expect(mask.size).toBe(4096);
  expect(getCcPencilMask(options)).toBe(mask);
  expect(mask.accepts(0, 0)).toBe(mask.accepts(63, 63));
  expect(mask.accepts(64, 0)).toBe(mask.accepts(127, 63));
});

it.each([0, 0.5, 1])('keeps Sierra Lite pores nested across pressure levels at variety %s', (diversity) => {
  const runtime = createStampDitherRuntime();
  const selected = { ...config, algorithm: 'sierra-lite' as const, diversity };
  const buffer = new IndexBuffer(128, 128);
  buffer.setPalette(Array.from({ length: 32 }, () => '#1166aa'));
  let previous = getCcPencilMask({ runtime, config: selected, pressure: 0 });
  const levels = new Set<number>();
  for (let step = 0; step <= 100; step += 1) {
    const mask = getCcPencilMask({ runtime, config: selected, pressure: step / 100 });
    expect(previous.tile.every((value, index) => !value || mask.tile[index])).toBe(true);
    levels.add(count(mask));
    if (step >= 20 && step <= 40) {
      buffer.paintSquareWithIndex(64, 64, 128, 10, mask.tile, mask.size, false);
    }
    previous = mask;
  }
  expect(levels.size).toBeGreaterThanOrEqual(60);
  const light = getCcPencilMask({ runtime, config: selected, pressure: 0.4 });
  expect(buffer.getDirectData().every((value, index) => Number(value > 0) === light.tile[index])).toBe(true);
  expect(count(light) / light.tile.length).toBeCloseTo(0.21, 1);
});
