import type React from 'react';
import type { CanvasShape } from '@/types';
import { strokeMarqueePath, strokeMarqueeRect } from '@/utils/marqueeStroke';
import { rasterizeFloatingPasteBitmap } from '@/utils/selection/floatingPasteRaster';

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

interface DrawFloatingPastePixelsOptions {
  ctx: CanvasRenderingContext2D;
  floatingPaste: FloatingPasteStateLike;
  project: { width: number; height: number };
  layerOpacity: number;
  layerBlendMode: GlobalCompositeOperation;
  contextIsWorldTransformed?: boolean;
  visibleRect?: { x: number; y: number; width: number; height: number };
  targetRect?: { x: number; y: number; width: number; height: number };
  scale: number;
  offsetX: number;
  offsetY: number;
  pasteCanvasRef: React.MutableRefObject<HTMLCanvasElement | null>;
  lastPasteInfoRef: React.MutableRefObject<{
    imageData: ImageData | null;
    width: number;
    height: number;
  }>;
  activeCanvasShape: CanvasShape | null;
  applyCanvasShapeClip: (ctx: CanvasRenderingContext2D, shape: CanvasShape) => void;
}

interface DrawFloatingPasteMarqueeOptions {
  ctx: CanvasRenderingContext2D;
  floatingPaste: FloatingPasteStateLike;
  contextIsWorldTransformed?: boolean;
  scale: number;
  offsetX: number;
  offsetY: number;
  marchingAntsOffset: number;
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

export const drawFloatingPastePixels = ({
  ctx,
  floatingPaste,
  project,
  layerOpacity,
  layerBlendMode,
  contextIsWorldTransformed = false,
  visibleRect,
  targetRect,
  scale,
  offsetX,
  offsetY,
  pasteCanvasRef,
  lastPasteInfoRef,
  activeCanvasShape,
  applyCanvasShapeClip,
}: DrawFloatingPastePixelsOptions): void => {
  if (!floatingPaste.imageData) {
    return;
  }

  ctx.save();
  if (visibleRect && targetRect) {
    ctx.translate(targetRect.x, targetRect.y);
    ctx.scale(targetRect.width / visibleRect.width, targetRect.height / visibleRect.height);
    ctx.translate(-visibleRect.x, -visibleRect.y);
  } else if (!contextIsWorldTransformed) {
    ctx.translate(offsetX, offsetY);
    ctx.scale(scale, scale);
  }

  const raster = rasterizeFloatingPasteBitmap(
    { ...floatingPaste, imageData: floatingPaste.imageData },
    project
  );

  if (raster) {
    pasteCanvasRef.current = raster.canvas;
    lastPasteInfoRef.current = {
      imageData: floatingPaste.imageData,
      width: raster.canvas.width,
      height: raster.canvas.height,
    };

    ctx.save();
    if (activeCanvasShape) {
      applyCanvasShapeClip(ctx, activeCanvasShape);
    } else {
      ctx.beginPath();
      ctx.rect(0, 0, project.width, project.height);
      ctx.clip();
    }

    ctx.save();
    ctx.globalAlpha = layerOpacity;
    ctx.globalCompositeOperation = layerBlendMode;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(raster.canvas, raster.roi.x, raster.roi.y, raster.roi.width, raster.roi.height);
    ctx.restore();

    ctx.restore();
  }

  ctx.restore();
};

export const drawFloatingPasteMarquee = ({
  ctx,
  floatingPaste,
  contextIsWorldTransformed = false,
  scale,
  offsetX,
  offsetY,
  marchingAntsOffset,
}: DrawFloatingPasteMarqueeOptions): void => {
  if (!floatingPaste.imageData) {
    return;
  }

  ctx.save();
  if (!contextIsWorldTransformed) {
    ctx.translate(offsetX, offsetY);
    ctx.scale(scale, scale);
  }

  const renderWidth = floatingPaste.displayWidth ?? floatingPaste.width;
  const renderHeight = floatingPaste.displayHeight ?? floatingPaste.height;
  const rotation = floatingPaste.rotation ?? 0;
  const localVectorPath = floatingPaste.vectorPath
    ? buildLocalVectorPath(floatingPaste.vectorPath)
    : null;
  const scaleX = renderWidth / Math.max(1, floatingPaste.width);
  const scaleY = renderHeight / Math.max(1, floatingPaste.height);

  ctx.translate(
    floatingPaste.position.x + renderWidth / 2,
    floatingPaste.position.y + renderHeight / 2,
  );
  ctx.rotate((rotation * Math.PI) / 180);
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
};
