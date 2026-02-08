import {
  selectGlobalAnimationActive,
  selectSequentialCaptureActive,
  selectSequentialPlaybackActive,
  useAppStore,
} from '@/stores/useAppStore';
import type { Layer } from '@/types';
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

    store.setTimeSmear(100);
    expect(useAppStore.getState().sequentialRecord.timeSmear).toBe(8);

    const next = useAppStore.getState().sequentialRecord;
    expect(next.durationMs).toBe(Math.round((next.frameCount * 1000) / next.fps));
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
});
