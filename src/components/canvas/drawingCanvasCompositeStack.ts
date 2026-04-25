import { getAppStoreState } from '@/stores/appStoreAccess';
import { debugWarn } from '@/utils/debug';
import type { Layer } from '@/types';
import type { CompositeSegment } from '@/stores/slices/layersSlice';
import { selectSequentialPlaybackActive, type AppState } from '@/stores/useAppStore';
import {
  getSequentialLayerRenderCanvas,
} from '@/lib/sequential/SequentialLayerRenderer';
import {
  getSequentialLivePreviewFrame,
  type SequentialLivePreviewFrame,
} from '@/lib/sequential/SequentialLivePreviewRuntime';

interface VisibleRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface TargetRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface DrawVisibleCompositeStackOptions {
  ctx: CanvasRenderingContext2D;
  visibleRect: VisibleRect | null;
  targetRect?: TargetRect;
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

const resolveSequentialLivePreviewSessionKey = (
  layerId: string,
  state: AppState
): string | null => {
  const sessionStartMs = state.sequentialRecord?.sessionStartMs;
  if (!Number.isFinite(sessionStartMs)) {
    return null;
  }
  return `${layerId}:${sessionStartMs}`;
};

const drawLivePreviewFrame = ({
  ctx,
  livePreview,
  visibleRect,
  destination,
}: {
  ctx: CanvasRenderingContext2D;
  livePreview: SequentialLivePreviewFrame;
  visibleRect: VisibleRect;
  destination: TargetRect;
}): void => {
  const sourceX = Math.max(visibleRect.x, livePreview.bounds.x);
  const sourceY = Math.max(visibleRect.y, livePreview.bounds.y);
  const sourceMaxX = Math.min(
    visibleRect.x + visibleRect.width,
    livePreview.bounds.x + livePreview.bounds.width
  );
  const sourceMaxY = Math.min(
    visibleRect.y + visibleRect.height,
    livePreview.bounds.y + livePreview.bounds.height
  );
  const sourceWidth = sourceMaxX - sourceX;
  const sourceHeight = sourceMaxY - sourceY;
  if (sourceWidth <= 0 || sourceHeight <= 0) {
    return;
  }

  const scaleX = destination.width / visibleRect.width;
  const scaleY = destination.height / visibleRect.height;
  ctx.drawImage(
    livePreview.canvas as CanvasImageSource,
    sourceX,
    sourceY,
    sourceWidth,
    sourceHeight,
    destination.x + (sourceX - visibleRect.x) * scaleX,
    destination.y + (sourceY - visibleRect.y) * scaleY,
    sourceWidth * scaleX,
    sourceHeight * scaleY
  );
};

export const drawVisibleCompositeStack = ({
  ctx,
  visibleRect,
  targetRect,
  useSplitOverlay,
  underCompositeCanvas,
  isActivelyErasing,
  drawNonActiveVisibleLayers,
  segments,
  layerMap,
  compositeBitmap,
  compositeCanvas,
}: DrawVisibleCompositeStackOptions): DrawVisibleCompositeStackResult => {
  const storeState = getAppStoreState() as AppState;
  const shouldHoldPreviousSequentialFrame = !selectSequentialPlaybackActive(storeState);
  const activeCaptureLayerId = storeState.sequentialRecord?.isPointerDown
    ? storeState.activeLayerId
    : null;
  const activeCaptureLayer = activeCaptureLayerId ? layerMap.get(activeCaptureLayerId) : null;
  const isSequentialCaptureActive = Boolean(
    activeCaptureLayer?.visible &&
      activeCaptureLayer.layerType === 'sequential' &&
      activeCaptureLayer.sequentialData
  );

  let invalidCompositeBitmap = false;
  if (!visibleRect) {
    return { invalidCompositeBitmap };
  }

  const { x, y, width, height } = visibleRect;
  const destination = targetRect ?? visibleRect;
  if (width <= 0 || height <= 0) {
    return { invalidCompositeBitmap };
  }

  if (useSplitOverlay && underCompositeCanvas) {
    ctx.drawImage(
      underCompositeCanvas,
      x,
      y,
      width,
      height,
      destination.x,
      destination.y,
      destination.width,
      destination.height,
    );
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
          ctx.drawImage(
            source,
            x,
            y,
            width,
            height,
            destination.x,
            destination.y,
            destination.width,
            destination.height,
          );
        } catch (error) {
          debugWarn('raw-console', '[CompositeSegments] Failed to draw static segment', error);
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
        ctx.drawImage(
          layerCanvas,
          x,
          y,
          width,
          height,
          destination.x,
          destination.y,
          destination.width,
          destination.height,
        );
        ctx.restore();
        return;
      }

      const layer = layerMap.get(segment.layerId);
      if (!layer || !layer.visible || layer.layerType !== 'sequential' || !layer.sequentialData) {
        return;
      }

      const projectWidth = storeState.project?.width ?? layer.framebuffer?.width ?? width;
      const projectHeight = storeState.project?.height ?? layer.framebuffer?.height ?? height;
      const frameIndex = storeState.sequentialRecord?.currentFrame ?? 0;
      const frameCount = layer.sequentialData.frameCount;
      const includePreviewEvents =
        Boolean(storeState.sequentialRecord?.isPointerDown) && storeState.activeLayerId === layer.id;
      const sequentialCanvas = getSequentialLayerRenderCanvas({
        layer,
        width: projectWidth,
        height: projectHeight,
        frameIndex,
        holdPreviousOnEmptyFrames: shouldHoldPreviousSequentialFrame,
      });
      if (!sequentialCanvas) {
        return;
      }
      const livePreviewFrame = includePreviewEvents
        ? getSequentialLivePreviewFrame({
            layerId: layer.id,
            sessionKey: resolveSequentialLivePreviewSessionKey(layer.id, storeState),
            width: projectWidth,
            height: projectHeight,
            frameIndex,
            frameCount,
          })
        : null;

      ctx.save();
      ctx.globalAlpha = segment.opacity;
      ctx.globalCompositeOperation = segment.blendMode ?? 'source-over';
      ctx.drawImage(
        sequentialCanvas as CanvasImageSource,
        x,
        y,
        width,
        height,
        destination.x,
        destination.y,
        destination.width,
        destination.height,
      );
      if (livePreviewFrame) {
        drawLivePreviewFrame({
          ctx,
          livePreview: livePreviewFrame,
          visibleRect,
          destination,
        });
      }
      ctx.restore();
    });

  }

  if (!compositeDrawn && isSequentialCaptureActive) {
    const activeLayer = activeCaptureLayer;
    if (activeLayer?.visible && activeLayer.layerType === 'sequential' && activeLayer.sequentialData) {
      const projectWidth = storeState.project?.width ?? activeLayer.framebuffer?.width ?? width;
      const projectHeight = storeState.project?.height ?? activeLayer.framebuffer?.height ?? height;
      const frameIndex = storeState.sequentialRecord?.currentFrame ?? 0;
      const sequentialCanvas = getSequentialLayerRenderCanvas({
        layer: activeLayer,
        width: projectWidth,
        height: projectHeight,
        frameIndex,
        holdPreviousOnEmptyFrames: shouldHoldPreviousSequentialFrame,
      });
      if (sequentialCanvas) {
        const livePreviewFrame = getSequentialLivePreviewFrame({
          layerId: activeLayer.id,
          sessionKey: resolveSequentialLivePreviewSessionKey(activeLayer.id, storeState),
          width: projectWidth,
          height: projectHeight,
          frameIndex,
          frameCount: activeLayer.sequentialData.frameCount,
        });
        ctx.save();
        ctx.beginPath();
        ctx.rect(x, y, width, height);
        ctx.clip();
        drawNonActiveVisibleLayers(ctx);
        ctx.globalAlpha = activeLayer.opacity;
        ctx.globalCompositeOperation = activeLayer.blendMode ?? 'source-over';
        ctx.drawImage(
          sequentialCanvas as CanvasImageSource,
          x,
          y,
          width,
          height,
          destination.x,
          destination.y,
          destination.width,
          destination.height,
        );
        if (livePreviewFrame) {
          drawLivePreviewFrame({
            ctx,
            livePreview: livePreviewFrame,
            visibleRect,
            destination,
          });
        }
        ctx.restore();
        compositeDrawn = true;
      }
    }
  }

  if (!compositeDrawn && compositeBitmap && !isSequentialCaptureActive) {
    try {
      ctx.drawImage(
        compositeBitmap,
        x,
        y,
        width,
        height,
        destination.x,
        destination.y,
        destination.width,
        destination.height,
      );
      compositeDrawn = true;
    } catch (error) {
      const errorName =
        typeof error === 'object' && error !== null && 'name' in error
          ? String((error as { name?: unknown }).name)
          : null;
      const isInvalidState = errorName === 'InvalidStateError';
      if (isInvalidState) {
        invalidCompositeBitmap = true;
      } else {
        throw error;
      }
    }
  }

  if (!compositeDrawn && compositeCanvas && !isSequentialCaptureActive) {
    ctx.drawImage(
      compositeCanvas,
      x,
      y,
      width,
      height,
      destination.x,
      destination.y,
      destination.width,
      destination.height,
    );
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
