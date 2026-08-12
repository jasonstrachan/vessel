import type React from 'react';
import { useEffect } from 'react';
import type { RenderStaticCompositeOptions } from '@/stores/slices/layersSlice';
import {
  dispatchCanvasFrameUpdate,
} from '@/hooks/canvas/handlers/animation/animationRuntime';
import {
  COLOR_CYCLE_FRAME_READY_EVENT,
  getColorCycleFrameReadyDirtyBatches,
  getColorCycleFrameReadySourceLayerId,
} from '@/hooks/brushEngine/colorCycleFrameEvents';
import { isInterlacePlaybackActive } from '@/hooks/canvas/useInterlaceAnimationRuntimeEffect';
import { getAppStoreState } from '@/stores/appStoreAccess';
import { recordColorCycleRuntimePerf } from '@/utils/perf/ccPerfProbe';

import { createColorCycleFrameCoalescer } from './colorCycleFrameCoalescer';
import type { ColorCycleSegmentRefreshRequest } from './useDrawingCanvasColorCycleSegmentRefresh';

interface UseDrawingCanvasRedrawEffectsOptions {
  layersNeedRecomposition: boolean;
  setNeedsRedraw: React.Dispatch<React.SetStateAction<number>>;
  selectionStart: unknown;
  selectionEnd: unknown;
  hadSelectionRef: React.MutableRefObject<boolean>;
  refreshColorCycleSegments: (request?: ColorCycleSegmentRefreshRequest) => boolean | void;
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
      recordColorCycleRuntimePerf('mainRedrawRequest');
      dispatchCanvasFrameUpdate();
    };

    const queue = createColorCycleFrameCoalescer((flush) => {
      recordColorCycleRuntimePerf('presentationFlush');
      const hasStaticDirtyBatch = flush.sourceLayerIds.length > 0
        ? refreshColorCycleSegments({
            dirtyBatches: flush.dirtyBatches,
            sourceLayerIds: flush.sourceLayerIds,
          })
        : false;
      if (flush.dirtyBatches.length > 0 && hasStaticDirtyBatch) {
        void Promise.resolve(rebuildStaticComposite?.({ dirtyBatches: flush.dirtyBatches }));
      }
      requestRedraw();
    });

    const handleColorCycleFrameReady = (event: Event) => {
      const dirtyBatches = getColorCycleFrameReadyDirtyBatches(event);
      const sourceLayerId = getColorCycleFrameReadySourceLayerId(event);
      const state = getAppStoreState();
      const sourceLayer = sourceLayerId
        ? state.layers.find((layer) => layer.id === sourceLayerId)
        : undefined;
      if (
        sourceLayer
        && !dirtyBatches?.length
        && isInterlacePlaybackActive(state)
        && Boolean(sourceLayer.groupId)
        && state.layerGroups.some((group) => (
          group.id === sourceLayer.groupId && group.kind === 'interlace'
        ))
      ) {
        return;
      }
      if (!sourceLayerId) {
        queue.enqueueRedraw();
        return;
      }
      queue.enqueueFrame(sourceLayerId, dirtyBatches);
    };

    const handleAnimationFrameUpdate = () => {
      if (isInterlacePlaybackActive(getAppStoreState())) {
        return;
      }
      queue.enqueueRedraw();
    };

    const handleSequentialFrameUpdate = () => {
      queue.enqueueRedraw();
    };

    window.addEventListener(COLOR_CYCLE_FRAME_READY_EVENT, handleColorCycleFrameReady);
    window.addEventListener('colorCycleFrameUpdate', handleAnimationFrameUpdate);
    window.addEventListener('vessel:animationFrameUpdate', handleAnimationFrameUpdate);
    window.addEventListener('vessel:sequentialFrameUpdate', handleSequentialFrameUpdate);

    return () => {
      window.removeEventListener(COLOR_CYCLE_FRAME_READY_EVENT, handleColorCycleFrameReady);
      window.removeEventListener('colorCycleFrameUpdate', handleAnimationFrameUpdate);
      window.removeEventListener('vessel:animationFrameUpdate', handleAnimationFrameUpdate);
      window.removeEventListener('vessel:sequentialFrameUpdate', handleSequentialFrameUpdate);
      queue.cancel();
    };
  }, [rebuildStaticComposite, refreshColorCycleSegments]);

};
