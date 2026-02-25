import type React from 'react';
import type { BoundingBox } from '@/hooks/canvas/utils/captureRegions';
import { createBoundingBox, expandBoundingBox } from '@/hooks/canvas/utils/captureRegions';

type Point = { x: number; y: number };

export const seedManualStrokeBoundingBox = (
  points: Point[] | null,
  strokeBoundingBoxRef: React.MutableRefObject<BoundingBox | null>,
  strokeCapturePaddingRef: React.MutableRefObject<number>,
  padding: number = 0
): void => {
  if (!points || points.length === 0) {
    strokeBoundingBoxRef.current = null;
    strokeCapturePaddingRef.current = Math.max(0, padding);
    return;
  }

  let bbox = createBoundingBox(points[0]);
  for (let i = 1; i < points.length; i += 1) {
    const point = points[i];
    if (!point) {
      continue;
    }
    bbox = expandBoundingBox(bbox, point);
  }

  strokeBoundingBoxRef.current = bbox;
  strokeCapturePaddingRef.current = Math.max(0, padding);
};
