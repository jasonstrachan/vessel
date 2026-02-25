import { useCallback, useEffect } from 'react';
import { useAppStore } from '@/stores/useAppStore';
import type { SimplifiedColorCycleManager } from './SimplifiedColorCycleManager';

interface ColorCycleRuntimeHandlers {
  start: (reason?: string) => void;
  stop: (reason?: string) => void;
  updateGradient: (stops: Array<{ position: number; color: string }>) => void;
  setFlowMode: (mode: 'forward' | 'reverse' | 'pingpong') => void;
  setFlowDirection: (direction: 'forward' | 'backward') => void;
}

interface UseDrawingCanvasAnimationRuntimeOptions {
  startAnimationRef: React.MutableRefObject<((reason?: string) => void) | null>;
  stopAnimationRef: React.MutableRefObject<((reason?: string) => void) | null>;
  managerRunningRef: React.MutableRefObject<boolean>;
  colorCycleManagerRef: React.MutableRefObject<SimplifiedColorCycleManager | null>;
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  drawRef: React.MutableRefObject<
    ((ctx: CanvasRenderingContext2D, transform: { scale: number; offsetX: number; offsetY: number }, skipDrawingCanvas?: boolean) => void) | null
  >;
  viewTransformRef: React.MutableRefObject<{ scale: number; offsetX: number; offsetY: number }>;
  pausedAnimationForPanRef: React.MutableRefObject<boolean>;
  setColorCycleRuntimeHandlers: (handlers: ColorCycleRuntimeHandlers | null) => void;
  updateColorCycleGradientRef: React.MutableRefObject<((stops: Array<{ position: number; color: string }>) => void) | null>;
  setColorCycleFlowModeRef: React.MutableRefObject<((mode: 'forward' | 'reverse' | 'pingpong') => void) | null>;
}

export const useDrawingCanvasAnimationRuntime = ({
  startAnimationRef,
  stopAnimationRef,
  managerRunningRef,
  colorCycleManagerRef,
  canvasRef,
  drawRef,
  viewTransformRef,
  pausedAnimationForPanRef,
  setColorCycleRuntimeHandlers,
  updateColorCycleGradientRef,
  setColorCycleFlowModeRef,
}: UseDrawingCanvasAnimationRuntimeOptions) => {
  const wrappedStartAnimation = useCallback((reason?: string) => {
    const effectiveReason = reason ?? 'drawing-canvas-wrapper';
    if (managerRunningRef.current && effectiveReason === 'drawing-canvas-wrapper') {
      return;
    }
    managerRunningRef.current = true;
    startAnimationRef.current?.(effectiveReason);
    colorCycleManagerRef.current?.start();
  }, [colorCycleManagerRef, managerRunningRef, startAnimationRef]);

  const wrappedStopAnimation = useCallback((reason?: string) => {
    const effectiveReason = reason ?? 'drawing-canvas-wrapper';
    if (!managerRunningRef.current && effectiveReason === 'drawing-canvas-wrapper') {
      return;
    }
    colorCycleManagerRef.current?.stop();
    stopAnimationRef.current?.(effectiveReason);
    managerRunningRef.current = false;

    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d', { willReadFrequently: true });
    if (ctx && drawRef.current) {
      drawRef.current(ctx, viewTransformRef.current);
    }
  }, [canvasRef, colorCycleManagerRef, drawRef, managerRunningRef, stopAnimationRef, viewTransformRef]);

  const pauseAnimationForPan = useCallback(() => {
    if (pausedAnimationForPanRef.current) {
      return;
    }
    const st = useAppStore.getState();
    st.suspendColorCycle('pan');
    pausedAnimationForPanRef.current = true;
  }, [pausedAnimationForPanRef]);

  const resumeAnimationAfterPan = useCallback(async () => {
    if (!pausedAnimationForPanRef.current) {
      return;
    }
    const st = useAppStore.getState();
    st.resumeColorCycle('pan');
    pausedAnimationForPanRef.current = false;
  }, [pausedAnimationForPanRef]);

  useEffect(() => {
    setColorCycleRuntimeHandlers({
      start: wrappedStartAnimation,
      stop: wrappedStopAnimation,
      updateGradient: (stops: Array<{ position: number; color: string }>) =>
        updateColorCycleGradientRef.current?.(stops),
      setFlowMode: (mode: 'forward' | 'reverse' | 'pingpong') =>
        setColorCycleFlowModeRef.current?.(mode),
      setFlowDirection: (direction: 'forward' | 'backward') =>
        setColorCycleFlowModeRef.current?.(direction === 'backward' ? 'reverse' : 'forward'),
    });

    return () => {
      setColorCycleRuntimeHandlers(null);
    };
  }, [
    setColorCycleRuntimeHandlers,
    setColorCycleFlowModeRef,
    updateColorCycleGradientRef,
    wrappedStartAnimation,
    wrappedStopAnimation,
  ]);

  return {
    wrappedStartAnimation,
    wrappedStopAnimation,
    pauseAnimationForPan,
    resumeAnimationAfterPan,
  };
};
