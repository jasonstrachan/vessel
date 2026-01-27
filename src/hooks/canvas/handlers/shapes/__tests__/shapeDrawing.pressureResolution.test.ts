import type { BrushSettings } from '@/types';
import { __TESTING__ } from '@/hooks/canvas/handlers/shapes/shapeDrawing';

describe('shapeDrawing pressure-linked dither resolution', () => {
  const { resolveColorCycleDitherPixelSize, resolveColorCycleFillMode } = __TESTING__;

  it('uses pressure-linked resolution when pressure is valid', () => {
    const computeShapePixelSize = jest.fn(() => 9);
    const settings = {
      fillResolution: 6,
      pressureLinkedFillResolution: true,
    } as BrushSettings;

    const result = resolveColorCycleDitherPixelSize({
      settings,
      hadValidPressure: true,
      lastStablePressure: 0.75,
      computeShapePixelSize,
    });

    expect(result.usePressure).toBe(true);
    expect(result.effectivePressure).toBe(0.75);
    expect(result.pixelSize).toBe(9);
    expect(computeShapePixelSize).toHaveBeenCalledWith(0.75);
  });

  it('falls back to slider resolution when pressure is missing', () => {
    const computeShapePixelSize = jest.fn(() => 12);
    const settings = {
      fillResolution: 6,
      pressureLinkedFillResolution: true,
    } as BrushSettings;

    const result = resolveColorCycleDitherPixelSize({
      settings,
      hadValidPressure: false,
      lastStablePressure: 0.5,
      computeShapePixelSize,
    });

    expect(result.usePressure).toBe(false);
    expect(result.effectivePressure).toBe(0);
    expect(result.pixelSize).toBe(6);
    expect(computeShapePixelSize).not.toHaveBeenCalled();
  });

  it('uses slider resolution when pressure linking is off', () => {
    const computeShapePixelSize = jest.fn(() => 14);
    const settings = {
      fillResolution: 4,
      pressureLinkedFillResolution: false,
    } as BrushSettings;

    const result = resolveColorCycleDitherPixelSize({
      settings,
      hadValidPressure: true,
      lastStablePressure: 1,
      computeShapePixelSize,
    });

    expect(result.usePressure).toBe(false);
    expect(result.effectivePressure).toBe(0);
    expect(result.pixelSize).toBe(4);
    expect(computeShapePixelSize).not.toHaveBeenCalled();
  });

  it('clamps pixel size to at least 1', () => {
    const computeShapePixelSize = jest.fn(() => 0.2);
    const settings = {
      fillResolution: 0,
      pressureLinkedFillResolution: true,
    } as BrushSettings;

    const result = resolveColorCycleDitherPixelSize({
      settings,
      hadValidPressure: true,
      lastStablePressure: 0.2,
      computeShapePixelSize,
    });

    expect(result.pixelSize).toBe(1);
  });

  it('defaults color cycle fill mode to linear', () => {
    expect(resolveColorCycleFillMode(undefined)).toBe('linear');
    expect(resolveColorCycleFillMode('linear')).toBe('linear');
    expect(resolveColorCycleFillMode('concentric')).toBe('concentric');
  });
});
