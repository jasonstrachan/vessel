import { getColorAdjustTargetWeight, getPickedColorAdjustTarget } from '@/utils/colorAdjustTarget';
import { applyColorAdjustments, hslToRgb } from '@/utils/imageProcessing';

const base = {
  hue: 0, saturation: 0, vibrance: 0, lightness: 20, contrast: 0, red: 0, green: 0, blue: 0,
  hueRangeEnabled: true, hueRangeStart: 0, hueRangeEnd: 360,
};

describe('colour adjustment targeting', () => {
  it('treats 0–360 as all colours, including greys', () => {
    for (const hue of [0, 60, 120, 240, 359]) expect(getColorAdjustTargetWeight(hue, 100, 50, base)).toBe(1);
    expect(getColorAdjustTargetWeight(0, 0, 50, base)).toBe(1);
  });

  it('does not treat a collapsed 360-to-0 seam as the full circle', () => {
    const params = { ...base, hueRangeStart: 360, hueRangeEnd: 0 };
    expect(getColorAdjustTargetWeight(240, 100, 50, params)).toBe(0);
    expect(getColorAdjustTargetWeight(0, 100, 50, params)).toBe(1);
  });

  it('wraps red across the seam and fades outward on both sides', () => {
    const params = { ...base, hueRangeStart: 345, hueRangeEnd: 15, hueRangeSoftness: 20 };
    expect(getColorAdjustTargetWeight(0, 100, 50, params)).toBe(1);
    expect(getColorAdjustTargetWeight(335, 100, 50, params)).toBe(0.5);
    expect(getColorAdjustTargetWeight(25, 100, 50, params)).toBe(0.5);
    expect(getColorAdjustTargetWeight(35, 100, 50, params)).toBe(0);
    expect(getColorAdjustTargetWeight(0, 0, 50, params)).toBe(0);
  });

  it('intersects hue, saturation and lightness with independent falloffs', () => {
    const params = { ...base, hueRangeStart: 220, hueRangeEnd: 260,
      lightnessRangeEnabled: true, lightnessRangeStart: 0, lightnessRangeEnd: 30, lightnessRangeSoftness: 20,
      saturationRangeEnabled: true, saturationRangeStart: 60, saturationRangeEnd: 100, saturationRangeSoftness: 20 };
    expect(getColorAdjustTargetWeight(240, 80, 20, params)).toBe(1);
    expect(getColorAdjustTargetWeight(120, 80, 20, params)).toBe(0);
    expect(getColorAdjustTargetWeight(240, 50, 40, params)).toBe(0.25);
    expect(getColorAdjustTargetWeight(240, 80, 60, params)).toBe(0);
  });

  it('brightens only dark blues, preserves alpha, and leaves the source intact', () => {
    const pixels = [hslToRgb(240, 100, 20), hslToRgb(240, 100, 70), hslToRgb(120, 100, 20)];
    const image = new ImageData(new Uint8ClampedArray(pixels.flatMap((rgb) => [...rgb, 123])), 3, 1);
    const result = applyColorAdjustments(image, { ...base, hueRangeStart: 220, hueRangeEnd: 260,
      lightnessRangeEnabled: true, lightnessRangeStart: 0, lightnessRangeEnd: 30 });
    expect(result.data[2]).toBeGreaterThan(image.data[2]);
    expect(result.data[3]).toBe(123);
    expect(Array.from(result.data.slice(4))).toEqual(Array.from(image.data.slice(4)));
    expect(Array.from(image.data.slice(0, 3))).toEqual(pixels[0]);
  });

  it('blends all RGB adjustments by the selection weight', () => {
    const image = new ImageData(new Uint8ClampedArray([128, 128, 128, 80]), 1, 1);
    const options = { ...base, hueRangeEnabled: false, contrast: 30, red: 20, lightness: 10,
      lightnessRangeEnabled: true, lightnessRangeStart: 0, lightnessRangeEnd: 40, lightnessRangeSoftness: 20 };
    const full = applyColorAdjustments(image, { ...options, lightnessRangeEnabled: false });
    const soft = applyColorAdjustments(image, options);
    for (let i = 0; i < 3; i++) expect(soft.data[i]).toBeCloseTo(128 + (full.data[i] - 128) * (1 - (128 / 255 * 100 - 40) / 20), 0);
    expect(soft.data[3]).toBe(80);
  });

  it('samples narrow ranges and selects neutral samples without a fabricated hue', () => {
    expect(getPickedColorAdjustTarget(0, 100, 50)).toMatchObject({ hueRangeEnabled: true, hueRangeStart: 345, hueRangeEnd: 15 });
    expect(getPickedColorAdjustTarget(0, 0, 80)).toMatchObject({ hueRangeEnabled: false, saturationRangeEnabled: true, lightnessRangeEnabled: true });
  });
});
