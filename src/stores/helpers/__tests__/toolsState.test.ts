import {
  normalizePersistedBrushSettings,
  pixelsFromCustomPercent,
  percentFromPixelSize,
} from '@/stores/helpers/toolsState';
import { BrushShape, type BrushSettings } from '@/types';
import type { AppState } from '@/stores/useAppStore';
import { defaultBrushSettings } from '@/presets/brushPresets';

const createBrushSettings = (overrides: Partial<BrushSettings> = {}): BrushSettings => ({
  ...defaultBrushSettings,
  size: overrides.size ?? 100,
  opacity: overrides.opacity ?? defaultBrushSettings.opacity,
  color: overrides.color ?? defaultBrushSettings.color,
  blendMode: overrides.blendMode ?? defaultBrushSettings.blendMode,
  spacing: overrides.spacing ?? defaultBrushSettings.spacing,
  pressure: overrides.pressure ?? defaultBrushSettings.pressure,
  rotation: overrides.rotation ?? defaultBrushSettings.rotation,
  antialiasing: overrides.antialiasing ?? defaultBrushSettings.antialiasing,
  brushShape: overrides.brushShape ?? BrushShape.CUSTOM,
  selectedCustomBrush: overrides.selectedCustomBrush ?? 'custom-brush',
  customBrushSizePercent: overrides.customBrushSizePercent ?? 100,
  lastRegularBrushSize: overrides.lastRegularBrushSize ?? defaultBrushSettings.lastRegularBrushSize,
  pressureEnabled: overrides.pressureEnabled ?? false,
  minPressure: overrides.minPressure ?? 1,
  maxPressure: overrides.maxPressure ?? 100,
  rotationEnabled: overrides.rotationEnabled ?? false,
  dashedEnabled: overrides.dashedEnabled ?? false,
  dashLength: overrides.dashLength ?? 1,
  useSwatchColor: overrides.useSwatchColor ?? false,
  dashGap: overrides.dashGap ?? 0,
  currentBrushTip: overrides.currentBrushTip,
});

const createState = (partial: Partial<AppState> = {}): AppState => ({
  temporaryCustomBrush: null,
  getCustomBrushById: () => null,
  project: null,
  ...partial,
} as unknown as AppState);

describe('custom brush size conversions', () => {
  it('converts percent to pixels using stored metadata', () => {
    const brushSettings = createBrushSettings({
      size: 32,
      currentBrushTip: {
        imageData: new ImageData(8, 4),
        brushId: 'tip',
        isColorizable: false,
        width: 8,
        height: 4,
        naturalWidth: 32,
        naturalHeight: 16,
        maxDimension: 32,
      },
    });

    const state = createState();
    expect(pixelsFromCustomPercent(150, state, brushSettings)).toBe(48);
    expect(pixelsFromCustomPercent(50, state, brushSettings)).toBe(16);
  });

  it('derives percent from pixels using metadata fallback when missing', () => {
    const brushSettings = createBrushSettings({
      size: 20,
      currentBrushTip: {
        imageData: new ImageData(10, 10),
        brushId: 'tip',
        isColorizable: false,
      },
    });

    const state = createState();
    // Without metadata we expect it to use the underlying image dimensions (10)
    expect(percentFromPixelSize(20, state, brushSettings)).toBe(200);
    expect(percentFromPixelSize(5, state, brushSettings)).toBe(50);
  });
});

describe('normalizePersistedBrushSettings', () => {
  it('restores pressure-linked max resolution from persisted dither settings', () => {
    expect(
      normalizePersistedBrushSettings({
        pressureLinkedFillResolution: true,
        fillResolution: 13,
        pressureLinkedFillMaxResolution: '27' as unknown as number,
      })
    ).toEqual(
      expect.objectContaining({
        pressureLinkedFillResolution: true,
        fillResolution: 13,
        pressureLinkedFillMaxResolution: 27,
      })
    );
  });

  it('backfills pressure-linked max resolution when older payloads omit it', () => {
    expect(
      normalizePersistedBrushSettings({
        pressureLinkedFillResolution: true,
        fillResolution: 19,
      })
    ).toEqual(
      expect.objectContaining({
        pressureLinkedFillResolution: true,
        fillResolution: 19,
        pressureLinkedFillMaxResolution: 19,
      })
    );
  });
});
