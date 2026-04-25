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
    expect(nextState.sequentialRecord.currentFrame).toBe(1);
    expect(nextState.sequentialRecord.isCaptureActive).toBe(true);
    expect(nextState.sequentialRecord.metrics.tickCount).toBeGreaterThan(initialTickCount);
    expect(frameUpdateListener).toHaveBeenCalledTimes(1);

    unmount();
    window.removeEventListener('vessel:animationFrameUpdate', frameUpdateListener as EventListener);
  });

  it('advances frames while capturing with playback paused, then stops on pointer up', () => {
    useAppStore.setState((state) => ({
      colorCyclePlayback: {
        ...state.colorCyclePlayback,
        desiredPlaying: false,
        suspendDepth: 0,
      },
      sequentialRecord: {
        ...state.sequentialRecord,
        isPointerDown: true,
        isCaptureActive: false,
        currentFrame: 0,
      },
    }));

    const storeRef = { current: useAppStore.getState() as AppState };
    const initialTickCount = useAppStore.getState().sequentialRecord.metrics.tickCount;
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
    expect(nextState.sequentialRecord.isCaptureActive).toBe(true);
    expect(nextState.sequentialRecord.metrics.tickCount).toBeGreaterThan(initialTickCount);
    expect(nextState.sequentialRecord.currentFrame).toBe(1);

    act(() => {
      useAppStore.getState().setSequentialPointerDown(false);
      rafCallback?.(1500);
    });

    const afterPointerUp = useAppStore.getState();
    expect(afterPointerUp.sequentialRecord.currentFrame).toBe(1);
    expect(afterPointerUp.sequentialRecord.isCaptureActive).toBe(false);

    unmount();
  });

  it('drops huge realtime gaps instead of catching up after tab resume', () => {
    useAppStore.setState((state) => ({
      sequentialRecord: {
        ...state.sequentialRecord,
        isPointerDown: false,
        isCaptureActive: false,
        currentFrame: 0,
      },
    }));
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
      // delta=5000ms simulates a hidden tab resuming; it should not create catch-up speed.
      rafCallback?.(6000);
    });

    const nextState = useAppStore.getState();
    expect(nextState.sequentialRecord.currentFrame).toBe(0);

    act(() => {
      rafCallback?.(6100);
    });

    expect(useAppStore.getState().sequentialRecord.currentFrame).toBe(1);

    unmount();
  });

  it('advances at most one frame per tick during capture catch-up', () => {
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
      rafCallback?.(6000);
    });

    expect(useAppStore.getState().sequentialRecord.currentFrame).toBe(0);

    act(() => {
      rafCallback?.(6100);
    });

    expect(useAppStore.getState().sequentialRecord.currentFrame).toBe(1);

    unmount();
  });

  it('does not let time-smear change playback frame stepping speed', () => {
    useAppStore.setState((state) => ({
      sequentialRecord: {
        ...state.sequentialRecord,
        timeSmear: 4,
        currentFrame: 0,
      },
    }));

    const storeRef = { current: useAppStore.getState() as AppState };
    const { unmount } = renderHook(() => {
      storeRef.current = useAppStore.getState() as AppState;
      useSequentialAnimationRuntimeEffect({ storeRef });
    });

    act(() => {
      rafCallback?.(1000);
    });
    act(() => {
      rafCallback?.(1250);
    });

    const nextState = useAppStore.getState();
    expect(nextState.sequentialRecord.currentFrame).toBe(1);

    unmount();
  });

  it('does not let color-cycle playback speed scale change sequence frame stepping speed', () => {
    useAppStore.setState((state) => ({
      ...state,
      colorCyclePlayback: {
        ...state.colorCyclePlayback,
        desiredPlaying: true,
        playbackSpeedScale: 3,
      },
      sequentialRecord: {
        ...state.sequentialRecord,
        fps: 10,
        currentFrame: 0,
      },
    }));

    const storeRef = { current: useAppStore.getState() as AppState };
    const { unmount } = renderHook(() => {
      storeRef.current = useAppStore.getState() as AppState;
      useSequentialAnimationRuntimeEffect({ storeRef });
    });

    act(() => {
      rafCallback?.(1000);
    });
    act(() => {
      rafCallback?.(1050);
    });

    expect(useAppStore.getState().sequentialRecord.currentFrame).toBe(0);

    act(() => {
      rafCallback?.(1100);
    });

    expect(useAppStore.getState().sequentialRecord.currentFrame).toBe(1);

    unmount();
  });

});
