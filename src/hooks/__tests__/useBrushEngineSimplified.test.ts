import { renderHook, act } from '@testing-library/react';
import { useBrushEngineSimplified } from '@/hooks/useBrushEngineSimplified';
import { useAppStore } from '@/stores/useAppStore';
import { BrushShape } from '@/types';

jest.mock('../brushEngine/dithering', () => ({
  applyDithering: (image: ImageData) => image,
  applyDitheringWithFillResolution: (image: ImageData) => image,
}));

jest.mock('@/stores/colorCycleBrushManager', () => ({
  setColorCycleStoreStateGetter: jest.fn(),
  setLayerIdGetter: jest.fn(),
  getColorCycleBrushManager: () => ({
    attachPreviewCanvas: jest.fn(),
    resetForNewStroke: jest.fn(),
  }),
}));

jest.mock('@/hooks/brushEngine/BrushEngineFacade', () => ({
  createBrushEngineFacade: () => ({
    drawBrush: jest.fn(),
    resetStroke: jest.fn(),
    updateConfig: jest.fn(),
  }),
}));

describe('useBrushEngineSimplified', () => {
  it('exposes draw/remove helpers without crashing when called', () => {
    const { result } = renderHook(() => useBrushEngineSimplified());

    act(() => {
      result.current.drawBrush?.({} as CanvasRenderingContext2D, { x: 0, y: 0 }, { x: 1, y: 1 }, { pressure: 1 });
      result.current.resetStroke?.();
    });

    expect(typeof result.current.drawBrush).toBe('function');
    expect(typeof result.current.resetStroke).toBe('function');
  });

  it('respects settingsOverride for applyStrokeDither', () => {
    const { result } = renderHook(() => useBrushEngineSimplified());
    act(() => {
      useAppStore.getState().setBrushSettings({
        brushShape: BrushShape.ROUND,
        ditherEnabled: false,
      });
    });

    const canvas = document.createElement('canvas');
    canvas.width = 4;
    canvas.height = 4;
    const ctx = canvas.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D | null;
    if (!ctx) {
      throw new Error('Missing 2D canvas context for dithering test');
    }
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, 4, 4);

    const putSpy = jest.spyOn(ctx, 'putImageData');

    act(() => {
      result.current.applyStrokeDither?.(
        ctx,
        { x: 0, y: 0, width: 4, height: 4 },
        undefined,
        {
          overridePixelSize: 1,
          settingsOverride: {
            ...useAppStore.getState().tools.brushSettings,
            brushShape: BrushShape.PIXEL_DITHER,
            ditherEnabled: true,
          },
        }
      );
    });

    expect(putSpy).toHaveBeenCalled();
  });
});
