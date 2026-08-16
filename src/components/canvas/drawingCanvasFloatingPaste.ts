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

const buildRenderedVectorPath = (
  vectorPath: NonNullable<FloatingPasteStateLike['vectorPath']>,
  scaleX: number,
  scaleY: number,
): Path2D | null => {
  if (vectorPath.points.length < 2) {
    return null;
  }

  const path = new Path2D();
  path.moveTo(vectorPath.points[0].x * scaleX, vectorPath.points[0].y * scaleY);
  for (let i = 1; i < vectorPath.points.length; i += 1) {
    path.lineTo(vectorPath.points[i].x * scaleX, vectorPath.points[i].y * scaleY);
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

export const renderFloatingPasteLayerOverlay = ({
  outputCanvasRef,
  baseOverlay,
  floatingPaste,
  project,
  pasteCanvasRef,
  lastPasteInfoRef,
  activeCanvasShape,
  applyCanvasShapeClip,
}: {
  outputCanvasRef: React.MutableRefObject<HTMLCanvasElement | null>;
  baseOverlay?: HTMLCanvasElement | null;
  floatingPaste: FloatingPasteStateLike;
  project: { width: number; height: number };
  pasteCanvasRef: DrawFloatingPastePixelsOptions['pasteCanvasRef'];
  lastPasteInfoRef: DrawFloatingPastePixelsOptions['lastPasteInfoRef'];
  activeCanvasShape: CanvasShape | null;
  applyCanvasShapeClip: DrawFloatingPastePixelsOptions['applyCanvasShapeClip'];
}): HTMLCanvasElement | null => {
  if (!floatingPaste.imageData) return null;
  const canvas = outputCanvasRef.current ?? document.createElement('canvas');
  canvas.width = project.width;
  canvas.height = project.height;
  outputCanvasRef.current = canvas;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) return null;
  context.clearRect(0, 0, canvas.width, canvas.height);
  if (baseOverlay) context.drawImage(baseOverlay, 0, 0);
  drawFloatingPastePixels({
    ctx: context,
    floatingPaste,
    project,
    layerOpacity: 1,
    layerBlendMode: 'source-over',
    contextIsWorldTransformed: true,
    scale: 1,
    offsetX: 0,
    offsetY: 0,
    pasteCanvasRef,
    lastPasteInfoRef,
    activeCanvasShape,
    applyCanvasShapeClip,
  });
  return canvas;
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
  const scaleX = renderWidth / Math.max(1, floatingPaste.width);
  const scaleY = renderHeight / Math.max(1, floatingPaste.height);
  const renderedVectorPath = floatingPaste.vectorPath
    ? buildRenderedVectorPath(floatingPaste.vectorPath, scaleX, scaleY)
    : null;

  ctx.translate(
    floatingPaste.position.x + renderWidth / 2,
    floatingPaste.position.y + renderHeight / 2,
  );
  ctx.rotate((rotation * Math.PI) / 180);
  ctx.translate(-renderWidth / 2, -renderHeight / 2);
  if (renderedVectorPath) {
    strokeMarqueePath(ctx, renderedVectorPath, {
      scale,
      marchingAntsOffset,
      animated: false,
    });
  } else {
    strokeMarqueeRect(ctx, 0, 0, renderWidth, renderHeight, {
      scale,
      marchingAntsOffset,
      animated: false,
    });
  }
  ctx.restore();
};
