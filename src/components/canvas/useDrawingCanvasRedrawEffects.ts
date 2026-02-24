import type React from 'react';
import { useEffect } from 'react';

interface UseDrawingCanvasRedrawEffectsOptions {
  layersNeedRecomposition: boolean;
  setNeedsRedraw: React.Dispatch<React.SetStateAction<number>>;
  selectionStart: unknown;
  selectionEnd: unknown;
  hadSelectionRef: React.MutableRefObject<boolean>;
  refreshColorCycleSegments: () => void;
}

export const useDrawingCanvasRedrawEffects = ({
  layersNeedRecomposition,
  setNeedsRedraw,
  selectionStart,
  selectionEnd,
  hadSelectionRef,
  refreshColorCycleSegments,
}: UseDrawingCanvasRedrawEffectsOptions) => {
  useEffect(() => {
    if (!layersNeedRecomposition) {
      return;
    }
    setNeedsRedraw((prev) => prev + 1);
  }, [layersNeedRecomposition, setNeedsRedraw]);

  useEffect(() => {
    const hasSelection = Boolean(selectionStart && selectionEnd);

    setNeedsRedraw((prev) => prev + 1);

    hadSelectionRef.current = hasSelection;
  }, [selectionStart, selectionEnd, setNeedsRedraw, hadSelectionRef]);

  useEffect(() => {
    const handleColorCycleFrame = () => {
      refreshColorCycleSegments();
      setNeedsRedraw((prev) => prev + 1);
    };

    window.addEventListener('colorCycleFrameReady', handleColorCycleFrame);
    window.addEventListener('colorCycleFrameUpdate', handleColorCycleFrame);
    window.addEventListener('vessel:animationFrameUpdate', handleColorCycleFrame);

    return () => {
      window.removeEventListener('colorCycleFrameReady', handleColorCycleFrame);
      window.removeEventListener('colorCycleFrameUpdate', handleColorCycleFrame);
      window.removeEventListener('vessel:animationFrameUpdate', handleColorCycleFrame);
    };
  }, [refreshColorCycleSegments, setNeedsRedraw]);

};
