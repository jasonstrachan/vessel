import type { CaptureRegion } from '@/hooks/canvas/utils/captureRegions';
import type { CanvasSnapshot, Layer } from '@/types';
import type { LayerHistoryPayload } from '@/history/helpers/layerHistory';

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
  const layerCanvas = activeLayer.colorCycleData?.canvas ?? null;
  const captureMode = isEraserV2 ? { mode: 'replace' as const } : undefined;

  if (isEraserV2 && isColorCycleLayer && layerCanvas) {
    await deps.withTiming('cc:capture', () =>
      deps.captureCanvasToActiveLayer(layerCanvas, eraserRoi ?? undefined, captureMode)
    );
    if (!skipSave) {
      void deps.scheduleHistoryCommit({
        layerId: activeLayerId,
        beforeImage: layerBeforeImage,
        beforeColorState: layerBeforeColorState,
        actionType,
        description,
        tool: 'eraser',
        coalesce,
        bitmapRoi: eraserRoi ?? undefined,
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
    void deps.scheduleHistoryCommit({
      layerId: activeLayerId,
      beforeImage: layerBeforeImage,
      beforeColorState: layerBeforeColorState,
      actionType,
      description,
      tool: 'eraser',
      coalesce,
      bitmapRoi: (eraserRoi ?? captureRoi) ?? undefined,
      skipBitmapDelta: false,
    });
    return true;
  }

  return false;
};
