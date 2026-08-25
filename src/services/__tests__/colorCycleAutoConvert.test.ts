import type { Layer } from '@/types';
import { createDefaultLayerAlignment } from '@/utils/layoutDefaults';

import { autoConvertActiveImageToColorCycle } from '@/services/colorCycleAutoConvert';
import { getAppStoreState } from '@/stores/appStoreAccess';
import { getColorCycleBrushManager } from '@/stores/colorCycleBrushManager';
import { clearColorCycleRegion } from '@/stores/helpers/colorCycleSelection';
import {
  captureLayerStructureSnapshot,
  commitLayerStructureHistory,
} from '@/stores/helpers/layerStructureHistory';
import { resolveLayerImageData } from '@/stores/helpers/selectionCapture';
import { initializeColorCycleBrushForActiveLayer } from '@/hooks/brushEngine/colorCycleInitController';
import { fillColorCycleLinear } from '@/hooks/brushEngine/colorCycleFillController';
import { applyRuntimeToBrush } from '@/hooks/brushEngine/ccGradientApplyScheduler';
import { resolveMarkSessionRuntimeStops } from '@/hooks/canvas/utils/colorCycleMarkSession';
import { ensureGradientDefForStops } from '@/utils/colorCycleGradientDefs';
import { runAutoConvertRegionsJob } from '@/workers/colorCycleFillClient';

jest.mock('@/stores/appStoreAccess', () => ({ getAppStoreState: jest.fn() }));
jest.mock('@/stores/colorCycleBrushManager', () => ({ getColorCycleBrushManager: jest.fn() }));
jest.mock('@/stores/helpers/colorCycleSelection', () => ({ clearColorCycleRegion: jest.fn() }));
jest.mock('@/stores/helpers/layerStructureHistory', () => ({
  captureLayerStructureSnapshot: jest.fn(),
  commitLayerStructureHistory: jest.fn(),
}));
jest.mock('@/stores/helpers/selectionCapture', () => ({ resolveLayerImageData: jest.fn() }));
jest.mock('@/stores/useAppStore', () => ({ useAppStore: { setState: jest.fn() } }));
jest.mock('@/hooks/brushEngine/colorCycleInitController', () => ({
  initializeColorCycleBrushForActiveLayer: jest.fn(),
}));
jest.mock('@/hooks/brushEngine/colorCycleFillController', () => ({
  fillColorCycleLinear: jest.fn(),
  fillColorCycleConcentric: jest.fn(),
}));
jest.mock('@/hooks/brushEngine/colorCycleSurface', () => ({ renderBrushToLayerCanvas: jest.fn() }));
jest.mock('@/hooks/brushEngine/ccGradientApplyScheduler', () => ({
  applyRuntimeToBrush: jest.fn(),
  requestGradientApply: jest.fn(),
  flushGradientApply: jest.fn(),
}));
jest.mock('@/hooks/canvas/utils/colorCycleMarkSession', () => ({
  resolveMarkSessionRuntimeStops: jest.fn(),
}));
jest.mock('@/utils/colorCycleGradientDefs', () => ({
  ensureGradientDefForStops: jest.fn(),
}));
jest.mock('@/workers/colorCycleFillClient', () => ({ runAutoConvertRegionsJob: jest.fn() }));
jest.mock('@/utils/layerOwnedProjectObjects', () => ({
  composeLayerOwnedProjectObjectsIntoLayerSource: ({ source }: { source: CanvasImageSource }) => source,
}));

const mockedGetState = getAppStoreState as jest.MockedFunction<typeof getAppStoreState>;
const mockedGetManager = getColorCycleBrushManager as jest.MockedFunction<
  typeof getColorCycleBrushManager
>;
const mockedResolveLayerImageData = resolveLayerImageData as jest.MockedFunction<
  typeof resolveLayerImageData
>;
const mockedInitialize = initializeColorCycleBrushForActiveLayer as jest.MockedFunction<
  typeof initializeColorCycleBrushForActiveLayer
>;
const mockedFillLinear = fillColorCycleLinear as jest.MockedFunction<typeof fillColorCycleLinear>;
const mockedRunRegions = runAutoConvertRegionsJob as jest.MockedFunction<
  typeof runAutoConvertRegionsJob
>;
const mockedCommitHistory = commitLayerStructureHistory as jest.MockedFunction<
  typeof commitLayerStructureHistory
>;
const mockedCaptureSnapshot = captureLayerStructureSnapshot as jest.MockedFunction<
  typeof captureLayerStructureSnapshot
>;
const mockedClearRegion = clearColorCycleRegion as jest.MockedFunction<typeof clearColorCycleRegion>;
const mockedApplyRuntime = applyRuntimeToBrush as jest.MockedFunction<typeof applyRuntimeToBrush>;
const mockedResolveRuntimeStops = resolveMarkSessionRuntimeStops as jest.MockedFunction<
  typeof resolveMarkSessionRuntimeStops
>;
const mockedEnsureGradientDef = ensureGradientDefForStops as jest.MockedFunction<
  typeof ensureGradientDefForStops
>;

const createSourceLayer = (imageData: ImageData): Layer => {
  const canvas = document.createElement('canvas');
  canvas.width = imageData.width;
  canvas.height = imageData.height;
  return {
    id: 'source-layer',
    name: 'Portrait',
    visible: true,
    opacity: 1,
    blendMode: 'source-over',
    locked: false,
    transparencyLocked: false,
    order: 0,
    imageData,
    framebuffer: canvas,
    alignment: createDefaultLayerAlignment(),
    layerType: 'normal',
  };
};

describe('autoConvertActiveImageToColorCycle', () => {
  let state: ReturnType<typeof getAppStoreState>;
  let sourceImage: ImageData;
  let sourceLayer: Layer;
  let manager: {
    deleteBrush: jest.Mock;
    getInitBrush: jest.Mock;
    getFillBrush: jest.Mock;
    getGradientApplyBrush: jest.Mock;
  };
  let getContextSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    sourceImage = new ImageData(4, 4);
    for (let index = 0; index < 16; index += 1) {
      sourceImage.data[index * 4] = 220;
      sourceImage.data[index * 4 + 3] = 255;
    }
    sourceLayer = createSourceLayer(sourceImage);
    const mutableState = {
      project: {
        id: 'project-1',
        width: 4,
        height: 4,
        txtShapes: [],
        uiShapes: [],
      },
      layers: [sourceLayer],
      activeLayerId: sourceLayer.id,
      selectedLayerIds: [sourceLayer.id],
      tools: {
        brushSettings: {
          opacity: 1,
          blendMode: 'source-over',
          colorCycleFillMode: 'linear',
          colorCycleGradient: [
            { position: 0, color: '#ff0000' },
            { position: 1, color: '#0000ff' },
          ],
          gradientBands: 4,
          fillResolution: 2,
          ccGradientSource: 'manual',
          ditherEnabled: true,
          ditherPaletteSpread: 24,
          ccGradientRangeContrast: 68,
          ditherAlgorithm: 'sierra-lite',
          ccFlatCycleDither: false,
          ditherGradBgFill: true,
        },
      },
      colorCyclePlayback: { playbackSpeedScale: 1 },
      setLayers: jest.fn((layers: Layer[]) => {
        mutableState.layers = layers;
      }),
      initColorCycleForLayer: jest.fn(),
      setActiveLayer: jest.fn((layerId: string | null) => {
        mutableState.activeLayerId = layerId ?? sourceLayer.id;
      }),
      setSelectedLayerIds: jest.fn((layerIds: string[]) => {
        mutableState.selectedLayerIds = layerIds;
      }),
      markAllCompositeSegmentsDirty: jest.fn(),
    };
    state = mutableState as unknown as ReturnType<typeof getAppStoreState>;
    mockedGetState.mockImplementation(() => state);
    mockedResolveLayerImageData.mockReturnValue(sourceImage);
    mockedRunRegions.mockResolvedValue({
      analysisWidth: 4,
      analysisHeight: 4,
      regions: [{
        points: [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 4 }, { x: 0, y: 4 }],
        direction: { x: 2, y: 0 },
        linearGradientSpan: 4,
        sampledStops: [
          { position: 0, color: '#dc0000' },
          { position: 1, color: '#dc0000' },
        ],
        pixelCount: 16,
        detailScore: 0.5,
      }],
    });
    manager = {
      deleteBrush: jest.fn(),
      getInitBrush: jest.fn(() => ({})),
      getFillBrush: jest.fn(() => ({})),
      getGradientApplyBrush: jest.fn(() => ({})),
    };
    mockedGetManager.mockReturnValue(manager as never);
    mockedInitialize.mockReturnValue({} as never);
    mockedFillLinear.mockResolvedValue(undefined);
    mockedResolveRuntimeStops.mockImplementation((_session, stops, overrides) =>
      stops.map((stop) => ({
        ...stop,
        color: overrides?.enabled === false ? `source:${stop.color}` : `runtime:${stop.color}`,
      })),
    );
    mockedEnsureGradientDef.mockImplementation(({ stops, sourceStops }) => ({
      def: {
        id: 7,
        kind: 'linear',
        stops: stops.map((stop) => ({ ...stop })),
        sourceStops: sourceStops?.map((stop) => ({ ...stop })),
        hash: 'linear:test',
        source: 'sampled',
        createdAtMs: 1,
        slot: 11,
      },
      slot: 11,
      hash: 'linear:test',
    }));
    mockedCaptureSnapshot
      .mockReturnValueOnce({ snapshot: { layers: [] } } as never)
      .mockReturnValueOnce({ snapshot: { layers: [] } } as never);
    mockedClearRegion.mockReturnValue(true);
    const context = {
      putImageData: jest.fn(),
      getImageData: jest.fn(() => sourceImage),
      clearRect: jest.fn(),
      drawImage: jest.fn(),
    };
    getContextSpy = jest
      .spyOn(HTMLCanvasElement.prototype, 'getContext')
      .mockReturnValue(context as never);
  });

  afterEach(() => {
    getContextSpy.mockRestore();
  });

  it('keeps the source and commits one new CC layer as one history action', async () => {
    const result = await autoConvertActiveImageToColorCycle({
      targetShapes: 24,
      focus: 50,
      resolutionRange: [1, 8],
    });

    expect(result.shapeCount).toBe(1);
    expect(state.layers).toHaveLength(2);
    expect(state.layers[0]).toMatchObject({ id: sourceLayer.id, layerType: 'normal' });
    expect(state.layers[0].imageData).toBe(sourceImage);
    expect(state.layers[1]).toMatchObject({ id: result.layerId, layerType: 'color-cycle' });
    expect(state.activeLayerId).toBe(result.layerId);
    expect(state.selectedLayerIds).toEqual([result.layerId]);
    expect(mockedCommitHistory).toHaveBeenCalledTimes(1);
    expect(mockedCommitHistory).toHaveBeenCalledWith(expect.objectContaining({
      label: 'Auto Convert to Color Cycle',
    }));
    expect(mockedFillLinear).toHaveBeenCalledWith(expect.objectContaining({
      options: expect.objectContaining({
        ditherSampledStops: [
          { position: 0, color: 'source:#dc0000' },
          { position: 1, color: 'source:#dc0000' },
        ],
        paintSlotOverride: 11,
        paintDefIdOverride: 7,
      }),
    }));
  });

  it('reports analysis and painting progress without changing conversion behavior', async () => {
    const onProgress = jest.fn();

    await autoConvertActiveImageToColorCycle({
      targetShapes: 24,
      focus: 50,
      resolutionRange: [1, 8],
      onProgress,
    });

    expect(onProgress.mock.calls.map(([progress]) => progress)).toEqual([
      { phase: 'analyzing' },
      { phase: 'painting', completed: 0, total: 1 },
      { phase: 'painting', completed: 1, total: 1 },
    ]);
  });

  it('does not clip converted contours to transparent source pixels', async () => {
    sourceImage.data[3] = 0;

    await autoConvertActiveImageToColorCycle({
      targetShapes: 24,
      focus: 50,
      resolutionRange: [1, 8],
    });

    expect(mockedFillLinear).toHaveBeenCalledWith(expect.objectContaining({
      vertices: [
        { x: 0, y: 0 },
        { x: 4, y: 0 },
        { x: 4, y: 4 },
        { x: 0, y: 4 },
      ],
    }));
    expect(mockedClearRegion).not.toHaveBeenCalled();
  });

  it('clamps shape and focus requests at their supported maxima', async () => {
    await autoConvertActiveImageToColorCycle({
      targetShapes: 9999,
      focus: 999,
      resolutionRange: [1, 8],
    });

    expect(mockedRunRegions).toHaveBeenCalledWith(expect.objectContaining({
      targetShapes: 1000,
      focus: 100,
    }));
  });

  it('binds distinct image-derived gradients and phase seeds to every converted shape', async () => {
    mockedRunRegions.mockResolvedValueOnce({
      analysisWidth: 4,
      analysisHeight: 4,
      regions: [
        {
          points: [{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 4 }, { x: 0, y: 4 }],
          direction: { x: 1, y: 0 },
          linearGradientSpan: 2,
          sampledStops: [
            { position: 0, color: '#ff0000' },
            { position: 1, color: '#aa0000' },
          ],
          pixelCount: 8,
          detailScore: 0.9,
        },
        {
          points: [{ x: 2, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 4 }, { x: 2, y: 4 }],
          direction: { x: 1, y: 0 },
          linearGradientSpan: 2,
          sampledStops: [
            { position: 0, color: '#0000ff' },
            { position: 1, color: '#000088' },
          ],
          pixelCount: 8,
          detailScore: 0.1,
        },
      ],
    });
    mockedEnsureGradientDef
      .mockImplementationOnce(({ stops, sourceStops }) => ({
        def: {
          id: 21,
          kind: 'linear',
          stops,
          sourceStops,
          hash: 'linear:red',
          source: 'sampled',
          createdAtMs: 1,
          slot: 31,
        },
        slot: 31,
        hash: 'linear:red',
      }))
      .mockImplementationOnce(({ stops, sourceStops }) => ({
        def: {
          id: 22,
          kind: 'linear',
          stops,
          sourceStops,
          hash: 'linear:blue',
          source: 'sampled',
          createdAtMs: 2,
          slot: 32,
        },
        slot: 32,
        hash: 'linear:blue',
      }));

    await autoConvertActiveImageToColorCycle({
      targetShapes: 2,
      focus: 50,
      resolutionRange: [1, 8],
    });

    expect(mockedEnsureGradientDef).toHaveBeenNthCalledWith(1, expect.objectContaining({
      source: 'sampled',
      stops: [
        { position: 0, color: 'runtime:#ff0000' },
        { position: 1, color: 'runtime:#aa0000' },
      ],
      sourceStops: [
        { position: 0, color: '#ff0000' },
        { position: 1, color: '#aa0000' },
      ],
    }));
    expect(mockedEnsureGradientDef).toHaveBeenNthCalledWith(2, expect.objectContaining({
      source: 'sampled',
      stops: [
        { position: 0, color: 'runtime:#0000ff' },
        { position: 1, color: 'runtime:#000088' },
      ],
      sourceStops: [
        { position: 0, color: '#0000ff' },
        { position: 1, color: '#000088' },
      ],
    }));
    expect(mockedResolveRuntimeStops).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ source: 'sampled', isRuntimePalette: false }),
      [
        { position: 0, color: '#ff0000' },
        { position: 1, color: '#aa0000' },
      ],
      expect.objectContaining({
        enabled: true,
        pairBandCount: 3,
        spread: 24,
        rangeContrast: 68,
        algorithm: 'sierra-lite',
        useDitherRenderPalette: true,
        fillBackground: true,
      }),
    );
    expect(mockedApplyRuntime).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      expect.any(String),
      expect.objectContaining({ paintSlot: 31 }),
    );
    expect(mockedApplyRuntime).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      expect.any(String),
      expect.objectContaining({ paintSlot: 32 }),
    );
    expect(mockedFillLinear).toHaveBeenNthCalledWith(1, expect.objectContaining({
      options: expect.objectContaining({ paintSlotOverride: 31, paintDefIdOverride: 21 }),
    }));
    expect(mockedFillLinear).toHaveBeenNthCalledWith(2, expect.objectContaining({
      options: expect.objectContaining({ paintSlotOverride: 32, paintDefIdOverride: 22 }),
    }));
    const phaseSeeds = mockedFillLinear.mock.calls.map(
      ([call]) => call.options?.shapePhaseSeedMarkId,
    );
    expect(phaseSeeds).toHaveLength(2);
    expect(phaseSeeds.every((seed) => typeof seed === 'string' && seed.length > 0)).toBe(true);
    expect(new Set(phaseSeeds).size).toBe(2);
  });

  it('uses the reused runtime palette as the dither source when sampled capacity is exhausted', async () => {
    mockedEnsureGradientDef.mockReturnValueOnce({
      def: {
        id: 41,
        kind: 'linear',
        stops: [
          { position: 0, color: '#118811' },
          { position: 1, color: '#004400' },
        ],
        sourceStops: [
          { position: 0, color: '#118811' },
          { position: 1, color: '#004400' },
        ],
        hash: 'linear:reused',
        source: 'sampled',
        createdAtMs: 1,
        slot: 51,
      },
      slot: 51,
      hash: 'linear:reused',
      reusedForCapacity: true,
    });

    await autoConvertActiveImageToColorCycle({
      targetShapes: 24,
      focus: 50,
      resolutionRange: [1, 8],
    });

    expect(mockedFillLinear).toHaveBeenCalledWith(expect.objectContaining({
      options: expect.objectContaining({
        ditherSampledStops: [
          { position: 0, color: '#118811' },
          { position: 1, color: '#004400' },
        ],
        paintSlotOverride: 51,
        paintDefIdOverride: 41,
      }),
    }));
  });

  it('clusters more than 240 shape gradients onto image-derived representatives', async () => {
    const regions = Array.from({ length: 242 }, (_, index) => {
      const color = `#${index.toString(16).padStart(2, '0')}0000`;
      return {
        points: [
          { x: index, y: 0 },
          { x: index + 1, y: 0 },
          { x: index + 1, y: 1 },
        ],
        direction: { x: 1, y: 0 },
        linearGradientSpan: 1,
        sampledStops: [
          { position: 0, color },
          { position: 1, color },
        ],
        pixelCount: 242 - index,
        detailScore: index / 241,
      };
    });
    mockedRunRegions.mockResolvedValueOnce({
      analysisWidth: 242,
      analysisHeight: 1,
      regions,
    });

    await autoConvertActiveImageToColorCycle({
      targetShapes: 242,
      focus: 100,
      resolutionRange: [1, 8],
    });

    const sourceSignatures = new Set(regions.map((region) => JSON.stringify(region.sampledStops)));
    const committedSignatures = mockedEnsureGradientDef.mock.calls.map(([call]) => (
      JSON.stringify(call.sourceStops)
    ));
    expect(new Set(committedSignatures).size).toBeLessThanOrEqual(240);
    expect(committedSignatures.every((signature) => sourceSignatures.has(signature))).toBe(true);
  });

  it('maps measured detail across the requested resolution range', async () => {
    const createRegion = (detailScore: number, pixelCount: number, pointCount: number) => ({
      points: Array.from({ length: pointCount }, (_, index) => ({ x: index, y: index % 2 })),
      direction: { x: 1, y: 0 },
      linearGradientSpan: 4,
      sampledStops: [
        { position: 0, color: '#111111' },
        { position: 1, color: '#eeeeee' },
      ],
      pixelCount,
      detailScore,
    });
    mockedRunRegions.mockResolvedValueOnce({
      analysisWidth: 8,
      analysisHeight: 8,
      regions: [
        createRegion(0.05, 8, 8),
        createRegion(0.95, 64, 4),
        createRegion(0.25, 24, 5),
        createRegion(0.65, 40, 6),
      ],
    });

    await autoConvertActiveImageToColorCycle({
      targetShapes: 4,
      focus: 100,
      resolutionRange: [2, 10],
    });

    expect(mockedFillLinear).toHaveBeenCalledTimes(4);
    expect(mockedFillLinear.mock.calls.map(([call]) => call.options?.ditherPixelSize)).toEqual([
      10,
      2,
      2,
      2,
    ]);
  });

  it('keeps low Res values in detailed regions and reserves high Res for the flattest tail', async () => {
    const regions = Array.from({ length: 100 }, (_, index) => ({
      points: [
        { x: index, y: 0 },
        { x: index + 1, y: 0 },
        { x: index + 1, y: 1 },
      ],
      direction: { x: 1, y: 0 },
      linearGradientSpan: 1,
      sampledStops: [
        { position: 0, color: '#111111' },
        { position: 1, color: '#eeeeee' },
      ],
      pixelCount: 1,
      detailScore: 1 - index / 99,
    }));
    mockedRunRegions.mockResolvedValueOnce({
      analysisWidth: 100,
      analysisHeight: 1,
      regions,
    });

    await autoConvertActiveImageToColorCycle({
      targetShapes: 100,
      focus: 100,
      resolutionRange: [1, 8],
    });

    const resolutions = mockedFillLinear.mock.calls.map(
      ([call]) => call.options?.ditherPixelSize ?? 0,
    );
    expect(resolutions.filter((resolution) => resolution === 1).length).toBeGreaterThan(75);
    expect(resolutions.filter((resolution) => resolution === 8)).toHaveLength(1);
    expect(resolutions.every((resolution, index) => (
      index === 0 || resolution >= resolutions[index - 1]
    ))).toBe(true);
  });

  it('does not invent resolution differences when regions have equal measured detail', async () => {
    const regions = Array.from({ length: 4 }, (_, index) => ({
      points: [
        { x: index, y: 0 },
        { x: index + 1, y: 0 },
        { x: index + 1, y: 1 },
      ],
      direction: { x: 1, y: 0 },
      linearGradientSpan: 1,
      sampledStops: [
        { position: 0, color: '#777777' },
        { position: 1, color: '#777777' },
      ],
      pixelCount: 16,
      detailScore: 0,
    }));
    mockedRunRegions.mockResolvedValueOnce({
      analysisWidth: 8,
      analysisHeight: 8,
      regions,
    });

    await autoConvertActiveImageToColorCycle({
      targetShapes: 4,
      focus: 100,
      resolutionRange: [2, 10],
    });

    expect(mockedFillLinear.mock.calls.map(([call]) => call.options?.ditherPixelSize)).toEqual([
      10,
      10,
      10,
      10,
    ]);
  });

  it('removes the temporary CC layer and preserves history when painting fails', async () => {
    mockedFillLinear.mockRejectedValueOnce(new Error('paint failed'));

    await expect(
      autoConvertActiveImageToColorCycle({
        targetShapes: 24,
        focus: 50,
        resolutionRange: [1, 8],
      }),
    ).rejects.toThrow('paint failed');

    expect(manager.deleteBrush).toHaveBeenCalledTimes(1);
    expect(state.layers).toEqual([sourceLayer]);
    expect(state.activeLayerId).toBe(sourceLayer.id);
    expect(state.selectedLayerIds).toEqual([sourceLayer.id]);
    expect(mockedCommitHistory).not.toHaveBeenCalled();
  });

  it('preserves layers added while image analysis is running', async () => {
    let resolveRegions!: (value: Awaited<ReturnType<typeof runAutoConvertRegionsJob>>) => void;
    mockedRunRegions.mockReturnValueOnce(new Promise((resolve) => {
      resolveRegions = resolve;
    }));
    const conversion = autoConvertActiveImageToColorCycle({
      targetShapes: 24,
      focus: 50,
      resolutionRange: [1, 8],
    });
    const extraLayer = { ...sourceLayer, id: 'extra-layer', name: 'Extra' };
    state.layers = [sourceLayer, extraLayer];
    resolveRegions({
      analysisWidth: 4,
      analysisHeight: 4,
      regions: [{
        points: [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 4 }, { x: 0, y: 4 }],
        direction: { x: 2, y: 0 },
        linearGradientSpan: 4,
        sampledStops: [
          { position: 0, color: '#dc0000' },
          { position: 1, color: '#dc0000' },
        ],
        pixelCount: 16,
        detailScore: 0.5,
      }],
    });

    const result = await conversion;

    expect(state.layers.map((layer) => layer.id)).toEqual([
      sourceLayer.id,
      result.layerId,
      extraLayer.id,
    ]);
  });

  it('removes only the temporary layer when painting fails after another layer is added', async () => {
    const extraLayer = { ...sourceLayer, id: 'extra-layer', name: 'Extra' };
    mockedFillLinear.mockImplementationOnce(async () => {
      state.layers = [...state.layers, extraLayer];
      throw new Error('paint failed');
    });

    await expect(
      autoConvertActiveImageToColorCycle({
        targetShapes: 24,
        focus: 50,
        resolutionRange: [1, 8],
      }),
    ).rejects.toThrow('paint failed');

    expect(state.layers.map((layer) => layer.id)).toEqual([sourceLayer.id, extraLayer.id]);
    expect(mockedCommitHistory).not.toHaveBeenCalled();
  });

  it('rolls back instead of committing an empty layer when the fill brush is unavailable', async () => {
    manager.getFillBrush.mockReturnValue(null);

    await expect(
      autoConvertActiveImageToColorCycle({
        targetShapes: 24,
        focus: 50,
        resolutionRange: [1, 8],
      }),
    ).rejects.toThrow('Unable to initialize the new Color Cycle fill brush');

    expect(state.layers).toEqual([sourceLayer]);
    expect(mockedFillLinear).not.toHaveBeenCalled();
    expect(mockedCommitHistory).not.toHaveBeenCalled();
  });

  it('rolls back instead of painting when the gradient brush is unavailable', async () => {
    manager.getGradientApplyBrush.mockReturnValue(null);

    await expect(
      autoConvertActiveImageToColorCycle({
        targetShapes: 24,
        focus: 50,
        resolutionRange: [1, 8],
      }),
    ).rejects.toThrow('Unable to initialize the new Color Cycle gradient brush');

    expect(state.layers).toEqual([sourceLayer]);
    expect(mockedEnsureGradientDef).not.toHaveBeenCalled();
    expect(mockedFillLinear).not.toHaveBeenCalled();
    expect(mockedCommitHistory).not.toHaveBeenCalled();
  });

  it('aborts before insertion when the source changes during image analysis', async () => {
    let resolveRegions!: (value: Awaited<ReturnType<typeof runAutoConvertRegionsJob>>) => void;
    mockedRunRegions.mockReturnValueOnce(new Promise((resolve) => {
      resolveRegions = resolve;
    }));
    const conversion = autoConvertActiveImageToColorCycle({
      targetShapes: 24,
      focus: 50,
      resolutionRange: [1, 8],
    });
    sourceLayer.version = 2;
    resolveRegions({
      analysisWidth: 4,
      analysisHeight: 4,
      regions: [{
        points: [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 4 }, { x: 0, y: 4 }],
        direction: { x: 2, y: 0 },
        linearGradientSpan: 4,
        sampledStops: [
          { position: 0, color: '#dc0000' },
          { position: 1, color: '#dc0000' },
        ],
        pixelCount: 16,
        detailScore: 0.5,
      }],
    });

    await expect(conversion).rejects.toThrow('The selected image layer changed during conversion');

    expect(state.layers).toEqual([sourceLayer]);
    expect(mockedInitialize).not.toHaveBeenCalled();
    expect(mockedCommitHistory).not.toHaveBeenCalled();
  });
});
