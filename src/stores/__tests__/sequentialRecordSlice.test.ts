import historyManager from '@/history/historyService';
import {
  selectGlobalAnimationActive,
  selectSequentialCaptureActive,
  selectSequentialPlaybackActive,
  useAppStore,
} from '@/stores/useAppStore';
import { BrushShape, type Layer } from '@/types';
import { createDefaultLayerAlignment } from '@/utils/layoutDefaults';

const createLayer = (id: string, layerType: Layer['layerType']): Layer => {
  const canvas = document.createElement('canvas');
  canvas.width = 1;
  canvas.height = 1;
  return {
    id,
    name: id,
    visible: true,
    opacity: 1,
    blendMode: 'source-over',
    locked: false,
    order: 0,
    imageData: null,
    framebuffer: canvas,
    alignment: createDefaultLayerAlignment(),
    layerType,
    colorCycleData:
      layerType === 'color-cycle'
        ? {
            isAnimating: false,
            gradient: [
              { position: 0, color: '#000000' },
              { position: 1, color: '#ffffff' },
            ],
          }
        : undefined,
    sequentialData:
      layerType === 'sequential'
        ? {
            frameCount: 12,
            fps: 12,
            durationMs: 1000,
            events: [
              {
                id: `${id}-event`,
                layerId: id,
                strokeId: `${id}-stroke`,
                timestampMs: 0,
                frameIndex: 0,
                brush: {
                  tool: 'brush',
                  brushShape: BrushShape.ROUND,
                  size: 1,
                  opacity: 1,
                  blendMode: 'source-over',
                  rotation: 0,
                  spacing: 1,
                  color: '#000000',
                  customStampId: null,
                  customStampHash: null,
                  customStamp: null,
                  ditherEnabled: false,
                },
                stamps: [{ x: 0, y: 0, pressure: 1, rotation: 0, size: 1, alpha: 1 }],
              },
            ],
          }
        : undefined,
  };
};

describe('sequentialRecordSlice', () => {
  it('defaults sequence playback to 12 fps and time smear to 40', () => {
    const initialState = useAppStore.getInitialState();
    expect(initialState.sequentialRecord.fps).toBe(12);
    expect(initialState.sequentialRecord.timeSmear).toBe(40);
  });

  beforeEach(() => {
    useAppStore.setState((state) => ({
      colorCyclePlayback: {
        ...state.colorCyclePlayback,
        desiredPlaying: false,
        suspendDepth: 0,
      },
      layers: [createLayer('layer-normal', 'normal')],
      activeLayerId: 'layer-normal',
      sequentialRecord: {
        ...state.sequentialRecord,
        fps: 12,
        frameCount: 12,
        timeSmear: 1,
        currentFrame: 0,
        durationMs: 1000,
        isPointerDown: false,
        isCaptureActive: false,
        sessionStartMs: null,
      },
    }));
  });

  it('updates fps/frameCount/timeSmear with clamping and duration updates', () => {
    const store = useAppStore.getState();

    store.setRecordFPS(0);
    expect(useAppStore.getState().sequentialRecord.fps).toBe(1);

    store.setRecordFrameCount(2048);
    expect(useAppStore.getState().sequentialRecord.frameCount).toBe(512);

    store.setTimeSmear(200);
    expect(useAppStore.getState().sequentialRecord.timeSmear).toBe(160);

    const next = useAppStore.getState().sequentialRecord;
    expect(next.durationMs).toBe(Math.round((next.frameCount * 1000) / next.fps));
  });

  it('syncs active sequential layer playback metadata when controls change', () => {
    useAppStore.setState({
      layers: [createLayer('layer-seq', 'sequential')],
      activeLayerId: 'layer-seq',
    });
    useAppStore.setState((state) => ({
      layers: state.layers.map((layer) =>
        layer.id === 'layer-seq'
          ? {
              ...layer,
              sequentialData: {
                ...layer.sequentialData!,
                frameCount: 12,
                fps: 12,
                durationMs: 1000,
                events: [
                  {
                    id: 'event-1',
                    layerId: 'layer-seq',
                    strokeId: 'stroke-1',
                    timestampMs: 0,
                    frameIndex: 11,
                    brush: {
                      tool: 'brush',
                      brushShape: BrushShape.ROUND,
                      size: 6,
                      opacity: 1,
                      blendMode: 'source-over',
                      rotation: 0,
                      spacing: 1,
                      color: '#000000',
                      customStampId: null,
                      customStampHash: null,
                      customStamp: null,
                      ditherEnabled: false,
                    },
                    stamps: [{ x: 1, y: 1, pressure: 1, rotation: 0, size: 6, alpha: 1 }],
                  },
                ],
              },
            }
          : layer
      ),
    }));

    const store = useAppStore.getState();
    store.setRecordFrameCount(4);
    store.setRecordFPS(24);

    const layer = useAppStore.getState().layers.find((entry) => entry.id === 'layer-seq');
    expect(layer?.sequentialData?.frameCount).toBe(4);
    expect(layer?.sequentialData?.fps).toBe(24);
    expect(layer?.sequentialData?.durationMs).toBe(Math.round((4 * 1000) / 24));
    expect(layer?.sequentialData?.events[0]?.frameIndex).toBe(11);
  });

  it('steps and sets sequential frame with wrap-around', () => {
    const store = useAppStore.getState();
    store.setRecordFrameCount(4);
    store.setSequentialFrame(3);

    store.stepSequentialFrame(1);
    expect(useAppStore.getState().sequentialRecord.currentFrame).toBe(0);

    store.setSequentialFrame(-1);
    expect(useAppStore.getState().sequentialRecord.currentFrame).toBe(3);
  });

  it('supports explicit trim and retime frame resize policies', () => {
    const baseLayer = createLayer('layer-seq-resize', 'sequential');
    const baseEvents = [0, 6, 11].map((frameIndex) => ({
      ...baseLayer.sequentialData!.events[0],
      id: `event-${frameIndex}`,
      frameIndex,
    }));
    baseLayer.sequentialData = {
      ...baseLayer.sequentialData!,
      frameCount: 12,
      events: baseEvents,
    };
    useAppStore.setState({ layers: [baseLayer], activeLayerId: baseLayer.id });

    useAppStore.getState().setRecordFrameCount(6, 'trim');
    expect(
      useAppStore.getState().layers[0].sequentialData?.events.map((event) => event.frameIndex),
    ).toEqual([0]);

    baseLayer.sequentialData = {
      ...baseLayer.sequentialData!,
      frameCount: 12,
      events: baseEvents,
    };
    useAppStore.setState({ layers: [baseLayer], activeLayerId: baseLayer.id });
    useAppStore.getState().setRecordFrameCount(6, 'retime');
    expect(
      useAppStore.getState().layers[0].sequentialData?.events.map((event) => event.frameIndex),
    ).toEqual([0, 3, 5]);
  });

  it('tracks pointer state and runtime metrics', () => {
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(1234);
    const store = useAppStore.getState();
    store.setSequentialPointerDown(true);
    expect(useAppStore.getState().sequentialRecord.isPointerDown).toBe(true);
    expect(useAppStore.getState().sequentialRecord.sessionStartMs).toBe(1234);
    useAppStore.getState().setSequentialCaptureActive(true);
    expect(useAppStore.getState().sequentialRecord.isCaptureActive).toBe(true);

    store.setSequentialPointerDown(false);
    expect(useAppStore.getState().sequentialRecord.isPointerDown).toBe(false);
    expect(useAppStore.getState().sequentialRecord.sessionStartMs).toBeNull();
    expect(useAppStore.getState().sequentialRecord.isCaptureActive).toBe(false);

    store.recordSequentialRuntimeTick(6);
    store.recordSequentialRuntimeTick(10);
    const metrics = useAppStore.getState().sequentialRecord.metrics;
    expect(metrics.tickCount).toBe(2);
    expect(metrics.lastTickMs).toBe(10);
    expect(metrics.avgTickMs).toBeCloseTo(8);
    nowSpy.mockRestore();
  });

  it('does not emit store updates when frame cache stats are unchanged', () => {
    const store = useAppStore.getState();
    const listener = jest.fn();
    const unsubscribe = useAppStore.subscribe(listener);

    store.setSequentialFrameCacheStats({
      frameCacheEntries: 5,
      frameCacheHits: 10,
      frameCacheMisses: 2,
    });
    const callsAfterChange = listener.mock.calls.length;
    expect(callsAfterChange).toBeGreaterThan(0);

    store.setSequentialFrameCacheStats({
      frameCacheEntries: 5,
      frameCacheHits: 10,
      frameCacheMisses: 2,
    });
    expect(listener).toHaveBeenCalledTimes(callsAfterChange);

    unsubscribe();
  });

  it('computes sequential playback/capture/global selector truth table', () => {
    useAppStore.setState({
      layers: [
        createLayer('layer-cc', 'color-cycle'),
        createLayer('layer-seq', 'sequential'),
      ],
      activeLayerId: 'layer-seq',
      colorCyclePlayback: {
        ...useAppStore.getState().colorCyclePlayback,
        desiredPlaying: true,
        suspendDepth: 0,
      },
      sequentialRecord: {
        ...useAppStore.getState().sequentialRecord,
        isPointerDown: false,
      },
    });

    let state = useAppStore.getState();
    expect(selectSequentialPlaybackActive(state)).toBe(true);
    expect(selectSequentialCaptureActive(state)).toBe(false);
    expect(selectGlobalAnimationActive(state)).toBe(true);

    state.setSequentialRecordArmed(true);
    state.setSequentialPointerDown(true);
    state = useAppStore.getState();
    expect(selectSequentialCaptureActive(state)).toBe(true);

    useAppStore.setState({
      colorCyclePlayback: {
        ...state.colorCyclePlayback,
        suspendDepth: 1,
      },
    });
    state = useAppStore.getState();
    expect(selectSequentialPlaybackActive(state)).toBe(true);
    expect(selectSequentialCaptureActive(state)).toBe(true);
    expect(selectGlobalAnimationActive(state)).toBe(true);
  });

  it('enables sequential playback selector when a visible sequential layer has events', () => {
    useAppStore.setState({
      layers: [
        createLayer('layer-normal', 'normal'),
        createLayer('layer-seq', 'sequential'),
      ],
      activeLayerId: 'layer-normal',
      colorCyclePlayback: {
        ...useAppStore.getState().colorCyclePlayback,
        desiredPlaying: true,
        suspendDepth: 2,
      },
      sequentialRecord: {
        ...useAppStore.getState().sequentialRecord,
        recordArmed: true,
        isPointerDown: true,
      },
    });

    let state = useAppStore.getState();
    expect(selectSequentialPlaybackActive(state)).toBe(true);
    expect(selectSequentialCaptureActive(state)).toBe(false);
    expect(selectGlobalAnimationActive(state)).toBe(true);

    useAppStore.setState({ activeLayerId: 'layer-seq' });
    state = useAppStore.getState();
    expect(selectSequentialPlaybackActive(state)).toBe(true);
    expect(selectSequentialCaptureActive(state)).toBe(true);
    expect(selectGlobalAnimationActive(state)).toBe(true);
  });

  it('does not run sequential playback for empty or hidden sequential layers', () => {
    const emptyLayer = createLayer('layer-empty-seq', 'sequential');
    emptyLayer.sequentialData = {
      ...emptyLayer.sequentialData!,
      events: [],
    };
    const hiddenLayer = createLayer('layer-hidden-seq', 'sequential');
    hiddenLayer.visible = false;

    useAppStore.setState({
      layers: [emptyLayer, hiddenLayer],
      activeLayerId: emptyLayer.id,
      colorCyclePlayback: {
        ...useAppStore.getState().colorCyclePlayback,
        desiredPlaying: true,
        suspendDepth: 0,
      },
      sequentialRecord: {
        ...useAppStore.getState().sequentialRecord,
        isPointerDown: false,
      },
    });

    const state = useAppStore.getState();
    expect(selectSequentialPlaybackActive(state)).toBe(false);
    expect(selectGlobalAnimationActive(state)).toBe(true);
  });

  it('keeps sequential capture active on sequential layers even when playback is paused', () => {
    useAppStore.setState({
      layers: [createLayer('layer-seq', 'sequential')],
      activeLayerId: 'layer-seq',
      colorCyclePlayback: {
        ...useAppStore.getState().colorCyclePlayback,
        desiredPlaying: false,
        suspendDepth: 0,
      },
      sequentialRecord: {
        ...useAppStore.getState().sequentialRecord,
        recordArmed: true,
        isPointerDown: true,
      },
    });

    const state = useAppStore.getState();
    expect(selectSequentialPlaybackActive(state)).toBe(false);
    expect(selectSequentialCaptureActive(state)).toBe(true);
    expect(selectGlobalAnimationActive(state)).toBe(true);
  });
});

describe('sequential settings real history', () => {
  const setup = () => {
    historyManager.clear();
    const target = createLayer('settings-target', 'sequential');
    target.sequentialData = {
      ...target.sequentialData!,
      frameCount: 4,
      fps: 1,
      durationMs: 4000,
      events: [0, 3].map(frameIndex => ({
        ...target.sequentialData!.events[0],
        id: `settings-${frameIndex}`,
        frameIndex
      })),
      eventChunks: [{
        id: 'settings-chunk',
        startEventIndex: 0,
        eventCount: 2,
        frameIndexes: [0, 3]
      }]
    };
    const other = createLayer('settings-other', 'normal');
    useAppStore.setState(state => ({
      layers: [target, other],
      activeLayerId: target.id,
      selectedLayerIds: [target.id],
      sequentialRecord: {
        ...state.sequentialRecord,
        fps: 1,
        frameCount: 4,
        currentFrame: 3,
        durationMs: 4000,
        recordArmed: false
      }
    }));
    return {
      target: useAppStore.getState().layers[0],
      other: useAppStore.getState().layers[1],
      data: useAppStore.getState().layers[0].sequentialData!
    };
  };
  it('records FPS as one bounded metadata command and replays twice without event copies', async () => {
    const {
      data,
      other
    } = setup();
    const canvas = document.createElement('canvas');
    useAppStore.setState({
      layersNeedRecomposition: false,
      pendingCompositeDirtyBatches: [],
      compositeSegments: [{
        kind: 'static',
        id: 'owned',
        layerIds: ['settings-target'],
        includeBackground: false,
        orderRange: {
          start: 0,
          end: 0
        },
        canvas,
        bitmap: null,
        dirty: false
      }, {
        kind: 'static',
        id: 'foreign',
        layerIds: ['settings-other'],
        includeBackground: false,
        orderRange: {
          start: 1,
          end: 1
        },
        canvas,
        bitmap: null,
        dirty: false
      }]
    });
    useAppStore.getState().setRecordFPS(2);
    expect(useAppStore.getState().layersNeedRecomposition).toBe(true);
    expect(useAppStore.getState().compositeSegments.map(segment => segment.kind === 'static' && segment.dirty)).toEqual([true, false]);
    expect(historyManager.entries()).toHaveLength(1);
    expect(useAppStore.getState().layers[0].sequentialData).toMatchObject({
      fps: 2,
      durationMs: 2000
    });
    expect(useAppStore.getState().layers[0].sequentialData!.events).toBe(data.events);
    useAppStore.setState(state => ({
      colorCyclePlayback: {
        ...state.colorCyclePlayback,
        desiredPlaying: true
      },
      sequentialRecord: {
        ...state.sequentialRecord,
        trailFalloff: 0.45
      }
    }));
    for (let i = 0; i < 2; i += 1) {
      await historyManager.undo();
      expect(useAppStore.getState().layers[0].sequentialData).toMatchObject({
        fps: 1,
        durationMs: 4000
      });
      expect(useAppStore.getState().sequentialRecord).toMatchObject({
        fps: 1,
        durationMs: 4000,
        currentFrame: 3
      });
      await historyManager.redo();
      expect(useAppStore.getState().layers[0].sequentialData).toMatchObject({
        fps: 2,
        durationMs: 2000
      });
      expect(useAppStore.getState().sequentialRecord).toMatchObject({
        fps: 2,
        durationMs: 2000,
        currentFrame: 3
      });
      expect(useAppStore.getState().layers[0].sequentialData!.events).toBe(data.events);
      expect(useAppStore.getState().layers[0].sequentialData!.eventChunks).toBe(data.eventChunks);
      expect(useAppStore.getState().layers[1]).toBe(other);
      expect(useAppStore.getState().selectedLayerIds).toEqual(['settings-target']);
      expect(useAppStore.getState().colorCyclePlayback.desiredPlaying).toBe(true);
      expect(useAppStore.getState().sequentialRecord.trailFalloff).toBe(0.45);
    }
  });
  it.each(['preserve', 'trim', 'retime'] as const)('owns %s frame policy and its global settings through real replay', async mode => {
    const {
      data,
      other
    } = setup();
    useAppStore.getState().setRecordFrameCount(2, mode);
    expect(historyManager.entries()).toHaveLength(1);
    const expectedFrames = mode === 'trim' ? [0] : mode === 'retime' ? [0, 1] : [0, 3];
    const after = useAppStore.getState().layers[0].sequentialData!;
    expect(after.events.map(e => e.frameIndex)).toEqual(expectedFrames);
    expect(after.eventChunks).toEqual(data.eventChunks);
    for (let i = 0; i < 2; i += 1) {
      await historyManager.undo();
      expect(useAppStore.getState().layers[0].sequentialData).toEqual(data);
      expect(useAppStore.getState().sequentialRecord).toMatchObject({
        frameCount: 4,
        durationMs: 4000,
        currentFrame: 3
      });
      await historyManager.redo();
      expect(useAppStore.getState().layers[0].sequentialData).toEqual(after);
      expect(useAppStore.getState().sequentialRecord).toMatchObject({
        frameCount: 2,
        durationMs: 2000,
        currentFrame: 1
      });
      expect(useAppStore.getState().layers[1]).toBe(other);
    }
  });
  it('replays the native FPS/Preserve2/Preserve4 command sequence without reverting paint', async () => {
    const {
      data
    } = setup();
    useAppStore.getState().setRecordFPS(2);
    useAppStore.getState().setRecordFrameCount(2, 'preserve');
    useAppStore.getState().setRecordFrameCount(4, 'preserve');
    expect(historyManager.entries()).toHaveLength(3);
    for (const expected of [{
      fps: 2,
      frameCount: 2
    }, {
      fps: 2,
      frameCount: 4
    }, {
      fps: 1,
      frameCount: 4
    }]) {
      await historyManager.undo();
      expect(useAppStore.getState().layers[0].sequentialData).toMatchObject(expected);
      expect(useAppStore.getState().layers[0].sequentialData!.events).toBe(data.events);
    }
    for (const expected of [{
      fps: 2,
      frameCount: 4
    }, {
      fps: 2,
      frameCount: 2
    }, {
      fps: 2,
      frameCount: 4
    }]) {
      await historyManager.redo();
      expect(useAppStore.getState().layers[0].sequentialData).toMatchObject(expected);
      expect(useAppStore.getState().layers[0].sequentialData!.events).toBe(data.events);
    }
  });
  it('keeps normalized noops and global-only configuration out of history', () => {
    const {
      data
    } = setup();
    useAppStore.getState().setRecordFPS(0);
    useAppStore.getState().setRecordFrameCount(4, 'retime');
    expect(historyManager.entries()).toHaveLength(0);
    expect(useAppStore.getState().layers[0].sequentialData).toBe(data);
    useAppStore.setState({
      activeLayerId: 'settings-other'
    });
    useAppStore.getState().setRecordFPS(60);
    useAppStore.getState().setRecordFrameCount(512);
    expect(historyManager.entries()).toHaveLength(0);
    expect(useAppStore.getState().sequentialRecord).toMatchObject({
      fps: 60,
      frameCount: 512
    });
  });
  it.each(['push', 'commit'] as const)('cancels a transaction rejected during %s before publishing', phase => {
    setup();
    const before = useAppStore.getState();
    const begin = historyManager.begin.bind(historyManager);
    let cancelled = false;
    const spy = jest.spyOn(historyManager, 'begin').mockImplementation((...args) => {
      const txn = begin(...args);
      const cancel = txn.cancel.bind(txn);
      txn.cancel = () => {
        cancelled = true;
        cancel();
      };
      jest.spyOn(txn, phase).mockImplementation(() => {
        throw new Error('preaccept settings rejection');
      });
      return txn;
    });
    try {
      expect(() => before.setRecordFPS(2)).toThrow('preaccept settings rejection');
      expect(cancelled).toBe(true);
      expect(historyManager.entries()).toHaveLength(0);
      expect(useAppStore.getState().layers).toBe(before.layers);
      expect(useAppStore.getState().sequentialRecord).toBe(before.sequentialRecord);
    } finally {
      spy.mockRestore();
    }
  });

  it('does not publish a settings change rejected before history acceptance', () => {
    setup();
    const before = useAppStore.getState();
    const spy = jest.spyOn(historyManager, 'begin').mockImplementation(() => {
      throw new Error('settings admission rejected');
    });
    try {
      expect(() => before.setRecordFPS(2)).toThrow('settings admission rejected');
      expect(useAppStore.getState().layers).toBe(before.layers);
      expect(useAppStore.getState().sequentialRecord).toBe(before.sequentialRecord);
    } finally {
      spy.mockRestore();
    }
  });
});
