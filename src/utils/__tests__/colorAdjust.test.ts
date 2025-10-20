import { applyColorAdjustments } from '@/utils/imageProcessing';

const clamp = (value: number) => Math.max(0, Math.min(255, Math.round(value)));

describe('applyColorAdjustments', () => {
  const createImageData = (data: number[], width: number, height: number): ImageData => {
    return new ImageData(new Uint8ClampedArray(data), width, height);
  };

  it('returns a clone when all adjustments are neutral', () => {
    const original = createImageData([255, 0, 0, 255], 1, 1);
    const result = applyColorAdjustments(original, {
      hue: 0,
      saturation: 0,
      lightness: 0,
      contrast: 0
    });

    expect(result).not.toBe(original);
    expect(Array.from(result.data)).toEqual(Array.from(original.data));
  });

  it('rotates hue correctly while preserving alpha', () => {
    const original = createImageData([255, 0, 0, 200], 1, 1);
    const result = applyColorAdjustments(original, {
      hue: 120,
      saturation: 0,
      lightness: 0,
      contrast: 0
    });

    const [r, g, b, a] = result.data;
    expect(r).toBeLessThanOrEqual(5);
    expect(g).toBeGreaterThanOrEqual(250);
    expect(b).toBeLessThanOrEqual(5);
    expect(a).toBe(200);
  });

  it('applies contrast adjustment using the expected curve', () => {
    const pixel = 100;
    const contrast = 50;
    const original = createImageData([pixel, pixel, pixel, 255], 1, 1);

    const result = applyColorAdjustments(original, {
      hue: 0,
      saturation: 0,
      lightness: 0,
      contrast
    });

    const contrastValue = Math.max(-255, Math.min(255, Math.round(contrast * 2.55)));
    const factor = (259 * (contrastValue + 255)) / (255 * (259 - contrastValue));
    const expectedChannel = clamp(factor * (pixel - 128) + 128);

    const [r, g, b, a] = result.data;
    expect(r).toBe(expectedChannel);
    expect(g).toBe(expectedChannel);
    expect(b).toBe(expectedChannel);
    expect(a).toBe(255);
  });
});
