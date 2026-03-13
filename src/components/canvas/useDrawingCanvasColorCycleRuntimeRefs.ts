import { useEffect, useRef, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import { SimplifiedColorCycleManager } from './SimplifiedColorCycleManager';
import { createRafRedrawQueue, type RafRedrawQueue } from './createRafRedrawQueue';

interface UseDrawingCanvasColorCycleRuntimeRefsOptions {
  updateColorCycleGradient: ((stops: Array<{ position: number; color: string }>) => void) | null | undefined;
  setColorCycleFlowMode: ((mode: 'forward' | 'reverse' | 'pingpong') => void) | null | undefined;
  setNeedsRedraw: Dispatch<SetStateAction<number>>;
  updateColorCycleGradientRef: MutableRefObject<((stops: Array<{ position: number; color: string }>) => void) | null>;
  setColorCycleFlowModeRef: MutableRefObject<((mode: 'forward' | 'reverse' | 'pingpong') => void) | null>;
  colorCycleManagerRef: MutableRefObject<SimplifiedColorCycleManager | null>;
}

export const useDrawingCanvasColorCycleRuntimeRefs = ({
  updateColorCycleGradient,
  setColorCycleFlowMode,
  setNeedsRedraw,
  updateColorCycleGradientRef,
  setColorCycleFlowModeRef,
  colorCycleManagerRef,
}: UseDrawingCanvasColorCycleRuntimeRefsOptions) => {
  const redrawQueueRef = useRef<RafRedrawQueue | null>(null);

  useEffect(() => {
    updateColorCycleGradientRef.current = updateColorCycleGradient ?? null;
  }, [updateColorCycleGradient, updateColorCycleGradientRef]);

  useEffect(() => {
    setColorCycleFlowModeRef.current = setColorCycleFlowMode ?? null;
  }, [setColorCycleFlowMode, setColorCycleFlowModeRef]);

  useEffect(() => {
    redrawQueueRef.current = createRafRedrawQueue(() => {
      setNeedsRedraw((prev) => prev + 1);
    });

    return () => {
      redrawQueueRef.current?.cancel();
      redrawQueueRef.current = null;
    };
  }, [setNeedsRedraw]);

  useEffect(() => {
    colorCycleManagerRef.current = new SimplifiedColorCycleManager({
      targetFPS: 24,
      onFrame: () => {
        redrawQueueRef.current?.schedule();
      },
    });

    return () => {
      redrawQueueRef.current?.cancel();
      colorCycleManagerRef.current?.destroy();
      colorCycleManagerRef.current = null;
    };
  }, [colorCycleManagerRef]);
};
