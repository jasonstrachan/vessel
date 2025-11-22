import React from 'react';
import { renderHook, act } from '@testing-library/react';
import { useDrawingHandlers } from '../useDrawingHandlers';

// Minimal store mock
const storeState = {
  project: { width: 64, height: 64 },
  canvas: { width: 64, height: 64, scale: 1, zoom: 1 },
  tools: {
    currentTool: 'brush',
    previousTool: 'brush',
    shapeMode: false,
    brushSettings: {
      brushShape: 'round',
      size: 8,
      pressureEnabled: true,
    },
    fillSettings: { threshold: 0, contiguous: true, eraseInstead: false },
    eraserSettings: { size: 8 },
    customBrushCapture: { sampleAllLayers: false, mode: 'idle', freehandPath: null },
  },
  layers: [],
  activeLayerId: null,
  palette: { activeSlot: 'foreground', foregroundColor: '#000000', backgroundColor: '#ffffff' },
  polygonGradientState: { drawingState: 'idle' },
  recolorSampling: { active: false, start: null, end: null, samples: 0, target: 'recolor' },
  currentBrushPreset: null,
  setCanvasCursor: jest.fn(),
  setBrushSettings: jest.fn(),
  setEraserSettings: jest.fn(),
  compositeLayersToCanvas: jest.fn(),
  captureCanvasToActiveLayer: jest.fn(),
  captureCanvasToLayer: jest.fn(),
  setLayersNeedRecomposition: jest.fn(),
  setCurrentBrushPreset: jest.fn(),
  setCanvasInteraction: jest.fn(),
  setCanvasMessage: jest.fn(),
  clearCanvasMessage: jest.fn(),
  setStrokeInProgress: jest.fn(),
  setStrokeBounds: jest.fn(),
  setColorCycleRuntimeHandlers: jest.fn(),
};

jest.mock('@/stores/useAppStore', () => {
  const mock = (selector?: any) => (selector ? selector(storeState) : storeState);
  mock.getState = () => storeState;
  mock.setState = jest.fn();
  mock.subscribe = jest.fn((listener: any) => {
    listener(storeState);
    return () => {};
  });
  const selectEffectiveColorCyclePlaying = jest.fn(() => false);
  const selectColorCycleDesiredPlaying = jest.fn(() => false);
  const selectColorCycleSuspendDepth = jest.fn(() => 0);
  return {
    useAppStore: mock,
    selectActiveLayerId: () => null,
    selectEffectiveColorCyclePlaying,
    selectColorCycleDesiredPlaying,
    selectColorCycleSuspendDepth,
  };
});

jest.mock('@/hooks/useBrushEngineSimplified', () => ({
  useBrushEngineSimplified: () => ({
    beginStroke: jest.fn(),
    samplePoint: jest.fn(),
    finalizeStroke: jest.fn(),
    cancelStroke: jest.fn(),
    drawBrush: jest.fn(),
    isBusy: false,
  }),
}));

jest.mock('@/hooks/useUserBrushEngine', () => ({ useUserBrushEngine: () => null }));
jest.mock('@/stores/colorCycleBrushManager', () => ({ getColorCycleBrushManager: () => null }));
jest.mock('@/layers/MaskManager', () => ({
  configureMaskManager: jest.fn(),
  getMaskManager: jest.fn(() => ({ applyMask: jest.fn() })),
}));
jest.mock('@/history/helpers/layerHistory', () => ({ commitLayerHistory: jest.fn() }));
jest.mock('@/history/helpers/colorCycle', () => ({ captureColorCycleBrushState: jest.fn() }));
jest.mock('@/history/selectionState', () => ({ captureSelectionSnapshot: jest.fn() }));
jest.mock('@/utils/risographTexture', () => ({ getRisographPattern: jest.fn(), getRisographEffectSettings: jest.fn() }));
jest.mock('@/utils/debug', () => ({ logError: jest.fn(), debugWarn: jest.fn() }));
jest.mock('@/utils/customBrushCapture', () => ({ captureBrushFromCanvas: jest.fn() }));

const makeCanvas = () => {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  canvas.getContext = jest.fn(() => ({
    clearRect: jest.fn(),
    drawImage: jest.fn(),
    getImageData: jest.fn(() => ({ data: new Uint8ClampedArray(4), width: 1, height: 1 })),
    putImageData: jest.fn(),
  })) as any;
  return canvas as HTMLCanvasElement;
};

describe('useDrawingHandlers stroke harness', () => {
  it('runs begin/continue/finalize stroke without crashing', async () => {
    const canvasRef = { current: makeCanvas() } as React.RefObject<HTMLCanvasElement>;
    const { result } = renderHook(() => useDrawingHandlers({
      project: storeState.project,
      screenToWorld: (x, y) => ({ x, y }),
      viewTransformRef: { current: { scale: 1, offsetX: 0, offsetY: 0 } },
      canvasRef,
    }));

    act(() => {
      result.current.beginStrokeSession({ pointerId: 1, layerId: null, tool: 'brush' } as any);
      result.current.startDrawing({ x: 1, y: 2 }, 0.5);
      result.current.continueDrawing({ x: 2, y: 3 }, 0.6);
    });

    await act(async () => {
      await result.current.finalizeDrawing(false);
    });

    expect(result.current.clearDrawingCanvas).toBeDefined();
  });

  it('clears stroke session on cancel', () => {
    const canvasRef = { current: makeCanvas() } as React.RefObject<HTMLCanvasElement>;
    const { result } = renderHook(() => useDrawingHandlers({
      project: storeState.project,
      screenToWorld: (x, y) => ({ x, y }),
      viewTransformRef: { current: { scale: 1, offsetX: 0, offsetY: 0 } },
      canvasRef,
    }));

    act(() => {
      result.current.beginStrokeSession({ pointerId: 2, layerId: null, tool: 'brush' } as any);
    });

    act(() => {
      result.current.clearStrokeSession();
    });

    expect(result.current.clearStrokeSession).toBeDefined();
  });
});
