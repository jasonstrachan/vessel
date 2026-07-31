import type { ShapeFillPoint } from './shapeFillGeometry';
import { SHAPE_PREVIEW_OPACITY } from '../shapePreviewOpacity';

export type ShapeFillPreviewRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type ShapeFillViewTransform = {
  scale: number;
  offsetX: number;
  offsetY: number;
};

const PREVIEW_CLEAR_PADDING = 16;

const clampRectToCanvas = (
  rect: ShapeFillPreviewRect,
  canvas: HTMLCanvasElement
): ShapeFillPreviewRect => {
  const x = Math.max(0, Math.floor(rect.x));
  const y = Math.max(0, Math.floor(rect.y));
  const right = Math.min(canvas.width, Math.ceil(rect.x + rect.width));
  const bottom = Math.min(canvas.height, Math.ceil(rect.y + rect.height));

  return {
    x,
    y,
    width: Math.max(0, right - x),
    height: Math.max(0, bottom - y),
  };
};

const computePreviewRect = (
  points: ShapeFillPoint[],
  previewPoint: ShapeFillPoint,
  transform: ShapeFillViewTransform,
  canvas: HTMLCanvasElement
): ShapeFillPreviewRect => {
  const allPoints = [...points, previewPoint];
  let minX = allPoints[0].x;
  let maxX = allPoints[0].x;
  let minY = allPoints[0].y;
  let maxY = allPoints[0].y;

  for (let i = 1; i < allPoints.length; i += 1) {
    const point = allPoints[i];
    if (point.x < minX) minX = point.x;
    if (point.x > maxX) maxX = point.x;
    if (point.y < minY) minY = point.y;
    if (point.y > maxY) maxY = point.y;
  }

  return clampRectToCanvas(
    {
      x: transform.offsetX + minX * transform.scale - PREVIEW_CLEAR_PADDING,
      y: transform.offsetY + minY * transform.scale - PREVIEW_CLEAR_PADDING,
      width: Math.max(1, (maxX - minX) * transform.scale) + PREVIEW_CLEAR_PADDING * 2,
      height: Math.max(1, (maxY - minY) * transform.scale) + PREVIEW_CLEAR_PADDING * 2,
    },
    canvas
  );
};

export const clearShapeFillPreviewRect = (
  ctx: CanvasRenderingContext2D,
  rect: ShapeFillPreviewRect | null
): void => {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  if (!rect) {
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    return;
  }

  const padded = {
    x: rect.x - 2,
    y: rect.y - 2,
    width: rect.width + 4,
    height: rect.height + 4,
  };
  ctx.clearRect(padded.x, padded.y, padded.width, padded.height);
};

export const renderShapeFillDraftPreview = ({
  overlayCanvas,
  points,
  previewPoint,
  transform,
  fillStyle,
  previousRect,
}: {
  overlayCanvas: HTMLCanvasElement;
  points: ShapeFillPoint[];
  previewPoint: ShapeFillPoint;
  transform: ShapeFillViewTransform;
  fillStyle: string;
  previousRect: ShapeFillPreviewRect | null;
}): ShapeFillPreviewRect | null => {
  const overlayCtx = overlayCanvas.getContext('2d');
  if (!overlayCtx || points.length === 0) {
    return previousRect;
  }

  const rect = computePreviewRect(points, previewPoint, transform, overlayCanvas);
  clearShapeFillPreviewRect(overlayCtx, previousRect);
  clearShapeFillPreviewRect(overlayCtx, rect);

  overlayCtx.save();
  overlayCtx.setTransform(1, 0, 0, 1, 0, 0);
  overlayCtx.translate(transform.offsetX, transform.offsetY);
  overlayCtx.scale(transform.scale, transform.scale);
  overlayCtx.lineJoin = 'round';
  overlayCtx.lineCap = 'round';

  if (points.length >= 3) {
    overlayCtx.globalCompositeOperation = 'source-over';
    overlayCtx.globalAlpha = SHAPE_PREVIEW_OPACITY;
    overlayCtx.fillStyle = fillStyle;
    overlayCtx.beginPath();
    overlayCtx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i += 1) {
      overlayCtx.lineTo(points[i].x, points[i].y);
    }
    overlayCtx.closePath();
    overlayCtx.fill();
  }

  const strokePoints = [...points, previewPoint];
  if (strokePoints.length >= 2) {
    overlayCtx.globalAlpha = 1;
    overlayCtx.lineWidth = Math.max(1.25 / transform.scale, 0.5);
    overlayCtx.strokeStyle = 'rgba(255, 255, 255, 0.95)';
    overlayCtx.beginPath();
    overlayCtx.moveTo(strokePoints[0].x, strokePoints[0].y);
    for (let i = 1; i < strokePoints.length; i += 1) {
      overlayCtx.lineTo(strokePoints[i].x, strokePoints[i].y);
    }
    if (points.length >= 3) {
      overlayCtx.closePath();
    }
    overlayCtx.stroke();

    overlayCtx.lineWidth = Math.max(2.75 / transform.scale, 1);
    overlayCtx.strokeStyle = 'rgba(0, 0, 0, 0.55)';
    overlayCtx.stroke();
  } else {
    overlayCtx.globalAlpha = 1;
    overlayCtx.fillStyle = fillStyle;
    overlayCtx.beginPath();
    overlayCtx.arc(previewPoint.x, previewPoint.y, Math.max(2 / transform.scale, 1), 0, Math.PI * 2);
    overlayCtx.fill();
  }

  overlayCtx.restore();
  return rect;
};
