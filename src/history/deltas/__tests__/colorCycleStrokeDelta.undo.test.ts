import { createDefaultLayerAlignment } from '@/utils/layoutDefaults';
import type { Layer } from '@/types';
import { useAppStore } from '@/stores/useAppStore';
import { ColorCycleStrokeDelta, createColorCycleStrokeDelta } from '@/history/deltas/colorCycleStrokeDelta';
import { ColorCycleAnimator } from '@/lib/ColorCycleAnimator';

// eslint-disable-next-line no-var
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
    getColorCycleStoreState: () => null,
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

const makeAnimatorState = () =>
  new ColorCycleAnimator({
    width: 2,
    height: 2,
    fps: 30,
    speed: 1,
    autoStart: false,
    forceCanvas2D: true,
  }).serialize();

describe('ColorCycleStrokeDelta undo resurrection', () => {
  beforeEach(() => {
    mockBrush.restoreFullState.mockClear();
    mockBrush.restoreFullState.mockReset();
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
          data: makeAnimatorState(),
          gradientDefStore: [
            {
              id: 1,
              kind: 'linear' as const,
              stops,
              hash: 'linear:one',
              source: 'manual' as const,
              createdAtMs: 0,
            },
          ],
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
          data: makeAnimatorState(),
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

  it('preserves speed, flow, and phase buffers through full-state history restore', async () => {
    const layer = createLayer();
    useAppStore.setState((state) => ({
      layers: [layer],
      activeLayerId: layer.id,
      project: state.project
        ? { ...state.project, width: 2, height: 2, layers: [layer] }
        : state.project,
    }));

    const backwardState = {
      cycleSpeed: 1,
      fps: 30,
      brushSize: 1,
      layers: [
        {
          layerId: layer.id,
          data: makeAnimatorState(),
          strokeData: {
            paintBuffer: new Uint8Array([1, 2, 0, 0]).buffer,
            gradientIdBuffer: new Uint8Array([3, 4, 0, 0]).buffer,
            gradientDefIdBuffer: new Uint16Array([5, 6, 0, 0]).buffer,
            speedBuffer: new Uint8Array([7, 8, 0, 0]).buffer,
            flowBuffer: new Uint8Array([9, 10, 0, 0]).buffer,
            phaseBuffer: new Uint8Array([11, 12, 0, 0]).buffer,
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
          data: makeAnimatorState(),
          strokeData: {
            paintBuffer: new Uint8Array([13, 14, 0, 0]).buffer,
            gradientIdBuffer: new Uint8Array([15, 16, 0, 0]).buffer,
            gradientDefIdBuffer: new Uint16Array([17, 18, 0, 0]).buffer,
            speedBuffer: new Uint8Array([19, 20, 0, 0]).buffer,
            flowBuffer: new Uint8Array([21, 22, 0, 0]).buffer,
            phaseBuffer: new Uint8Array([23, 24, 0, 0]).buffer,
            hasContent: true,
            strokeCounter: 2,
          },
        },
      ],
    };

    const delta = createColorCycleStrokeDelta({
      layerId: layer.id,
      forwardState,
      backwardState,
    });

    expect(delta).not.toBeNull();
    await delta!.apply('backward');

    const payload = mockBrush.restoreFullState.mock.calls[0]?.[0] as {
      layerSnapshots?: Array<{
        speedBuffer?: ArrayBuffer;
        flowBuffer?: ArrayBuffer;
        phaseBuffer?: ArrayBuffer;
      }>;
    };
    const snapshot = payload.layerSnapshots?.[0];
    expect(Array.from(new Uint8Array(snapshot?.speedBuffer ?? new ArrayBuffer(0)))).toEqual([7, 8, 0, 0]);
    expect(Array.from(new Uint8Array(snapshot?.flowBuffer ?? new ArrayBuffer(0)))).toEqual([9, 10, 0, 0]);
    expect(Array.from(new Uint8Array(snapshot?.phaseBuffer ?? new ArrayBuffer(0)))).toEqual([11, 12, 0, 0]);
  });

  it('restores color-cycle slot metadata with sampled stroke history states', async () => {
    const layer = createLayer({
      colorCycleData: {
        canvas: document.createElement('canvas'),
        gradientDefs: [{ id: 'g0', currentSlot: 9 }],
        slotPalettes: [
          {
            slot: 9,
            stops: [
              { position: 0, color: '#111111' },
              { position: 1, color: '#222222' },
            ],
          },
        ],
        gradientDefStore: [
          {
            id: 9,
            kind: 'linear',
            stops: [
              { position: 0, color: '#111111' },
              { position: 1, color: '#222222' },
            ],
            hash: 'linear:old',
            source: 'sampled',
            createdAtMs: 1,
            slot: 9,
          },
        ],
        paintSlot: 9,
      },
    });
    layer.colorCycleData!.canvas!.width = 2;
    layer.colorCycleData!.canvas!.height = 2;

    useAppStore.setState((state) => ({
      layers: [layer],
      activeLayerId: layer.id,
      project: state.project
        ? { ...state.project, width: 2, height: 2, layers: [layer] }
        : state.project,
    }));

    const backwardState = {
      cycleSpeed: 1,
      fps: 30,
      brushSize: 1,
      layers: [
        {
          layerId: layer.id,
          data: makeAnimatorState(),
          gradientDefs: [{ id: 'g0', currentSlot: 4 }],
          slotPalettes: [
            {
              slot: 4,
              stops: [
                { position: 0, color: '#334455' },
                { position: 1, color: '#ddeeff' },
              ],
            },
          ],
          gradientDefStore: [
            {
              id: 4,
              kind: 'linear' as const,
              stops: [
                { position: 0, color: '#334455' },
                { position: 1, color: '#ddeeff' },
              ],
              hash: 'linear:sampled-back',
              source: 'sampled' as const,
              createdAtMs: 2,
              slot: 4,
            },
          ],
          nextGradientDefId: 5,
          activeGradientId: 'g0',
          paintSlot: 4,
          strokeData: {
            paintBuffer: new Uint8Array([1, 0, 0, 0]).buffer,
            gradientIdBuffer: new Uint8Array([4, 0, 0, 0]).buffer,
            gradientDefIdBuffer: new Uint16Array([4, 0, 0, 0]).buffer,
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
          ...backwardState.layers[0],
          slotPalettes: [
            {
              slot: 9,
              stops: [
                { position: 0, color: '#111111' },
                { position: 1, color: '#222222' },
              ],
            },
          ],
          gradientDefStore: layer.colorCycleData!.gradientDefStore,
          paintSlot: 9,
          strokeData: {
            paintBuffer: new Uint8Array([1, 1, 0, 0]).buffer,
            gradientIdBuffer: new Uint8Array([9, 9, 0, 0]).buffer,
            gradientDefIdBuffer: new Uint16Array([9, 9, 0, 0]).buffer,
            hasContent: true,
            strokeCounter: 2,
          },
        },
      ],
    };

    const delta = createColorCycleStrokeDelta({
      layerId: layer.id,
      forwardState,
      backwardState,
    });

    expect(delta).not.toBeNull();
    await delta!.apply('backward');

    const restoredLayer = useAppStore.getState().layers.find((entry) => entry.id === layer.id);
    expect(restoredLayer?.colorCycleData?.paintSlot).toBe(4);
    expect(restoredLayer?.colorCycleData?.slotPalettes?.[0]?.slot).toBe(4);
    expect(restoredLayer?.colorCycleData?.gradientDefStore?.[0]?.slot).toBe(4);
    expect(restoredLayer?.colorCycleData?.nextGradientDefId).toBe(5);
  });

  it('clears future slot metadata when restoring a state that had none', async () => {
    const layer = createLayer({
      colorCycleData: {
        canvas: document.createElement('canvas'),
        gradientDefs: [{ id: 'g0', currentSlot: 9 }],
        slotPalettes: [
          {
            slot: 9,
            stops: [
              { position: 0, color: '#111111' },
              { position: 1, color: '#222222' },
            ],
          },
        ],
        gradientDefStore: [
          {
            id: 9,
            kind: 'linear',
            stops: [
              { position: 0, color: '#111111' },
              { position: 1, color: '#222222' },
            ],
            hash: 'linear:future',
            source: 'sampled',
            createdAtMs: 1,
            slot: 9,
          },
        ],
        nextGradientDefId: 10,
        activeGradientId: 'g0',
        paintSlot: 9,
      },
    });
    layer.colorCycleData!.canvas!.width = 2;
    layer.colorCycleData!.canvas!.height = 2;

    useAppStore.setState((state) => ({
      layers: [layer],
      activeLayerId: layer.id,
      project: state.project
        ? { ...state.project, width: 2, height: 2, layers: [layer] }
        : state.project,
    }));

    const backwardState = {
      cycleSpeed: 1,
      fps: 30,
      brushSize: 1,
      layers: [
        {
          layerId: layer.id,
          data: makeAnimatorState(),
          strokeData: {
            paintBuffer: new Uint8Array([0, 0, 0, 0]).buffer,
            gradientIdBuffer: new Uint8Array([0, 0, 0, 0]).buffer,
            gradientDefIdBuffer: new Uint16Array([0, 0, 0, 0]).buffer,
            hasContent: false,
            strokeCounter: 0,
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
          data: makeAnimatorState(),
          slotPalettes: layer.colorCycleData!.slotPalettes,
          gradientDefStore: layer.colorCycleData!.gradientDefStore,
          nextGradientDefId: 10,
          activeGradientId: 'g0',
          paintSlot: 9,
          strokeData: {
            paintBuffer: new Uint8Array([1, 0, 0, 0]).buffer,
            gradientIdBuffer: new Uint8Array([9, 0, 0, 0]).buffer,
            gradientDefIdBuffer: new Uint16Array([9, 0, 0, 0]).buffer,
            hasContent: true,
            strokeCounter: 1,
          },
        },
      ],
    };

    const delta = createColorCycleStrokeDelta({
      layerId: layer.id,
      forwardState,
      backwardState,
    });

    expect(delta).not.toBeNull();
    await delta!.apply('backward');

    const restoredLayer = useAppStore.getState().layers.find((entry) => entry.id === layer.id);
    expect(restoredLayer?.colorCycleData?.paintSlot).toBeUndefined();
    expect(restoredLayer?.colorCycleData?.slotPalettes).toBeUndefined();
    expect(restoredLayer?.colorCycleData?.gradientDefStore).toBeUndefined();
    expect(restoredLayer?.colorCycleData?.nextGradientDefId).toBeUndefined();
  });
});
