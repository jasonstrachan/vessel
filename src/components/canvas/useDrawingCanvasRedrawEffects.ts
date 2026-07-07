import type React from 'react';
import { useEffect } from 'react';
import type { RenderStaticCompositeOptions } from '@/stores/slices/layersSlice';
import {
  COLOR_CYCLE_FRAME_READY_EVENT,
  getColorCycleFrameReadyDirtyBatches,
} from '@/hooks/brushEngine/colorCycleFrameEvents';
import type { ColorCycleLayerDirtyBatch } from '@/lib/colorCycle/document';

interface UseDrawingCanvasRedrawEffectsOptions {
  layersNeedRecomposition: boolean;
  setNeedsRedraw: React.Dispatch<React.SetStateAction<number>>;
  selectionStart: unknown;
  selectionEnd: unknown;
  hadSelectionRef: React.MutableRefObject<boolean>;
  refreshColorCycleSegments: (dirtyBatches?: ColorCycleLayerDirtyBatch[]) => boolean | void;
  rebuildStaticComposite?: (
    options?: RenderStaticCompositeOptions
  ) => boolean | Promise<boolean>;
}

export const useDrawingCanvasRedrawEffects = ({
  layersNeedRecomposition,
  setNeedsRedraw,
  selectionStart,
  selectionEnd,
  hadSelectionRef,
  refreshColorCycleSegments,
  rebuildStaticComposite,
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

    const handleColorCycleFrameReady = (event: Event) => {
      const dirtyBatches = getColorCycleFrameReadyDirtyBatches(event);
      const hasStaticDirtyBatch = refreshColorCycleSegments(dirtyBatches);
      if (dirtyBatches?.length && hasStaticDirtyBatch) {
        void Promise.resolve(rebuildStaticComposite?.({ dirtyBatches }));
      }
      requestRedraw();
    };

    const handleAnimationFrameUpdate = () => {
      requestRedraw();
    };

    const handleSequentialFrameUpdate = () => {
      requestRedraw();
    };

    window.addEventListener(COLOR_CYCLE_FRAME_READY_EVENT, handleColorCycleFrameReady);
    window.addEventListener('vessel:animationFrameUpdate', handleAnimationFrameUpdate);
    window.addEventListener('vessel:sequentialFrameUpdate', handleSequentialFrameUpdate);

    return () => {
      window.removeEventListener(COLOR_CYCLE_FRAME_READY_EVENT, handleColorCycleFrameReady);
      window.removeEventListener('vessel:animationFrameUpdate', handleAnimationFrameUpdate);
      window.removeEventListener('vessel:sequentialFrameUpdate', handleSequentialFrameUpdate);
    };
  }, [rebuildStaticComposite, refreshColorCycleSegments, setNeedsRedraw]);

};
