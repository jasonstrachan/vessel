import { createDefaultAdjustmentEffect } from '@/lib/adjustmentLayers';
import { applyAdjustmentEffect, createDisplayFilterPipelineState } from '@/lib/displayFilterPipeline';
import type { ColorAdjustParams } from '@/types';

const render = (pixels: number[][], settings: Partial<ColorAdjustParams>) => {
  const source = document.createElement('canvas');
  source.width = pixels.length;
  source.height = 1;
  const context = source.getContext('2d')!;
  const input = new Uint8ClampedArray(pixels.flat());
  context.putImageData(new ImageData(input.slice(), pixels.length, 1), 0, 0);
  const effect = createDefaultAdjustmentEffect('hue-sat');
  if (effect.id !== 'hue-sat') throw new Error('Expected Hue/Sat defaults');
  const result = applyAdjustmentEffect({
    sourceCanvas: source,
    effect: { ...effect, settings: { ...effect.settings, ...settings } },
    filterState: createDisplayFilterPipelineState(),
  });
  expect([...context.getImageData(0, 0, pixels.length, 1).data]).toEqual(pixels.flat());
  expect([...input]).toEqual(pixels.flat());
  return { source, result, rgba: [...result.getContext('2d')!.getImageData(0, 0, pixels.length, 1).data] };
};

describe('adjustment Hue/Sat Vibrance policy', () => {
  it('keeps opaque and partial-alpha greys, black and white neutral under positive Vibrance', () => {
    const pixels = [[128, 128, 128, 255], [128, 128, 128, 64], [0, 0, 0, 255], [255, 255, 255, 255]];
    expect(render(pixels, { vibrance: 100 }).rgba).toEqual(pixels.flat());
  });

  it('keeps saturation-collapsed coloured and near-grey pixels neutral when Vibrance is positive', () => {
    expect(render([[128, 64, 32, 255], [129, 128, 128, 255]], { saturation: -100, vibrance: 100 }).rgba)
      .toEqual([80, 80, 80, 255, 129, 129, 129, 255]);
  });

  it('preserves positive Vibrance for coloured and near-grey pixels and their alpha', () => {
    expect(render([[128, 64, 32, 255], [128, 64, 32, 128], [129, 128, 128, 255]], { vibrance: 100 }).rgba)
      .toEqual([160, 53, 0, 255, 160, 53, 0, 128, 255, 2, 2, 255]);
  });

  it('preserves negative Vibrance and skips transparent hidden RGB exactly', () => {
    expect(render([[128, 64, 32, 255], [128, 128, 128, 255], [37, 91, 142, 0]], { vibrance: -100 }).rgba)
      .toEqual([80, 80, 80, 255, 128, 128, 128, 255, 37, 91, 142, 0]);
    expect(render([[37, 91, 142, 0]], { vibrance: 100 }).rgba).toEqual([37, 91, 142, 0]);
  });

  it('returns the unchanged original canvas for neutral settings', () => {
    const value = render([[128, 128, 128, 255], [128, 64, 32, 128]], {});
    expect(value.result).toBe(value.source);
  });
});
