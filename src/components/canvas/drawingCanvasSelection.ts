import type { CanvasShape } from '@/types';

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
  activeCanvasShape,
  applyCanvasShapeClip,
}: DrawSelectionLayerOptions): void => {
  const hasMask = Boolean(selectionMask && selectionMaskBounds);
  if (!((selectionStart && selectionEnd) || (isSelecting && selectionStartRef))) {
    return;
  }

  ctx.save();
  ctx.translate(offsetX, offsetY);
  ctx.scale(scale, scale);
  if (activeCanvasShape) {
    applyCanvasShapeClip(ctx, activeCanvasShape);
  }

  const start = selectionStart || selectionStartRef;
  const end = selectionEnd || { x: 0, y: 0 };

  if (start && !hasMask) {
    const x = Math.min(start.x, end.x);
    const y = Math.min(start.y, end.y);
    const width = Math.abs(end.x - start.x);
    const height = Math.abs(end.y - start.y);

    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1 / scale;
    ctx.setLineDash([]);
    ctx.strokeRect(x, y, width, height);

    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 1 / scale;
    const selectionDash = 5 / scale;
    ctx.setLineDash([selectionDash, selectionDash]);
    ctx.lineDashOffset = -marchingAntsOffset / scale;
    ctx.strokeRect(x, y, width, height);
  }

  if (selectionMask && selectionMaskBounds) {
    const outlinePath = buildMaskEdgePath(selectionMask, selectionMaskBounds);
    const dash = 5 / scale;

    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1 / scale;
    ctx.setLineDash([]);
    ctx.stroke(outlinePath);

    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 1 / scale;
    ctx.setLineDash([dash, dash]);
    ctx.lineDashOffset = -marchingAntsOffset / scale;
    ctx.stroke(outlinePath);
  }

  ctx.restore();
};
