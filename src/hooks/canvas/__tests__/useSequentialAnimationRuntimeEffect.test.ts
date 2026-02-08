import { act, renderHook } from '@testing-library/react';
import { setFeatureFlag } from '@/config/featureFlags';
import { useSequentialAnimationRuntimeEffect } from '@/hooks/canvas/useSequentialAnimationRuntimeEffect';
import { useAppStore, type AppState } from '@/stores/useAppStore';
import { createDefaultLayerAlignment } from '@/utils/layoutDefaults';

const createSequentialLayer = () => {
  const framebuffer = document.createElement('canvas');
  framebuffer.width = 8;
  framebuffer.height = 8;
  return {
    id: 'layer-seq-runtime',
    name: 'SEQ Runtime',
    visible: true,
    opacity: 1,
    blendMode: 'source-over' as const,
    locked: false,
    order: 0,
    imageData: null,
    framebuffer,
    alignment: createDefaultLayerAlignment(),
    layerType: 'sequential' as const,
    sequentialData: {
      frameCount: 4,
      fps: 10,
      durationMs: 400,
      events: [],
    },
  };
};

describe('useSequentialAnimationRuntimeEffect', () => {
  let requestAnimationFrameSpy: jest.SpyInstance<number, [FrameRequestCallback]>;
  let cancelAnimationFrameSpy: jest.SpyInstance<void, [number]>;
  let rafCallback: FrameRequestCallback | null = null;
  let rafHandle = 0;

  beforeEach(() => {
    rafCallback = null;
    rafHandle = 0;
    requestAnimationFrameSpy = jest
      .spyOn(window, 'requestAnimationFrame')
      .mockImplementation((callback: FrameRequestCallback) => {
        rafHandle += 1;
        rafCallback = callback;
        return rafHandle;
      });
    cancelAnimationFrameSpy = jest.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});

    const sequentialLayer = createSequentialLayer();
    useAppStore.setState((state) => ({
      ...state,
      layers: [sequentialLayer],
      activeLayerId: sequentialLayer.id,
      colorCyclePlayback: {
        ...state.colorCyclePlayback,
        desiredPlaying: true,
        suspendDepth: 0,
      },
      sequentialRecord: {
        ...state.sequentialRecord,
        fps: 10,
        frameCount: 4,
        timeSmear: 1,
        currentFrame: 0,
        isPointerDown: true,
        isCaptureActive: false,
      },
    }));
    setFeatureFlag('enableSequentialRecordMode', true);
  });

  afterEach(() => {
    setFeatureFlag('enableSequentialRecordMode', false);
    requestAnimationFrameSpy.mockRestore();
    cancelAnimationFrameSpy.mockRestore();
    delete (globalThis as typeof globalThis & { vesselSequentialPerf?: unknown }).vesselSequentialPerf;
  });

  it('advances frames and keeps runtime ticking during sequential capture with no CC layers', () => {
    const storeRef = { current: useAppStore.getState() as AppState };
    const initialTickCount = useAppStore.getState().sequentialRecord.metrics.tickCount;
    const frameUpdateListener = jest.fn();
    window.addEventListener('vessel:animationFrameUpdate', frameUpdateListener as EventListener);

    const { unmount } = renderHook(() => {
      storeRef.current = useAppStore.getState() as AppState;
      useSequentialAnimationRuntimeEffect({ storeRef });
    });

    expect(requestAnimationFrameSpy).toHaveBeenCalled();
    expect(rafCallback).toBeTruthy();

    act(() => {
      rafCallback?.(1000);
    });
    act(() => {
      rafCallback?.(1250);
    });

    const nextState = useAppStore.getState();
    expect(nextState.sequentialRecord.currentFrame).toBe(2);
    expect(nextState.sequentialRecord.isCaptureActive).toBe(true);
    expect(nextState.sequentialRecord.metrics.tickCount).toBeGreaterThan(initialTickCount);
    expect(frameUpdateListener).toHaveBeenCalledTimes(1);

    unmount();
    window.removeEventListener('vessel:animationFrameUpdate', frameUpdateListener as EventListener);
  });

  it('caps large delta frame advances per tick to avoid runaway runtime loops', () => {
    const storeRef = { current: useAppStore.getState() as AppState };

    const { unmount } = renderHook(() => {
      storeRef.current = useAppStore.getState() as AppState;
      useSequentialAnimationRuntimeEffect({ storeRef });
    });

    expect(rafCallback).toBeTruthy();

    act(() => {
      rafCallback?.(1000);
    });
    act(() => {
      // fps=10 => frameDuration=100ms.
      // delta=5000ms would be 50 frame advances without a cap.
      // Guardrail caps to frameCount*2 (8) per tick.
      rafCallback?.(6000);
    });

    const nextState = useAppStore.getState();
    expect(nextState.sequentialRecord.currentFrame).toBe(0);

    unmount();
  });

  it('exposes a dev sequential perf probe with snapshot and reset actions', () => {
    const storeRef = { current: useAppStore.getState() as AppState };

    const { unmount } = renderHook(() => {
      storeRef.current = useAppStore.getState() as AppState;
      useSequentialAnimationRuntimeEffect({ storeRef });
    });

    const perfProbe = (
      globalThis as typeof globalThis & {
        vesselSequentialPerf?: {
          getSnapshot: () => {
            metrics: { tickCount: number };
            sequentialPayloadBytes: number;
          };
          resetMetrics: () => void;
          recordSample: () => unknown;
          getSamples: () => unknown[];
          clearSamples: () => void;
          summarizeSamples: () => {
            sampleCount: number;
            avgTickMsMean: number;
            payloadBytesMax: number;
          };
        };
      }
    ).vesselSequentialPerf;

    expect(perfProbe).toBeDefined();
    if (!perfProbe) {
      unmount();
      return;
    }

    act(() => {
      rafCallback?.(1000);
      rafCallback?.(1200);
    });

    const beforeReset = perfProbe.getSnapshot();
    expect(beforeReset.metrics.tickCount).toBeGreaterThan(0);
    expect(beforeReset.sequentialPayloadBytes).toBeGreaterThanOrEqual(0);

    act(() => {
      perfProbe.resetMetrics();
    });

    const afterReset = perfProbe.getSnapshot();
    expect(afterReset.metrics.tickCount).toBe(0);
    perfProbe.clearSamples();
    act(() => {
      perfProbe.recordSample();
      rafCallback?.(1400);
      perfProbe.recordSample();
    });
    const summary = perfProbe.summarizeSamples();
    expect(summary.sampleCount).toBe(2);
    expect(summary.avgTickMsMean).toBeGreaterThanOrEqual(0);
    expect(summary.payloadBytesMax).toBeGreaterThanOrEqual(0);
    expect(perfProbe.getSamples()).toHaveLength(2);

    unmount();
  });
});
