import { defaultBrushSettings } from '@/presets/brushPresets';
import { resolveEraserBrushSettings } from '@/stores/helpers/eraserSettings';
import { BrushShape, type BrushSettings } from '@/types';

const createBrushSettings = (): BrushSettings => ({
  ...defaultBrushSettings,
  brushShape: BrushShape.COLOR_CYCLE,
  size: 17,
  opacity: 0.8,
  antialiasing: true,
});

describe('resolveEraserBrushSettings', () => {
  it.each([undefined, true])('uses brush size when linking is %s', (linkSizeToBrush) => {
    const resolved = resolveEraserBrushSettings(createBrushSettings(), {
      size: 42,
      linkSizeToBrush,
    });

    expect(resolved.size).toBe(17);
  });

  it('uses the independent eraser size when unlinked', () => {
    const resolved = resolveEraserBrushSettings(createBrushSettings(), {
      size: 42,
      linkSizeToBrush: false,
    });

    expect(resolved.size).toBe(42);
  });

  it('falls back to brush size when an unlinked eraser has no size', () => {
    expect(resolveEraserBrushSettings(createBrushSettings(), {
      linkSizeToBrush: false,
    }).size).toBe(17);
  });

  it.each([
    [BrushShape.SQUARE, 'triangle', BrushShape.SQUARE, 'square'],
    [BrushShape.PIXEL_ROUND, 'square', BrushShape.PIXEL_ROUND, 'round'],
    [BrushShape.ROUND, 'square', BrushShape.ROUND, 'round'],
    [BrushShape.PIXEL_DITHER, 'diamond5', BrushShape.PIXEL_DITHER, 'diamond5'],
    [BrushShape.CUSTOM, 'diamond9', BrushShape.SQUARE, 'square'],
  ] as const)(
    'sanitizes %s with %s independently of the selected brush',
    (brushShape, ditherStrokeTipShape, expectedShape, expectedTip) => {
      expect(resolveEraserBrushSettings(createBrushSettings(), {
        brushShape,
        ditherStrokeTipShape,
        antialiasing: true,
      })).toMatchObject({
        brushShape: expectedShape,
        ditherStrokeTipShape: expectedTip,
        antialiasing: false,
      });
    },
  );

  it('defaults a missing eraser tip to square instead of inheriting the CC brush', () => {
    expect(resolveEraserBrushSettings(createBrushSettings(), {})).toMatchObject({
      brushShape: BrushShape.SQUARE,
      ditherStrokeTipShape: 'square',
      antialiasing: false,
    });
  });

  it.each([0, 0.25, 0.5, 1])('preserves eraser opacity %s instead of brush opacity', (opacity) => {
    expect(resolveEraserBrushSettings(createBrushSettings(), { opacity }).opacity).toBe(opacity);
  });

  it('uses opaque mask color instead of the translucent eraser overlay tint', () => {
    const resolved = resolveEraserBrushSettings(createBrushSettings(), {
      color: 'rgba(255, 255, 255, 0.1)',
      opacity: 0.5,
    });

    expect(resolved.color).toBe('#ffffff');
    expect(resolved.opacity).toBe(0.5);
  });

  it('keeps explicit eraser pressure, spacing and dash settings over brush defaults', () => {
    const brush = {
      ...createBrushSettings(),
      pressureEnabled: false,
      minPressure: 1,
      maxPressure: 100,
      spacing: 1,
      velocitySpacingEnabled: false,
      dashedEnabled: false,
      dashLength: 3,
      dashGap: 2,
      velocityDashGapStrength: 1,
    };
    const eraser = {
      pressureEnabled: true,
      minPressure: 50,
      maxPressure: 200,
      spacing: 40,
      velocitySpacingEnabled: true,
      dashedEnabled: true,
      dashLength: 4,
      dashGap: 5,
      velocityDashGapStrength: 0,
    };

    expect(resolveEraserBrushSettings(brush, eraser)).toMatchObject(eraser);
  });

  it('does not mutate either input while resolving size and sanitizing the tip', () => {
    const brush = Object.freeze(createBrushSettings());
    const eraser = Object.freeze({
      brushShape: BrushShape.CUSTOM,
      ditherStrokeTipShape: 'triangle' as const,
      antialiasing: true,
      size: 42,
      opacity: 0,
      linkSizeToBrush: true,
    });
    const brushBefore = { ...brush };
    const eraserBefore = { ...eraser };

    const resolved = resolveEraserBrushSettings(brush, eraser);

    expect(resolved).not.toBe(brush);
    expect(resolved).not.toBe(eraser);
    expect(resolved).toMatchObject({
      brushShape: BrushShape.SQUARE,
      ditherStrokeTipShape: 'square',
      antialiasing: false,
      size: 17,
      opacity: 0,
    });
    expect(brush).toEqual(brushBefore);
    expect(eraser).toEqual(eraserBefore);
  });
});
