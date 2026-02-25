import {
  createMosaicState,
  shouldUseMosaicDither,
  DITHER_MAX_PIXELS
} from '@/hooks/brushEngine/mosaic';
import { defaultBrushSettings } from '@/presets/brushPresets';

const gradientStops = [
  { position: 0, color: '#000000' },
  { position: 1, color: '#ffffff' }
];

describe('mosaic brush helpers', () => {
  it('creates a mosaic state with expected stamp geometry', () => {
    const state = createMosaicState({
      settings: {
        ...defaultBrushSettings,
        size: 60,
        pressureEnabled: true,
        minPressure: 50,
        maxPressure: 150,
        rotationEnabled: true,
        antialiasing: false,
        dashedEnabled: false,
        gridSnapEnabled: false,
        spacing: 0,
        mosaicTilePx: 8,
        mosaicPaletteCount: 6,
        mosaicSegmentPx: 160,
        mosaicDitherEnabled: false
      },
      gradientStops,
      startX: 0,
      startY: 0
    });

    expect(state.stampW).toBe(48);
    expect(state.stampH).toBe(8);
    expect(state.spacingPx).toBe(6);
    expect(state.activePalette).toHaveLength(6);
    expect(state.hasStamped).toBe(false);
  });

  it('produces deterministic palettes for a fixed seed', () => {
    const settings = {
      ...defaultBrushSettings,
      mosaicTilePx: 8,
      mosaicPaletteCount: 6,
      mosaicSegmentPx: 160,
      mosaicDitherEnabled: false,
      mosaicSeed: 12345
    };

    const a = createMosaicState({
      settings,
      gradientStops,
      startX: 0,
      startY: 0
    });
    const b = createMosaicState({
      settings,
      gradientStops,
      startX: 0,
      startY: 0
    });

    expect(a.activePalette).toEqual(b.activePalette);
  });

  it('respects the dither area cap', () => {
    expect(shouldUseMosaicDither(256, 256, true)).toBe(true);
    expect(shouldUseMosaicDither(257, 256, true)).toBe(false);
    expect(shouldUseMosaicDither(256, 256, false)).toBe(false);
    expect(DITHER_MAX_PIXELS).toBe(256 * 256);
  });
});
