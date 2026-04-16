/* eslint-disable @typescript-eslint/no-explicit-any */
import React from 'react';
import { renderHook, act } from '@testing-library/react';
import { useDrawingHandlers } from '../useDrawingHandlers';
import type { BrushSettings } from '@/types';
import { BrushShape } from '@/types';
import {
  buildForegroundDerivedGradientSpec,
  clampForegroundDerivedBands,
  deriveForegroundGradientStops,
} from '@/utils/colorCycleGradients';

type TestBrushSettings = Partial<BrushSettings> & {
  brushShape: string;
  size: number;
  pressureEnabled: boolean;
};

const mockColorCycleBrushManager = {
  getBrush: jest.fn(),
};

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
    } as TestBrushSettings,
    fillSettings: { threshold: 0, contiguous: true, eraseInstead: false },
    eraserSettings: { size: 8 },
    customBrushCapture: { sampleAllLayers: false, mode: 'idle', freehandPath: null },
  },
  layers: [],
  activeLayerId: null as string | null,
  palette: { activeSlot: 'foreground', foregroundColor: '#000000', backgroundColor: '#ffffff' },
  polygonGradientState: { drawingState: 'idle' },
  recolorSampling: { active: false, start: null, end: null, samples: 0, target: 'recolor' },
  currentBrushPreset: null,
  updateLayer: jest.fn(),
  initColorCycleForLayer: jest.fn(),
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
  setShapeDrawing: jest.fn(),
};

const baseBrushSettings = { ...storeState.tools.brushSettings };
const baseToolsState = { ...storeState.tools, brushSettings: baseBrushSettings };
const resetStoreState = () => {
  storeState.tools = { ...baseToolsState, brushSettings: { ...baseBrushSettings } };
  storeState.setBrushSettings.mockClear();
  storeState.setShapeDrawing.mockClear();
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
  const selectSequentialCaptureActive = jest.fn(() => false);
  return {
    useAppStore: mock,
    selectActiveLayerId: () => null,
    selectEffectiveColorCyclePlaying,
    selectColorCycleDesiredPlaying,
    selectColorCycleSuspendDepth,
    selectSequentialCaptureActive,
  };
});

jest.mock('@/hooks/useBrushEngineSimplified', () => ({
  useBrushEngineSimplified: () => ({
    beginStroke: jest.fn(),
    samplePoint: jest.fn(),
    finalizeStroke: jest.fn(),
    cancelStroke: jest.fn(),
    drawBrush: jest.fn(),
    resetColorCycle: jest.fn(),
    isBusy: false,
  }),
}));

jest.mock('@/hooks/useUserBrushEngine', () => ({ useUserBrushEngine: () => null }));
jest.mock('@/hooks/canvas/utils/colorCycleMarkSession', () => ({
  __esModule: true,
  beginMarkGradientSession: jest.fn(() => null),
  registerMarkGradientPointerDownRef: jest.fn(),
  cancelMarkGradientSession: jest.fn(),
}));
jest.mock('@/stores/colorCycleBrushManager', () => ({
  getColorCycleBrushManager: () => mockColorCycleBrushManager,
}));
jest.mock('@/layers/MaskManager', () => ({
  configureMaskManager: jest.fn(),
  getMaskManager: jest.fn(() => ({ applyMask: jest.fn() })),
}));
jest.mock('@/history/helpers/layerHistory', () => ({ commitLayerHistory: jest.fn() }));
jest.mock('@/history/helpers/colorCycle', () => ({ captureColorCycleBrushState: jest.fn() }));
jest.mock('@/history/selectionState', () => ({ captureSelectionSnapshot: jest.fn() }));
jest.mock('@/utils/risographTexture', () => ({ getRisographPattern: jest.fn(), getRisographEffectSettings: jest.fn() }));
jest.mock('@/utils/debug', () => ({ logError: jest.fn(), debugWarn: jest.fn(), debugLog: jest.fn() }));
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
  let now = 1000;
  let nowSpy: jest.SpyInstance | null = null;

  beforeEach(() => {
    resetStoreState();
    now = 1000;
    nowSpy = jest.spyOn(performance, 'now').mockImplementation(() => {
      now += 200;
      return now;
    });
    mockColorCycleBrushManager.getBrush.mockReset();
    mockColorCycleBrushManager.getBrush.mockReturnValue(null);
    storeState.updateLayer.mockClear();
  });

  afterEach(() => {
    nowSpy?.mockRestore();
    nowSpy = null;
  });

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

  it('samples dither gradient stops on shape start when enabled', () => {
    storeState.tools = {
      ...storeState.tools,
      shapeMode: true,
      brushSettings: {
        ...storeState.tools.brushSettings,
        brushShape: BrushShape.DITHER_GRADIENT,
        ditherGradSampleEnabled: true,
        ditherGradStops: ['#000000', '#ffffff'],
        trans: 0,
      },
    };

    const canvasRef = { current: makeCanvas() } as React.RefObject<HTMLCanvasElement>;
    const sampleColorAt = jest.fn(() => '#123456');
    const { result } = renderHook(() => useDrawingHandlers({
      project: storeState.project,
      screenToWorld: (x, y) => ({ x, y }),
      viewTransformRef: { current: { scale: 1, offsetX: 0, offsetY: 0 } },
      canvasRef,
      sampleColorAt,
    }));

    act(() => {
      result.current.startShapeDrawing({ x: 0, y: 0 }, 0.5);
    });

    expect(storeState.setBrushSettings).toHaveBeenCalledWith({
      ditherGradStops: ['#123456', '#123456'],
    });
  });

  it('samples dither gradient stops across polyline points', () => {
    storeState.tools = {
      ...storeState.tools,
      shapeMode: true,
      brushSettings: {
        ...storeState.tools.brushSettings,
        brushShape: BrushShape.DITHER_GRADIENT,
        ditherGradSampleEnabled: true,
        ditherGradStops: ['#000000', '#111111', '#222222', '#333333'],
        trans: 0,
      },
    };

    const canvasRef = { current: makeCanvas() } as React.RefObject<HTMLCanvasElement>;
    const sampleColorAt = jest.fn((x: number, _y: number) => {
      void _y;
      if (x < 5) return '#000000';
      if (x < 15) return '#444444';
      if (x < 25) return '#888888';
      return '#cccccc';
    });
    const { result } = renderHook(() => useDrawingHandlers({
      project: storeState.project,
      screenToWorld: (x, y) => ({ x, y }),
      viewTransformRef: { current: { scale: 1, offsetX: 0, offsetY: 0 } },
      canvasRef,
      sampleColorAt,
    }));

    act(() => {
      result.current.updateDitherGradSamples([
        { x: 0, y: 0 },
        { x: 30, y: 0 },
      ]);
    });

    expect(storeState.setBrushSettings).toHaveBeenCalledWith({
      ditherGradStops: ['#000000', '#444444', '#888888', '#cccccc'],
    });
  });

  it('skips dither gradient sampling when disabled', () => {
    storeState.tools = {
      ...storeState.tools,
      shapeMode: true,
      brushSettings: {
        ...storeState.tools.brushSettings,
        brushShape: BrushShape.DITHER_GRADIENT,
        ditherGradSampleEnabled: false,
        ditherGradStops: ['#000000', '#ffffff'],
      },
    };

    const canvasRef = { current: makeCanvas() } as React.RefObject<HTMLCanvasElement>;
    const { result } = renderHook(() => useDrawingHandlers({
      project: storeState.project,
      screenToWorld: (x, y) => ({ x, y }),
      viewTransformRef: { current: { scale: 1, offsetX: 0, offsetY: 0 } },
      canvasRef,
    }));

    act(() => {
      result.current.updateDitherGradSamples([
        { x: 0, y: 0 },
        { x: 10, y: 0 },
      ]);
    });

    expect(storeState.setBrushSettings).not.toHaveBeenCalled();
  });

  it('clamps transparent count when sampling shrinks stop count', () => {
    storeState.tools = {
      ...storeState.tools,
      shapeMode: true,
      brushSettings: {
        ...storeState.tools.brushSettings,
        brushShape: BrushShape.DITHER_GRADIENT,
        ditherGradSampleEnabled: true,
        ditherGradStops: ['#000000', '#ffffff'],
        trans: 5,
      },
    };

    const canvasRef = { current: makeCanvas() } as React.RefObject<HTMLCanvasElement>;
    const sampleColorAt = jest.fn(() => '#abcdef');
    const { result } = renderHook(() => useDrawingHandlers({
      project: storeState.project,
      screenToWorld: (x, y) => ({ x, y }),
      viewTransformRef: { current: { scale: 1, offsetX: 0, offsetY: 0 } },
      canvasRef,
      sampleColorAt,
    }));

    act(() => {
      result.current.updateDitherGradSamples([
        { x: 0, y: 0 },
        { x: 10, y: 0 },
      ]);
    });

    expect(storeState.setBrushSettings).toHaveBeenCalledWith({
      ditherGradStops: ['#abcdef', '#abcdef'],
      trans: 1,
    });
  });

  it('avoids redundant dither gradient updates when stops are unchanged', () => {
    storeState.tools = {
      ...storeState.tools,
      shapeMode: true,
      brushSettings: {
        ...storeState.tools.brushSettings,
        brushShape: BrushShape.DITHER_GRADIENT,
        ditherGradSampleEnabled: true,
        ditherGradStops: ['#123456', '#123456'],
        trans: 0,
      },
    };

    const canvasRef = { current: makeCanvas() } as React.RefObject<HTMLCanvasElement>;
    const sampleColorAt = jest.fn(() => '#123456');
    const { result } = renderHook(() => useDrawingHandlers({
      project: storeState.project,
      screenToWorld: (x, y) => ({ x, y }),
      viewTransformRef: { current: { scale: 1, offsetX: 0, offsetY: 0 } },
      canvasRef,
      sampleColorAt,
    }));

    act(() => {
      result.current.updateDitherGradSamples([
        { x: 0, y: 0 },
        { x: 10, y: 0 },
      ]);
    });

    expect(storeState.setBrushSettings).not.toHaveBeenCalled();
  });

  it('avoids redundant FG-derived updates when key unchanged', () => {
    const layerId = 'layer-cc-1';
    const fgColor = '#33aa88';
    const bands = clampForegroundDerivedBands(4);
    const derivedSpec = buildForegroundDerivedGradientSpec({
      baseColor: fgColor,
      lightness: 50,
      variance: 0,
      hueShift: 0,
      saturationShift: 0,
      opacity: 100,
      bands,
    });
    const fgSlot = 2;
    const fgStops = deriveForegroundGradientStops(derivedSpec);

    storeState.activeLayerId = layerId;
    storeState.layers = [{
      id: layerId,
      name: 'CC Layer',
      visible: true,
      opacity: 1,
      blendMode: 'source-over',
      layerType: 'color-cycle',
      colorCycleData: {
        flowMode: 'forward',
        gradientDefs: [{ id: 'g0', currentSlot: 0 }],
        activeGradientId: 'g0',
        slotPalettes: [
          { slot: 0, stops: fgStops },
          { slot: fgSlot, stops: fgStops },
        ],
        fgActiveSlot: fgSlot,
        fgDerivedKey: derivedSpec.key,
        fgDerivedGradients: [{ key: derivedSpec.key, slot: fgSlot, spec: derivedSpec }],
      },
    }] as any;
    storeState.tools = {
      ...storeState.tools,
      brushSettings: {
        ...storeState.tools.brushSettings,
        brushShape: BrushShape.COLOR_CYCLE,
        colorCycleUseForegroundGradient: true,
        colorCycleFgStops: bands,
        colorCycleFgLightness: 50,
        colorCycleFgVariance: 0,
        colorCycleFgHueShift: 0,
        colorCycleFgSaturationShift: 0,
        colorCycleFgOpacity: 100,
      } as TestBrushSettings,
    };
    storeState.palette = {
      ...storeState.palette,
      foregroundColor: fgColor,
    };

    const brush = {
      setGradientSlot: jest.fn(),
      setActiveGradientSlot: jest.fn(),
      getActiveGradientSlot: jest.fn(() => fgSlot),
      commitCurrentStroke: jest.fn(),
      flush: jest.fn(),
      setFlowMode: jest.fn(),
    };
    mockColorCycleBrushManager.getBrush.mockReturnValue(brush);

    const canvasRef = { current: makeCanvas() } as React.RefObject<HTMLCanvasElement>;
    const { result } = renderHook(() => useDrawingHandlers({
      project: storeState.project,
      screenToWorld: (x, y) => ({ x, y }),
      viewTransformRef: { current: { scale: 1, offsetX: 0, offsetY: 0 } },
      canvasRef,
    }));

    act(() => {
      result.current.startDrawing({ x: 2, y: 2 }, 0.7);
    });

    expect(storeState.updateLayer).not.toHaveBeenCalled();
    expect(brush.setGradientSlot).not.toHaveBeenCalled();
  });
});
