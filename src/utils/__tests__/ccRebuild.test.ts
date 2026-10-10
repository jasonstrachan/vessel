import { rebuildCCLayerAfterCrop, rebuildRecolorLayersAfterCrop } from '@/utils/crop/ccRebuild';
import { registerColorCycleBrushLayerSnapshotRuntime } from '@/lib/colorCycle/document';
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

describe('rebuildRecolorLayersAfterCrop', () => {
  it('awaits restoration and surfaces rejected runtime work', async () => {
    const layer = createColorCycleLayer();
    layer.colorCycleData!.mode = 'recolor';
    let state = { layers: [layer], setLayersNeedRecomposition: jest.fn() } as unknown as AppState;
    const setState: StoreApi<AppState>['setState'] = (updater) => {
      const next = typeof updater === 'function' ? updater(state) : updater;
      state = { ...state, ...next };
    };
    let finish!: (value: boolean) => void;
    const restoreLayer = jest.fn(() => new Promise<boolean>((resolve) => { finish = resolve; }));
    const pending = rebuildRecolorLayersAfterCrop({
      queue: [{ id: layer.id }], getState: () => state, setState, restoreLayer,
    });
    await Promise.resolve();
    expect(state.setLayersNeedRecomposition).not.toHaveBeenCalled();
    finish(true);
    await pending;
    expect(state.setLayersNeedRecomposition).toHaveBeenCalledWith(true);
    await expect(rebuildRecolorLayersAfterCrop({
      queue: [{ id: layer.id }], getState: () => state, setState,
      restoreLayer: jest.fn().mockResolvedValue(false), logError: jest.fn(),
    })).rejects.toThrow('Recolor runtime rejected cropped layer');
  });
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

  it.each(['create-null', 'create-throw', 'snapshot-unregistered', 'snapshot-throw'])(
    'rejects required runtime restoration failures (%s)', async (failure) => {
      const state = createState();
      const brush = { getCanvas: () => document.createElement('canvas') };
      if (failure === 'snapshot-throw') {
        registerColorCycleBrushLayerSnapshotRuntime(brush, { apply: () => { throw new Error('snapshot refused'); } });
      }
      const manager = {
        removeColorCycleBrush: jest.fn(),
        createBrush: jest.fn(() => {
          if (failure === 'create-throw') throw new Error('creation refused');
          return failure === 'create-null' ? null : brush;
        }),
        setActiveState: jest.fn(),
      };
      const sync = jest.fn();
      await expect(rebuildCCLayerAfterCrop({
        entries: [{
          id: 'layer-cc', width: 2, height: 2, croppedCanvas: null,
          imageData: new ImageData(2, 2), wasAnimating: false, wasPlaying: false, wasActiveLayer: true,
          strokeSnapshot: { paintBuffer: new Uint8Array([1, 2, 3, 4]).buffer, hasContent: true, strokeCounter: 1 },
        }],
        colorCycleBrushManager: manager as never,
        getState: () => state as AppState,
        setState: jest.fn(), syncPlaybackColorCycleLayers: sync, logError: jest.fn(),
      })).rejects.toThrow();
      expect(sync).not.toHaveBeenCalled();
      expect(state.setLayersNeedRecomposition).not.toHaveBeenCalled();
    },
  );

  it('preserves an external base when indexed stroke data was restored', async () => {
    const brushCanvas = document.createElement('canvas');
    brushCanvas.width = 2;
    brushCanvas.height = 2;

    const applySnapshot = jest.fn();
    const freshBrush = {
      getCanvas: jest.fn(() => brushCanvas),
      setSpeed: jest.fn(),
      markLayerHasExternalBase: jest.fn(),
    };
    registerColorCycleBrushLayerSnapshotRuntime(freshBrush, {
      apply: applySnapshot,
    });

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
          wasPlaying: true,
          wasActiveLayer: true,
          strokeSnapshot: {
            paintBuffer: new Uint8Array([1, 0, 0, 0]).buffer,
            phaseBuffer: new Uint8Array([4, 0, 0, 0]).buffer,
            hasContent: true,
            strokeCounter: 1,
          },
        },
      ],
      colorCycleBrushManager: manager as never,
      getState: () => state as AppState,
      setState,
      syncPlaybackColorCycleLayers: jest.fn(),
      logError: jest.fn(),
    });

    await flushMicrotasks();

    expect(applySnapshot).toHaveBeenCalled();
    expect(applySnapshot).toHaveBeenCalledWith(
      'layer-cc',
      expect.objectContaining({
        phaseBuffer: expect.any(ArrayBuffer),
      })
    );
    expect(freshBrush.markLayerHasExternalBase).toHaveBeenCalledWith('layer-cc');
  });

  it('preserves an external base when only bitmap pixels were restored', async () => {
    const brushCanvas = document.createElement('canvas');
    brushCanvas.width = 2;
    brushCanvas.height = 2;

    const applySnapshot = jest.fn();
    const freshBrush = {
      getCanvas: jest.fn(() => brushCanvas),
      setSpeed: jest.fn(),
      markLayerHasExternalBase: jest.fn(),
    };
    registerColorCycleBrushLayerSnapshotRuntime(freshBrush, {
      apply: applySnapshot,
    });

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
          wasPlaying: true,
          wasActiveLayer: true,
        },
      ],
      colorCycleBrushManager: manager as never,
      getState: () => state as AppState,
      setState,
      syncPlaybackColorCycleLayers: jest.fn(),
      logError: jest.fn(),
    });

    await flushMicrotasks();

    expect(applySnapshot).not.toHaveBeenCalled();
    expect(freshBrush.markLayerHasExternalBase).toHaveBeenCalledWith('layer-cc');
  });
});
