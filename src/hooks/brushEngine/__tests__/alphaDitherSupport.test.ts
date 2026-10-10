import { ditherRegionWithCurrentPressure, type StrokeDitherRegionOptions } from '../strokeDitherRegion';
import type { BrushSettings } from '@/types';

const render = (ctx: CanvasRenderingContext2D, raw: CanvasRenderingContext2D, options?: StrokeDitherRegionOptions) => {
  ditherRegionWithCurrentPressure({
    ctx, sampleCtx: raw, region: { x: 0, y: 0, width: 32, height: 32 }, options,
    signal: 'alpha', toolsBrushSettings: {
      color: '#ffffff', ditherEnabled: true, ditherAlgorithm: 'sierra-lite',
      ditherBackgroundFill: false, fillResolution: 4,
    } as BrushSettings,
    strokeDitherPalette: ['#000000', '#ffffff'], transparentInk: [0, 0, 0],
    computeStrokeDitherPaletteForSettings: () => ['#000000', '#ffffff'],
    pickTransparentInk: () => [0, 0, 0], computePressureScaledResolution: () => 4,
    getStrokeDitherPixelSize: () => 4, applyLostEdgeToStrokeAlpha: jest.fn(),
    ensureBgOffTemp: () => null, ensureBgOffHole: () => null,
    bgOffMaskImageRef: { current: null }, strokePhaseOriginRef: { current: null }, DD: jest.fn(),
  });
};

const context = () => {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 32;
  return canvas.getContext('2d')!;
};

describe('alpha dither authored support', () => {
  it.each(['u', 'disconnected'] as const)('samples all cumulative raw while replacing only positive %s support', (shape) => {
    const raw = context(), whole = context(), target = context();
    const source = new ImageData(32, 32), prior = new ImageData(32, 32), support = new ImageData(32, 32);
    for (let y = 0; y < 32; y += 1) {
      for (let x = 0; x < 32; x += 1) {
        const i = (y * 32 + x) * 4;
        source.data.set([255, 255, 255, x % 7 === 0 ? 255 : (x * 13 + y * 17) % 200 + 20], i);
        prior.data.set([37, 91, 153, x % 3 === 0 ? 255 : 0], i);
        const owned = (x >= 4 && x < 8 && y >= 4 && y < 28) ||
          (x >= 24 && x < 28 && y >= 4 && y < 28) ||
          (shape === 'u' && y >= 24 && y < 28 && x >= 8 && x < 24);
        if (owned) support.data[i + 3] = x % 2 === 0 ? 1 : 255;
      }
    }
    raw.putImageData(source, 0, 0); target.putImageData(prior, 0, 0);
    render(whole, raw, { overridePixelSize: 4 });
    render(target, raw, { overridePixelSize: 4, writeSupportMask: support });
    const expected = whole.getImageData(0, 0, 32, 32).data;
    const actual = target.getImageData(0, 0, 32, 32).data;
    let saturatedOwned = 0, transparentOwned = 0;
    for (let i = 0; i < actual.length; i += 4) {
      const owned = support.data[i + 3] > 0;
      expect(Array.from(actual.subarray(i, i + 4))).toEqual(Array.from((owned ? expected : prior.data).subarray(i, i + 4)));
      if (owned && source.data[i + 3] === 255) saturatedOwned += 1;
      if (owned && expected[i + 3] === 0) transparentOwned += 1;
    }
    expect(saturatedOwned).toBeGreaterThan(0);
    expect(transparentOwned).toBeGreaterThan(0);
    expect(raw.getImageData(0, 0, 32, 32).data).toEqual(source.data);
  });

  it('fails fast if support uses a different sampling region', () => {
    expect(() => render(context(), context(), { writeSupportMask: new ImageData(1, 1) })).toThrow('support must match');
  });
});
