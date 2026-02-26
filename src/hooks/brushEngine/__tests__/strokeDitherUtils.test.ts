import { BrushShape, type BrushSettings } from '@/types';
import { shouldApplyStrokeDitherForSettings } from '../strokeDitherUtils';

const makeSettings = (overrides: Partial<BrushSettings>): BrushSettings =>
  ({
    brushShape: BrushShape.ROUND,
    ditherEnabled: true,
    ...overrides,
  }) as BrushSettings;

describe('shouldApplyStrokeDitherForSettings', () => {
  it('returns false for custom brushes to preserve native tip colors', () => {
    const settings = makeSettings({ brushShape: BrushShape.CUSTOM, ditherEnabled: true });
    expect(shouldApplyStrokeDitherForSettings(settings)).toBe(false);
  });

  it('returns false for color-cycle brushes', () => {
    const settings = makeSettings({ brushShape: BrushShape.COLOR_CYCLE, ditherEnabled: true });
    expect(shouldApplyStrokeDitherForSettings(settings)).toBe(false);
  });

  it('returns true for regular round brush when dither is enabled', () => {
    const settings = makeSettings({ brushShape: BrushShape.ROUND, ditherEnabled: true });
    expect(shouldApplyStrokeDitherForSettings(settings)).toBe(true);
  });
});
