import type { CanvasShape, ShapePoint } from '@/types';
import { isPointInCanvasShape } from '@/utils/canvasShape';

export const isPointerInsideCanvasAtPosition = ({
  pointer,
  rect,
  activeCanvasShape,
  canvasOffsetX,
  canvasOffsetY,
  canvasZoom,
}: {
  pointer: ShapePoint;
  rect: DOMRect;
  activeCanvasShape: CanvasShape | null;
  canvasOffsetX: number;
  canvasOffsetY: number;
  canvasZoom: number;
}): boolean => {
  if (
    pointer.x < rect.left ||
    pointer.x > rect.right ||
    pointer.y < rect.top ||
    pointer.y > rect.bottom
  ) {
    return false;
  }

  if (!activeCanvasShape) {
    return true;
  }

  const localX = pointer.x - rect.left;
  const localY = pointer.y - rect.top;
  const worldX = (localX - canvasOffsetX) / canvasZoom;
  const worldY = (localY - canvasOffsetY) / canvasZoom;

  return isPointInCanvasShape(activeCanvasShape, { x: worldX, y: worldY });
};
