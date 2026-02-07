import { inflateRect, mergeRectBounds, type Rect } from './engineShared';

export const updateLiveStrokeTracking = ({
  segmentBounds,
  fillResolution,
  ditherBackgroundFill,
  strokeBoundsRef,
  liveStrokeBoundsRef,
  lastSegmentBoundsRef,
  liveDirtyRectRef,
}: {
  segmentBounds: Rect;
  fillResolution: number | undefined;
  ditherBackgroundFill: boolean | undefined;
  strokeBoundsRef: { current: Rect | null };
  liveStrokeBoundsRef: { current: Rect | null };
  lastSegmentBoundsRef: { current: Rect | null };
  liveDirtyRectRef: { current: Rect | null };
}): void => {
  strokeBoundsRef.current = mergeRectBounds(strokeBoundsRef.current, segmentBounds);
  liveStrokeBoundsRef.current = mergeRectBounds(liveStrokeBoundsRef.current, segmentBounds);
  lastSegmentBoundsRef.current = segmentBounds;

  const pixelSizeForOverlap =
    ditherBackgroundFill === false
      ? Math.max(1, Math.round(fillResolution || 1))
      : Math.max(1, Math.round(fillResolution || 1));

  const overlap = Math.max(8, pixelSizeForOverlap * 2);
  const dirty = inflateRect(segmentBounds, overlap);
  liveDirtyRectRef.current = mergeRectBounds(liveDirtyRectRef.current, dirty);
};
