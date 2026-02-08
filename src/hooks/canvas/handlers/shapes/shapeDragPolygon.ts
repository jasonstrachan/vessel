import type React from 'react';
import { ensurePolygonFromDrag } from '@/utils/shapeMaker';

type Point = { x: number; y: number };

interface CoerceDragShapeToPolygonOptions {
  shapeDragMovedRef: React.MutableRefObject<boolean>;
  shapeDragStartRef: React.MutableRefObject<Point | null>;
  shapeDragLastRef: React.MutableRefObject<Point | null>;
  shapePointsRef: React.MutableRefObject<Point[]>;
  storeRef: React.MutableRefObject<{
    canvas?: { zoom?: number };
    tools: { brushSettings: { size?: number } };
    globalBrushSize?: number;
  }>;
  seedManualStrokeBoundingBox: (points: Point[], extraPadding: number) => void;
  triggerSimpleShapePreview: () => void;
}

export const coerceDragShapeToPolygon = ({
  shapeDragMovedRef,
  shapeDragStartRef,
  shapeDragLastRef,
  shapePointsRef,
  storeRef,
  seedManualStrokeBoundingBox,
  triggerSimpleShapePreview,
}: CoerceDragShapeToPolygonOptions): boolean => {
  if (!shapeDragMovedRef.current || !shapeDragStartRef.current || !shapeDragLastRef.current) {
    return false;
  }

  const store = storeRef.current;
  const zoom = store.canvas?.zoom || 1;
  const brushSize = store.tools.brushSettings.size ?? store.globalBrushSize ?? 12;

  const next = ensurePolygonFromDrag({
    existingPoints: shapePointsRef.current,
    start: shapeDragStartRef.current,
    end: shapeDragLastRef.current,
    zoom,
    brushSize,
  });

  if (!next) {
    return false;
  }

  shapePointsRef.current = next;
  seedManualStrokeBoundingBox(shapePointsRef.current, 2);
  triggerSimpleShapePreview();
  return true;
};
