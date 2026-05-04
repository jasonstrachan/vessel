import { getAppStoreState } from '@/stores/appStoreAccess';
import { debugWarn, recordBreadcrumb } from '@/utils/debug';
import { createDevDebugOverlayLogger } from '@/utils/dev/debugOverlayStore';
import type { Layer } from '@/types';
import type { CompositeSegment } from '@/stores/slices/layersSlice';
import { selectSequentialPlaybackActive, type AppState } from '@/stores/useAppStore';
import {
  getSequentialLayerRenderCanvas,
} from '@/lib/sequential/SequentialLayerRenderer';
import { getSequentialRenderFrame } from '@/runtime/playback/sequentialFrameCursor';
import {
  getSequentialLivePreviewFrame,
  type SequentialLivePreviewFrame,
} from '@/lib/sequential/SequentialLivePreviewRuntime';
import {
  getColorCyclePresentationCanvas,
  resolveColorCyclePresentation,
} from './resolveColorCyclePresentation';

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

const compositeDebug = createDevDebugOverlayLogger('visible-composite');
const lastCompositeProbeSignatures = new Map<string, string>();

const sampleCanvasAlpha = (
  canvas: HTMLCanvasElement,
  rect: VisibleRect,
): { sampled: number; alphaHits: number; rgbHits: number } => {
  const ctx = canvas.getContext('2d', { willReadFrequently: true } as CanvasRenderingContext2DSettings);
  if (!ctx || canvas.width <= 0 || canvas.height <= 0) {
    return { sampled: 0, alphaHits: 0, rgbHits: 0 };
  }
  const x0 = Math.max(0, Math.floor(rect.x));
  const y0 = Math.max(0, Math.floor(rect.y));
  const x1 = Math.min(canvas.width - 1, Math.ceil(rect.x + rect.width));
  const y1 = Math.min(canvas.height - 1, Math.ceil(rect.y + rect.height));
  if (x1 < x0 || y1 < y0) {
    return { sampled: 0, alphaHits: 0, rgbHits: 0 };
  }
  let sampled = 0;
  let alphaHits = 0;
  let rgbHits = 0;
  const steps = 4;
  for (let yi = 0; yi < steps; yi += 1) {
    const py = Math.round(y0 + ((y1 - y0) * yi) / Math.max(1, steps - 1));
    for (let xi = 0; xi < steps; xi += 1) {
      const px = Math.round(x0 + ((x1 - x0) * xi) / Math.max(1, steps - 1));
      try {
        const pixel = ctx.getImageData(px, py, 1, 1).data;
        sampled += 1;
        if (pixel[3] !== 0) {
          alphaHits += 1;
        }
        if (pixel[0] !== 0 || pixel[1] !== 0 || pixel[2] !== 0) {
          rgbHits += 1;
        }
      } catch {
        return { sampled, alphaHits, rgbHits };
      }
    }
  }
  return { sampled, alphaHits, rgbHits };
};

const recordCompositeProbe = (event: string, data: unknown): void => {
  const key = (() => {
    if (data && typeof data === 'object' && 'layerId' in data) {
      return `${event}:${String((data as { layerId?: unknown }).layerId ?? '')}`;
    }
    return event;
  })();
  const signature = (() => {
    try {
      return JSON.stringify(data);
    } catch {
      return event;
    }
  })();
  if (lastCompositeProbeSignatures.get(key) === signature) {
    return;
  }
  lastCompositeProbeSignatures.set(key, signature);
  recordBreadcrumb('visible-composite', { event, data });
  compositeDebug.log(event, data);
};

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
    recordCompositeProbe('draw-split-overlay', {
      activeLayerId: storeState.activeLayerId,
      segmentCount: segments.length,
      hasCompositeBitmap: Boolean(compositeBitmap),
      hasCompositeCanvas: Boolean(compositeCanvas),
      isActivelyErasing,
    });
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
    recordCompositeProbe('draw-nonactive-for-erasing', {
      activeLayerId: storeState.activeLayerId,
      segmentCount: segments.length,
      hasCompositeBitmap: Boolean(compositeBitmap),
      hasCompositeCanvas: Boolean(compositeCanvas),
    });
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
    recordCompositeProbe('draw-segments', {
      activeLayerId: storeState.activeLayerId,
      segmentCount: segments.length,
      segments: segments.map((segment) => ({
        kind: segment.kind,
        layerId: 'layerId' in segment ? segment.layerId : null,
        dirty: 'dirty' in segment ? segment.dirty : null,
      })),
    });
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
          recordCompositeProbe('skip-cc-segment', {
            activeLayerId: storeState.activeLayerId,
            layerId: segment.layerId,
            reason: !layer ? 'missing-layer' : !layer.visible ? 'hidden' : 'not-color-cycle',
          });
          return;
        }

        const projectWidth = storeState.project?.width ?? layer.framebuffer?.width ?? width;
        const projectHeight = storeState.project?.height ?? layer.framebuffer?.height ?? height;
        const presentation = resolveColorCyclePresentation({
          layer,
          activeLayerId: storeState.activeLayerId ?? null,
          projectWidth,
          projectHeight,
        });
        const drawCanvas = getColorCyclePresentationCanvas(presentation, layer);
        if (!drawCanvas) {
          recordCompositeProbe('skip-cc-segment', {
            activeLayerId: storeState.activeLayerId,
            layerId: segment.layerId,
            reason: presentation.kind === 'none' ? presentation.reason : 'missing-source',
            hydration: layer.colorCycleData?.runtimeHydrationState ?? null,
            hasCanvasImageData: Boolean(layer.colorCycleData?.canvasImageData),
          });
          return;
        }
        recordCompositeProbe('draw-cc-segment', {
          activeLayerId: storeState.activeLayerId,
          layerId: segment.layerId,
          isActiveLayer: storeState.activeLayerId === segment.layerId,
          hydration: layer.colorCycleData?.runtimeHydrationState ?? null,
          canvasSize: `${drawCanvas.width}x${drawCanvas.height}`,
          drawSource: presentation.kind,
          presentationReason: presentation.reason,
          hasCanvasImageData: Boolean(layer.colorCycleData?.canvasImageData),
          canvasSample: drawCanvas instanceof HTMLCanvasElement
            ? sampleCanvasAlpha(drawCanvas, visibleRect)
            : null,
          opacity: segment.opacity,
          blendMode: segment.blendMode ?? 'source-over',
        });
        ctx.save();
        ctx.globalAlpha = segment.opacity;
        ctx.globalCompositeOperation = segment.blendMode ?? 'source-over';
        ctx.drawImage(
          drawCanvas,
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
      const frameIndex = getSequentialRenderFrame(storeState);
      const frameCount = layer.sequentialData.frameCount;
      const includePreviewEvents =
        Boolean(storeState.sequentialRecord?.isPointerDown) && storeState.activeLayerId === layer.id;
      const sequentialCanvas = getSequentialLayerRenderCanvas({
        layer,
        width: projectWidth,
        height: projectHeight,
        frameIndex,
        holdPreviousOnEmptyFrames: shouldHoldPreviousSequentialFrame,
        ...(includePreviewEvents ? { deferAppendPatching: true } : {}),
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
      const frameIndex = getSequentialRenderFrame(storeState);
      const sequentialCanvas = getSequentialLayerRenderCanvas({
        layer: activeLayer,
        width: projectWidth,
        height: projectHeight,
        frameIndex,
        holdPreviousOnEmptyFrames: shouldHoldPreviousSequentialFrame,
        deferAppendPatching: true,
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
      recordCompositeProbe('draw-composite-bitmap', {
        activeLayerId: storeState.activeLayerId,
        segmentCount: segments.length,
        hasCompositeCanvas: Boolean(compositeCanvas),
      });
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
    recordCompositeProbe('draw-composite-canvas', {
      activeLayerId: storeState.activeLayerId,
      segmentCount: segments.length,
    });
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
