import type { CaptureRegion } from '@/hooks/canvas/utils/captureRegions';
import type { CanvasSnapshot, Layer } from '@/types';
import type { LayerHistoryPayload } from '@/history/helpers/layerHistory';
import { cloneSequentialLayerData } from '@/history/deltas/sequentialFrameDelta';
import { commitSequentialLayerHistory } from '@/history/helpers/sequentialLayerHistory';
import { getSequentialLayerRenderCanvas } from '@/lib/sequential/SequentialLayerRenderer';
import {
  appendSequentialEvent,
  buildSequentialDestinationOutEvent,
  createSequentialEraseMaskFromDiff,
  cropImageDataToBounds,
  findOpaqueMaskBounds,
} from '@/lib/sequential/sequentialEdit';
import { useAppStore } from '@/stores/useAppStore';

export type FinalizeEraserStrokeArgs = {
  activeLayer: Layer | null;
  activeLayerId: string;
  drawingCanvas: HTMLCanvasElement | null;
  layerBeforeImage: ImageData | null;
  layerBeforeColorState: LayerHistoryPayload['beforeColorState'];
  historyAction?: CanvasSnapshot['actionType'];
  historyDescription?: string;
  captureRoi?: CaptureRegion;
  eraserRoi?: CaptureRegion | null;
  coalesce?: LayerHistoryPayload['coalesce'];
  isEraserV2: boolean;
  skipSave: boolean;
};

export type FinalizeEraserStrokeDeps = {
  captureCanvasToActiveLayer: (
    canvas: HTMLCanvasElement,
    roi?: CaptureRegion,
    options?: { mode: 'replace' }
  ) => Promise<void>;
  scheduleHistoryCommit: (payload: LayerHistoryPayload) => Promise<void>;
  withTiming: <T>(label: string, task: () => Promise<T> | T) => Promise<T>;
  logError: (message: string) => void;
};

const extractCanvasRegion = (
  source: HTMLCanvasElement | OffscreenCanvas,
  roi?: CaptureRegion
): ImageData | null => {
  const ctx = source.getContext(
    '2d',
    { willReadFrequently: true } as CanvasRenderingContext2DSettings
  ) as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
  if (!ctx || !('getImageData' in ctx)) {
    return null;
  }

  const x = Math.max(0, Math.floor(roi?.x ?? 0));
  const y = Math.max(0, Math.floor(roi?.y ?? 0));
  const right = Math.min(source.width, Math.ceil((roi?.x ?? 0) + (roi?.width ?? source.width)));
  const bottom = Math.min(source.height, Math.ceil((roi?.y ?? 0) + (roi?.height ?? source.height)));
  const width = Math.max(0, right - x);
  const height = Math.max(0, bottom - y);

  if (width <= 0 || height <= 0) {
    return null;
  }

  try {
    return ctx.getImageData(x, y, width, height);
  } catch {
    return null;
  }
};

export const createFinalizeEraserStrokeDeps = (
  deps: FinalizeEraserStrokeDeps
): FinalizeEraserStrokeDeps => deps;

type PendingEraserTool = {
  end: () => void;
  getROI: () => CaptureRegion | null;
};

export const finalizePendingEraserTool = ({
  pendingEraserTool,
  eraserToolRef,
  eraserRoiRef,
}: {
  pendingEraserTool: PendingEraserTool | null;
  eraserToolRef: React.MutableRefObject<PendingEraserTool | null>;
  eraserRoiRef: React.MutableRefObject<CaptureRegion | null>;
}): void => {
  if (!pendingEraserTool) {
    return;
  }
  try {
    pendingEraserTool.end();
  } finally {
    eraserRoiRef.current = pendingEraserTool.getROI();
    if (eraserToolRef.current === pendingEraserTool) {
      eraserToolRef.current = null;
    }
  }
};

export const finalizeEraserStroke = async (
  args: FinalizeEraserStrokeArgs,
  deps: FinalizeEraserStrokeDeps
): Promise<boolean> => {
  const {
    activeLayer,
    activeLayerId,
    drawingCanvas,
    layerBeforeImage,
    layerBeforeColorState,
    historyAction,
    historyDescription,
    captureRoi,
    eraserRoi,
    coalesce,
    isEraserV2,
    skipSave,
  } = args;

  if (!activeLayer) {
    return false;
  }

  const actionType = historyAction ?? 'eraser';
  const description = historyDescription ?? 'Eraser Stroke';
  const isColorCycleLayer = activeLayer.layerType === 'color-cycle';
  if (activeLayer.layerType === 'sequential' && activeLayer.sequentialData && drawingCanvas) {
    const store = useAppStore.getState();
    const project = store.project;
    if (!project) {
      return false;
    }

    const frameCount = Math.max(1, Math.round(activeLayer.sequentialData.frameCount));
    const frameIndex =
      ((Math.round(store.sequentialRecord.currentFrame) % frameCount) + frameCount) % frameCount;
    const beforeCanvas = getSequentialLayerRenderCanvas({
      layer: activeLayer,
      width: project.width,
      height: project.height,
      frameIndex,
      holdPreviousOnEmptyFrames: true,
    });
    if (!beforeCanvas) {
      return false;
    }

    const diffRoi = (eraserRoi ?? captureRoi) ?? undefined;
    const beforeRegion = extractCanvasRegion(beforeCanvas, diffRoi);
    const afterRegion = extractCanvasRegion(drawingCanvas, diffRoi);
    if (!beforeRegion || !afterRegion) {
      return false;
    }

    const baseBounds = {
      x: Math.max(0, Math.floor(diffRoi?.x ?? 0)),
      y: Math.max(0, Math.floor(diffRoi?.y ?? 0)),
      width: beforeRegion.width,
      height: beforeRegion.height,
    };
    const eraseMask = createSequentialEraseMaskFromDiff({
      beforeImage: beforeRegion,
      afterImage: afterRegion,
      bounds: baseBounds,
    });
    if (!eraseMask) {
      return false;
    }

    const relativeBounds = findOpaqueMaskBounds(eraseMask);
    if (!relativeBounds) {
      return false;
    }

    const croppedMask = cropImageDataToBounds(eraseMask, relativeBounds);
    const absoluteBounds = {
      x: baseBounds.x + relativeBounds.x,
      y: baseBounds.y + relativeBounds.y,
      width: relativeBounds.width,
      height: relativeBounds.height,
    };
    const beforeSequentialData = cloneSequentialLayerData(activeLayer.sequentialData);
    const timestampMs = Date.now();
    const strokeId = `seq-eraser-${timestampMs}`;
    const event = buildSequentialDestinationOutEvent({
      layer: activeLayer,
      frameIndex,
      maskImageData: croppedMask,
      maskBounds: absoluteBounds,
      eraserSettings: {
        ...store.tools.brushSettings,
        ...store.tools.eraserSettings,
        blendMode: 'destination-out',
      },
      timestampMs,
      id: `${strokeId}-0`,
      strokeId,
    });
    const afterSequentialData = appendSequentialEvent(beforeSequentialData, event);

    store.updateLayer(
      activeLayerId,
      { sequentialData: afterSequentialData },
      { skipColorCycleSync: true }
    );
    store.setCurrentCompositeBitmap(null);
    store.setLayersNeedRecomposition(true);

    if (skipSave) {
      return false;
    }

    await commitSequentialLayerHistory({
      layerId: activeLayerId,
      beforeSequentialData,
      afterSequentialData,
      actionType,
      description,
      tool: 'eraser',
      coalesce: coalesce
        ? {
            key: coalesce.key,
            maxIntervalMs: coalesce.maxIntervalMs,
            mergeLabel: coalesce.mergeLabel,
            pointerSession: coalesce.pointerSession,
          }
        : undefined,
    });
    return true;
  }

  const layerCanvas = activeLayer.colorCycleData?.canvas ?? null;
  const captureMode = isEraserV2 ? { mode: 'replace' as const } : undefined;
  const matchesRoi = (image: ImageData | null, roi: CaptureRegion | null | undefined): boolean =>
    Boolean(image && roi && image.width === roi.width && image.height === roi.height);
  const isFullSnapshot = (image: ImageData | null): boolean =>
    Boolean(
      image &&
      drawingCanvas &&
      image.width === drawingCanvas.width &&
      image.height === drawingCanvas.height
    );
  const resolveHistoryBitmapRoi = (): CaptureRegion | undefined => {
    const preferred = (eraserRoi ?? captureRoi) ?? undefined;
    if (!preferred) {
      return undefined;
    }
    if (!layerBeforeImage || isFullSnapshot(layerBeforeImage)) {
      return preferred;
    }
    if (matchesRoi(layerBeforeImage, preferred)) {
      return preferred;
    }
    if (matchesRoi(layerBeforeImage, captureRoi ?? null)) {
      return captureRoi ?? undefined;
    }
    return undefined;
  };
  const historyBitmapRoi = resolveHistoryBitmapRoi();

  if (isEraserV2 && isColorCycleLayer && layerCanvas) {
    await deps.withTiming('cc:capture', () =>
      deps.captureCanvasToActiveLayer(layerCanvas, eraserRoi ?? undefined, captureMode)
    );
    if (!skipSave) {
      await deps.scheduleHistoryCommit({
        layerId: activeLayerId,
        beforeImage: layerBeforeImage,
        beforeColorState: layerBeforeColorState,
        actionType,
        description,
        tool: 'eraser',
        coalesce,
        bitmapRoi: historyBitmapRoi,
        skipBitmapDelta: true,
      });
      return true;
    }
    return false;
  }

  if (drawingCanvas) {
    if (skipSave) {
      await deps.withTiming('cc:capture', () =>
        deps.captureCanvasToActiveLayer(
          drawingCanvas,
          (eraserRoi ?? captureRoi) ?? undefined,
          captureMode
        )
      );
      return false;
    }

    await deps.withTiming('cc:capture', () =>
      deps.captureCanvasToActiveLayer(
        drawingCanvas,
        (eraserRoi ?? captureRoi) ?? undefined,
        captureMode
      )
    );
    if (!layerBeforeImage) {
      deps.logError('[finalize] eraser beforeImage missing; skipping history to avoid destructive undo.');
      return false;
    }
    await deps.scheduleHistoryCommit({
      layerId: activeLayerId,
      beforeImage: layerBeforeImage,
      beforeColorState: layerBeforeColorState,
      actionType,
      description,
      tool: 'eraser',
      coalesce,
      bitmapRoi: historyBitmapRoi,
      skipBitmapDelta: false,
    });
    return true;
  }

  return false;
};
