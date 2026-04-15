import { useAppStore } from '@/stores/useAppStore';
import {
  finalizeColorCycleShapeFillConcentric,
  finalizeColorCycleShapeFillLinear,
} from '@/hooks/canvas/handlers/colorCycle/colorCycleShapeFill';
import * as colorCycleGradients from '@/utils/colorCycleGradients';
import * as colorCycleGradientDefs from '@/utils/colorCycleGradientDefs';
import { buildCcDitherRenderPalette, resolveCcDitherBandMode } from '@/utils/colorCycle/ccDitherRenderPalette';
import { hashStops, type StoredStop } from '@/utils/colorCycleGradientDefs';
import type { MarkGradientSession } from '@/hooks/canvas/utils/colorCycleMarkSession';
import { createDefaultLayerAlignment } from '@/utils/layoutDefaults';

describe('colorCycleShapeFill transparency lock', () => {
  const initialState = useAppStore.getState();

  afterEach(() => {
    jest.restoreAllMocks();
    useAppStore.setState(initialState, true);
  });

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

  it('re-renders the committed CC shape state after binding gradient defs', async () => {
    const updateLayer = jest.fn();
    const getStateSpy = jest.spyOn(useAppStore, 'getState');
    getStateSpy.mockReturnValue({
      layers: [
        {
          id: 'layer-1',
          transparencyLocked: false,
          colorCycleData: {
            gradientDefStore: [
              {
                id: 11,
                kind: 'linear',
                slot: 7,
                stops: [
                  { position: 0, color: '#111111' },
                  { position: 1, color: '#eeeeee' },
                ],
                hash: 'hash-11',
              },
            ],
          },
        },
      ],
      tools: {
        brushSettings: {
          colorCycleUseForegroundGradient: false,
          ditherEnabled: false,
        },
      },
      setCcGradientSampleCount: jest.fn(),
      updateLayer,
    } as unknown as ReturnType<typeof useAppStore.getState>);

    const canvas = document.createElement('canvas');
    canvas.width = 2;
    canvas.height = 2;

    const renderDirectToCanvas = jest.fn();
    const commitCommittedLayerState = jest.fn();
    const ccBrush = {
      renderDirectToCanvas,
      commitCommittedLayerState,
    };

    await finalizeColorCycleShapeFillLinear(
      {
        session: {
          markId: 'mark-1',
          layerId: 'layer-1',
          markKind: 'shape',
          gradientKind: 'linear',
          source: 'manual',
          frozenStopsStored: [
            { position: 0, color: '#111111' },
            { position: 1, color: '#eeeeee' },
          ],
          frozenHash: 'hash-11',
          binding: { kind: 'def', defId: 11, slot: 7 },
          speedCps: 0.3,
        },
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
          fillCcGradientLinear: jest.fn(async () => undefined),
          updateColorCycleTexture: jest.fn(),
        } as never,
        getColorCycleBrushManager: () => ({ getBrush: () => ccBrush as never }),
        bindBrushToCanvas: jest.fn(),
        timeAsync: async (_label, task) => task(),
        timeSync: (_label, task) => task(),
        ccLog: jest.fn(),
        scheduleDeferredColorCycleSaveWithState: jest.fn(async () => undefined),
        logError: jest.fn(),
      }
    );

    expect(commitCommittedLayerState).toHaveBeenCalledWith({
      layerId: 'layer-1',
      targetCanvas: canvas,
      binding: {
        defId: 11,
        slot: 7,
        bbox: undefined,
        previewSlot: null,
      },
    });
    expect(renderDirectToCanvas).not.toHaveBeenCalled();

    getStateSpy.mockRestore();
  });

  it('reuses an existing manual-session binding when finalize resolves the same render hash', async () => {
    const ensureGradientDefForStopsSpy = jest.spyOn(colorCycleGradientDefs, 'ensureGradientDefForStops');
    const getStateSpy = jest.spyOn(useAppStore, 'getState');
    getStateSpy.mockReturnValue({
      layers: [
        {
          id: 'layer-1',
          transparencyLocked: false,
          colorCycleData: {
            gradientDefStore: [
              {
                id: 11,
                kind: 'linear',
                slot: 7,
                stops: [
                  { position: 0, color: '#111111' },
                  { position: 1, color: '#eeeeee' },
                ],
                hash: 'hash-11',
              },
            ],
          },
        },
      ],
      tools: {
        brushSettings: {
          colorCycleUseForegroundGradient: false,
          ditherEnabled: true,
          gradientBands: 64,
          ditherPaletteSpread: 0,
          ditherAlgorithm: 'sierra-lite',
        },
      },
      setCcGradientSampleCount: jest.fn(),
      updateLayer: jest.fn(),
    } as unknown as ReturnType<typeof useAppStore.getState>);

    const canvas = document.createElement('canvas');
    canvas.width = 2;
    canvas.height = 2;

    const commitCommittedLayerState = jest.fn();
    const ccBrush = {
      commitCommittedLayerState,
      renderDirectToCanvas: jest.fn(),
    };
    const frozenStops: StoredStop[] = [
      { position: 0, color: '#111111' },
      { position: 1, color: '#eeeeee' },
    ];
    const runtimeHash = hashStops(frozenStops, 'linear');

    await finalizeColorCycleShapeFillLinear(
      {
        session: {
          markId: 'mark-reuse-binding',
          layerId: 'layer-1',
          markKind: 'shape',
          gradientKind: 'linear',
          source: 'manual',
          seamProfile: 'hard',
          frozenStopsStored: frozenStops,
          frozenHash: runtimeHash,
          binding: { kind: 'def', defId: 11, slot: 7 },
          speedCps: 0.3,
          ditherRenderConfig: {
            enabled: true,
            pairBandCount: 0,
            spread: 0,
            algorithm: 'sierra-lite',
          },
        },
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
          fillCcGradientLinear: jest.fn(async () => undefined),
          updateColorCycleTexture: jest.fn(),
        } as never,
        getColorCycleBrushManager: () => ({ getBrush: () => ccBrush as never }),
        bindBrushToCanvas: jest.fn(),
        timeAsync: async (_label, task) => task(),
        timeSync: (_label, task) => task(),
        ccLog: jest.fn(),
        scheduleDeferredColorCycleSaveWithState: jest.fn(async () => undefined),
        logError: jest.fn(),
      }
    );

    expect(ensureGradientDefForStopsSpy).not.toHaveBeenCalled();
    expect(commitCommittedLayerState).toHaveBeenCalledWith({
      layerId: 'layer-1',
      targetCanvas: canvas,
      binding: {
        defId: 11,
        slot: 7,
        bbox: undefined,
        previewSlot: null,
      },
    });

    getStateSpy.mockRestore();
  });

  it('prevents noisy fills by using preview-parity quantized levels for linear CC dither finalize', async () => {
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
        ditherPairBandCount: 0,
        skipPostRender: true,
      })
    );
    expect(linearOptions).toHaveProperty('ditherPairBandCount', 0);

    getStateSpy.mockRestore();
  });

  it('prevents noisy fills by using preview-parity quantized levels for concentric CC dither finalize', async () => {
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
        ditherPairBandCount: 0,
        skipPostRender: true,
      })
    );
    expect(concentricOptions).toHaveProperty('ditherPairBandCount', 0);

    getStateSpy.mockRestore();
  });

  it('heals stale def-bound slot palettes before linear CC dither finalize', async () => {
    const baseStops: StoredStop[] = [
      { position: 0, color: '#000000' },
      { position: 0.5, color: '#00ff00' },
      { position: 1, color: '#ffffff' },
    ];
    const staleStops: StoredStop[] = [
      { position: 0, color: '#ff00ff' },
      { position: 1, color: '#00ffff' },
    ];
    const gradientBands = 3;
    const renderStops = buildCcDitherRenderPalette({
      baseStops,
      bands: resolveCcDitherBandMode(gradientBands).pairBandCount,
      spread: 0,
    }).renderStops;
    const renderHash = hashStops(renderStops, 'linear');
    const updateLayer = initialState.updateLayer;

    useAppStore.setState((state) => ({
      ...state,
      activeLayerId: 'layer-1',
      layers: [{
        id: 'layer-1',
        name: 'Layer 1',
        visible: true,
        opacity: 1,
        blendMode: 'source-over',
        locked: false,
        transparencyLocked: false,
        order: 0,
        imageData: null,
        framebuffer: document.createElement('canvas'),
        alignment: createDefaultLayerAlignment(),
        layerType: 'color-cycle',
        colorCycleData: {
          gradientDefs: [],
          slotPalettes: [{ slot: 7, stops: staleStops }],
          gradientDefStore: [{
            id: 11,
            kind: 'linear',
            stops: renderStops,
            hash: renderHash,
            source: 'manual',
            createdAtMs: 0,
            slot: 7,
          }],
          nextGradientDefId: 12,
        },
        version: 1,
      }],
      tools: {
        ...state.tools,
        brushSettings: {
          ...state.tools.brushSettings,
          colorCycleUseForegroundGradient: false,
          ditherEnabled: true,
          gradientBands,
          ditherPaletteSpread: 0,
        },
      },
      updateLayer,
    }));

    const canvas = document.createElement('canvas');
    canvas.width = 3;
    canvas.height = 3;

    const brushEngine = {
      fillCcGradientLinear: jest.fn(async () => undefined),
      updateColorCycleTexture: jest.fn(),
    };
    const session: MarkGradientSession = {
      markId: 'mark-1',
      layerId: 'layer-1',
      markKind: 'shape',
      gradientKind: 'linear',
      source: 'manual',
      seamProfile: 'hard',
      frozenStopsStored: baseStops,
      frozenHash: hashStops(baseStops, 'linear'),
      binding: { kind: 'def', defId: 11, slot: 7 },
      speedCps: null,
    };

    await finalizeColorCycleShapeFillLinear(
      {
        session,
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

    expect(brushEngine.fillCcGradientLinear).toHaveBeenCalled();
    expect(useAppStore.getState().layers[0]?.colorCycleData?.slotPalettes).toEqual([
      { slot: 7, stops: renderStops },
    ]);
  });

  it('forwards sampled finalize phase seed and sampled stops into linear fill', async () => {
    const sampledStops: StoredStop[] = [
      { position: 0, color: '#112233' },
      { position: 1, color: '#ddeeff' },
    ];
    const updateLayer = jest.fn();
    const setActiveGradientSlot = jest.fn();
    const getStateSpy = jest.spyOn(useAppStore, 'getState');
    getStateSpy.mockReturnValue({
      layers: [
        {
          id: 'layer-1',
          transparencyLocked: false,
          layerType: 'color-cycle',
          colorCycleData: {
            paintSlot: 0,
            slotPalettes: [],
          },
        },
      ],
      tools: {
        brushSettings: {
          colorCycleUseForegroundGradient: false,
          ditherEnabled: true,
          gradientBands: 2,
          ditherPaletteSpread: 50,
        },
      },
      setCcGradientSampleCount: jest.fn(),
      updateLayer,
    } as unknown as ReturnType<typeof useAppStore.getState>);

    const canvas = document.createElement('canvas');
    canvas.width = 3;
    canvas.height = 3;

    const brushEngine = {
      fillCcGradientLinear: jest.fn(async () => undefined),
      updateColorCycleTexture: jest.fn(),
    };
    const brush = {
      setActiveGradientSlot,
      renderDirectToCanvas: jest.fn(),
    };
    const session: MarkGradientSession = {
      markId: 'mark-sampled-shape',
      layerId: 'layer-1',
      markKind: 'shape',
      gradientKind: 'linear',
      source: 'sampled',
      frozenStopsStored: sampledStops,
      previewStopsStored: sampledStops,
      fallbackStopsStored: sampledStops,
      frozenHash: hashStops(sampledStops, 'linear'),
      binding: { kind: 'def', defId: 17, slot: 9 },
      speedCps: null,
    };

    await finalizeColorCycleShapeFillLinear(
      {
        session,
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
        ditherPixelSize: 2,
      },
      {
        brushEngine: brushEngine as never,
        getColorCycleBrushManager: () => ({ getBrush: () => brush as never }),
        bindBrushToCanvas: jest.fn(),
        timeAsync: async (_label, task) => task(),
        timeSync: (_label, task) => task(),
        ccLog: jest.fn(),
        scheduleDeferredColorCycleSaveWithState: jest.fn(async () => undefined),
        logError: jest.fn(),
      }
    );

    expect(brushEngine.fillCcGradientLinear).toHaveBeenCalledWith(
      expect.any(Array),
      { x: 1, y: 0 },
      expect.objectContaining({
        ditherBaseOffsetOverride: 0,
        shapePhaseSeedMarkId: 'mark-sampled-shape',
      })
    );
    const sampledCall = brushEngine.fillCcGradientLinear.mock.calls[0] as unknown as
      | [Array<{ x: number; y: number }>, { x: number; y: number }, Record<string, unknown>]
      | undefined;
    const sampledOptions = sampledCall?.[2] as {
      ditherSampledStops?: StoredStop[];
      paintSlotOverride?: number;
    } | undefined;
    expect(sampledOptions?.ditherSampledStops?.length).toBeGreaterThanOrEqual(2);
    expect(sampledOptions?.paintSlotOverride).toBe(0);
    expect(setActiveGradientSlot).not.toHaveBeenCalledWith('layer-1', 9);
    expect(
      updateLayer.mock.calls.some(([, payload]) => payload?.colorCycleData?.paintSlot === 9)
    ).toBe(false);

    getStateSpy.mockRestore();
  });

  it('continues linear finalize when foreground runtime refresh still cannot allocate a slot', async () => {
    const ensureForegroundGradientSlotSpy = jest
      .spyOn(colorCycleGradients, 'ensureForegroundGradientSlot')
      .mockReturnValue(null);

    const commitCommittedLayerState = jest.fn();
    const scheduleDeferredColorCycleSaveWithState = jest.fn(async () => undefined);
    const logError = jest.fn();
    const getStateSpy = jest.spyOn(useAppStore, 'getState');
    getStateSpy.mockReturnValue({
      layers: [
        {
          id: 'layer-1',
          transparencyLocked: false,
          layerType: 'color-cycle',
          colorCycleData: {
            fgActiveSlot: undefined,
            slotPalettes: [],
          },
        },
      ],
      tools: {
        brushSettings: {
          colorCycleUseForegroundGradient: true,
          ditherEnabled: false,
        },
      },
      setCcGradientSampleCount: jest.fn(),
      updateLayer: jest.fn(),
    } as unknown as ReturnType<typeof useAppStore.getState>);

    const canvas = document.createElement('canvas');
    canvas.width = 2;
    canvas.height = 2;

    const session: MarkGradientSession = {
      markId: 'mark-fg-linear',
      layerId: 'layer-1',
      markKind: 'shape',
      gradientKind: 'linear',
      source: 'fg',
      frozenStopsStored: [
        { position: 0, color: '#101010' },
        { position: 1, color: '#f0f0f0' },
      ],
      frozenHash: 'hash-fg-linear',
      binding: null,
      speedCps: null,
    };

    await finalizeColorCycleShapeFillLinear(
      {
        session,
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
          fillCcGradientLinear: jest.fn(async () => undefined),
          updateColorCycleTexture: jest.fn(),
        } as never,
        getColorCycleBrushManager: () => ({
          getBrush: () => ({ commitCommittedLayerState }) as never,
        }),
        bindBrushToCanvas: jest.fn(),
        timeAsync: async (_label, task) => task(),
        timeSync: (_label, task) => task(),
        ccLog: jest.fn(),
        scheduleDeferredColorCycleSaveWithState,
        logError,
      }
    );

    expect(commitCommittedLayerState).toHaveBeenCalled();
    expect(scheduleDeferredColorCycleSaveWithState).toHaveBeenCalled();
    expect(ensureForegroundGradientSlotSpy).toHaveBeenCalledTimes(2);
    expect(ensureForegroundGradientSlotSpy).toHaveBeenCalledWith('layer-1');
    expect(logError).toHaveBeenCalledWith(
      '[CC] Missing foreground runtime palette after linear shape finalize; continuing commit.'
    );

    getStateSpy.mockRestore();
  });

  it('continues concentric finalize when foreground runtime refresh still cannot allocate a slot', async () => {
    const ensureForegroundGradientSlotSpy = jest
      .spyOn(colorCycleGradients, 'ensureForegroundGradientSlot')
      .mockReturnValue(null);

    const commitCommittedLayerState = jest.fn();
    const scheduleDeferredColorCycleSaveWithState = jest.fn(async () => undefined);
    const logError = jest.fn();
    const getStateSpy = jest.spyOn(useAppStore, 'getState');
    getStateSpy.mockReturnValue({
      layers: [
        {
          id: 'layer-1',
          transparencyLocked: false,
          layerType: 'color-cycle',
          colorCycleData: {
            fgActiveSlot: undefined,
            slotPalettes: [],
          },
        },
      ],
      tools: {
        brushSettings: {
          colorCycleUseForegroundGradient: true,
          ditherEnabled: false,
        },
      },
      setCcGradientSampleCount: jest.fn(),
      updateLayer: jest.fn(),
    } as unknown as ReturnType<typeof useAppStore.getState>);

    const canvas = document.createElement('canvas');
    canvas.width = 2;
    canvas.height = 2;

    const session: MarkGradientSession = {
      markId: 'mark-fg-concentric',
      layerId: 'layer-1',
      markKind: 'shape',
      gradientKind: 'concentric',
      source: 'fg',
      frozenStopsStored: [
        { position: 0, color: '#202020' },
        { position: 1, color: '#fafafa' },
      ],
      frozenHash: 'hash-fg-concentric',
      binding: null,
      speedCps: null,
    };

    await finalizeColorCycleShapeFillConcentric(
      {
        session,
        shapePoints: [
          { x: 0, y: 0 },
          { x: 1, y: 0 },
          { x: 0, y: 1 },
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
      },
      {
        brushEngine: {
          fillCcGradientConcentric: jest.fn(async () => undefined),
          updateColorCycleTexture: jest.fn(),
        } as never,
        getColorCycleBrushManager: () => ({
          getBrush: () => ({ commitCommittedLayerState }) as never,
        }),
        bindBrushToCanvas: jest.fn(),
        timeAsync: async (_label, task) => task(),
        timeSync: (_label, task) => task(),
        ccLog: jest.fn(),
        scheduleDeferredColorCycleSaveWithState,
        logError,
      }
    );

    expect(commitCommittedLayerState).toHaveBeenCalled();
    expect(scheduleDeferredColorCycleSaveWithState).toHaveBeenCalled();
    expect(ensureForegroundGradientSlotSpy).toHaveBeenCalledTimes(2);
    expect(ensureForegroundGradientSlotSpy).toHaveBeenCalledWith('layer-1');
    expect(logError).toHaveBeenCalledWith(
      '[CC] Missing foreground runtime palette after concentric shape finalize; continuing commit.'
    );

    getStateSpy.mockRestore();
  });

});
