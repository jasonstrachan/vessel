import { act, renderHook } from '@testing-library/react';

import { getSequentialFrameCursor, getSequentialLayerRenderFrame } from '@/runtime/playback/sequentialFrameCursor';
import { setFeatureFlag } from '@/config/featureFlags';
import { useSequentialAnimationRuntimeEffect } from '@/hooks/canvas/useSequentialAnimationRuntimeEffect';
import { useAppStore, type AppState } from '@/stores/useAppStore';
import { BrushShape, type Layer } from '@/types';
import { createDefaultLayerAlignment } from '@/utils/layoutDefaults';

const createSequentialLayer = (): Layer => {
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
      events: [
        {
          id: 'seq-runtime-event',
          layerId: 'layer-seq-runtime',
          strokeId: 'seq-runtime-stroke',
          timestampMs: 0,
          frameIndex: 0,
          brush: {
            tool: 'brush',
            brushShape: BrushShape.ROUND,
            size: 1,
            opacity: 1,
              blendMode: 'source-over' as const,
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
        recordArmed: true,
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

  it('freezes the authored live frame when Pause follows a throttled UI publication', () => {
    const seq = createSequentialLayer();
    seq.sequentialData = {
      ...seq.sequentialData!,
      fps: 6,
      durationMs: 667,
      events: [0, 3].map(frameIndex => ({
        ...seq.sequentialData!.events[0],
        id: `authored-${frameIndex}`,
        frameIndex
      }))
    };
    useAppStore.setState(state => ({
      layers: [seq],
      activeLayerId: seq.id,
      selectedLayerIds: [seq.id],
      sequentialRecord: {
        ...state.sequentialRecord,
        fps: 6,
        frameCount: 4,
        durationMs: 667,
        currentFrame: 0,
        recordArmed: false,
        isPointerDown: false
      }
    }));
    const storeRef = {
      current: useAppStore.getState() as AppState
    };
    const {
      unmount
    } = renderHook(() => useSequentialAnimationRuntimeEffect({
      storeRef
    }));
    act(() => {
      rafCallback?.(1000);
    });
    act(() => {
      rafCallback?.(1400);
    });
    act(() => {
      rafCallback?.(1550);
    });
    const before = useAppStore.getState();
    const cursor = getSequentialFrameCursor();
    expect(before.sequentialRecord.currentFrame).toBe(2);
    expect(getSequentialLayerRenderFrame(before, before.layers[0])).toBe(3);
    const observed: Array<{
      desired: boolean;
      frame: number;
    }> = [];
    const unsubscribe = useAppStore.subscribe(state => observed.push({
      desired: state.colorCyclePlayback.desiredPlaying,
      frame: state.sequentialRecord.currentFrame
    }));
    try {
      act(() => {
        before.pauseColorCycle('toolbar');
      });
      const paused = useAppStore.getState();
      expect(paused.sequentialRecord.currentFrame).toBe(3);
      expect(getSequentialLayerRenderFrame(paused, paused.layers[0])).toBe(3);
      expect(observed.every(state => state.desired || state.frame === 3)).toBe(true);
      expect(getSequentialFrameCursor()).toEqual(cursor);
      expect(paused.layers).toBe(before.layers);
      expect(paused.selectedLayerIds).toBe(before.selectedLayerIds);
      expect(paused.history).toBe(before.history);
      expect(paused.sequentialRecord).toEqual({
        ...before.sequentialRecord,
        currentFrame: 3
      });
      expect(paused.colorCyclePlayback).toMatchObject({
        ...before.colorCyclePlayback,
        desiredPlaying: false,
        lastReason: 'toolbar',
        recentReasons: paused.colorCyclePlayback.recentReasons
      });
      const record = paused.sequentialRecord;
      act(() => {
        paused.pauseColorCycle('toolbar');
      });
      expect(useAppStore.getState().sequentialRecord).toBe(record);
      expect(getSequentialFrameCursor()).toEqual(cursor);
    } finally {
      unsubscribe();
      unmount();
    }
  });
  it('projects pause time using the active clip instead of dormant cursor frame metadata', () => {
    const seq = createSequentialLayer();
    seq.sequentialData = {
      ...seq.sequentialData!,
      fps: 6,
      frameCount: 4,
      durationMs: 667
    };
    const normal = {
      ...createSequentialLayer(),
      id: 'normal-clock-owner',
      layerType: 'normal' as const,
      sequentialData: undefined
    };
    useAppStore.setState(state => ({
      layers: [normal, seq],
      activeLayerId: normal.id,
      sequentialRecord: {
        ...state.sequentialRecord,
        fps: 12,
        frameCount: 24,
        durationMs: 2000,
        currentFrame: 0,
        recordArmed: false,
        isPointerDown: false
      }
    }));
    const storeRef = {
      current: useAppStore.getState() as AppState
    };
    const {
      unmount
    } = renderHook(() => useSequentialAnimationRuntimeEffect({
      storeRef
    }));
    act(() => {
      rafCallback?.(1000);
    });
    act(() => {
      rafCallback?.(1550);
    });
    act(() => {
      useAppStore.setState({
        activeLayerId: seq.id
      });
    });
    const before = useAppStore.getState();
    const cursor = getSequentialFrameCursor();
    expect(cursor.frameCount).toBe(24);
    expect(cursor.fps).toBe(12);
    expect(cursor.frame).toBe(6);
    expect(getSequentialLayerRenderFrame(before, before.layers[1])).toBe(3);
    act(() => {
      before.pauseColorCycle('toolbar');
    });
    expect(useAppStore.getState().sequentialRecord.currentFrame).toBe(3);
    expect(useAppStore.getState().sequentialRecord).toMatchObject({
      fps: 12,
      frameCount: 24
    });
    expect(getSequentialFrameCursor()).toEqual(cursor);
    expect(useAppStore.getState().layers).toBe(before.layers);
    unmount();
  });
  it.each(['normal', 'color-cycle'] as const)('leaves store frame untouched when %s is active', layerType => {
    const seq = createSequentialLayer();
    const active = {
      ...createSequentialLayer(),
      id: 'non-sequence-active',
      layerType,
      sequentialData: undefined
    };
    useAppStore.setState(state => ({
      layers: [active, seq],
      activeLayerId: active.id,
      sequentialRecord: {
        ...state.sequentialRecord,
        currentFrame: 1,
        recordArmed: false,
        isPointerDown: false
      }
    }));
    const storeRef = {
      current: useAppStore.getState() as AppState
    };
    const {
      unmount
    } = renderHook(() => useSequentialAnimationRuntimeEffect({
      storeRef
    }));
    act(() => {
      rafCallback?.(1000);
    });
    act(() => {
      rafCallback?.(1250);
    });
    const before = useAppStore.getState();
    const cursor = getSequentialFrameCursor();
    act(() => {
      before.pauseColorCycle('toolbar');
    });
    expect(useAppStore.getState().sequentialRecord).toBe(before.sequentialRecord);
    expect(useAppStore.getState().layers).toBe(before.layers);
    expect(getSequentialFrameCursor()).toEqual(cursor);
    unmount();
  });
  it('preserves record capture ownership and keeps capture ticking after playback Pause', () => {
    const storeRef = {
      current: useAppStore.getState() as AppState
    };
    const {
      unmount
    } = renderHook(() => useSequentialAnimationRuntimeEffect({
      storeRef
    }));
    act(() => {
      rafCallback?.(1000);
    });
    act(() => {
      rafCallback?.(1250);
    });
    const before = useAppStore.getState();
    const cursor = getSequentialFrameCursor();
    act(() => {
      before.pauseColorCycle('toolbar');
    });
    const paused = useAppStore.getState();
    expect(paused.sequentialRecord).toMatchObject({
      recordArmed: true,
      isPointerDown: true,
      isCaptureActive: true,
      sessionStartMs: before.sequentialRecord.sessionStartMs
    });
    expect(paused.layers).toBe(before.layers);
    expect(getSequentialFrameCursor()).toEqual(cursor);
    act(() => {
      rafCallback?.(1350);
    });
    expect(getSequentialFrameCursor().timeMs).toBeGreaterThan(cursor.timeMs);
    expect(useAppStore.getState().colorCyclePlayback.desiredPlaying).toBe(false);
    unmount();
  });

  it('advances frames and keeps runtime ticking during sequential capture with no CC layers', () => {
    const storeRef = { current: useAppStore.getState() as AppState };
    const initialTickCount = useAppStore.getState().sequentialRecord.metrics.tickCount;
    const frameUpdateListener = jest.fn();
    window.addEventListener('vessel:sequentialFrameUpdate', frameUpdateListener as EventListener);

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
    window.removeEventListener('vessel:sequentialFrameUpdate', frameUpdateListener as EventListener);
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
    expect(nextState.sequentialRecord.currentFrame).toBe(2);

    act(() => {
      useAppStore.getState().setSequentialPointerDown(false);
      rafCallback?.(1500);
    });

    const afterPointerUp = useAppStore.getState();
    expect(afterPointerUp.sequentialRecord.currentFrame).toBe(2);
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
    expect(nextState.sequentialRecord.currentFrame).toBe(2);

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

  it('does not request a canvas redraw before any visible sequence frame changes', () => {
    const frameUpdateListener = jest.fn();
    window.addEventListener('vessel:sequentialFrameUpdate', frameUpdateListener as EventListener);
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
    expect(frameUpdateListener).not.toHaveBeenCalled();

    unmount();
    window.removeEventListener('vessel:sequentialFrameUpdate', frameUpdateListener as EventListener);
  });

});
