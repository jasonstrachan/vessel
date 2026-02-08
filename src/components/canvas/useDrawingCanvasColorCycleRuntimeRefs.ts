import { useEffect, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import { SimplifiedColorCycleManager } from './SimplifiedColorCycleManager';

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
  useEffect(() => {
    updateColorCycleGradientRef.current = updateColorCycleGradient ?? null;
  }, [updateColorCycleGradient, updateColorCycleGradientRef]);

  useEffect(() => {
    setColorCycleFlowModeRef.current = setColorCycleFlowMode ?? null;
  }, [setColorCycleFlowMode, setColorCycleFlowModeRef]);

  useEffect(() => {
    colorCycleManagerRef.current = new SimplifiedColorCycleManager({
      targetFPS: 24,
      onFrame: () => {
        setNeedsRedraw((prev) => prev + 1);
      },
    });

    return () => {
      colorCycleManagerRef.current?.destroy();
      colorCycleManagerRef.current = null;
    };
  }, [colorCycleManagerRef, setNeedsRedraw]);
};
