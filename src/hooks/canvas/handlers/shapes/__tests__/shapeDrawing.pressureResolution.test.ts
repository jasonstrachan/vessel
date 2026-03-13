import type { AppState } from '@/stores/useAppStore';
import type { BrushSettings } from '@/types';
import { BrushShape } from '@/types';
import { __TESTING__ } from '@/hooks/canvas/handlers/shapes/shapeDrawing';

describe('shapeDrawing pressure-linked dither resolution', () => {
  const {
    resolveColorCycleDitherPixelSize,
    resolveColorCycleFillMode,
    resolveDitherGridSnapPoint,
  } = __TESTING__;

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

  it('snaps points to grid for dither shape and dither stroke presets when enabled', () => {
    const ditherShapeState = {
      currentBrushPreset: { id: 'dither-shape' },
      tools: { brushSettings: { gridSnapEnabled: true, brushShape: BrushShape.PIXEL_DITHER } },
    } as unknown as AppState;
    const ditherStrokeState = {
      currentBrushPreset: { id: 'dither-stroke' },
      tools: { brushSettings: { gridSnapEnabled: true, brushShape: BrushShape.PIXEL_DITHER } },
    } as unknown as AppState;

    expect(resolveDitherGridSnapPoint({ x: 9, y: 23 }, ditherShapeState)).toEqual({ x: 16, y: 16 });
    expect(resolveDitherGridSnapPoint({ x: 9, y: 23 }, ditherStrokeState)).toEqual({ x: 16, y: 16 });
  });

  it('expands dither grid snap spacing when pressure grows', () => {
    const pressureSnapState = {
      currentBrushPreset: { id: 'dither-stroke' },
      tools: {
        brushSettings: {
          gridSnapEnabled: true,
          gridSnapSize: 8,
          pressureEnabled: true,
          minPressure: 0,
          maxPressure: 100,
          brushShape: BrushShape.PIXEL_DITHER,
        },
      },
    } as unknown as AppState;

    expect(resolveDitherGridSnapPoint({ x: 9, y: 23 }, pressureSnapState, 0)).toEqual({ x: 8, y: 24 });
    expect(resolveDitherGridSnapPoint({ x: 9, y: 23 }, pressureSnapState, 1)).toEqual({ x: 16, y: 16 });
  });

  it('leaves points unchanged when grid snap is disabled or preset is not dither', () => {
    const gridOffState = {
      currentBrushPreset: { id: 'dither-shape' },
      tools: { brushSettings: { gridSnapEnabled: false, brushShape: BrushShape.PIXEL_DITHER } },
    } as unknown as AppState;
    const nonDitherState = {
      currentBrushPreset: { id: 'round-square' },
      tools: { brushSettings: { gridSnapEnabled: true, brushShape: BrushShape.SQUARE } },
    } as unknown as AppState;

    expect(resolveDitherGridSnapPoint({ x: 9, y: 23 }, gridOffState)).toEqual({ x: 9, y: 23 });
    expect(resolveDitherGridSnapPoint({ x: 9, y: 23 }, nonDitherState)).toEqual({ x: 9, y: 23 });
  });
});
