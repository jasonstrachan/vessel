import type { Layer } from '@/types';
import { registerColorCycleBrushLayerSnapshotRuntime } from '@/lib/colorCycle/document';
import { createDefaultLayerAlignment } from '@/utils/layoutDefaults';

const mockStoreState = {
  layers: [] as Layer[],
  project: { width: 2, height: 2 },
  updateLayer: jest.fn(),
  setLayersNeedRecomposition: jest.fn(),
};

const mockBrushManager = {
  validateColorCycleBrush: jest.fn(),
  initColorCycleForLayer: jest.fn(),
  getHistoryBrush: jest.fn(),
  deleteBrush: jest.fn(),
};

const clearSequentialLayerRendererLayer = jest.fn();

jest.mock('@/lib/sequential/SequentialLayerRenderer', () => ({
  __esModule: true,
  clearSequentialLayerRendererLayer,
}));

jest.mock('@/stores/useAppStore', () => ({
  __esModule: true,
  useAppStore: {
    getState: () => mockStoreState,
  },
}));

jest.mock('@/stores/colorCycleBrushManager', () => ({
  __esModule: true,
  getColorCycleBrushManager: () => mockBrushManager,
}));

const { rehydrateEntryResources, createRehydrationTargets } = jest.requireActual('@/history/runtimeRehydration') as typeof import('@/history/runtimeRehydration');

const makeLayer = (canvas: HTMLCanvasElement, canvasImageData: ImageData): Layer => ({
  id: 'cc-layer',
  name: 'CC Layer',
  visible: true,
  opacity: 1,
  blendMode: 'source-over',
  locked: false,
  transparencyLocked: false,
  order: 0,
  imageData: null,
  framebuffer: canvas,
  alignment: createDefaultLayerAlignment(),
  layerType: 'color-cycle',
  colorCycleData: {
    canvas,
    canvasImageData,
    canvasWidth: 2,
    canvasHeight: 2,
    mode: 'brush',
    brushState: {
      layers: [{
        layerId: 'cc-layer',
        strokeData: {
          paintBuffer: new Uint8Array([1, 2, 3, 4]).buffer,
          gradientIdBuffer: new Uint8Array([4, 3, 2, 1]).buffer,
          hasContent: true,
          strokeCounter: 3,
        },
      }],
    },
  },
});

const createRuntimeBrush = () => {
  const applySnapshot = jest.fn();
  const brush = {
    setTargetCanvas: jest.fn(),
    updateColorCycleTexture: jest.fn(),
    renderDirectToCanvas: jest.fn(),
  };
  registerColorCycleBrushLayerSnapshotRuntime(brush, {
    apply: applySnapshot,
  });
  return { brush, applySnapshot };
};

describe('runtimeRehydration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockStoreState.layers = [];
  });

  it('does not overwrite a restored color-cycle brush surface with compatibility pixels', async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 2;
    canvas.height = 2;
    const ctx = canvas.getContext('2d')!;
    const putImageDataSpy = jest.spyOn(ctx, 'putImageData');
    const compatibilityImageData = new ImageData(2, 2);
    const layer = makeLayer(canvas, compatibilityImageData);
    const { brush, applySnapshot } = createRuntimeBrush();
    mockStoreState.layers = [layer];
    mockBrushManager.validateColorCycleBrush.mockReturnValue(true);
    mockBrushManager.getHistoryBrush.mockReturnValue(brush);

    const targets = createRehydrationTargets();
    targets.layerIds.add(layer.id);
    targets.colorCycleLayerIds.add(layer.id);
    await rehydrateEntryResources(
      { id: 'entry', action: 'layer-structure', label: 'test', ts: 1, docId: 'doc', deltas: [] },
      'backward',
      targets,
    );

    expect(applySnapshot).toHaveBeenCalled();
    const [appliedLayerId, appliedSnapshot] = applySnapshot.mock.calls[0];
    expect(appliedLayerId).toBe(layer.id);
    expect(appliedSnapshot).toEqual(expect.objectContaining({
      paintBuffer: expect.any(ArrayBuffer),
      hasContent: true,
      strokeCounter: 3,
    }));
    expect(brush.renderDirectToCanvas).toHaveBeenCalledWith(canvas, layer.id);
    expect(mockStoreState.updateLayer).toHaveBeenCalledWith(
      layer.id,
      expect.objectContaining({
        colorCycleData: expect.objectContaining({
          hasContent: true,
        }),
      }),
      { skipColorCycleSync: true },
    );
    expect(putImageDataSpy).not.toHaveBeenCalled();
  });

  it('does not overwrite a replayed color-cycle shape patch with compatibility pixels', async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 2;
    canvas.height = 2;
    const ctx = canvas.getContext('2d')!;
    const putImageDataSpy = jest.spyOn(ctx, 'putImageData');
    const staleCompatibilityImageData = new ImageData(2, 2);
    staleCompatibilityImageData.data[3] = 255;
    const layer = makeLayer(canvas, staleCompatibilityImageData);
    mockStoreState.layers = [layer];
    mockBrushManager.validateColorCycleBrush.mockReturnValue(true);

    const targets = createRehydrationTargets();
    targets.layerIds.add(layer.id);
    targets.colorCycleLayerIds.add(layer.id);
    await rehydrateEntryResources(
      { id: 'entry', action: 'fill', label: 'test', ts: 1, docId: 'doc', deltas: [] },
      'backward',
      targets,
    );

    expect(putImageDataSpy).not.toHaveBeenCalled();
    expect(mockStoreState.setLayersNeedRecomposition).toHaveBeenCalled();
  });

  it('restores compatibility pixels for a static layer-structure snapshot', async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 2;
    canvas.height = 2;
    const ctx = canvas.getContext('2d')!;
    const putImageDataSpy = jest.spyOn(ctx, 'putImageData');
    const compatibilityImageData = new ImageData(2, 2);
    compatibilityImageData.data[3] = 255;
    const layer = makeLayer(canvas, compatibilityImageData);
    layer.colorCycleData = {
      ...layer.colorCycleData!,
      brushState: null,
    };
    mockStoreState.layers = [layer];
    mockBrushManager.validateColorCycleBrush.mockReturnValue(true);

    const targets = createRehydrationTargets();
    targets.layerIds.add(layer.id);
    targets.colorCycleLayerIds.add(layer.id);
    await rehydrateEntryResources(
      { id: 'entry', action: 'layer-structure', label: 'test', ts: 1, docId: 'doc', deltas: [] },
      'backward',
      targets,
    );

    expect(putImageDataSpy).toHaveBeenCalledWith(compatibilityImageData, 0, 0);
  });

  it('does not overwrite a valid live brush with an all-zero serialized brush state', async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 2;
    canvas.height = 2;
    const ctx = canvas.getContext('2d')!;
    const putImageDataSpy = jest.spyOn(ctx, 'putImageData');
    const layer = makeLayer(canvas, new ImageData(2, 2));
    layer.colorCycleData = {
      ...layer.colorCycleData!,
      hasContent: true,
      brushState: {
        layers: [{
          layerId: layer.id,
          strokeData: {
            paintBuffer: new Uint8Array([0, 0, 0, 0]).buffer,
            gradientIdBuffer: new Uint8Array([0, 0, 0, 0]).buffer,
            hasContent: false,
            strokeCounter: 0,
          },
        }],
      },
    };
    const { brush, applySnapshot } = createRuntimeBrush();
    mockStoreState.layers = [layer];
    mockBrushManager.validateColorCycleBrush.mockReturnValue(true);
    mockBrushManager.getHistoryBrush.mockReturnValue(brush);

    const targets = createRehydrationTargets();
    targets.layerIds.add(layer.id);
    targets.colorCycleLayerIds.add(layer.id);
    await rehydrateEntryResources(
      { id: 'entry', action: 'layer-structure', label: 'test', ts: 1, docId: 'doc', deltas: [] },
      'backward',
      targets,
    );

    expect(applySnapshot).not.toHaveBeenCalled();
    expect(brush.renderDirectToCanvas).toHaveBeenCalledWith(canvas, layer.id);
    expect(mockStoreState.updateLayer).not.toHaveBeenCalled();
    expect(mockStoreState.setLayersNeedRecomposition).toHaveBeenCalled();
    expect(putImageDataSpy).not.toHaveBeenCalled();
  });

  it('does not repaint stale compatibility pixels when rejecting an empty serialized brush without a brush handle', async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 2;
    canvas.height = 2;
    const ctx = canvas.getContext('2d')!;
    const putImageDataSpy = jest.spyOn(ctx, 'putImageData');
    const staleImageData = new ImageData(2, 2);
    staleImageData.data[3] = 255;
    const layer = makeLayer(canvas, staleImageData);
    layer.colorCycleData = {
      ...layer.colorCycleData!,
      hasContent: true,
      brushState: {
        layers: [{
          layerId: layer.id,
          strokeData: {
            paintBuffer: new Uint8Array([0, 0, 0, 0]).buffer,
            hasContent: false,
            strokeCounter: 0,
          },
        }],
      },
    };
    mockStoreState.layers = [layer];
    mockBrushManager.validateColorCycleBrush.mockReturnValue(true);
    mockBrushManager.getHistoryBrush.mockReturnValue(null);

    const targets = createRehydrationTargets();
    targets.layerIds.add(layer.id);
    targets.colorCycleLayerIds.add(layer.id);
    await rehydrateEntryResources(
      { id: 'entry', action: 'layer-structure', label: 'test', ts: 1, docId: 'doc', deltas: [] },
      'backward',
      targets,
    );

    expect(mockStoreState.updateLayer).not.toHaveBeenCalled();
    expect(mockStoreState.setLayersNeedRecomposition).toHaveBeenCalled();
    expect(putImageDataSpy).not.toHaveBeenCalled();
  });

  it('does not apply an all-zero serialized brush state after brush reinit', async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 2;
    canvas.height = 2;
    const fallbackImageData = new ImageData(2, 2);
    fallbackImageData.data[3] = 255;
    const layer = makeLayer(canvas, fallbackImageData);
    layer.colorCycleData = {
      ...layer.colorCycleData!,
      hasContent: true,
      brushState: {
        layers: [{
          layerId: layer.id,
          strokeData: {
            paintBuffer: new Uint8Array([0, 0, 0, 0]).buffer,
            gradientIdBuffer: new Uint8Array([0, 0, 0, 0]).buffer,
            hasContent: false,
            strokeCounter: 0,
          },
        }],
      },
    };
    const { brush, applySnapshot } = createRuntimeBrush();
    mockStoreState.layers = [layer];
    mockBrushManager.validateColorCycleBrush.mockReturnValue(false);
    mockBrushManager.initColorCycleForLayer.mockReturnValue(true);
    mockBrushManager.getHistoryBrush.mockReturnValue(brush);

    const targets = createRehydrationTargets();
    targets.layerIds.add(layer.id);
    targets.colorCycleLayerIds.add(layer.id);
    await rehydrateEntryResources(
      { id: 'entry', action: 'layer-structure', label: 'test', ts: 1, docId: 'doc', deltas: [] },
      'backward',
      targets,
    );

    expect(mockBrushManager.initColorCycleForLayer).toHaveBeenCalledWith(layer.id, 2, 2, undefined);
    expect(applySnapshot).not.toHaveBeenCalled();
    expect(mockStoreState.updateLayer).not.toHaveBeenCalled();
    expect(mockStoreState.setLayersNeedRecomposition).toHaveBeenCalled();
  });

  it('applies an explicit empty serialized brush state to clear canonical runtime state', async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 2;
    canvas.height = 2;
    const layer = makeLayer(canvas, new ImageData(2, 2));
    layer.colorCycleData = {
      ...layer.colorCycleData!,
      hasContent: false,
      brushState: {
        layers: [{
          layerId: layer.id,
          strokeData: {
            paintBuffer: new Uint8Array([0, 0, 0, 0]).buffer,
            gradientIdBuffer: new Uint8Array([0, 0, 0, 0]).buffer,
            hasContent: false,
            strokeCounter: 0,
          },
        }],
      },
    };
    const { brush, applySnapshot } = createRuntimeBrush();
    mockStoreState.layers = [layer];
    mockBrushManager.validateColorCycleBrush.mockReturnValue(true);
    mockBrushManager.getHistoryBrush.mockReturnValue(brush);

    const targets = createRehydrationTargets();
    targets.layerIds.add(layer.id);
    targets.colorCycleLayerIds.add(layer.id);
    await rehydrateEntryResources(
      { id: 'entry', action: 'layer-structure', label: 'test', ts: 1, docId: 'doc', deltas: [] },
      'backward',
      targets,
    );

    expect(applySnapshot).toHaveBeenCalled();
    const [appliedLayerId, appliedSnapshot] = applySnapshot.mock.calls[0];
    expect(appliedLayerId).toBe(layer.id);
    expect(appliedSnapshot).toEqual(expect.objectContaining({
      paintBuffer: expect.any(ArrayBuffer),
      hasContent: false,
      strokeCounter: 0,
    }));
    expect(mockStoreState.updateLayer).toHaveBeenCalledWith(
      layer.id,
      expect.objectContaining({
        colorCycleData: expect.objectContaining({
          hasContent: false,
        }),
      }),
      { skipColorCycleSync: true },
    );
  });

  it('invalidates sequential materializer and presentation caches after replay', async () => {
    const targets = createRehydrationTargets();
    targets.layerIds.add('sequential-layer');
    targets.sequentialLayerIds.add('sequential-layer');

    await rehydrateEntryResources(
      { id: 'entry', action: 'sequential-stroke', label: 'test', ts: 1, docId: 'doc', deltas: [] },
      'backward',
      targets,
    );

    expect(clearSequentialLayerRendererLayer).toHaveBeenCalledWith('sequential-layer');
    expect(mockStoreState.setLayersNeedRecomposition).toHaveBeenCalled();
  });

  it('removes replay-target runtimes for color-cycle layers absent from restored state', async () => {
    const targets = createRehydrationTargets();
    targets.colorCycleLayerIds.add('removed-cc-layer');

    await rehydrateEntryResources(
      { id: 'entry', action: 'layer-structure', label: 'test', ts: 1, docId: 'doc', deltas: [] },
      'forward',
      targets,
    );

    expect(mockBrushManager.deleteBrush).toHaveBeenCalledWith('removed-cc-layer');
  });

  it('rejects replay when a required color-cycle runtime cannot be initialized', async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 2;
    canvas.height = 2;
    const layer = makeLayer(canvas, new ImageData(2, 2));
    mockStoreState.layers = [layer];
    mockBrushManager.validateColorCycleBrush.mockReturnValue(false);
    mockBrushManager.initColorCycleForLayer.mockReturnValue(false);

    const targets = createRehydrationTargets();
    targets.colorCycleLayerIds.add(layer.id);

    await expect(rehydrateEntryResources(
      { id: 'entry', action: 'layer-structure', label: 'test', ts: 1, docId: 'doc', deltas: [] },
      'backward',
      targets,
    )).rejects.toThrow(`initialize runtime for color-cycle layer ${layer.id}`);
  });

  it('rejects replay when canonical color-cycle state cannot be restored', async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 2;
    canvas.height = 2;
    const layer = makeLayer(canvas, new ImageData(2, 2));
    const { brush, applySnapshot } = createRuntimeBrush();
    applySnapshot.mockImplementation(() => {
      throw new Error('restore rejected');
    });
    mockStoreState.layers = [layer];
    mockBrushManager.validateColorCycleBrush.mockReturnValue(true);
    mockBrushManager.getHistoryBrush.mockReturnValue(brush);

    const targets = createRehydrationTargets();
    targets.colorCycleLayerIds.add(layer.id);

    await expect(rehydrateEntryResources(
      { id: 'entry', action: 'layer-structure', label: 'test', ts: 1, docId: 'doc', deltas: [] },
      'backward',
      targets,
    )).rejects.toThrow(`restore canonical brush state for color-cycle layer ${layer.id}`);
  });
});
