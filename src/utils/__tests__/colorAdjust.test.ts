import { applyColorAdjustments, rgbToHsl } from '@/utils/imageProcessing';

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
      vibrance: 0,
      lightness: 0,
      contrast: 0,
      red: 0,
      green: 0,
      blue: 0,
      hueRangeEnabled: false,
      hueRangeStart: 0,
      hueRangeEnd: 360,
    });

    expect(result).not.toBe(original);
    expect(Array.from(result.data)).toEqual(Array.from(original.data));
  });

  it('rotates hue correctly while preserving alpha', () => {
    const original = createImageData([255, 0, 0, 200], 1, 1);
    const result = applyColorAdjustments(original, {
      hue: 120,
      saturation: 0,
      vibrance: 0,
      lightness: 0,
      contrast: 0,
      red: 0,
      green: 0,
      blue: 0,
      hueRangeEnabled: false,
      hueRangeStart: 0,
      hueRangeEnd: 360,
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
      vibrance: 0,
      lightness: 0,
      contrast,
      red: 0,
      green: 0,
      blue: 0,
      hueRangeEnabled: false,
      hueRangeStart: 0,
      hueRangeEnd: 360,
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

  it('applies RGB channel offsets after other adjustments', () => {
    const original = createImageData([10, 20, 30, 255], 1, 1);
    const result = applyColorAdjustments(original, {
      hue: 0,
      saturation: 0,
      vibrance: 0,
      lightness: 0,
      contrast: 0,
      red: 10,
      green: -10,
      blue: 25,
      hueRangeEnabled: false,
      hueRangeStart: 0,
      hueRangeEnd: 360,
    });

    const [r, g, b] = result.data;
    expect(r).toBeGreaterThan(original.data[0]);
    expect(g).toBeLessThan(original.data[1]);
    expect(b).toBeGreaterThan(original.data[2]);
  });

  it('limits adjustments to the targeted hue range when enabled', () => {
    const original = createImageData([
      255, 0, 0, 255,
      0, 255, 0, 255,
    ], 2, 1);

    const result = applyColorAdjustments(original, {
      hue: 0,
      saturation: -100,
      vibrance: 0,
      lightness: 0,
      contrast: 0,
      red: 0,
      green: 0,
      blue: 0,
      hueRangeEnabled: true,
      hueRangeStart: 0,
      hueRangeEnd: 40,
    });

    expect(Array.from(result.data.slice(0, 4))).toEqual([128, 128, 128, 255]);
    expect(Array.from(result.data.slice(4, 8))).toEqual([0, 255, 0, 255]);
  });

  it('supports wrap-around hue targeting across 360 degrees', () => {
    const original = createImageData([
      255, 0, 0, 255,
      255, 255, 0, 255,
    ], 2, 1);

    const result = applyColorAdjustments(original, {
      hue: 0,
      saturation: -100,
      vibrance: 0,
      lightness: 0,
      contrast: 0,
      red: 0,
      green: 0,
      blue: 0,
      hueRangeEnabled: true,
      hueRangeStart: 330,
      hueRangeEnd: 20,
    });

    expect(Array.from(result.data.slice(0, 4))).toEqual([128, 128, 128, 255]);
    expect(Array.from(result.data.slice(4, 8))).toEqual([255, 255, 0, 255]);
  });

  it('boosts muted colors with vibrance while preserving alpha', () => {
    const original = createImageData([160, 110, 110, 123], 1, 1);
    const result = applyColorAdjustments(original, {
      hue: 0,
      saturation: 0,
      vibrance: 60,
      lightness: 0,
      contrast: 0,
      red: 0,
      green: 0,
      blue: 0,
      hueRangeEnabled: false,
      hueRangeStart: 0,
      hueRangeEnd: 360,
    });

    const [, originalSaturation] = rgbToHsl(original.data[0] ?? 0, original.data[1] ?? 0, original.data[2] ?? 0);
    const [, adjustedSaturation] = rgbToHsl(result.data[0] ?? 0, result.data[1] ?? 0, result.data[2] ?? 0);
    const [r, g, b, a] = result.data;

    expect(r).toBeGreaterThan(original.data[0] - 1);
    expect(adjustedSaturation).toBeGreaterThan(originalSaturation);
    expect(g).toBeLessThanOrEqual(original.data[1]);
    expect(b).toBeLessThanOrEqual(original.data[2]);
    expect(a).toBe(123);
  });
});
