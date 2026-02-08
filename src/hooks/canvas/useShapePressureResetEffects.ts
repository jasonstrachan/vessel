import { useEffect } from 'react';
import type React from 'react';
import type { AppState } from '@/stores/useAppStore';
import { useAppStore } from '@/stores/useAppStore';
import type { BoundingBox } from '@/hooks/canvas/utils/captureRegions';

type UseShapePressureResetEffectsArgs = {
  resetShapePressureState: () => void;
  resetShapeDragRefs: () => void;
  strokeBoundingBoxRef: React.MutableRefObject<BoundingBox | null>;
  strokeCapturePaddingRef: React.MutableRefObject<number>;
  shapePointsRef: React.MutableRefObject<Array<{ x: number; y: number }>>;
  isDrawingShapeRef: React.MutableRefObject<boolean>;
};

export const useShapePressureResetEffects = ({
  resetShapePressureState,
  resetShapeDragRefs,
  strokeBoundingBoxRef,
  strokeCapturePaddingRef,
  shapePointsRef,
  isDrawingShapeRef,
}: UseShapePressureResetEffectsArgs): void => {
  useEffect(() => {
    const selector = (state: AppState) => ({
      fillResolution: state.tools.brushSettings.fillResolution,
      pressureLinkedFillResolution: state.tools.brushSettings.pressureLinkedFillResolution,
    });

    let prev = selector(useAppStore.getState());
    const unsubscribe = useAppStore.subscribe((state) => {
      const next = selector(state);
      const pressureToggled =
        next.pressureLinkedFillResolution !== prev.pressureLinkedFillResolution;
      const fillResolutionChanged = next.fillResolution !== prev.fillResolution;
      const shouldReset =
        pressureToggled ||
        (fillResolutionChanged && !next.pressureLinkedFillResolution);

      if (shouldReset) {
        resetShapePressureState();
      }
      prev = next;
    });

    return () => unsubscribe();
  }, [resetShapePressureState]);

  useEffect(() => {
    let prevZoom = useAppStore.getState().canvas?.zoom ?? 1;

    const unsubscribe = useAppStore.subscribe((state: AppState) => {
      const nextZoom = state.canvas?.zoom ?? 1;
      if (nextZoom !== prevZoom) {
        resetShapePressureState();
        strokeBoundingBoxRef.current = null;
        strokeCapturePaddingRef.current = 0;
        shapePointsRef.current = [];
        isDrawingShapeRef.current = false;
        resetShapeDragRefs();
      }
      prevZoom = nextZoom;
    });

    return () => unsubscribe();
  }, [
    isDrawingShapeRef,
    resetShapeDragRefs,
    resetShapePressureState,
    shapePointsRef,
    strokeBoundingBoxRef,
    strokeCapturePaddingRef,
  ]);
};
