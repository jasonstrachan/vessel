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
    const requestRedraw = () => {
      setNeedsRedraw((prev) => prev + 1);
    };

    const handleColorCycleFrameReady = () => {
      refreshColorCycleSegments();
      requestRedraw();
    };

    const handleColorCycleFrameUpdate = () => {
      requestRedraw();
    };

    const handleAnimationFrameUpdate = () => {
      requestRedraw();
    };

    const handleSequentialFrameUpdate = () => {
      requestRedraw();
    };

    window.addEventListener('colorCycleFrameReady', handleColorCycleFrameReady);
    window.addEventListener('colorCycleFrameUpdate', handleColorCycleFrameUpdate);
    window.addEventListener('vessel:animationFrameUpdate', handleAnimationFrameUpdate);
    window.addEventListener('vessel:sequentialFrameUpdate', handleSequentialFrameUpdate);

    return () => {
      window.removeEventListener('colorCycleFrameReady', handleColorCycleFrameReady);
      window.removeEventListener('colorCycleFrameUpdate', handleColorCycleFrameUpdate);
      window.removeEventListener('vessel:animationFrameUpdate', handleAnimationFrameUpdate);
      window.removeEventListener('vessel:sequentialFrameUpdate', handleSequentialFrameUpdate);
    };
  }, [refreshColorCycleSegments, setNeedsRedraw]);

};
