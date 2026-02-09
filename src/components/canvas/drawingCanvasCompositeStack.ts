import type { Layer } from '@/types';
import type { CompositeSegment } from '@/stores/slices/layersSlice';
import { useAppStore } from '@/stores/useAppStore';
import {
  getSequentialLayerRenderCanvas,
} from '@/lib/sequential/SequentialLayerRenderer';
import { getBufferedSequentialLayerFrameEvents } from '@/hooks/canvas/handlers/sequential/sequentialCapture';

interface VisibleRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface DrawVisibleCompositeStackOptions {
  ctx: CanvasRenderingContext2D;
  visibleRect: VisibleRect | null;
  useSplitOverlay: boolean;
  underCompositeCanvas: HTMLCanvasElement | null;
  isActivelyErasing: boolean | undefined;
  drawNonActiveVisibleLayers: (ctx: CanvasRenderingContext2D) => void;
  segments: CompositeSegment[];
  layerMap: Map<string, Layer>;
  compositeBitmap: ImageBitmap | null;
  compositeCanvas: HTMLCanvasElement | null;
}

interface DrawVisibleCompositeStackResult {
  invalidCompositeBitmap: boolean;
}

export const drawVisibleCompositeStack = ({
  ctx,
  visibleRect,
  useSplitOverlay,
  underCompositeCanvas,
  isActivelyErasing,
  drawNonActiveVisibleLayers,
  segments,
  layerMap,
  compositeBitmap,
  compositeCanvas,
}: DrawVisibleCompositeStackOptions): DrawVisibleCompositeStackResult => {
  const storeState = useAppStore.getState() as {
    project?: { width: number; height: number } | null;
    activeLayerId?: string | null;
    sequentialRecord?: { currentFrame?: number; isPointerDown?: boolean };
  };

  let invalidCompositeBitmap = false;
  if (!visibleRect) {
    return { invalidCompositeBitmap };
  }

  const { x, y, width, height } = visibleRect;
  if (width <= 0 || height <= 0) {
    return { invalidCompositeBitmap };
  }

  if (useSplitOverlay && underCompositeCanvas) {
    ctx.drawImage(underCompositeCanvas, x, y, width, height, x, y, width, height);
    return { invalidCompositeBitmap };
  }

  if (isActivelyErasing) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, width, height);
    ctx.clip();
    drawNonActiveVisibleLayers(ctx);
    ctx.restore();
    return { invalidCompositeBitmap };
  }

  let compositeDrawn = false;
  if (segments.length > 0) {
    compositeDrawn = true;
    segments.forEach((segment) => {
      if (segment.kind === 'static') {
        const source = segment.bitmap ?? segment.canvas;
        try {
          ctx.drawImage(source, x, y, width, height, x, y, width, height);
        } catch (error) {
          console.warn('[CompositeSegments] Failed to draw static segment', error);
        }
        return;
      }

      if (segment.kind === 'color-cycle') {
        const layer = layerMap.get(segment.layerId);
        if (!layer || !layer.visible || layer.layerType !== 'color-cycle') {
          return;
        }

        const layerCanvas = layer.colorCycleData?.canvas as HTMLCanvasElement | undefined;
        if (!layerCanvas) {
          return;
        }

        ctx.save();
        ctx.globalAlpha = segment.opacity;
        ctx.globalCompositeOperation = segment.blendMode ?? 'source-over';
        ctx.drawImage(layerCanvas, x, y, width, height, x, y, width, height);
        ctx.restore();
        return;
      }

      const layer = layerMap.get(segment.layerId);
      if (!layer || !layer.visible || layer.layerType !== 'sequential') {
        return;
      }

      const projectWidth = storeState.project?.width ?? layer.framebuffer?.width ?? width;
      const projectHeight = storeState.project?.height ?? layer.framebuffer?.height ?? height;
      const frameIndex = storeState.sequentialRecord?.currentFrame ?? 0;
      const includePreviewEvents =
        Boolean(storeState.sequentialRecord?.isPointerDown) && storeState.activeLayerId === layer.id;
      const previewEvents = includePreviewEvents
        ? getBufferedSequentialLayerFrameEvents({
            layerId: layer.id,
            frameIndex,
          })
        : undefined;
      const sequentialCanvas = getSequentialLayerRenderCanvas({
        layer,
        width: projectWidth,
        height: projectHeight,
        frameIndex,
        previewEvents,
      });
      if (!sequentialCanvas) {
        return;
      }

      ctx.save();
      ctx.globalAlpha = segment.opacity;
      ctx.globalCompositeOperation = segment.blendMode ?? 'source-over';
      ctx.drawImage(sequentialCanvas as CanvasImageSource, x, y, width, height, x, y, width, height);
      ctx.restore();
    });

  }

  if (!compositeDrawn && compositeBitmap) {
    try {
      ctx.drawImage(compositeBitmap, x, y, width, height, x, y, width, height);
      compositeDrawn = true;
    } catch (error) {
      const isInvalidState = error instanceof DOMException && error.name === 'InvalidStateError';
      if (isInvalidState) {
        invalidCompositeBitmap = true;
      } else {
        throw error;
      }
    }
  }

  if (!compositeDrawn && compositeCanvas) {
    ctx.drawImage(compositeCanvas, x, y, width, height, x, y, width, height);
  }

  return { invalidCompositeBitmap };
};

interface DrawOverCompositeLayerOptions {
  ctx: CanvasRenderingContext2D;
  useSplitOverlay: boolean;
  overCompositeHasContent: boolean;
  overCompositeCanvas: HTMLCanvasElement | null;
  visibleRect: VisibleRect | null;
}

export const drawOverCompositeLayer = ({
  ctx,
  useSplitOverlay,
  overCompositeHasContent,
  overCompositeCanvas,
  visibleRect,
}: DrawOverCompositeLayerOptions): void => {
  if (!useSplitOverlay || !overCompositeHasContent || !overCompositeCanvas || !visibleRect) {
    return;
  }

  const { x, y, width, height } = visibleRect;
  if (width <= 0 || height <= 0) {
    return;
  }

  ctx.drawImage(overCompositeCanvas, x, y, width, height, x, y, width, height);
};
