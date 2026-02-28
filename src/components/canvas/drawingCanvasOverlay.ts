import type { Layer } from '@/types';
import { getSelectionMaskContourPath } from '@/utils/selectionMaskContourPath';

interface VisibleRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface ColorCycleManagerLike {
  isPlaying?: () => boolean;
}

interface DrawCanvasOverlayLayerOptions {
  ctx: CanvasRenderingContext2D;
  layers: Layer[];
  activeLayer: Layer | null;
  visibleRect: VisibleRect | null;
  overlayCanvasElement: HTMLCanvasElement | null;
  overlayActive: boolean;
  isDrawing?: boolean;
  colorCycleManager: ColorCycleManagerLike | null;
  selectionStart?: { x: number; y: number } | null;
  selectionEnd?: { x: number; y: number } | null;
  selectionMask?: ImageData | null;
  selectionMaskBounds?: { x: number; y: number; width: number; height: number } | null;
  selectionVectorPath?: {
    mode: 'freehand' | 'click-line';
    points: Array<{ x: number; y: number }>;
  } | null;
}

export const drawCanvasOverlayLayer = ({
  ctx,
  layers,
  activeLayer,
  visibleRect,
  overlayCanvasElement,
  overlayActive,
  isDrawing,
  colorCycleManager,
  selectionStart = null,
  selectionEnd = null,
  selectionMask = null,
  selectionMaskBounds = null,
  selectionVectorPath = null,
}: DrawCanvasOverlayLayerOptions): void => {
  if (!overlayActive || !overlayCanvasElement || !visibleRect) {
    return;
  }

  const anyCCAnimating = layers.some(
    (layer) =>
      layer.visible &&
      layer.layerType === 'color-cycle' &&
      layer.colorCycleData?.mode !== 'recolor' &&
      Boolean(layer.colorCycleData?.isAnimating)
  );
  const isManagerPlaying =
    colorCycleManager && typeof colorCycleManager.isPlaying === 'function'
      ? colorCycleManager.isPlaying()
      : false;

  const activelyDrawing = Boolean(isDrawing);
  const overlayBlockedByAnimation = anyCCAnimating || isManagerPlaying;
  if (overlayBlockedByAnimation && !activelyDrawing) {
    return;
  }

  const { x, y, width, height } = visibleRect;
  if (width <= 0 || height <= 0) {
    return;
  }

  ctx.save();
  if (activeLayer) {
    ctx.globalAlpha = activeLayer.opacity;
    ctx.globalCompositeOperation = activeLayer.blendMode ?? 'source-over';
  } else {
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  if (selectionMask && selectionMaskBounds) {
    const hasVectorPath = Boolean(selectionVectorPath && selectionVectorPath.points.length >= 2);
    if (hasVectorPath) {
      const path = new Path2D();
      const points = selectionVectorPath!.points;
      path.moveTo(points[0].x, points[0].y);
      for (let i = 1; i < points.length; i += 1) {
        path.lineTo(points[i].x, points[i].y);
      }
      if (points.length > 2) {
        path.closePath();
      }
      ctx.clip(path);
    } else {
      const contourPath = getSelectionMaskContourPath(selectionMask);
      ctx.translate(selectionMaskBounds.x, selectionMaskBounds.y);
      ctx.clip(contourPath);
      ctx.translate(-selectionMaskBounds.x, -selectionMaskBounds.y);
    }
  } else if (selectionStart && selectionEnd) {
    const x = Math.min(selectionStart.x, selectionEnd.x);
    const y = Math.min(selectionStart.y, selectionEnd.y);
    const width = Math.abs(selectionEnd.x - selectionStart.x);
    const height = Math.abs(selectionEnd.y - selectionStart.y);
    if (width > 0 && height > 0) {
      const rectPath = new Path2D();
      rectPath.rect(x, y, width, height);
      ctx.clip(rectPath);
    }
  }

  ctx.drawImage(overlayCanvasElement, x, y, width, height, x, y, width, height);
  ctx.restore();
};
