import { renderHook, act } from '@testing-library/react';
import { useBrushEngineSimplified } from '@/hooks/useBrushEngineSimplified';

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
});
