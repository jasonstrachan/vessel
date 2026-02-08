import type React from 'react';
import type { CanvasShape } from '@/types';

interface FloatingPasteStateLike {
  imageData: ImageData | null;
  position: { x: number; y: number };
  width: number;
  height: number;
  displayWidth?: number;
  displayHeight?: number;
  rotation?: number;
}

interface DrawFloatingPasteOptions {
  ctx: CanvasRenderingContext2D;
  floatingPaste: FloatingPasteStateLike;
  project: { width: number; height: number };
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

export const drawFloatingPasteLayer = ({
  ctx,
  floatingPaste,
  project,
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
  ctx.translate(offsetX, offsetY);
  ctx.scale(scale, scale);

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
      ctx.translate(centerX, centerY);
      ctx.rotate(rotationRad);
      ctx.drawImage(pasteCanvas, -renderWidth / 2, -renderHeight / 2, renderWidth, renderHeight);
      ctx.restore();
    } else {
      ctx.drawImage(
        pasteCanvas,
        floatingPaste.position.x,
        floatingPaste.position.y,
        renderWidth,
        renderHeight
      );
    }

    const borderLineWidth = 2 / scale;
    const dashLineWidth = 1 / scale;
    const dashLength = 5 / scale;

    if (rotation !== 0) {
      ctx.save();
      ctx.translate(centerX, centerY);
      ctx.rotate(rotationRad);

      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = borderLineWidth;
      ctx.setLineDash([]);
      ctx.strokeRect(-renderWidth / 2, -renderHeight / 2, renderWidth, renderHeight);

      ctx.strokeStyle = '#000000';
      ctx.lineWidth = dashLineWidth;
      ctx.setLineDash([dashLength, dashLength]);
      ctx.lineDashOffset = -marchingAntsOffset / scale;
      ctx.strokeRect(-renderWidth / 2, -renderHeight / 2, renderWidth, renderHeight);
      ctx.restore();
    } else {
      const x = floatingPaste.position.x;
      const y = floatingPaste.position.y;

      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = borderLineWidth;
      ctx.setLineDash([]);
      ctx.strokeRect(x, y, renderWidth, renderHeight);

      ctx.strokeStyle = '#000000';
      ctx.lineWidth = dashLineWidth;
      ctx.setLineDash([dashLength, dashLength]);
      ctx.lineDashOffset = -marchingAntsOffset / scale;
      ctx.strokeRect(x, y, renderWidth, renderHeight);
    }

    ctx.restore();
  }

  ctx.restore();
};
