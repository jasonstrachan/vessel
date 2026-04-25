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
            events: [],
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
    expect(layer?.sequentialData?.events[0]?.frameIndex).toBe(3);
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

  it('tracks pointer state and runtime metrics', () => {
    const store = useAppStore.getState();
    store.setSequentialPointerDown(true);
    expect(useAppStore.getState().sequentialRecord.isPointerDown).toBe(true);
    expect(useAppStore.getState().sequentialRecord.sessionStartMs).not.toBeNull();
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

  it('enables sequential playback selector when any sequential layer exists', () => {
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
        isPointerDown: true,
      },
    });

    const state = useAppStore.getState();
    expect(selectSequentialPlaybackActive(state)).toBe(false);
    expect(selectSequentialCaptureActive(state)).toBe(true);
    expect(selectGlobalAnimationActive(state)).toBe(true);
  });
});
