/* eslint-disable @typescript-eslint/no-explicit-any */
import React, { useEffect } from 'react';
import { render, act } from '@testing-library/react';
import { useBrushEngineSimplified } from '../useBrushEngineSimplified';

// Mock dependencies
const mockApplyDitheringWithFillResolution = jest.fn((...args: any[]) => args[0] as ImageData);
const mockSetSpeed = jest.fn();
const mockSetLayerBaseSpeed = jest.fn();
const getMockManagedBrush = () => ({
  setTargetCanvas: jest.fn(),
  getCanvas: jest.fn(),
  setOnFrameRendered: jest.fn(),
  endStroke: jest.fn(),
  setBrushSize: jest.fn(),
  setFPS: jest.fn(),
  setSpeed: mockSetSpeed,
  setLayerBaseSpeed: mockSetLayerBaseSpeed,
  setPlaybackSpeedScale: jest.fn(),
  setGradientBands: jest.fn(),
  setBandSpacing: jest.fn(),
  setDitherEnabled: jest.fn(),
  setDitherPixelSize: jest.fn(),
  setPxlEdgeEnabled: jest.fn(),
  setStampDitherEnabled: jest.fn(),
  setPressureEnabled: jest.fn(),
  setMinPressure: jest.fn(),
  setMaxPressure: jest.fn(),
  setStampShape: jest.fn(),
  setFlowMode: jest.fn(),
  setFlowDirection: jest.fn(),
  setLegacyFlowMode: jest.fn(),
  setDitherStrength: jest.fn(),
});
const mockGetBrush = jest.fn(() => ({
  setTargetCanvas: jest.fn(),
  setSpeed: mockSetSpeed,
  setLayerBaseSpeed: mockSetLayerBaseSpeed,
}));
jest.mock('@/stores/colorCycleBrushManager', () => ({
  getColorCycleBrushManager: () => ({
    getBrush: (...args: Parameters<typeof mockGetBrush>) => {
      mockGetBrush(...args);
      return getMockManagedBrush();
    },
  }),
}));

jest.mock('@/utils/risographTexture', () => ({
  getRisographPattern: jest.fn(() => null),
  getRisographEffectSettings: jest.fn(() => ({})),
}));

jest.mock('@/stores/useAppStore', () => {
  const state = {
    tools: {
      brushSettings: {
        size: 10,
        brushShape: 'round',
        pressureEnabled: false,
        maxPressure: 1,
      },
      tool: 'brush',
    },
    project: { width: 10, height: 10 },
    layers: [],
    activeLayerId: null,
    getLayerColorCycleBrush: () => getMockManagedBrush(),
  };
  const useAppStore = (selector: any) => (typeof selector === 'function' ? selector(state) : state);
  (useAppStore as any).getState = () => state;
  (useAppStore as any).subscribe = () => jest.fn();
  return { useAppStore, selectEffectiveColorCyclePlaying: () => false };
});

jest.mock('@/hooks/brushEngine/BrushEngineFacade', () => {
  const drawStroke = jest.fn();
  const renderBrushStroke = jest.fn();
  const reset = jest.fn();
  return {
    createBrushEngineFacade: () => ({
      drawStroke,
      renderBrushStroke,
      reset,
      dispose: jest.fn(),
      setBrush: jest.fn(),
      updateConfig: jest.fn(),
    }),
  };
});

jest.mock('@/hooks/brushEngine/dithering', () => ({
  applyDithering: jest.fn((imageData: ImageData) => imageData),
  applyDitheringWithFillResolution: (...args: unknown[]) =>
    mockApplyDitheringWithFillResolution(...args),
}));

// Harness component that invokes the hook
const Harness: React.FC<{ onReady: (engine: ReturnType<typeof useBrushEngineSimplified>) => void }> = ({ onReady }) => {
  const engine = useBrushEngineSimplified();
  useEffect(() => {
    onReady(engine);
  }, [engine, onReady]);
  return null;
};

describe('useBrushEngineSimplified harness', () => {
  beforeEach(() => {
    mockApplyDitheringWithFillResolution.mockClear();
    mockSetSpeed.mockClear();
    mockSetLayerBaseSpeed.mockClear();
  });

  it('initializes and exposes API methods', async () => {
    let engineRef: any;
    await act(async () => {
      render(<Harness onReady={(engine) => (engineRef = engine)} />);
    });

    expect(engineRef).toBeDefined();
    expect(typeof engineRef.resetStroke).toBe('function');
    expect(typeof engineRef.drawBrush).toBe('function');
  });

  it('clears preview region for Dither Stroke when BG fill is off (legacy path)', async () => {
    const state = (jest.requireMock('@/stores/useAppStore') as { useAppStore: { getState: () => any } }).useAppStore.getState();
    state.tools.brushSettings.brushShape = 'pixel_dither';
    state.tools.brushSettings.ditherEnabled = true;
    state.tools.brushSettings.ditherBackgroundFill = false;
    state.tools.brushSettings.pressureLinkedFillResolution = true;
    state.tools.brushSettings.fillResolution = 4;

    if (typeof ImageData === 'undefined') {
      (global as unknown as { ImageData?: typeof ImageData }).ImageData = class ImageData {
        data: Uint8ClampedArray;
        width: number;
        height: number;
        constructor(data: Uint8ClampedArray, width: number, height: number) {
          this.data = data;
          this.width = width;
          this.height = height;
        }
      } as unknown as typeof ImageData;
    }

    const targetCanvas = document.createElement('canvas');
    targetCanvas.width = 32;
    targetCanvas.height = 32;

    const createMockCtx = () => {
      const ctx: Partial<CanvasRenderingContext2D> & { canvas: HTMLCanvasElement } = {
        canvas: targetCanvas,
        clearRect: jest.fn(),
        drawImage: jest.fn(),
        getImageData: jest.fn(() => new ImageData(new Uint8ClampedArray(32 * 32 * 4), 32, 32)),
        putImageData: jest.fn(),
        setTransform: jest.fn(),
        save: jest.fn(),
        restore: jest.fn(),
        globalCompositeOperation: 'source-over',
        globalAlpha: 1,
        imageSmoothingEnabled: false,
      };
      return ctx as CanvasRenderingContext2D;
    };

    const targetCtx = createMockCtx();
    const otherCtx = createMockCtx();

    const getContextSpy = jest.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
      function getContext(this: HTMLCanvasElement, _contextId: unknown) {
        void _contextId;
        return (this === targetCanvas ? targetCtx : otherCtx) as unknown as ReturnType<HTMLCanvasElement['getContext']>;
      }
    );

    const originalRaf = global.requestAnimationFrame;
    global.requestAnimationFrame = (cb: FrameRequestCallback) => {
      cb(0);
      return 0;
    };

    let engineRef: any;
    await act(async () => {
      render(<Harness onReady={(engine) => (engineRef = engine)} />);
    });

    act(() => {
      engineRef.drawBrush?.(targetCtx, { x: 0, y: 0 }, { x: 4, y: 4 }, { pressure: 0.8 });
    });

    expect((targetCtx.clearRect as jest.Mock).mock.calls.length).toBeGreaterThan(0);

    getContextSpy.mockRestore();
    global.requestAnimationFrame = originalRaf;
  });

  it('does not use Dither Stroke BG-off clear path for non-dither brushes', async () => {
    const state = (jest.requireMock('@/stores/useAppStore') as { useAppStore: { getState: () => any } }).useAppStore.getState();
    state.tools.brushSettings.brushShape = 'color_cycle';
    state.tools.brushSettings.ditherEnabled = true;
    state.tools.brushSettings.ditherBackgroundFill = false;
    state.tools.brushSettings.pressureLinkedFillResolution = true;
    state.tools.brushSettings.fillResolution = 4;

    if (typeof ImageData === 'undefined') {
      (global as unknown as { ImageData?: typeof ImageData }).ImageData = class ImageData {
        data: Uint8ClampedArray;
        width: number;
        height: number;
        constructor(data: Uint8ClampedArray, width: number, height: number) {
          this.data = data;
          this.width = width;
          this.height = height;
        }
      } as unknown as typeof ImageData;
    }

    const targetCanvas = document.createElement('canvas');
    targetCanvas.width = 32;
    targetCanvas.height = 32;

    const createMockCtx = () => {
      const ctx: Partial<CanvasRenderingContext2D> & { canvas: HTMLCanvasElement } = {
        canvas: targetCanvas,
        clearRect: jest.fn(),
        drawImage: jest.fn(),
        getImageData: jest.fn(() => new ImageData(new Uint8ClampedArray(32 * 32 * 4), 32, 32)),
        putImageData: jest.fn(),
        setTransform: jest.fn(),
        save: jest.fn(),
        restore: jest.fn(),
        globalCompositeOperation: 'source-over',
        globalAlpha: 1,
        imageSmoothingEnabled: false,
      };
      return ctx as CanvasRenderingContext2D;
    };

    const targetCtx = createMockCtx();
    const otherCtx = createMockCtx();

    const getContextSpy = jest.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
      function getContext(this: HTMLCanvasElement, _contextId: unknown) {
        void _contextId;
        return (this === targetCanvas ? targetCtx : otherCtx) as unknown as ReturnType<HTMLCanvasElement['getContext']>;
      }
    );

    const originalRaf = global.requestAnimationFrame;
    global.requestAnimationFrame = (cb: FrameRequestCallback) => {
      cb(0);
      return 0;
    };

    let engineRef: any;
    await act(async () => {
      render(<Harness onReady={(engine) => (engineRef = engine)} />);
    });

    act(() => {
      engineRef.drawBrush?.(targetCtx, { x: 0, y: 0 }, { x: 4, y: 4 }, { pressure: 0.8 });
    });

    expect((targetCtx.clearRect as jest.Mock)).not.toHaveBeenCalled();

    getContextSpy.mockRestore();
    global.requestAnimationFrame = originalRaf;
  });

  it('uses layer base speed rescaling only for same-layer CC speed edits', async () => {
    const state = (jest.requireMock('@/stores/useAppStore') as { useAppStore: { getState: () => any } }).useAppStore.getState();
    state.tools.brushSettings.colorCycleSpeed = 0.3;
    state.layers = [
      {
        id: 'layer-a',
        layerType: 'color-cycle',
        colorCycleData: {
          layerBaseSpeedCps: 0.2,
        },
      },
      {
        id: 'layer-b',
        layerType: 'color-cycle',
        colorCycleData: {
          layerBaseSpeedCps: 0.8,
        },
      },
    ];
    state.activeLayerId = 'layer-a';

    let renderApi: ReturnType<typeof render> | null = null;
    await act(async () => {
      renderApi = render(<Harness onReady={() => {}} />);
    });

    expect(mockSetSpeed).toHaveBeenCalledWith(0.3);
    expect(mockSetLayerBaseSpeed).toHaveBeenCalledWith(0.2);

    await act(async () => {
      state.layers[0].colorCycleData.layerBaseSpeedCps = 0.5;
      renderApi?.rerender(<Harness onReady={() => {}} />);
    });

    expect(mockSetLayerBaseSpeed).toHaveBeenCalledWith(0.5);

    await act(async () => {
      state.activeLayerId = 'layer-b';
      renderApi?.rerender(<Harness onReady={() => {}} />);
    });

    expect(mockSetSpeed).toHaveBeenCalledWith(0.3);
    expect(mockSetLayerBaseSpeed).toHaveBeenCalledWith(0.8);
  });

  it('does not treat brush speed changes as layer base changes when the layer has no explicit base speed', async () => {
    const state = (jest.requireMock('@/stores/useAppStore') as { useAppStore: { getState: () => any } }).useAppStore.getState();
    state.tools.brushSettings.colorCycleSpeed = 0.2;
    state.layers = [
      {
        id: 'layer-a',
        layerType: 'color-cycle',
        colorCycleData: {},
      },
    ];
    state.activeLayerId = 'layer-a';

    let renderApi: ReturnType<typeof render> | null = null;
    await act(async () => {
      renderApi = render(<Harness onReady={() => {}} />);
    });

    expect(mockSetSpeed).toHaveBeenCalledWith(0.2);
    expect(mockSetLayerBaseSpeed).toHaveBeenCalledWith(1);

    mockSetSpeed.mockClear();
    mockSetLayerBaseSpeed.mockClear();

    await act(async () => {
      state.tools.brushSettings.colorCycleSpeed = 0.6;
      renderApi?.rerender(<Harness onReady={() => {}} />);
    });

    expect(mockSetSpeed).toHaveBeenCalledWith(0.6);
    expect(mockSetLayerBaseSpeed).not.toHaveBeenCalled();
  });

});
