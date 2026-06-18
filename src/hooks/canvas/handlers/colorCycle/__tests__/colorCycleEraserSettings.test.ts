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
