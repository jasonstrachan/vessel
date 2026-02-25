import { applyStrokeDither, ditherRegionWithCurrentPressure } from '../strokeDitherController';
import type { BrushSettings } from '@/types';

const brushSettings = {
  ditherEnabled: true,
} as BrushSettings;

describe('strokeDitherController', () => {
  it('forwards dither region orchestration to util', () => {
    const ditherRegionWithCurrentPressureUtil = jest.fn();

    ditherRegionWithCurrentPressure({
      ctx: {} as CanvasRenderingContext2D,
      region: { x: 0, y: 0, width: 10, height: 10 },
      ditherRegionWithCurrentPressureUtil,
      toolsBrushSettings: brushSettings,
      strokeDitherPalette: ['#000'],
      transparentInk: [0, 0, 0],
      computeStrokeDitherPaletteForSettings: jest.fn(() => ['#000']),
      pickTransparentInk: jest.fn(() => [0, 0, 0]),
      computePressureScaledResolution: jest.fn(() => 1),
      getStrokeDitherPixelSize: jest.fn(() => 1),
      applyLostEdgeToStrokeAlpha: jest.fn(),
      ensureBgOffTemp: jest.fn(() => null),
      ensureBgOffHole: jest.fn(() => null),
      bgOffMaskImageRef: { current: null },
      strokePhaseOriginRef: { current: null },
      DD: jest.fn(),
    });

    expect(ditherRegionWithCurrentPressureUtil).toHaveBeenCalled();
  });

  it('applies stroke dither only when enabled and bounds exist', () => {
    const ditherRegion = jest.fn();
    const ctx = {
      canvas: { width: 64, height: 32 },
    } as unknown as CanvasRenderingContext2D;

    applyStrokeDither({
      ctx,
      bounds: { x: 2, y: 3, width: 4, height: 5 },
      toolsBrushSettings: brushSettings,
      shouldApplyStrokeDitherForSettings: jest.fn(() => true),
      normalizeRectForCanvas: jest.fn((rect) => rect ?? { x: 0, y: 0, width: 0, height: 0 }),
      ditherRegionWithCurrentPressure: ditherRegion,
    });

    expect(ditherRegion).toHaveBeenCalledWith(
      ctx,
      { x: 2, y: 3, width: 4, height: 5 },
      undefined,
      undefined
    );
  });
});
