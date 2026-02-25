import { defaultBrushSettings } from '@/presets/brushPresets';
import { BrushShape, type BrushSettings } from '@/types';
import type { CustomBrushStrokeData } from '../brushEngine/BrushEngineFacade';
import { __TESTING__ } from '../useDrawingHandlers';

const { computeStrokeCapturePadding } = __TESTING__;

const makeSettings = (overrides: Partial<BrushSettings> = {}): BrushSettings => ({
  ...defaultBrushSettings,
  ...overrides,
});

const createStamp = (width: number, height: number, overrides: Partial<CustomBrushStrokeData> = {}): CustomBrushStrokeData => ({
  imageData: new ImageData(width, height),
  width,
  height,
  ...overrides,
});

describe('computeStrokeCapturePadding', () => {
  it('uses brush diameter for standard brushes', () => {
    const settings = makeSettings({ size: 40, brushShape: BrushShape.SQUARE, antialiasing: false });
    expect(computeStrokeCapturePadding(settings)).toBe(20);
  });

  it('scales padding with custom brush dimensions at 100% size', () => {
    const settings = makeSettings({ size: 100, brushShape: BrushShape.CUSTOM });
    const stamp = createStamp(200, 80);
    expect(computeStrokeCapturePadding(settings, stamp)).toBeCloseTo(100);
  });

  it('respects slider scale for custom brushes', () => {
    const settings = makeSettings({ size: 50, brushShape: BrushShape.CUSTOM });
    const stamp = createStamp(180, 60);
    // 180 * 0.5 = 90 → radius 45
    expect(computeStrokeCapturePadding(settings, stamp)).toBeCloseTo(45);
  });

  it('keeps resampler brushes tied to brush size', () => {
    const settings = makeSettings({ size: 32, brushShape: BrushShape.CUSTOM });
    const stamp = createStamp(128, 128, { isResampler: true });
    expect(computeStrokeCapturePadding(settings, stamp)).toBeCloseTo(16);
  });
});
