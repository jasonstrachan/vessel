import { useCallback } from 'react';
import type React from 'react';
import type { AppState } from '@/stores/useAppStore';
import type { BoundingBox } from '@/hooks/canvas/utils/captureRegions';
import { drawEraserSegment as drawEraserSegmentExternal } from '@/hooks/canvas/handlers/eraserSegment';
import { seedManualStrokeBoundingBox as seedManualStrokeBoundingBoxExternal } from '@/hooks/canvas/handlers/strokeBoundingBox';

export const useStrokeBoundaryCallbacks = ({
  storeRef,
  strokeBoundingBoxRef,
  strokeCapturePaddingRef,
}: {
  storeRef: React.MutableRefObject<AppState>;
  strokeBoundingBoxRef: React.MutableRefObject<BoundingBox | null>;
  strokeCapturePaddingRef: React.MutableRefObject<number>;
}) => {
  const drawEraserSegment = useCallback((
    ctx: CanvasRenderingContext2D,
    p1: { x: number; y: number },
    p2: { x: number; y: number }
  ) => {
    drawEraserSegmentExternal(storeRef.current, ctx, p1, p2);
  }, [storeRef]);

  const seedManualStrokeBoundingBox = useCallback((
    points: Array<{ x: number; y: number }> | null,
    padding: number = 0
  ) => {
    seedManualStrokeBoundingBoxExternal(
      points,
      strokeBoundingBoxRef,
      strokeCapturePaddingRef,
      padding
    );
  }, [strokeBoundingBoxRef, strokeCapturePaddingRef]);

  return {
    drawEraserSegment,
    seedManualStrokeBoundingBox,
  };
};
