import type React from 'react';
import { BrushShape } from '@/types';
import type { BrushEngine } from '@/hooks/useBrushEngineSimplified';
import type { AppState } from '@/stores/useAppStore';
import {
  startContinuousColorCycleAnimationCore,
  stopContinuousColorCycleAnimationCore,
} from '@/hooks/canvas/handlers/colorCycle/colorCyclePlayback';

const dispatchGlobalAnimationFrameUpdate = jest.fn();
const registerSharedRuntimeConsumer = jest.fn();
const startSharedRuntime = jest.fn();

jest.mock('@/hooks/canvas/handlers/animation/animationRuntime', () => ({
  dispatchGlobalAnimationFrameUpdate: (...args: unknown[]) =>
    dispatchGlobalAnimationFrameUpdate(...args),
  getSharedAnimationRuntime: () => ({
    register: (...args: unknown[]) => registerSharedRuntimeConsumer(...args),
    start: (...args: unknown[]) => startSharedRuntime(...args),
  }),
}));

describe('colorCyclePlayback shared runtime integration', () => {
  beforeEach(() => {
    dispatchGlobalAnimationFrameUpdate.mockReset();
    registerSharedRuntimeConsumer.mockReset();
    startSharedRuntime.mockReset();
  });

  it('registers a shared runtime consumer and unregisters on stop', () => {
    const unregister = jest.fn();
    registerSharedRuntimeConsumer.mockImplementation(() => unregister);

    const updateLayer = jest.fn();
    const state = {
      tools: {
        brushSettings: {
          brushShape: BrushShape.COLOR_CYCLE,
          customBrushColorCycle: false,
        },
      },
      layers: [
        {
          id: 'layer-cc',
          layerType: 'color-cycle',
          colorCycleData: {
            mode: 'index',
            isAnimating: false,
          },
        },
      ],
      project: { width: 64, height: 64 },
      initColorCycleForLayer: jest.fn(),
      updateLayer,
    } as unknown as AppState;

    const storeRef = { current: state } as React.MutableRefObject<AppState>;
    const continuousColorCycleAnimationRef = { current: null as number | null };
    const continuousColorCycleAnimationActiveRef = { current: false };
    const drawingCanvasHasContent = { current: false };
    const renderAllColorCycleLayers = jest.fn(() => true);

    startContinuousColorCycleAnimationCore('toolbar', {
      brushEngine: {
        renderColorCycle: jest.fn(),
        updateColorCycleAnimation: jest.fn(),
        isColorCycleAnimating: jest.fn(() => false),
      } as unknown as BrushEngine,
      ensureOverlayInitialized: jest.fn(() => true),
      renderAllColorCycleLayers,
      storeRef,
      getEffectiveColorCyclePlaying: jest.fn(() => true),
      cancelDeferredOverlayRender: jest.fn(),
      scheduleDeferredOverlayRender: jest.fn(),
      ccLog: jest.fn(),
      ccGroup: jest.fn(),
      ccGroupEnd: jest.fn(),
      dumpLayerFlags: jest.fn(),
      debugWarn: jest.fn(),
      continuousColorCycleAnimationRef,
      continuousColorCycleAnimationActiveRef,
      startingColorCycleAnimationRef: { current: false },
      lastStartAtRef: { current: 0 },
      drawingCanvasRef: { current: null },
      drawingCtxRef: { current: null },
      drawingCanvasHasContent,
      firstPaintRef: { current: true },
      lastRendererLogTS: { current: 0 },
      startCooldownMs: 0,
    });

    expect(registerSharedRuntimeConsumer).toHaveBeenCalledTimes(1);
    expect(startSharedRuntime).toHaveBeenCalledTimes(1);
    expect(continuousColorCycleAnimationRef.current).toBe(-1);
    expect(continuousColorCycleAnimationActiveRef.current).toBe(true);

    const runtimeConsumer = registerSharedRuntimeConsumer.mock.calls[0]?.[0] as
      | ((timestampMs: number) => void)
      | undefined;
    expect(typeof runtimeConsumer).toBe('function');

    runtimeConsumer?.(10);
    expect(renderAllColorCycleLayers).toHaveBeenCalledTimes(1);

    runtimeConsumer?.(50);
    expect(renderAllColorCycleLayers).toHaveBeenCalledTimes(2);
    expect(dispatchGlobalAnimationFrameUpdate).toHaveBeenCalledTimes(1);

    stopContinuousColorCycleAnimationCore('toolbar', {
      cancelDeferredOverlayRender: jest.fn(),
      storeRef,
      ccLog: jest.fn(),
      ccGroup: jest.fn(),
      ccGroupEnd: jest.fn(),
      dumpLayerFlags: jest.fn(),
      pauseAllBrushCCAnimationsNow: jest.fn(() => true),
      continuousColorCycleAnimationActiveRef,
      continuousColorCycleAnimationRef,
      colorCycleAnimationRef: { current: null },
      shouldResumeColorCycleAfterInteractionRef: { current: false },
      drawingCtxRef: { current: null },
      drawingCanvasRef: { current: null },
      drawingCanvasHasContent,
      lastStopAtRef: { current: 0 },
      stopCooldownMs: 0,
      syntheticStopThrottleMs: 0,
      syntheticStopReasons: new Set(),
    });

    expect(unregister).toHaveBeenCalledTimes(1);
    expect(continuousColorCycleAnimationRef.current).toBeNull();
    expect(continuousColorCycleAnimationActiveRef.current).toBe(false);
  });

  it('uses lightweight stop/start when store-sync comes from pan suspend', () => {
    const unregister = jest.fn();
    registerSharedRuntimeConsumer.mockImplementation(() => unregister);

    const updateLayer = jest.fn();
    const initColorCycleForLayer = jest.fn();
    const state = {
      tools: {
        brushSettings: {
          brushShape: BrushShape.COLOR_CYCLE,
          customBrushColorCycle: false,
        },
      },
      colorCyclePlayback: {
        desiredPlaying: true,
        suspendDepth: 1,
        lastReason: 'pan',
      },
      layers: [
        {
          id: 'layer-cc',
          layerType: 'color-cycle',
          colorCycleData: {
            mode: 'index',
            isAnimating: true,
          },
        },
      ],
      project: { width: 64, height: 64 },
      initColorCycleForLayer,
      updateLayer,
    } as unknown as AppState;

    const storeRef = { current: state } as React.MutableRefObject<AppState>;
    const continuousColorCycleAnimationRef = { current: null as number | null };
    const continuousColorCycleAnimationActiveRef = { current: false };
    const drawingCanvasHasContent = { current: true };
    const renderAllColorCycleLayers = jest.fn(() => true);

    startContinuousColorCycleAnimationCore('store-sync', {
      brushEngine: {
        renderColorCycle: jest.fn(),
        updateColorCycleAnimation: jest.fn(),
        isColorCycleAnimating: jest.fn(() => false),
      } as unknown as BrushEngine,
      ensureOverlayInitialized: jest.fn(() => true),
      renderAllColorCycleLayers,
      storeRef,
      getEffectiveColorCyclePlaying: jest.fn(() => true),
      cancelDeferredOverlayRender: jest.fn(),
      scheduleDeferredOverlayRender: jest.fn(),
      ccLog: jest.fn(),
      ccGroup: jest.fn(),
      ccGroupEnd: jest.fn(),
      dumpLayerFlags: jest.fn(),
      debugWarn: jest.fn(),
      continuousColorCycleAnimationRef,
      continuousColorCycleAnimationActiveRef,
      startingColorCycleAnimationRef: { current: false },
      lastStartAtRef: { current: 0 },
      drawingCanvasRef: { current: null },
      drawingCtxRef: { current: null },
      drawingCanvasHasContent,
      firstPaintRef: { current: true },
      lastRendererLogTS: { current: 0 },
      startCooldownMs: 0,
    });

    expect(initColorCycleForLayer).not.toHaveBeenCalled();
    expect(updateLayer).not.toHaveBeenCalled();
    expect(renderAllColorCycleLayers).toHaveBeenCalledTimes(1);
    expect(continuousColorCycleAnimationActiveRef.current).toBe(true);

    stopContinuousColorCycleAnimationCore('store-sync', {
      cancelDeferredOverlayRender: jest.fn(),
      storeRef,
      ccLog: jest.fn(),
      ccGroup: jest.fn(),
      ccGroupEnd: jest.fn(),
      dumpLayerFlags: jest.fn(),
      pauseAllBrushCCAnimationsNow: jest.fn(() => true),
      continuousColorCycleAnimationActiveRef,
      continuousColorCycleAnimationRef,
      colorCycleAnimationRef: { current: null },
      shouldResumeColorCycleAfterInteractionRef: { current: false },
      drawingCtxRef: { current: null },
      drawingCanvasRef: { current: null },
      drawingCanvasHasContent,
      lastStopAtRef: { current: 0 },
      stopCooldownMs: 0,
      syntheticStopThrottleMs: 0,
      syntheticStopReasons: new Set(),
    });

    expect(unregister).toHaveBeenCalledTimes(1);
    expect(updateLayer).not.toHaveBeenCalled();
    expect(drawingCanvasHasContent.current).toBe(false);
    expect(continuousColorCycleAnimationRef.current).toBeNull();
    expect(continuousColorCycleAnimationActiveRef.current).toBe(false);
  });
});
