import { replayDeltaForTest } from '@/history/__tests__/replayTestUtils';
import type { HistoryDelta } from '@/history/actionTypes';
import { createColorCycleEraseMaskDelta } from '@/history/deltas/colorCycleEraseMaskDelta';
import { HistoryReplayApplyError } from '@/history/errors';
import type { ColorCycleSerializedState } from '@/history/helpers/colorCycle';
import HistoryManager from '@/history/historyManager';
import { ColorCycleAnimator } from '@/lib/ColorCycleAnimator';
import * as colorCycleBrushManager from '@/stores/colorCycleBrushManager';
import { useAppStore } from '@/stores/useAppStore';
import type { Layer } from '@/types';
import { createDefaultLayerAlignment } from '@/utils/layoutDefaults';

const layerId = 'crop-mask';
const makeState = (
  width: number,
  height: number,
  alpha: number[] | null,
  version = 1,
): ColorCycleSerializedState => ({
  cycleSpeed: 1,
  fps: 30,
  brushSize: 1,
  layers: [{
    layerId,
    data: new ColorCycleAnimator({
      width, height, fps: 30, speed: 1, autoStart: false, forceCanvas2D: true,
    }).serialize(),
    strokeData: {
      paintBuffer: new Uint8Array(width * height).buffer,
      hasContent: false,
      strokeCounter: 0,
    },
    ...(alpha ? { eraseMaskSnapshot: { width, height, alpha: new Uint8ClampedArray(alpha), version } } : {}),
  }],
});

const maskState = () => {
  const data = useAppStore.getState().layers[0].colorCycleData!;
  const mask = data.eraseMask;
  const image = mask?.getContext('2d')?.getImageData(0, 0, mask.width, mask.height);
  return {
    width: mask?.width,
    height: mask?.height,
    version: data.eraseMaskVersion,
    alpha: image ? Array.from(image.data).filter((_, index) => index % 4 === 3) : undefined,
  };
};

describe('ColorCycleEraseMaskDelta', () => {
  beforeEach(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 3;
    canvas.height = 2;
    const layer: Layer = {
      id: layerId,
      name: 'CC crop mask',
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
      colorCycleData: { canvas, gradient: [], mode: 'brush', hasContent: false },
      version: 1,
    };
    useAppStore.setState({
      layers: [layer],
      activeLayerId: layerId,
      layersNeedRecomposition: false,
      compositeSegments: [],
      pendingCompositeDirtyBatches: [],
    });
  });

  afterEach(() => jest.restoreAllMocks());

  it('restores different dimensions and fractional alpha on undo and redo without touching anchors', async () => {
    const managerRead = jest.spyOn(colorCycleBrushManager, 'getColorCycleBrushManager');
    const delta = createColorCycleEraseMaskDelta({
      layerId,
      backwardState: makeState(3, 2, [0, 1, 48, 127, 254, 255], 7),
      forwardState: makeState(2, 1, [48, 127], 8),
    })!;
    await replayDeltaForTest(delta, 'forward');
    expect(maskState()).toEqual({ width: 2, height: 1, version: 8, alpha: [48, 127] });
    await replayDeltaForTest(delta, 'backward');
    expect(maskState()).toEqual({ width: 3, height: 2, version: 7, alpha: [0, 1, 48, 127, 254, 255] });
    await replayDeltaForTest(delta, 'forward');
    expect(maskState()).toEqual({ width: 2, height: 1, version: 8, alpha: [48, 127] });
    expect(managerRead).not.toHaveBeenCalled();
    expect(useAppStore.getState().layersNeedRecomposition).toBe(true);
    expect(useAppStore.getState().pendingCompositeDirtyBatches[0]?.layerId).toBe(layerId);
  });

  it.each([false, true])('preserves actual mask absence with reversed states=%s', async (reverse) => {
    const absent = makeState(3, 2, null);
    const transparent = makeState(2, 1, [0, 0], 4);
    const delta = createColorCycleEraseMaskDelta({
      layerId,
      backwardState: reverse ? transparent : absent,
      forwardState: reverse ? absent : transparent,
    })!;
    expect(delta).not.toBeNull();
    await replayDeltaForTest(delta, reverse ? 'backward' : 'forward');
    expect(maskState()).toEqual({ width: 2, height: 1, version: 4, alpha: [0, 0] });
    await replayDeltaForTest(delta, reverse ? 'forward' : 'backward');
    const data = useAppStore.getState().layers[0].colorCycleData!;
    expect(data).not.toHaveProperty('eraseMask');
    expect(data).not.toHaveProperty('eraseMaskImageData');
    expect(data).not.toHaveProperty('eraseMaskVersion');
  });

  it('captures immutable alpha and keeps version-only changes', async () => {
    const forwardState = makeState(1, 1, [73], 2)!;
    const delta = createColorCycleEraseMaskDelta({
      layerId, forwardState, backwardState: makeState(1, 1, [73], 1),
    })!;
    forwardState.layers[0].eraseMaskSnapshot!.alpha[0] = 200;
    await replayDeltaForTest(delta, 'forward');
    expect(maskState()).toEqual({ width: 1, height: 1, version: 2, alpha: [73] });
    await replayDeltaForTest(delta, 'backward');
    expect(maskState().version).toBe(1);
    expect(createColorCycleEraseMaskDelta({
      layerId, forwardState, backwardState: forwardState,
    })).toBeNull();
  });

  it('compensates to actual pre-replay mask references and dirty state after a later failure', async () => {
    await replayDeltaForTest(createColorCycleEraseMaskDelta({
      layerId, backwardState: null, forwardState: makeState(1, 2, [31, 99], 13),
    })!, 'forward');
    useAppStore.setState({ layersNeedRecomposition: false, pendingCompositeDirtyBatches: [] });
    const before = useAppStore.getState();
    const delta = createColorCycleEraseMaskDelta({
      layerId,
      backwardState: makeState(3, 2, [0, 1, 48, 127, 254, 255], 7),
      forwardState: makeState(2, 1, [48, 127], 8),
    })!;
    const failure: HistoryDelta = {
      _tag: 'late-failure',
      prepare: () => ({
        deltaTag: 'late-failure',
        apply: () => { throw new Error('Injected replay failure'); },
        requiresCompensation: () => false,
        compensate: () => undefined,
      }),
    };
    const manager = new HistoryManager({
      runtimeRehydration: {
        createTargets: () => ({ layerIds: new Set(), colorCycleLayerIds: new Set(), sequentialLayerIds: new Set(), workerScopes: new Set() }),
        rehydrate: async () => undefined,
      },
    });
    const transaction = manager.begin('crop');
    transaction.push(failure);
    transaction.push(delta);
    transaction.commit('Crop masks');
    await expect(manager.undo()).rejects.toBeInstanceOf(HistoryReplayApplyError);
    const after = useAppStore.getState();
    expect(after.layers).toBe(before.layers);
    expect(after.compositeSegments).toBe(before.compositeSegments);
    expect(after.pendingCompositeDirtyBatches).toBe(before.pendingCompositeDirtyBatches);
    expect(after.layersNeedRecomposition).toBe(false);
    expect(maskState()).toEqual({ width: 1, height: 2, version: 13, alpha: [31, 99] });
    expect(manager.entries()).toHaveLength(1);
  });

  it('rejects malformed dimensions before replay', () => {
    expect(() => createColorCycleEraseMaskDelta({
      layerId, forwardState: makeState(2, 1, [50]), backwardState: null,
    })).toThrow('Invalid color-cycle erase mask snapshot');
  });
});
