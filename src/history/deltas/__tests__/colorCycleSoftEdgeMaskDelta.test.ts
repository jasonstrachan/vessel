import { createColorCycleSoftEdgeMaskDelta } from '@/history/deltas/colorCycleSoftEdgeMaskDelta';
import { ColorCycleAnimator } from '@/lib/ColorCycleAnimator';
import * as colorCycleBrushManager from '@/stores/colorCycleBrushManager';
import { useAppStore } from '@/stores/useAppStore';
import type { ColorCycleSerializedState } from '@/history/helpers/colorCycle';
import type { Layer } from '@/types';
import { createDefaultLayerAlignment } from '@/utils/layoutDefaults';

const makeState = (
  layerId: string,
  width: number,
  height: number,
  alpha: number[] | null,
  version: number,
): ColorCycleSerializedState => {
  const animatorState = new ColorCycleAnimator({
    width,
    height,
    fps: 30,
    speed: 1,
    autoStart: false,
    forceCanvas2D: true,
  }).serialize();

  return {
    cycleSpeed: 1,
    fps: 30,
    brushSize: 1,
    layers: [
      {
        layerId,
        data: animatorState,
        strokeData: {
          paintBuffer: new Uint8Array(width * height).buffer,
          hasContent: false,
          strokeCounter: 0,
        },
        ...(alpha
          ? {
              softEdgeMaskSnapshot: {
                width,
                height,
                alpha: new Uint8ClampedArray(alpha),
                enabled: true,
                version,
              },
            }
          : {}),
      },
    ],
  };
};

const createColorCycleLayer = (layerId: string, width: number, height: number): Layer => {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return {
    id: layerId,
    name: 'CC Layer',
    order: 0,
    visible: true,
    opacity: 1,
    blendMode: 'source-over',
    locked: false,
    transparencyLocked: false,
    layerType: 'color-cycle',
    imageData: null,
    framebuffer: canvas,
    alignment: createDefaultLayerAlignment(),
    colorCycleData: {
      canvas,
      gradient: [],
      mode: 'brush',
      hasContent: false,
      softEdgeMaskVersion: 0,
    },
    version: 1,
  };
};

describe('ColorCycleSoftEdgeMaskDelta', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  beforeEach(() => {
    const width = 4;
    const height = 4;
    const layer = createColorCycleLayer('layer-cc-soft-edge', width, height);
    useAppStore.setState((state) => ({
      layers: [layer],
      activeLayerId: layer.id,
      layersNeedRecomposition: false,
      pendingCompositeDirtyBatches: [],
      project: state.project
        ? { ...state.project, width, height, layers: [layer] }
        : state.project,
    }));
  });

  it('replays soft-edge mask snapshots through the dirty-batch contract', async () => {
    const width = 4;
    const height = 4;
    const layerId = 'layer-cc-soft-edge';
    const forwardAlpha = new Array(width * height).fill(0);
    forwardAlpha[5] = 255;
    const delta = createColorCycleSoftEdgeMaskDelta({
      layerId,
      forwardState: makeState(layerId, width, height, forwardAlpha, 2),
      backwardState: makeState(layerId, width, height, null, 1),
    });

    expect(delta).not.toBeNull();

    await delta!.apply('forward');
    let layer = useAppStore.getState().layers[0];
    expect(layer?.colorCycleData?.softEdgeMaskImageData?.data[5 * 4 + 3]).toBe(255);
    expect(layer?.colorCycleData?.softEdgeMaskVersion).toBe(2);
    expect(useAppStore.getState().layersNeedRecomposition).toBe(true);
    expect(useAppStore.getState().pendingCompositeDirtyBatches).toEqual([
      {
        layerId,
        version: 1,
        rects: [{ x: 0, y: 0, width, height }],
      },
    ]);

    useAppStore.setState({ layersNeedRecomposition: false, pendingCompositeDirtyBatches: [] });
    await delta!.apply('backward');
    layer = useAppStore.getState().layers[0];
    expect(layer?.colorCycleData?.softEdgeMask).toBeUndefined();
    expect(layer?.colorCycleData?.softEdgeMaskImageData).toBeUndefined();
    expect(layer?.colorCycleData?.softEdgeMaskVersion).toBe(3);
    expect(useAppStore.getState().layersNeedRecomposition).toBe(true);
    expect(useAppStore.getState().pendingCompositeDirtyBatches).toEqual([
      {
        layerId,
        version: 1,
        rects: [{ x: 0, y: 0, width, height }],
      },
    ]);
  });

  it('accepts forward replay after an earlier stroke patch advances the document version', async () => {
    const width = 4;
    const height = 4;
    const layerId = 'layer-cc-soft-edge';
    const forwardAlpha = new Array(width * height).fill(0);
    forwardAlpha[5] = 255;

    jest.spyOn(colorCycleBrushManager, 'getColorCycleBrushManager').mockReturnValue({
      getDocument: () => ({
        read: () => ({ version: 2 }),
      }),
    } as never);

    const delta = createColorCycleSoftEdgeMaskDelta({
      layerId,
      forwardState: makeState(layerId, width, height, forwardAlpha, 2),
      backwardState: makeState(layerId, width, height, null, 1),
      beforeVersion: 1,
      afterVersion: 2,
    });

    await expect(delta!.apply('forward')).resolves.toBeUndefined();
  });
});
