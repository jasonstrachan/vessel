import { rebuildCCLayerAfterCrop } from '@/utils/crop/ccRebuild';
import { createDefaultLayerAlignment } from '@/utils/layoutDefaults';
import type { Layer } from '@/types';
import type { AppState } from '@/stores/useAppStore';
import type { StoreApi } from 'zustand';

const flushMicrotasks = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

const createColorCycleLayer = (): Layer => ({
  id: 'layer-cc',
  name: 'Color Cycle',
  visible: true,
  opacity: 1,
  blendMode: 'source-over',
  locked: false,
  order: 0,
  imageData: null,
  framebuffer: document.createElement('canvas'),
  alignment: createDefaultLayerAlignment(),
  layerType: 'color-cycle',
  colorCycleData: {
    mode: 'brush',
    gradient: [
      { position: 0, color: '#000000' },
      { position: 1, color: '#ffffff' },
    ],
    isAnimating: true,
    canvas: document.createElement('canvas'),
  },
});

describe('rebuildCCLayerAfterCrop', () => {
  const createState = (): Pick<AppState, 'activeLayerId' | 'layers' | 'tools' | 'setLayersNeedRecomposition'> => ({
    activeLayerId: 'layer-cc',
    layers: [createColorCycleLayer()],
    tools: {
      brushSettings: {
        colorCycleSpeed: 0.1,
      } as AppState['tools']['brushSettings'],
    } as AppState['tools'],
    setLayersNeedRecomposition: jest.fn(),
  });

  it('preserves an external base when indexed stroke data was restored', async () => {
    const brushCanvas = document.createElement('canvas');
    brushCanvas.width = 2;
    brushCanvas.height = 2;

    const freshBrush = {
      getCanvas: jest.fn(() => brushCanvas),
      applyLayerSnapshot: jest.fn(),
      setSpeed: jest.fn(),
      markLayerHasExternalBase: jest.fn(),
    };

    const manager = {
      removeColorCycleBrush: jest.fn(),
      createBrush: jest.fn(() => freshBrush),
      setActiveState: jest.fn(),
    };

    let state = createState();
    const setState: StoreApi<AppState>['setState'] = (updater) => {
      const next = typeof updater === 'function' ? updater(state as AppState) : updater;
      state = { ...state, ...(next as Partial<typeof state>) };
    };

    rebuildCCLayerAfterCrop({
      entries: [
        {
          id: 'layer-cc',
          width: 2,
          height: 2,
          croppedCanvas: null,
          imageData: new ImageData(2, 2),
          wasAnimating: true,
          wasActiveLayer: true,
          strokeSnapshot: {
            paintBuffer: new Uint8Array([1, 0, 0, 0]).buffer,
            hasContent: true,
            strokeCounter: 1,
          },
        },
      ],
      colorCycleBrushManager: manager as never,
      getState: () => state as AppState,
      setState,
      syncCCRuntimes: jest.fn(),
      logError: jest.fn(),
    });

    await flushMicrotasks();

    expect(freshBrush.applyLayerSnapshot).toHaveBeenCalled();
    expect(freshBrush.markLayerHasExternalBase).toHaveBeenCalledWith('layer-cc');
  });

  it('preserves an external base when only bitmap pixels were restored', async () => {
    const brushCanvas = document.createElement('canvas');
    brushCanvas.width = 2;
    brushCanvas.height = 2;

    const freshBrush = {
      getCanvas: jest.fn(() => brushCanvas),
      applyLayerSnapshot: jest.fn(),
      setSpeed: jest.fn(),
      markLayerHasExternalBase: jest.fn(),
    };

    const manager = {
      removeColorCycleBrush: jest.fn(),
      createBrush: jest.fn(() => freshBrush),
      setActiveState: jest.fn(),
    };

    let state = createState();
    const setState: StoreApi<AppState>['setState'] = (updater) => {
      const next = typeof updater === 'function' ? updater(state as AppState) : updater;
      state = { ...state, ...(next as Partial<typeof state>) };
    };

    const imageData = new ImageData(2, 2);
    imageData.data[3] = 255;

    rebuildCCLayerAfterCrop({
      entries: [
        {
          id: 'layer-cc',
          width: 2,
          height: 2,
          croppedCanvas: null,
          imageData,
          wasAnimating: true,
          wasActiveLayer: true,
        },
      ],
      colorCycleBrushManager: manager as never,
      getState: () => state as AppState,
      setState,
      syncCCRuntimes: jest.fn(),
      logError: jest.fn(),
    });

    await flushMicrotasks();

    expect(freshBrush.applyLayerSnapshot).not.toHaveBeenCalled();
    expect(freshBrush.markLayerHasExternalBase).toHaveBeenCalledWith('layer-cc');
  });
});
