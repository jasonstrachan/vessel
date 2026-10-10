/* eslint-disable @typescript-eslint/no-explicit-any */
import React, { useEffect } from 'react';
import { render, act } from '@testing-library/react';
import { useBrushEngineSimplified } from '../useBrushEngineSimplified';
import * as liveStrokePreviewController from '../brushEngine/liveStrokePreviewController';

// Mock dependencies
const mockApplyDitheringWithFillResolution = jest.fn((...args: any[]) => args[0] as ImageData);
const mockSetSpeed = jest.fn();
const mockSetLayerBaseSpeed = jest.fn();
const mockGetPixelStrokePreview = jest.fn(() => null);
const mockFacadeOwners: Array<{ beginStroke: jest.Mock; renderBrushStroke: jest.Mock; finalizeStroke: jest.Mock }> = [];
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
    getPlaybackBrush: () => getMockManagedBrush(),
    getSurfaceBrush: () => getMockManagedBrush(),
    getSettingsPatchBrush: () => getMockManagedBrush(),
    getLayerActivationBrush: () => getMockManagedBrush(),
    getClearBrush: () => getMockManagedBrush(),
    getInitBrush: (...args: Parameters<typeof mockGetBrush>) => {
      mockGetBrush(...args);
      return getMockManagedBrush();
    },
    getDrawBrush: () => getMockManagedBrush(),
    getFillBrush: () => getMockManagedBrush(),
    getStrokeLifecycleBrush: () => getMockManagedBrush(),
    getSpeedSettingsBrush: () => getMockManagedBrush(),
    applySettingsToBrushes: jest.fn(),
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
  };
  const useAppStore = (selector: any) => (typeof selector === 'function' ? selector(state) : state);
  (useAppStore as any).getState = () => state;
  (useAppStore as any).subscribe = () => jest.fn();
  return { useAppStore, selectEffectiveColorCyclePlaying: () => false };
});

jest.mock('@/hooks/brushEngine/BrushEngineFacade', () => {
  const drawStroke = jest.fn();
  const reset = jest.fn();
  return {
    createBrushEngineFacade: () => {
      const owner = { beginStroke: jest.fn(), renderBrushStroke: jest.fn(), finalizeStroke: jest.fn() };
      mockFacadeOwners.push(owner);
      return {
        ...owner,
        drawStroke,
        getPixelStrokePreview: mockGetPixelStrokePreview,
        reset,
        resetStroke: jest.fn(),
        dispose: jest.fn(),
        setBrush: jest.fn(),
        updateConfig: jest.fn(),
      };
    },
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
    mockGetPixelStrokePreview.mockClear();
    mockFacadeOwners.length = 0;
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


  it.each([
    [false, { lostEdge: 0, ditherEnabled: false }, 1],
    [false, { lostEdge: 100, ditherEnabled: false }, 1],
    [false, { lostEdge: 0, ditherEnabled: true }, 1],
    [true, { lostEdge: 100, ditherEnabled: false }, 1],
    [true, { lostEdge: 0, ditherEnabled: true }, 1],
    [false, { lostEdge: 0, ditherEnabled: true, pressureLinkedFillResolution: true }, 0],
  ])('requests deterministic effect raw with CC=%s settings=%o', async (cc, effect, expectedCalls) => {
    const state = (jest.requireMock('@/stores/useAppStore') as { useAppStore: { getState: () => {
      tools: { brushSettings: Record<string, unknown>; currentTool?: string };
    } } }).useAppStore.getState();
    const previousTools = state.tools;
    const originalRaf = global.requestAnimationFrame;
    state.tools = {
      currentTool: 'brush',
      brushSettings: {
        ...previousTools.brushSettings,
        brushShape: 'square', size: 5, opacity: 1, color: '#ffffff',
        antialiasing: false,
        pressureLinkedFillResolution: false, risographIntensity: 0, ...effect,
      },
    };
    global.requestAnimationFrame = (callback: FrameRequestCallback) => {
      callback(0);
      return 0;
    };
    try {
      let engineRef: ReturnType<typeof useBrushEngineSimplified> | undefined;
      await act(async () => {
        render(<Harness onReady={(engine) => { engineRef = engine; }} />);
      });
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 32;
      const ctx = canvas.getContext('2d')!;
      ctx.globalCompositeOperation = cc ? 'source-over' : 'destination-out';
      act(() => {
        engineRef!.drawBrush(ctx, { x: 4, y: 4 }, { x: 24, y: 4 }, { pressure: 1, ...(cc ? { target: 'erase-mask' as const } : {}) });
      });
      expect(mockGetPixelStrokePreview).toHaveBeenCalledTimes(expectedCalls);
      if (expectedCalls) expect(mockGetPixelStrokePreview).toHaveBeenCalledWith({
        rawCanvas: expect.any(HTMLCanvasElement),
        bounds: expect.objectContaining({ width: expect.any(Number), height: expect.any(Number) }),
      });
    } finally {
      state.tools = previousTools;
      global.requestAnimationFrame = originalRaf;
    }
  });

  it.each([
    ['raster/sequence', false, false, false], ['raster/sequence', false, true, false],
    ['CC', true, false, false], ['CC', true, true, false],
    ['painting', false, false, true], ['painting', false, true, true],
  ] as const)('keeps the color overlay painting-only for %s CC=%s dither=%s paint=%s', async (_target, cc, ditherEnabled, paint) => {
    const state = (jest.requireMock('@/stores/useAppStore') as { useAppStore: { getState: () => {
      tools: { brushSettings: Record<string, unknown>; currentTool?: string };
    } } }).useAppStore.getState();
    const previousTools = state.tools;
    const originalRaf = global.requestAnimationFrame;
    // The mutable tool intentionally disagrees with the admitted paint/mask target.
    state.tools = {
      currentTool: 'brush',
      brushSettings: {
        ...previousTools.brushSettings,
        brushShape: 'square', size: 5, opacity: 0.5, color: '#ffffff',
        antialiasing: false, ditherEnabled, ditherBackgroundFill: false,
        pressureLinkedFillResolution: false, fillResolution: 4, risographIntensity: 100, lostEdge: 0,
      },
    };
    global.requestAnimationFrame = (callback: FrameRequestCallback) => {
      callback(0);
      return 0;
    };
    const overlay = jest.spyOn(liveStrokePreviewController, 'applyStrokeRisographOverlay').mockImplementation(() => {});
    try {
      let runtime: ReturnType<typeof useBrushEngineSimplified> | undefined;
      await act(async () => {
        render(<Harness onReady={(engine) => { runtime = engine; }} />);
      });
      state.tools.currentTool = paint ? 'eraser' : 'brush';
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 32;
      const ctx = canvas.getContext('2d')!;
      const saved: Array<{ composite: GlobalCompositeOperation; alpha: number }> = [];
      jest.spyOn(ctx, 'save').mockImplementation(() => {
        saved.push({ composite: ctx.globalCompositeOperation, alpha: ctx.globalAlpha });
      });
      jest.spyOn(ctx, 'restore').mockImplementation(() => {
        const previous = saved.pop()!;
        ctx.globalCompositeOperation = previous.composite;
        ctx.globalAlpha = previous.alpha;
      });
      ctx.globalCompositeOperation = cc || paint ? 'source-over' : 'destination-out';
      act(() => {
        runtime!.drawBrush(ctx, { x: 4, y: 4 }, { x: 24, y: 4 }, {
          pressure: 1, ...(cc ? { target: 'erase-mask' as const } : {}),
        });
      });
      const heldCalls = overlay.mock.calls.length;
      if (paint) expect(overlay).toHaveBeenLastCalledWith(expect.objectContaining({
        ctx, risographIntensity: 100, source: expect.any(HTMLCanvasElement),
      }));
      overlay.mockClear();
      act(() => { runtime!.finalizeStroke(ctx); });
      expect({ held: heldCalls, finalized: overlay.mock.calls.length }).toEqual({
        held: paint ? 1 : 0,
        finalized: paint && ditherEnabled ? 1 : 0,
      });
    } finally {
      overlay.mockRestore();
      state.tools = previousTools;
      global.requestAnimationFrame = originalRaf;
    }
  });

  it.each(['destination-out', 'erase-mask', 'paint'] as const)(
    'admits %s once and retains the admitted facade across settings rerenders', async (target) => {
      const state = (jest.requireMock('@/stores/useAppStore') as { useAppStore: { getState: () => {
        tools: { brushSettings: Record<string, unknown>; currentTool?: string };
      } } }).useAppStore.getState();
      const previousTools = state.tools;
      const originalRaf = global.requestAnimationFrame;
      state.tools = {
        currentTool: 'brush',
        brushSettings: {
          ...previousTools.brushSettings, brushShape: 'square', size: 5, opacity: 0.5,
          antialiasing: false, ditherEnabled: false, risographIntensity: 0,
        },
      };
      global.requestAnimationFrame = (callback: FrameRequestCallback) => { callback(0); return 0; };
      try {
        let current: ReturnType<typeof useBrushEngineSimplified> | undefined;
        const onReady = (runtime: ReturnType<typeof useBrushEngineSimplified>) => { current = runtime; };
        const mounted = render(<Harness onReady={onReady} />);
        const admitted = current!;
        const firstOwner = mockFacadeOwners[0];
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = 32;
        const ctx = canvas.getContext('2d')!;
        ctx.globalCompositeOperation = target === 'destination-out' ? 'destination-out' : 'source-over';
        const cursor = target === 'erase-mask' ? { target: 'erase-mask' as const } : {};
        act(() => { admitted.drawBrush(ctx, { x: 4, y: 4 }, { x: 8, y: 4 }, cursor); });
        state.tools.brushSettings = { ...state.tools.brushSettings, risographIntensity: 100 };
        mounted.rerender(<Harness onReady={onReady} />);
        expect(mockFacadeOwners).toHaveLength(2);
        admitted.updateConfig({ brushSettings: state.tools.brushSettings as unknown as Parameters<typeof admitted.updateConfig>[0]['brushSettings'] });
        act(() => { admitted.drawBrush(ctx, { x: 8, y: 4 }, { x: 24, y: 4 }, cursor); });
        expect(firstOwner.beginStroke).toHaveBeenCalledTimes(1);
        expect(firstOwner.beginStroke).toHaveBeenCalledWith(target === 'paint' ? 'paint' : 'erase-mask');
        expect(mockFacadeOwners[1].beginStroke).not.toHaveBeenCalled();
        expect(firstOwner.renderBrushStroke).toHaveBeenCalledTimes(2);
        expect(mockFacadeOwners[1].renderBrushStroke).not.toHaveBeenCalled();
        act(() => { admitted.finalizeStroke(ctx); });
        expect(firstOwner.finalizeStroke).toHaveBeenCalledTimes(1);
        expect(mockFacadeOwners[1].finalizeStroke).not.toHaveBeenCalled();
      } finally {
        state.tools = previousTools;
        global.requestAnimationFrame = originalRaf;
      }
    },
  );

  it('restores the preview region without clearing artwork when Dither Stroke BG fill is off', async () => {
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
        beginPath: jest.fn(),
        rect: jest.fn(),
        clip: jest.fn(),
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

    expect(targetCtx.clearRect).not.toHaveBeenCalled();
    expect((targetCtx.drawImage as jest.Mock).mock.calls.length).toBeGreaterThan(0);

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

  it('ignores legacy brushSpeed when resolving runtime layer base speed', async () => {
    const state = (jest.requireMock('@/stores/useAppStore') as { useAppStore: { getState: () => any } }).useAppStore.getState();
    state.tools.brushSettings.colorCycleSpeed = 0.2;
    state.layers = [
      {
        id: 'layer-a',
        layerType: 'color-cycle',
        colorCycleData: {
          brushSpeed: 1.6,
        },
      },
    ];
    state.activeLayerId = 'layer-a';

    await act(async () => {
      render(<Harness onReady={() => {}} />);
    });

    expect(mockSetSpeed).toHaveBeenCalledWith(0.2);
    expect(mockSetLayerBaseSpeed).toHaveBeenCalledWith(1);
  });

});
