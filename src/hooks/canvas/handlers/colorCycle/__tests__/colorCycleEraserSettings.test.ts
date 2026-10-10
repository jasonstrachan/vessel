import { getColorCycleBrushEraserSettings } from '@/hooks/canvas/handlers/colorCycle/colorCycleEraserSettings';
import { BrushShape } from '@/types';
import type { AppState } from '@/stores/useAppStore';

const makeState = (overrides: {
  globalBrushSize?: number;
  brushSize?: number;
  eraserSize?: number;
  linkSizeToBrush?: boolean;
  eraserShape?: BrushShape;
} = {}): AppState => ({
  globalBrushSize: overrides.globalBrushSize ?? 12,
  tools: {
    brushSettings: {
      size: overrides.brushSize,
    },
    eraserSettings: {
      size: overrides.eraserSize,
      linkSizeToBrush: overrides.linkSizeToBrush,
      brushShape: overrides.eraserShape,
    },
  },
} as AppState);

describe('getColorCycleBrushEraserSettings', () => {
  it('forwards resolved texture intensity, including an explicit eraser override of zero', () => {
    const state = makeState();
    state.tools.brushSettings.risographIntensity = 75;
    expect(getColorCycleBrushEraserSettings({ state })).toMatchObject({ risographIntensity: 75 });
    state.tools.eraserSettings.risographIntensity = 100;
    expect(getColorCycleBrushEraserSettings({ state })).toMatchObject({ risographIntensity: 100 });
    state.tools.eraserSettings.risographIntensity = 0;
    expect(getColorCycleBrushEraserSettings({ state })).toMatchObject({ risographIntensity: 0 });
  });

  it('exposes the resolved rotation enabled by either renderer setting', () => {
    const state = makeState();
    state.tools.brushSettings.rotationEnabled = true;
    expect(getColorCycleBrushEraserSettings({ state }).rotationEnabled).toBe(true);

    state.tools.eraserSettings.rotationEnabled = false;
    expect(getColorCycleBrushEraserSettings({ state }).rotationEnabled).toBe(false);

    state.tools.eraserSettings.rotationConfig = { enabled: true, mode: 'fixed', fixedAngle: 45 };
    expect(getColorCycleBrushEraserSettings({ state }).rotationEnabled).toBe(true);

    state.tools.eraserSettings.rotationConfig.enabled = false;
    state.tools.eraserSettings.rotationEnabled = true;
    expect(getColorCycleBrushEraserSettings({ state }).rotationEnabled).toBe(true);
  });

  it('passes the same resolved grid and pressure settings used by raster stamps', () => {
    const state = makeState();
    state.tools.brushSettings.gridSnapEnabled = true;
    state.tools.brushSettings.gridSnapSize = 24;
    state.tools.eraserSettings.gridSnapSize = 16;
    state.tools.eraserSettings.pressureEnabled = true;
    state.tools.eraserSettings.minPressure = 50;
    state.tools.eraserSettings.maxPressure = 200;

    expect(getColorCycleBrushEraserSettings({ state })).toMatchObject({
      gridSnapEnabled: true, gridSnapSize: 16,
      pressureEnabled: true, minPressure: 50, maxPressure: 200,
    });
    state.tools.eraserSettings.gridSnapEnabled = false;
    expect(getColorCycleBrushEraserSettings({ state }).gridSnapEnabled).toBe(false);
  });

  it('uses brush/global size when eraser size is linked', () => {
    expect(getColorCycleBrushEraserSettings({
      state: makeState({
        globalBrushSize: 24,
        brushSize: 30,
        eraserSize: 6,
        linkSizeToBrush: true,
      }),
    }).size).toBe(30);
  });

  it('uses eraser size only when eraser size is unlinked', () => {
    expect(getColorCycleBrushEraserSettings({
      state: makeState({
        brushSize: 30,
        eraserSize: 6,
        linkSizeToBrush: false,
      }),
    }).size).toBe(6);
  });

  it('sanitizes unsupported eraser tip shapes for color-cycle masks', () => {
    expect(getColorCycleBrushEraserSettings({
      state: makeState({
        eraserShape: BrushShape.RESAMPLER,
      }),
    }).brushShape).toBe(BrushShape.SQUARE);
  });
});
