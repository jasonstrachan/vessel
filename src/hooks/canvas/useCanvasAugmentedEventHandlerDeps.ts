import { createAugmentedEventHandlerDeps } from './handlers/createAugmentedEventHandlerDeps';
import type { useCanvasEventHandlerDynamicDepsRef } from './useCanvasEventHandlerDynamicDepsRef';
import type { useCanvasEventHandlerRefs } from './useCanvasEventHandlerRefs';
import type { splitCanvasEventHandlerDeps } from './canvasEventHandlerDeps';

type SplitDeps = ReturnType<typeof splitCanvasEventHandlerDeps>;
type RefsState = ReturnType<typeof useCanvasEventHandlerRefs>;
type DynamicDepsRef = ReturnType<typeof useCanvasEventHandlerDynamicDepsRef>;

interface UseCanvasAugmentedEventHandlerDepsOptions {
  staticDeps: SplitDeps['staticDeps'];
  dynamicDepsRef: DynamicDepsRef;
  refs: RefsState;
}

export const useCanvasAugmentedEventHandlerDeps = ({
  staticDeps,
  dynamicDepsRef,
  refs,
}: UseCanvasAugmentedEventHandlerDepsOptions) =>
  createAugmentedEventHandlerDeps({
    staticDeps,
    dynamicDepsRef,
    snapStrokeStartRef: refs.snapStrokeStartRef,
    snapShiftAnchorRef: refs.snapShiftAnchorRef,
    snapLastBrushSampleRef: refs.snapLastBrushSampleRef,
    contourLinesStateRef: refs.contourLinesStateRef,
    contourLinesDefaultsCacheRef: refs.contourLinesDefaultsCacheRef,
    contourLinesFinalizingRef: refs.contourLinesFinalizingRef,
    previewSessionIdRef: refs.previewSessionIdRef,
    newPreviewSession: refs.newPreviewSession,
    isCurrentPreviewSession: refs.isCurrentPreviewSession,
  });
