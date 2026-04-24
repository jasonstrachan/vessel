import { createColorCycleStrokePatchDelta } from '@/history/deltas/colorCycleStrokePatchDelta';
import { ColorCycleAnimator } from '@/lib/ColorCycleAnimator';
import { useAppStore } from '@/stores/useAppStore';
import type { Layer } from '@/types';
import { createDefaultLayerAlignment } from '@/utils/layoutDefaults';

type PatchExtras = {
  gradientIdBytes?: Uint8Array;
  gradientDefIdBytes?: Uint8Array;
  speedBytes?: Uint8Array;
  flowBytes?: Uint8Array;
  phaseBytes?: Uint8Array;
};

const mockBrush = {
  applyPaintPatch: jest.fn((_layerId: string, _roi: unknown, bytes: Uint8Array) =>
    bytes.some((value) => value !== 0)
  ),
  updateColorCycleTexture: jest.fn(),
  commitToLayer: jest.fn(),
  setTargetCanvas: jest.fn(),
};

jest.mock('@/stores/colorCycleBrushManager', () => ({
  __esModule: true as const,
  getColorCycleBrushManager: () => ({ getBrush: () => mockBrush }),
  getColorCycleStoreState: () => null,
  setColorCycleStoreStateGetter: jest.fn(),
  setLayerIdGetter: jest.fn(),
}));

const makeAnimatorState = (width: number, height: number) =>
  new ColorCycleAnimator({
    width,
    height,
    fps: 30,
    speed: 1,
    autoStart: false,
    forceCanvas2D: true,
  }).serialize();

const makeState = ({
  layerId,
  width,
  height,
  paint,
  gradientId,
  gradientDefId,
  speed,
  flow,
  phase,
}: {
  layerId: string;
  width: number;
  height: number;
  paint: number[];
  gradientId: number[];
  gradientDefId: number[];
  speed: number[];
  flow: number[];
  phase: number[];
}) => ({
  cycleSpeed: 1,
  fps: 30,
  brushSize: 1,
  layers: [
    {
      layerId,
      data: makeAnimatorState(width, height),
      strokeData: {
        paintBuffer: new Uint8Array(paint).buffer,
        gradientIdBuffer: new Uint8Array(gradientId).buffer,
        gradientDefIdBuffer: new Uint16Array(gradientDefId).buffer,
        speedBuffer: new Uint8Array(speed).buffer,
        flowBuffer: new Uint8Array(flow).buffer,
        phaseBuffer: new Uint8Array(phase).buffer,
        hasContent: paint.some((value) => value !== 0),
        strokeCounter: 1,
      },
    },
  ],
});

const createLayer = (layerId: string, width: number, height: number): Layer => {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return {
    id: layerId,
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
      gradientDefs: [],
      slotPalettes: [],
      gradientDefStore: [],
      paintSlot: 0,
      hasContent: true,
    },
    version: 1,
  };
};

describe('ColorCycleStrokePatchDelta', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    const layer = createLayer('layer-cc-patch', 2, 2);
    useAppStore.setState((state) => ({
      layers: [layer],
      activeLayerId: layer.id,
      project: state.project
        ? { ...state.project, width: 2, height: 2, layers: [layer] }
        : state.project,
    }));
  });

  it('restores gradient def id and phase bytes when undoing an overlapping CC shape patch', async () => {
    const layerId = 'layer-cc-patch';
    const backwardState = makeState({
      layerId,
      width: 2,
      height: 2,
      paint: [1, 2, 0, 0],
      gradientId: [3, 4, 0, 0],
      gradientDefId: [7, 9, 0, 0],
      speed: [10, 20, 0, 0],
      flow: [30, 40, 0, 0],
      phase: [50, 60, 0, 0],
    });
    const forwardState = makeState({
      layerId,
      width: 2,
      height: 2,
      paint: [5, 6, 0, 0],
      gradientId: [8, 8, 0, 0],
      gradientDefId: [12, 12, 0, 0],
      speed: [70, 80, 0, 0],
      flow: [90, 100, 0, 0],
      phase: [110, 120, 0, 0],
    });

    const delta = await createColorCycleStrokePatchDelta({
      layerId,
      width: 2,
      height: 2,
      roi: { x: 0, y: 0, width: 2, height: 2 },
      forwardState,
      backwardState,
    });

    expect(delta).not.toBeNull();
    await delta!.apply('backward');

    expect(mockBrush.applyPaintPatch).toHaveBeenCalledTimes(1);
    const [, , paintBytes, extras] = mockBrush.applyPaintPatch.mock.calls[0] as unknown as [
      string,
      unknown,
      Uint8Array,
      PatchExtras,
    ];
    expect(Array.from(paintBytes)).toEqual([1, 2, 0, 0]);
    expect(Array.from(extras.gradientIdBytes ?? [])).toEqual([3, 4, 0, 0]);
    expect(Array.from(new Uint16Array(extras.gradientDefIdBytes?.buffer ?? new ArrayBuffer(0)))).toEqual([
      7,
      9,
      0,
      0,
    ]);
    expect(Array.from(extras.speedBytes ?? [])).toEqual([10, 20, 0, 0]);
    expect(Array.from(extras.flowBytes ?? [])).toEqual([30, 40, 0, 0]);
    expect(Array.from(extras.phaseBytes ?? [])).toEqual([50, 60, 0, 0]);
  });

  it('undoes the first CC gradient when no before brush state was captured', async () => {
    const layerId = 'layer-cc-patch';
    const forwardState = makeState({
      layerId,
      width: 2,
      height: 2,
      paint: [5, 6, 0, 0],
      gradientId: [8, 8, 0, 0],
      gradientDefId: [12, 12, 0, 0],
      speed: [70, 80, 0, 0],
      flow: [90, 100, 0, 0],
      phase: [110, 120, 0, 0],
    });

    const delta = await createColorCycleStrokePatchDelta({
      layerId,
      width: 2,
      height: 2,
      roi: { x: 0, y: 0, width: 2, height: 2 },
      forwardState,
      backwardState: null,
    });

    expect(delta).not.toBeNull();
    await delta!.apply('backward');

    expect(mockBrush.applyPaintPatch).toHaveBeenCalledTimes(1);
    const [, , paintBytes, extras] = mockBrush.applyPaintPatch.mock.calls[0] as unknown as [
      string,
      unknown,
      Uint8Array,
      PatchExtras,
    ];
    expect(Array.from(paintBytes)).toEqual([0, 0, 0, 0]);
    expect(Array.from(extras.gradientIdBytes ?? [])).toEqual([0, 0, 0, 0]);
    expect(Array.from(new Uint16Array(extras.gradientDefIdBytes?.buffer ?? new ArrayBuffer(0)))).toEqual([
      0,
      0,
      0,
      0,
    ]);
    expect(Array.from(extras.speedBytes ?? [])).toEqual([0, 0, 0, 0]);
    expect(Array.from(extras.flowBytes ?? [])).toEqual([0, 0, 0, 0]);
    expect(Array.from(extras.phaseBytes ?? [])).toEqual([0, 0, 0, 0]);
  });
});
