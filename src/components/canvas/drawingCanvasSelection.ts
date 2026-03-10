import type { CanvasShape } from '@/types';
import { clampMarqueeDragRectToBounds } from '@/stores/helpers/selectionRoi';
import { strokeMarqueePath, strokeMarqueeRect } from '@/utils/marqueeStroke';
import { getSelectionMaskContourPath } from '@/utils/selectionMaskContourPath';

type Point = { x: number; y: number };
type SelectionMaskBounds = { x: number; y: number; width: number; height: number };

interface DrawSelectionLayerOptions {
  ctx: CanvasRenderingContext2D;
  projectWidth: number;
  projectHeight: number;
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

export const drawSelectionLayer = ({
  ctx,
  projectWidth,
  projectHeight,
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
  // Keep marquee rendering constrained to the drawable project surface.
  ctx.beginPath();
  ctx.rect(0, 0, projectWidth, projectHeight);
  ctx.clip();
  if (activeCanvasShape) {
    applyCanvasShapeClip(ctx, activeCanvasShape);
  }

  const start = selectionStart || (hasDragPreview ? selectionStartRef : null);
  const end = selectionEnd || null;

  if (start && end && !hasMask) {
    const marqueeBounds = clampMarqueeDragRectToBounds(start, end, projectWidth, projectHeight);
    if (marqueeBounds) {
      strokeMarqueeRect(ctx, marqueeBounds.x, marqueeBounds.y, marqueeBounds.width, marqueeBounds.height, {
        scale,
        marchingAntsOffset,
        animated: true,
      });
    }
  }

  if (selectionMask && selectionMaskBounds) {
    const hasVectorPath = Boolean(selectionVectorPath && selectionVectorPath.points.length >= 2);
    if (!hasVectorPath) {
      const contourPath = getSelectionMaskContourPath(selectionMask);
      ctx.save();
      ctx.translate(selectionMaskBounds.x, selectionMaskBounds.y);
      strokeMarqueePath(ctx, contourPath, {
        scale,
        marchingAntsOffset,
        animated: true,
      });
      ctx.restore();
    } else {
      const outlinePath = (() => {
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
    }

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
