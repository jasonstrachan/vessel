import { useRef } from 'react';
import type React from 'react';
import type { SimplifiedColorCycleManager } from './SimplifiedColorCycleManager';
import { useDrawingCanvasColorCycleRuntimeRefs } from './useDrawingCanvasColorCycleRuntimeRefs';

export interface UseDrawingCanvasColorCycleRuntimeStateOptions {
  updateColorCycleGradient: ((stops: Array<{ position: number; color: string }>) => void) | undefined;
  setColorCycleFlowMode: ((mode: 'forward' | 'reverse' | 'pingpong') => void) | undefined;
  setNeedsRedraw: React.Dispatch<React.SetStateAction<number>>;
}

export const useDrawingCanvasColorCycleRuntimeState = ({
  updateColorCycleGradient,
  setColorCycleFlowMode,
  setNeedsRedraw,
}: UseDrawingCanvasColorCycleRuntimeStateOptions) => {
  const updateColorCycleGradientRef = useRef<((stops: Array<{ position: number; color: string }>) => void) | null>(
    updateColorCycleGradient ?? null
  );
  const setColorCycleFlowModeRef = useRef<((mode: 'forward' | 'reverse' | 'pingpong') => void) | null>(
    setColorCycleFlowMode ?? null
  );
  const colorCycleManagerRef = useRef<SimplifiedColorCycleManager | null>(null);

  useDrawingCanvasColorCycleRuntimeRefs({
    updateColorCycleGradient,
    setColorCycleFlowMode,
    setNeedsRedraw,
    updateColorCycleGradientRef,
    setColorCycleFlowModeRef,
    colorCycleManagerRef,
  });

  return {
    updateColorCycleGradientRef,
    setColorCycleFlowModeRef,
    colorCycleManagerRef,
  };
};
