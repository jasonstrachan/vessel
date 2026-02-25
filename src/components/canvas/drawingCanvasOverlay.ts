import type { Layer } from '@/types';

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

  ctx.drawImage(overlayCanvasElement, x, y, width, height, x, y, width, height);
  ctx.restore();
};
