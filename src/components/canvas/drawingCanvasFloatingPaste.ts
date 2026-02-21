import type React from 'react';
import type { CanvasShape } from '@/types';
import { strokeMarqueePath, strokeMarqueeRect } from '@/utils/marqueeStroke';

interface FloatingPasteStateLike {
  imageData: ImageData | null;
  position: { x: number; y: number };
  width: number;
  height: number;
  displayWidth?: number;
  displayHeight?: number;
  rotation?: number;
  vectorPath?: {
    mode: 'freehand' | 'click-line';
    points: Array<{ x: number; y: number }>;
  } | null;
}

interface DrawFloatingPasteOptions {
  ctx: CanvasRenderingContext2D;
  floatingPaste: FloatingPasteStateLike;
  project: { width: number; height: number };
  layerOpacity: number;
  layerBlendMode: GlobalCompositeOperation;
  contextIsWorldTransformed?: boolean;
  scale: number;
  offsetX: number;
  offsetY: number;
  marchingAntsOffset: number;
  pasteCanvasRef: React.MutableRefObject<HTMLCanvasElement | null>;
  lastPasteInfoRef: React.MutableRefObject<{
    imageData: ImageData | null;
    width: number;
    height: number;
  }>;
  activeCanvasShape: CanvasShape | null;
  applyCanvasShapeClip: (ctx: CanvasRenderingContext2D, shape: CanvasShape) => void;
}

const buildLocalVectorPath = (
  vectorPath: NonNullable<FloatingPasteStateLike['vectorPath']>
): Path2D | null => {
  if (vectorPath.points.length < 2) {
    return null;
  }

  const path = new Path2D();
  path.moveTo(vectorPath.points[0].x, vectorPath.points[0].y);
  for (let i = 1; i < vectorPath.points.length; i += 1) {
    path.lineTo(vectorPath.points[i].x, vectorPath.points[i].y);
  }
  if (vectorPath.points.length > 2) {
    path.closePath();
  }
  return path;
};

export const drawFloatingPasteLayer = ({
  ctx,
  floatingPaste,
  project,
  layerOpacity,
  layerBlendMode,
  contextIsWorldTransformed = false,
  scale,
  offsetX,
  offsetY,
  marchingAntsOffset,
  pasteCanvasRef,
  lastPasteInfoRef,
  activeCanvasShape,
  applyCanvasShapeClip,
}: DrawFloatingPasteOptions): void => {
  if (!floatingPaste.imageData) {
    return;
  }

  ctx.save();
  if (!contextIsWorldTransformed) {
    ctx.translate(offsetX, offsetY);
    ctx.scale(scale, scale);
  }

  const pasteX = floatingPaste.position.x;
  const pasteY = floatingPaste.position.y;
  const renderWidth = floatingPaste.displayWidth ?? floatingPaste.width;
  const renderHeight = floatingPaste.displayHeight ?? floatingPaste.height;
  const rotation = floatingPaste.rotation ?? 0;
  const rotationRad = (rotation * Math.PI) / 180;

  const centerX = pasteX + renderWidth / 2;
  const centerY = pasteY + renderHeight / 2;
  const cos = Math.cos(rotationRad);
  const sin = Math.sin(rotationRad);
  const bboxWidth = Math.abs(renderWidth * cos) + Math.abs(renderHeight * sin);
  const bboxHeight = Math.abs(renderWidth * sin) + Math.abs(renderHeight * cos);
  const bboxX = centerX - bboxWidth / 2;
  const bboxY = centerY - bboxHeight / 2;

  const fullyOutside =
    bboxX + bboxWidth <= 0 ||
    bboxY + bboxHeight <= 0 ||
    bboxX >= project.width ||
    bboxY >= project.height;

  if (!fullyOutside) {
    if (!pasteCanvasRef.current) {
      pasteCanvasRef.current = document.createElement('canvas');
    }
    const pasteCanvas = pasteCanvasRef.current;

    let needsUpdate = false;
    if (pasteCanvas.width !== floatingPaste.width || pasteCanvas.height !== floatingPaste.height) {
      pasteCanvas.width = floatingPaste.width;
      pasteCanvas.height = floatingPaste.height;
      needsUpdate = true;
    }

    if (lastPasteInfoRef.current.imageData !== floatingPaste.imageData || needsUpdate) {
      const pasteCtx = pasteCanvas.getContext('2d', { willReadFrequently: true });
      if (pasteCtx) {
        pasteCtx.putImageData(floatingPaste.imageData, 0, 0);
        lastPasteInfoRef.current = {
          imageData: floatingPaste.imageData,
          width: pasteCanvas.width,
          height: pasteCanvas.height,
        };
      }
    }

    ctx.save();
    if (activeCanvasShape) {
      applyCanvasShapeClip(ctx, activeCanvasShape);
    } else {
      ctx.beginPath();
      ctx.rect(0, 0, project.width, project.height);
      ctx.clip();
    }

    if (rotation !== 0) {
      ctx.save();
      ctx.globalAlpha = layerOpacity;
      ctx.globalCompositeOperation = layerBlendMode;
      ctx.translate(centerX, centerY);
      ctx.rotate(rotationRad);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(pasteCanvas, -renderWidth / 2, -renderHeight / 2, renderWidth, renderHeight);
      ctx.restore();
    } else {
      ctx.save();
      ctx.globalAlpha = layerOpacity;
      ctx.globalCompositeOperation = layerBlendMode;
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(
        pasteCanvas,
        floatingPaste.position.x,
        floatingPaste.position.y,
        renderWidth,
        renderHeight
      );
      ctx.restore();
    }

    const localVectorPath = floatingPaste.vectorPath ? buildLocalVectorPath(floatingPaste.vectorPath) : null;
    const scaleX = renderWidth / Math.max(1, floatingPaste.width);
    const scaleY = renderHeight / Math.max(1, floatingPaste.height);
    if (rotation !== 0) {
      ctx.save();
      ctx.translate(centerX, centerY);
      ctx.rotate(rotationRad);
      ctx.translate(-renderWidth / 2, -renderHeight / 2);
      ctx.scale(scaleX, scaleY);

      if (localVectorPath) {
        strokeMarqueePath(ctx, localVectorPath, {
          scale,
          marchingAntsOffset,
          animated: false,
        });
      } else {
        strokeMarqueeRect(ctx, 0, 0, floatingPaste.width, floatingPaste.height, {
          scale,
          marchingAntsOffset,
          animated: false,
        });
      }
      ctx.restore();
    } else {
      const x = floatingPaste.position.x;
      const y = floatingPaste.position.y;
      ctx.save();
      ctx.translate(x, y);
      ctx.scale(scaleX, scaleY);
      if (localVectorPath) {
        strokeMarqueePath(ctx, localVectorPath, {
          scale,
          marchingAntsOffset,
          animated: false,
        });
      } else {
        strokeMarqueeRect(ctx, 0, 0, floatingPaste.width, floatingPaste.height, {
          scale,
          marchingAntsOffset,
          animated: false,
        });
      }
      ctx.restore();
    }

    ctx.restore();
  }

  ctx.restore();
};
