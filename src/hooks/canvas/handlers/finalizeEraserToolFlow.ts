import type React from 'react';
import type { ColorCycleSerializedState } from '@/history/helpers/colorCycle';
import type { CaptureRegion } from '@/hooks/canvas/utils/captureRegions';
import type { CanvasSnapshot, Layer } from '@/types';
import {
  finalizeEraserStroke,
  type FinalizeEraserStrokeDeps,
} from '@/hooks/canvas/handlers/eraserFinalize';
import type { StrokeCoalescePayload } from '@/hooks/canvas/handlers/strokeHistoryCoalesce';

export const runFinalizeEraserToolFlow = async ({
  activeLayer,
  activeLayerId,
  drawingCanvas,
  layerBeforeImage,
  layerBeforeColorState,
  historyActionOverride,
  historyDescriptionOverride,
  captureRoi,
  eraserRoiRef,
  coalescePayload,
  isEraserV2,
  skipSave,
}: {
  activeLayer: Layer;
  activeLayerId: string;
  drawingCanvas: HTMLCanvasElement | null;
  layerBeforeImage: ImageData | null;
  layerBeforeColorState: ColorCycleSerializedState | null;
  historyActionOverride?: CanvasSnapshot['actionType'];
  historyDescriptionOverride?: string;
  captureRoi: CaptureRegion | undefined;
  eraserRoiRef: React.MutableRefObject<CaptureRegion | null>;
  coalescePayload: StrokeCoalescePayload | undefined;
  isEraserV2: boolean;
  skipSave: boolean;
}, deps: FinalizeEraserStrokeDeps): Promise<void> => {
  await finalizeEraserStroke({
    activeLayer,
    activeLayerId,
    drawingCanvas,
    layerBeforeImage,
    layerBeforeColorState,
    historyAction: historyActionOverride,
    historyDescription: historyDescriptionOverride,
    captureRoi,
    eraserRoi: isEraserV2 ? eraserRoiRef.current : null,
    coalesce: coalescePayload,
    isEraserV2,
    skipSave,
  }, deps);

  eraserRoiRef.current = null;
};
