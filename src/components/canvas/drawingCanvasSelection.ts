import type { CanvasShape } from '@/types';
import { strokeMarqueePath, strokeMarqueeRect } from '@/utils/marqueeStroke';

type Point = { x: number; y: number };
type SelectionMaskBounds = { x: number; y: number };

interface DrawSelectionLayerOptions {
  ctx: CanvasRenderingContext2D;
  scale: number;
  offsetX: number;
  offsetY: number;
  marchingAntsOffset: number;
  selectionStart: Point | null;
  selectionEnd: Point | null;
  isSelecting?: boolean;
  selectionStartRef?: Point | null;
  selectionMask: ImageData | null;
  selectionMaskBounds: SelectionMaskBounds | null;
  selectionVectorPath: {
    mode: 'freehand' | 'click-line';
    points: Point[];
  } | null;
  activeCanvasShape: CanvasShape | null;
  applyCanvasShapeClip: (ctx: CanvasRenderingContext2D, shape: CanvasShape) => void;
}

const buildMaskEdgePath = (mask: ImageData, bounds: SelectionMaskBounds): Path2D => {
  const path = new Path2D();
  const { data, width, height } = mask;

  const alphaAt = (x: number, y: number): number => {
    if (x < 0 || y < 0 || x >= width || y >= height) {
      return 0;
    }
    return data[(y * width + x) * 4 + 3];
  };

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (alphaAt(x, y) === 0) {
        continue;
      }
      const hasBackgroundNeighbor =
        alphaAt(x - 1, y) === 0 ||
        alphaAt(x + 1, y) === 0 ||
        alphaAt(x, y - 1) === 0 ||
        alphaAt(x, y + 1) === 0;
      if (hasBackgroundNeighbor) {
        path.rect(bounds.x + x, bounds.y + y, 1, 1);
      }
    }
  }

  return path;
};

export const drawSelectionLayer = ({
  ctx,
  scale,
  offsetX,
  offsetY,
  marchingAntsOffset,
  selectionStart,
  selectionEnd,
  isSelecting,
  selectionStartRef,
  selectionMask,
  selectionMaskBounds,
  selectionVectorPath,
  activeCanvasShape,
  applyCanvasShapeClip,
}: DrawSelectionLayerOptions): void => {
  const hasMask = Boolean(selectionMask && selectionMaskBounds);
  const hasRect = Boolean(selectionStart && selectionEnd);
  const hasDragPreview = Boolean(isSelecting && selectionStartRef && selectionEnd && !hasMask);
  if (!(hasMask || hasRect || hasDragPreview)) {
    return;
  }

  ctx.save();
  ctx.translate(offsetX, offsetY);
  ctx.scale(scale, scale);
  if (activeCanvasShape) {
    applyCanvasShapeClip(ctx, activeCanvasShape);
  }

  const start = selectionStart || (hasDragPreview ? selectionStartRef : null);
  const end = selectionEnd || null;

  if (start && end && !hasMask) {
    const x = Math.min(start.x, end.x);
    const y = Math.min(start.y, end.y);
    const width = Math.abs(end.x - start.x);
    const height = Math.abs(end.y - start.y);
    strokeMarqueeRect(ctx, x, y, width, height, {
      scale,
      marchingAntsOffset,
      animated: true,
    });
  }

  if (selectionMask && selectionMaskBounds) {
    const hasVectorPath = Boolean(selectionVectorPath && selectionVectorPath.points.length >= 2);
    const outlinePath = (() => {
      if (!hasVectorPath) {
        return buildMaskEdgePath(selectionMask, selectionMaskBounds);
      }
      const path = new Path2D();
      const vectorPoints = selectionVectorPath!.points;
      path.moveTo(vectorPoints[0].x, vectorPoints[0].y);
      for (let i = 1; i < vectorPoints.length; i += 1) {
        path.lineTo(vectorPoints[i].x, vectorPoints[i].y);
      }
      if (vectorPoints.length > 2) {
        path.closePath();
      }
      return path;
    })();
    strokeMarqueePath(ctx, outlinePath, {
      scale,
      marchingAntsOffset,
      animated: true,
    });

    if (selectionVectorPath?.mode === 'click-line' && selectionVectorPath.points.length > 0) {
      const pointRadius = Math.max(1.25, 3 / scale);
      ctx.setLineDash([]);
      for (const point of selectionVectorPath.points) {
        ctx.beginPath();
        ctx.arc(point.x, point.y, pointRadius, 0, Math.PI * 2);
        ctx.fillStyle = '#ffffff';
        ctx.fill();
        ctx.strokeStyle = '#000000';
        ctx.lineWidth = Math.max(0.5, 1 / scale);
        ctx.stroke();
      }
    }
  }

  ctx.restore();
};
