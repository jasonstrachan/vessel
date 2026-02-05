import { createDefaultLayerAlignment } from '@/utils/layoutDefaults';
import type { Layer } from '@/types';
import { useAppStore } from '@/stores/useAppStore';
import { ColorCycleStrokeDelta } from '@/history/deltas/colorCycleStrokeDelta';

var mockManager: { getBrush: jest.Mock };
const mockBrush = {
  restoreFullState: jest.fn(),
  updateColorCycleTexture: jest.fn(),
  render: jest.fn(),
  setTargetCanvas: jest.fn(),
  commitToLayer: jest.fn(),
};

jest.mock('@/stores/colorCycleBrushManager', () => {
  mockManager = {
    getBrush: jest.fn(() => mockBrush),
  };
  return {
    __esModule: true as const,
    getColorCycleBrushManager: () => mockManager,
    setColorCycleStoreStateGetter: jest.fn(),
    setLayerIdGetter: jest.fn(),
  };
});

const createLayer = (overrides?: Partial<Layer>): Layer => {
  const canvas = document.createElement('canvas');
  canvas.width = 2;
  canvas.height = 2;
  return {
    id: 'layer-cc',
    name: 'Layer 1',
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
      gradientDefs: [],
      slotPalettes: [],
      gradientDefStore: [],
      gradientDefIdBuffer: new Uint16Array([0, 0, 0, 0]).buffer,
      paintSlot: 0,
    },
    version: 1,
    ...(overrides ?? {}),
  };
};

describe('ColorCycleStrokeDelta undo resurrection', () => {
  beforeEach(() => {
    mockBrush.restoreFullState.mockClear();
    mockManager.getBrush.mockClear();
    mockManager.getBrush.mockReturnValue(mockBrush);
    useAppStore.setState((state) => ({
      layers: [],
      activeLayerId: null,
      project: state.project
        ? { ...state.project, width: 2, height: 2 }
        : state.project,
    }));
  });

  it('restores def id buffers and allows slot GC to reassign', async () => {
    const stops = [
      { position: 0, color: '#000000' },
      { position: 1, color: '#ffffff' },
    ];
    const layer = createLayer({
      colorCycleData: {
        gradientDefs: [],
        slotPalettes: [],
        gradientDefStore: [
          {
            id: 1,
            kind: 'linear',
            stops,
            hash: 'linear:one',
            source: 'manual',
            createdAtMs: 0,
          },
        ],
        gradientDefIdBuffer: new Uint16Array([0, 0, 0, 0]).buffer,
        paintSlot: 0,
      },
    });

    useAppStore.setState((state) => ({
      layers: [layer],
      activeLayerId: layer.id,
      project: state.project
        ? { ...state.project, width: 2, height: 2, layers: [layer] }
        : state.project,
    }));
    const canvas = document.createElement('canvas');
    canvas.width = 2;
    canvas.height = 2;
    useAppStore.getState().updateLayer(layer.id, {
      colorCycleData: {
        ...(layer.colorCycleData ?? {}),
        canvas,
      },
    });
    const storedLayer = useAppStore.getState().layers.find((entry) => entry.id === layer.id);
    expect(storedLayer?.colorCycleData?.canvas).toBeDefined();

    mockBrush.restoreFullState.mockImplementation((payload: { layerSnapshots?: Array<{ gradientDefIdBuffer?: ArrayBuffer }> }) => {
      const snapshot = payload.layerSnapshots?.[0];
      if (snapshot?.gradientDefIdBuffer) {
        const latest = useAppStore.getState();
        const updatedLayer = latest.layers.find((entry) => entry.id === layer.id);
        if (updatedLayer?.colorCycleData) {
          latest.updateLayer(layer.id, {
            colorCycleData: {
              ...updatedLayer.colorCycleData,
              gradientDefIdBuffer: snapshot.gradientDefIdBuffer,
            },
          });
        }
      }
    });

    const backwardState = {
      cycleSpeed: 1,
      fps: 30,
      brushSize: 1,
      layers: [
        {
          layerId: layer.id,
          strokeData: {
            paintBuffer: new Uint8Array([1, 0, 0, 0]).buffer,
            gradientDefIdBuffer: new Uint16Array([1, 0, 0, 0]).buffer,
            hasContent: true,
            strokeCounter: 1,
          },
        },
      ],
    };

    const forwardState = {
      cycleSpeed: 1,
      fps: 30,
      brushSize: 1,
      layers: [
        {
          layerId: layer.id,
          strokeData: {
            paintBuffer: new Uint8Array([0, 0, 0, 0]).buffer,
            gradientDefIdBuffer: new Uint16Array([0, 0, 0, 0]).buffer,
            hasContent: false,
            strokeCounter: 2,
          },
        },
      ],
    };

    const delta = new ColorCycleStrokeDelta({
      layerId: layer.id,
      forwardState,
      backwardState,
    });

    await delta.apply('backward');

    expect(mockManager.getBrush).toHaveBeenCalled();
    expect(mockBrush.restoreFullState).toHaveBeenCalled();
    const restoredLayer = useAppStore.getState().layers.find((entry) => entry.id === layer.id);
    const restoredDefBuffer = restoredLayer?.colorCycleData?.gradientDefIdBuffer;
    expect(restoredDefBuffer).toBeDefined();

    useAppStore.getState().runColorCycleSlotRebuild('undo-test');
    const updatedLayer = useAppStore.getState().layers.find((entry) => entry.id === layer.id);
    const def = updatedLayer?.colorCycleData?.gradientDefStore?.find((entry) => entry.id === 1);
    expect(typeof def?.slot).toBe('number');
  });
});
