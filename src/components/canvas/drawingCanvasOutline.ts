import type { CanvasShape } from '@/types';

interface DrawCanvasOutlineOptions {
  ctx: CanvasRenderingContext2D;
  scale: number;
  offsetX: number;
  offsetY: number;
  projectWidth: number;
  projectHeight: number;
  activeCanvasShape: CanvasShape | null;
  editorDraftShape: CanvasShape | null;
  editorActive: boolean;
  strokeCanvasShapeOutline: (
    ctx: CanvasRenderingContext2D,
    shape: CanvasShape,
    options?: {
      strokeStyle?: string;
      lineWidth?: number;
      dash?: number[];
    }
  ) => void;
}

export const drawCanvasOutlineLayer = ({
  ctx,
  scale,
  offsetX,
  offsetY,
  projectWidth,
  projectHeight,
  activeCanvasShape,
  editorDraftShape,
  editorActive,
  strokeCanvasShapeOutline,
}: DrawCanvasOutlineOptions): void => {
  ctx.save();
  ctx.translate(offsetX, offsetY);
  ctx.scale(scale, scale);
  const outlineWidth = 2 / scale;

  if (activeCanvasShape) {
    strokeCanvasShapeOutline(ctx, activeCanvasShape, {
      strokeStyle: '#141514',
      lineWidth: outlineWidth,
    });
  } else {
    ctx.strokeStyle = '#141514';
    ctx.lineWidth = outlineWidth;
    ctx.strokeRect(0, 0, projectWidth, projectHeight);
  }

  if (editorActive && editorDraftShape) {
    strokeCanvasShapeOutline(ctx, editorDraftShape, {
      strokeStyle: '#C7D7F8',
      lineWidth: Math.max(1 / scale, 0.75),
      dash: [6 / scale, 4 / scale],
    });
  }

  ctx.restore();
};
