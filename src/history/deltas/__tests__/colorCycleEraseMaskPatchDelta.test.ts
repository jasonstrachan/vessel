import { createColorCycleEraseMaskPatchDelta } from '@/history/deltas/colorCycleEraseMaskPatchDelta';
import { ColorCycleAnimator } from '@/lib/ColorCycleAnimator';
import * as colorCycleBrushManager from '@/stores/colorCycleBrushManager';
import { useAppStore } from '@/stores/useAppStore';
import type { ColorCycleSerializedState } from '@/history/helpers/colorCycle';
import type { Layer } from '@/types';
import { createDefaultLayerAlignment } from '@/utils/layoutDefaults';

const readMaskAlpha = (canvas: HTMLCanvasElement, x: number, y: number): number => {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) {
    return 0;
  }
  return ctx.getImageData(x, y, 1, 1).data[3] ?? 0;
};

const makeState = (
  layerId: string,
  width: number,
  height: number,
  alpha: number[],
  version: number
): ColorCycleSerializedState => {
  const animatorState = new ColorCycleAnimator({
    width,
    height,
    fps: 30,
    speed: 1,
    autoStart: false,
    forceCanvas2D: true,
  }).serialize();

  return ({
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
      eraseMaskSnapshot: {
        width,
        height,
        alpha: new Uint8ClampedArray(alpha),
        version,
      },
    },
  ],
  });
};

describe('ColorCycleEraseMaskPatchDelta', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  beforeEach(() => {
    const width = 4;
    const height = 4;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const mask = document.createElement('canvas');
    mask.width = width;
    mask.height = height;

    const layer: Layer = {
      id: 'layer-cc-mask',
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
        eraseMask: mask,
        eraseMaskVersion: 0,
      },
      version: 1,
    };

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

  it('restores erase mask ROI alpha on undo/redo', async () => {
    const width = 4;
    const height = 4;
    const layerId = 'layer-cc-mask';
    const index = 1 * width + 1;
    const forwardAlpha = new Array(width * height).fill(0);
    forwardAlpha[index] = 255;
    const backwardAlpha = new Array(width * height).fill(0);

    const delta = await createColorCycleEraseMaskPatchDelta({
      layerId,
      width,
      height,
      roi: { x: 0, y: 0, width, height },
      forwardState: makeState(layerId, width, height, forwardAlpha, 2),
      backwardState: makeState(layerId, width, height, backwardAlpha, 1),
    });

    expect(delta).not.toBeNull();

    const mask = useAppStore.getState().layers[0]?.colorCycleData?.eraseMask as HTMLCanvasElement;
    expect(readMaskAlpha(mask, 1, 1)).toBe(0);

    await delta!.apply('forward');
    expect(readMaskAlpha(mask, 1, 1)).toBe(255);
    expect(useAppStore.getState().layers[0]?.colorCycleData?.eraseMaskVersion).toBe(2);
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
    expect(readMaskAlpha(mask, 1, 1)).toBe(0);
    expect(useAppStore.getState().layers[0]?.colorCycleData?.eraseMaskVersion).toBe(1);
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
    const layerId = 'layer-cc-mask';
    const forwardAlpha = new Array(width * height).fill(0);
    forwardAlpha[5] = 255;
    const backwardAlpha = new Array(width * height).fill(0);

    jest.spyOn(colorCycleBrushManager, 'getColorCycleBrushManager').mockReturnValue({
      getDocument: () => ({
        read: () => ({ version: 2 }),
      }),
    } as never);

    const delta = await createColorCycleEraseMaskPatchDelta({
      layerId,
      width,
      height,
      roi: { x: 0, y: 0, width, height },
      forwardState: makeState(layerId, width, height, forwardAlpha, 2),
      backwardState: makeState(layerId, width, height, backwardAlpha, 1),
      beforeVersion: 1,
      afterVersion: 2,
    });

    await expect(delta!.apply('forward')).resolves.toBeUndefined();
  });
});
