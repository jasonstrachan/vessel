import { useAppStore } from '@/stores/useAppStore';
import {
  finalizeColorCycleShapeFillConcentric,
  finalizeColorCycleShapeFillLinear,
} from '@/hooks/canvas/handlers/colorCycle/colorCycleShapeFill';

describe('colorCycleShapeFill transparency lock', () => {
  it('masks CC shape finalize output to pre-existing alpha when transparency is locked', async () => {
    const getStateSpy = jest.spyOn(useAppStore, 'getState');
    getStateSpy.mockReturnValue({
      layers: [
        {
          id: 'layer-1',
          transparencyLocked: true,
          colorCycleData: {},
        },
      ],
      tools: {
        brushSettings: {
          colorCycleUseForegroundGradient: false,
        },
      },
      setCcGradientSampleCount: jest.fn(),
      updateLayer: jest.fn(),
    } as unknown as ReturnType<typeof useAppStore.getState>);

    const canvas = document.createElement('canvas');
    canvas.width = 2;
    canvas.height = 1;
    const ctx = canvas.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D;
    ctx.clearRect(0, 0, 2, 1);
    ctx.fillStyle = 'rgba(255, 255, 255, 1)';
    ctx.fillRect(0, 0, 1, 1);

    const brushEngine = {
      resetColorCycle: jest.fn(),
      fillCcGradientLinear: jest.fn(async () => {
        const drawCtx = canvas.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D;
        drawCtx.fillStyle = 'rgba(255, 0, 0, 1)';
        drawCtx.fillRect(0, 0, 2, 1);
      }),
      updateColorCycleTexture: jest.fn(),
    };
    const applyLayerSnapshot = jest.fn();
    const getLayerSnapshot = jest.fn()
      .mockReturnValueOnce({
        paintBuffer: new Uint8Array([1, 0]).buffer,
        gradientIdBuffer: new Uint8Array([2, 0]).buffer,
        gradientDefIdBuffer: new Uint16Array([3, 0]).buffer,
        speedBuffer: new Uint8Array([4, 0]).buffer,
        flowBuffer: new Uint8Array([5, 0]).buffer,
        hasContent: true,
        strokeCounter: 9,
      })
      .mockReturnValue({
        paintBuffer: new Uint8Array([1, 1]).buffer,
        gradientIdBuffer: new Uint8Array([2, 2]).buffer,
        gradientDefIdBuffer: new Uint16Array([3, 3]).buffer,
        speedBuffer: new Uint8Array([4, 4]).buffer,
        flowBuffer: new Uint8Array([5, 5]).buffer,
        hasContent: true,
        strokeCounter: 9,
      });
    const renderDirectToCanvas = jest.fn();
    const ccBrush = {
      getLayerSnapshot,
      applyLayerSnapshot,
      renderDirectToCanvas,
    };

    await finalizeColorCycleShapeFillLinear(
      {
        session: null,
        shapePoints: [
          { x: 0, y: 0 },
          { x: 1, y: 0 },
          { x: 0, y: 1 },
        ],
        direction: { x: 1, y: 0 },
        activeLayerId: 'layer-1',
        activeLayerCanvas: canvas,
        overlayCanvas: null,
        overlayCtx: null,
        fallbackBlendMode: 'source-over',
        fallbackOpacity: 1,
        shapeLayerId: 'layer-1',
        beforeColorState: null,
        tool: 'brush',
      },
      {
        brushEngine: brushEngine as never,
        getColorCycleBrushManager: () => ({ getBrush: () => ccBrush as never }),
        bindBrushToCanvas: jest.fn(),
        timeAsync: async (_label, task) => task(),
        timeSync: (_label, task) => task(),
        ccLog: jest.fn(),
        scheduleDeferredColorCycleSaveWithState: jest.fn(async () => undefined),
        logError: jest.fn(),
      }
    );

    expect(getLayerSnapshot).toHaveBeenCalledWith('layer-1');
    expect(applyLayerSnapshot).toHaveBeenCalled();
    const appliedSnapshot = applyLayerSnapshot.mock.calls[0][1];
    expect(new Uint8Array(appliedSnapshot.paintBuffer)[1]).toBe(0);
    expect(new Uint8Array(appliedSnapshot.gradientIdBuffer)[1]).toBe(0);
    expect(new Uint16Array(appliedSnapshot.gradientDefIdBuffer)[1]).toBe(0);
    expect(new Uint8Array(appliedSnapshot.speedBuffer)[1]).toBe(0);
    expect(new Uint8Array(appliedSnapshot.flowBuffer)[1]).toBe(0);
    expect(renderDirectToCanvas).toHaveBeenCalled();

    getStateSpy.mockRestore();
  });

  it('does not reset the color-cycle stroke lifecycle before shape finalize fill', async () => {
    const getStateSpy = jest.spyOn(useAppStore, 'getState');
    getStateSpy.mockReturnValue({
      layers: [
        {
          id: 'layer-1',
          transparencyLocked: false,
          colorCycleData: {},
        },
      ],
      tools: {
        brushSettings: {
          colorCycleUseForegroundGradient: false,
        },
      },
      setCcGradientSampleCount: jest.fn(),
      updateLayer: jest.fn(),
    } as unknown as ReturnType<typeof useAppStore.getState>);

    const canvas = document.createElement('canvas');
    canvas.width = 2;
    canvas.height = 2;

    const brushEngine = {
      resetColorCycle: jest.fn(),
      fillCcGradientLinear: jest.fn(async () => undefined),
      updateColorCycleTexture: jest.fn(),
    };

    await finalizeColorCycleShapeFillLinear(
      {
        session: null,
        shapePoints: [
          { x: 0, y: 0 },
          { x: 1, y: 0 },
          { x: 0, y: 1 },
        ],
        direction: { x: 1, y: 0 },
        activeLayerId: 'layer-1',
        activeLayerCanvas: canvas,
        overlayCanvas: null,
        overlayCtx: null,
        fallbackBlendMode: 'source-over',
        fallbackOpacity: 1,
        shapeLayerId: 'layer-1',
        beforeColorState: null,
        tool: 'brush',
      },
      {
        brushEngine: brushEngine as never,
        getColorCycleBrushManager: () => ({ getBrush: () => null }),
        bindBrushToCanvas: jest.fn(),
        timeAsync: async (_label, task) => task(),
        timeSync: (_label, task) => task(),
        ccLog: jest.fn(),
        scheduleDeferredColorCycleSaveWithState: jest.fn(async () => undefined),
        logError: jest.fn(),
      }
    );

    expect(brushEngine.resetColorCycle).not.toHaveBeenCalled();
    expect(brushEngine.fillCcGradientLinear).toHaveBeenCalledWith(
      expect.any(Array),
      { x: 1, y: 0 },
      expect.objectContaining({
        skipPostRender: true,
      })
    );

    getStateSpy.mockRestore();
  });

  it('does not wait for deferred color-cycle shape history save before resolving', async () => {
    const getStateSpy = jest.spyOn(useAppStore, 'getState');
    getStateSpy.mockReturnValue({
      layers: [
        {
          id: 'layer-1',
          transparencyLocked: false,
          colorCycleData: {},
        },
      ],
      tools: {
        brushSettings: {
          colorCycleUseForegroundGradient: false,
        },
      },
      setCcGradientSampleCount: jest.fn(),
      updateLayer: jest.fn(),
    } as unknown as ReturnType<typeof useAppStore.getState>);

    const canvas = document.createElement('canvas');
    canvas.width = 2;
    canvas.height = 2;

    let releaseDeferred: (() => void) | undefined;
    const deferredSave = new Promise<void>((resolve) => {
      releaseDeferred = resolve;
    });

    const finalizePromise = finalizeColorCycleShapeFillLinear(
      {
        session: null,
        shapePoints: [
          { x: 0, y: 0 },
          { x: 1, y: 0 },
          { x: 0, y: 1 },
        ],
        direction: { x: 1, y: 0 },
        activeLayerId: 'layer-1',
        activeLayerCanvas: canvas,
        overlayCanvas: null,
        overlayCtx: null,
        fallbackBlendMode: 'source-over',
        fallbackOpacity: 1,
        shapeLayerId: 'layer-1',
        beforeColorState: null,
        tool: 'brush',
      },
      {
        brushEngine: {
          resetColorCycle: jest.fn(),
          fillCcGradientLinear: jest.fn(async () => undefined),
          updateColorCycleTexture: jest.fn(),
        } as never,
        getColorCycleBrushManager: () => ({ getBrush: () => null }),
        bindBrushToCanvas: jest.fn(),
        timeAsync: async (_label, task) => task(),
        timeSync: (_label, task) => task(),
        ccLog: jest.fn(),
        scheduleDeferredColorCycleSaveWithState: jest.fn(() => deferredSave),
        logError: jest.fn(),
      }
    );

    const finalizeResult = await Promise.race([
      finalizePromise.then(() => 'resolved'),
      new Promise<'timeout'>((resolve) => {
        setTimeout(() => resolve('timeout'), 0);
      }),
    ]);
    expect(finalizeResult).toBe('resolved');

    releaseDeferred?.();
    await deferredSave;

    getStateSpy.mockRestore();
  });

  it('uses preview-parity quantized levels for linear CC dither finalize', async () => {
    const getStateSpy = jest.spyOn(useAppStore, 'getState');
    getStateSpy.mockReturnValue({
      layers: [
        {
          id: 'layer-1',
          transparencyLocked: false,
          colorCycleData: {},
        },
      ],
      tools: {
        brushSettings: {
          colorCycleUseForegroundGradient: false,
          ditherEnabled: true,
          gradientBands: 5,
        },
      },
      setCcGradientSampleCount: jest.fn(),
      updateLayer: jest.fn(),
    } as unknown as ReturnType<typeof useAppStore.getState>);

    const canvas = document.createElement('canvas');
    canvas.width = 3;
    canvas.height = 3;

    const brushEngine = {
      fillCcGradientLinear: jest.fn(async () => undefined),
      updateColorCycleTexture: jest.fn(),
    };

    await finalizeColorCycleShapeFillLinear(
      {
        session: null,
        shapePoints: [
          { x: 0, y: 0 },
          { x: 2, y: 0 },
          { x: 0, y: 2 },
        ],
        direction: { x: 1, y: 0 },
        activeLayerId: 'layer-1',
        activeLayerCanvas: canvas,
        overlayCanvas: null,
        overlayCtx: null,
        fallbackBlendMode: 'source-over',
        fallbackOpacity: 1,
        shapeLayerId: 'layer-1',
        beforeColorState: null,
        tool: 'brush',
        ditherPixelSize: 3,
      },
      {
        brushEngine: brushEngine as never,
        getColorCycleBrushManager: () => ({ getBrush: () => null }),
        bindBrushToCanvas: jest.fn(),
        timeAsync: async (_label, task) => task(),
        timeSync: (_label, task) => task(),
        ccLog: jest.fn(),
        scheduleDeferredColorCycleSaveWithState: jest.fn(async () => undefined),
        logError: jest.fn(),
      }
    );

    const linearCall = brushEngine.fillCcGradientLinear.mock.calls[0] as unknown as
      | [Array<{ x: number; y: number }>, { x: number; y: number }, Record<string, unknown>]
      | undefined;
    const linearOptions = linearCall?.[2];
    expect(brushEngine.fillCcGradientLinear).toHaveBeenCalledWith(
      expect.any(Array),
      { x: 1, y: 0 },
      expect.objectContaining({
        ditherPixelSize: 3,
        ditherLevels: 5,
        skipPostRender: true,
      })
    );
    expect(linearOptions).not.toHaveProperty('ditherPairBandCount');

    getStateSpy.mockRestore();
  });

  it('uses preview-parity quantized levels for concentric CC dither finalize', async () => {
    const getStateSpy = jest.spyOn(useAppStore, 'getState');
    getStateSpy.mockReturnValue({
      layers: [
        {
          id: 'layer-1',
          transparencyLocked: false,
          colorCycleData: {},
        },
      ],
      tools: {
        brushSettings: {
          colorCycleUseForegroundGradient: false,
          ditherEnabled: true,
          gradientBands: 6,
        },
      },
      setCcGradientSampleCount: jest.fn(),
      updateLayer: jest.fn(),
    } as unknown as ReturnType<typeof useAppStore.getState>);

    const canvas = document.createElement('canvas');
    canvas.width = 3;
    canvas.height = 3;

    const brushEngine = {
      fillCcGradientConcentric: jest.fn(async () => undefined),
      updateColorCycleTexture: jest.fn(),
    };

    await finalizeColorCycleShapeFillConcentric(
      {
        session: null,
        shapePoints: [
          { x: 0, y: 0 },
          { x: 2, y: 0 },
          { x: 0, y: 2 },
        ],
        activeLayerId: 'layer-1',
        activeLayerCanvas: canvas,
        overlayCanvas: null,
        overlayCtx: null,
        fallbackBlendMode: 'source-over',
        fallbackOpacity: 1,
        shapeLayerId: 'layer-1',
        beforeColorState: null,
        tool: 'brush',
        ditherPixelSize: 2,
      },
      {
        brushEngine: brushEngine as never,
        getColorCycleBrushManager: () => ({ getBrush: () => null }),
        bindBrushToCanvas: jest.fn(),
        timeAsync: async (_label, task) => task(),
        timeSync: (_label, task) => task(),
        ccLog: jest.fn(),
        scheduleDeferredColorCycleSaveWithState: jest.fn(async () => undefined),
        logError: jest.fn(),
      }
    );

    const concentricCall = brushEngine.fillCcGradientConcentric.mock.calls[0] as unknown as
      | [Array<{ x: number; y: number }>, Record<string, unknown>]
      | undefined;
    const concentricOptions = concentricCall?.[1];
    expect(brushEngine.fillCcGradientConcentric).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({
        ditherPixelSize: 2,
        ditherLevels: 6,
        skipPostRender: true,
      })
    );
    expect(concentricOptions).not.toHaveProperty('ditherPairBandCount');

    getStateSpy.mockRestore();
  });
});
