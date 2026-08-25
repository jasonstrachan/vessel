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
  requestGradientApply: jest.fn(),
  flushGradientApply: jest.fn(),
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
      }],
    });
    manager = {
      deleteBrush: jest.fn(),
      getInitBrush: jest.fn(() => ({})),
      getFillBrush: jest.fn(() => ({})),
    };
    mockedGetManager.mockReturnValue(manager as never);
    mockedInitialize.mockReturnValue({} as never);
    mockedFillLinear.mockResolvedValue(undefined);
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
    const result = await autoConvertActiveImageToColorCycle({ targetShapes: 24, detail: 50 });

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
  });

  it('removes the temporary CC layer and preserves history when painting fails', async () => {
    mockedFillLinear.mockRejectedValueOnce(new Error('paint failed'));

    await expect(
      autoConvertActiveImageToColorCycle({ targetShapes: 24, detail: 50 }),
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
    const conversion = autoConvertActiveImageToColorCycle({ targetShapes: 24, detail: 50 });
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
      autoConvertActiveImageToColorCycle({ targetShapes: 24, detail: 50 }),
    ).rejects.toThrow('paint failed');

    expect(state.layers.map((layer) => layer.id)).toEqual([sourceLayer.id, extraLayer.id]);
    expect(mockedCommitHistory).not.toHaveBeenCalled();
  });

  it('rolls back instead of committing an empty layer when the fill brush is unavailable', async () => {
    manager.getFillBrush.mockReturnValue(null);

    await expect(
      autoConvertActiveImageToColorCycle({ targetShapes: 24, detail: 50 }),
    ).rejects.toThrow('Unable to initialize the new Color Cycle fill brush');

    expect(state.layers).toEqual([sourceLayer]);
    expect(mockedFillLinear).not.toHaveBeenCalled();
    expect(mockedCommitHistory).not.toHaveBeenCalled();
  });

  it('aborts before insertion when the source changes during image analysis', async () => {
    let resolveRegions!: (value: Awaited<ReturnType<typeof runAutoConvertRegionsJob>>) => void;
    mockedRunRegions.mockReturnValueOnce(new Promise((resolve) => {
      resolveRegions = resolve;
    }));
    const conversion = autoConvertActiveImageToColorCycle({ targetShapes: 24, detail: 50 });
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
      }],
    });

    await expect(conversion).rejects.toThrow('The selected image layer changed during conversion');

    expect(state.layers).toEqual([sourceLayer]);
    expect(mockedInitialize).not.toHaveBeenCalled();
    expect(mockedCommitHistory).not.toHaveBeenCalled();
  });
});
