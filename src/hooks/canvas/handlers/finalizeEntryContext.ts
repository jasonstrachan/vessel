import type React from 'react';
import type { AppState } from '@/stores/useAppStore';
import type { CaptureRegion } from '@/hooks/canvas/utils/captureRegions';
import type { CanvasSnapshot } from '@/types';
import { resolveFinalizeOptions } from '@/hooks/canvas/handlers/finalizeOptions';
import { resolveFinalizeGuardContext } from '@/hooks/canvas/handlers/finalizeGuards';

export type FinalizeDrawingOptions<TAction, TRoi> = {
  historyActionOverride?: TAction;
  historyDescriptionOverride?: string;
  captureRegionOverride?: TRoi | null;
};

export type PendingEraserTool = {
  end: () => void;
  getROI: () => CaptureRegion | null;
};

export const resolveFinalizeEntryContext = ({
  skipSaveOrOptions,
  snapshot,
  hasCanvas,
  busy,
  project,
  isEraserV2,
  drawingCanvasHasContent,
  eraserToolRef,
  endMaskHealingStroke,
}: {
  skipSaveOrOptions?: boolean | FinalizeDrawingOptions<CanvasSnapshot['actionType'], CaptureRegion>;
  snapshot: AppState;
  hasCanvas: boolean;
  busy: boolean;
  project: { width: number; height: number } | null;
  isEraserV2: boolean;
  drawingCanvasHasContent: boolean;
  eraserToolRef: React.MutableRefObject<PendingEraserTool | null>;
  endMaskHealingStroke: () => void;
}):
  | {
      options: FinalizeDrawingOptions<CanvasSnapshot['actionType'], CaptureRegion>;
      skipSave: boolean;
      historyActionOverride?: CanvasSnapshot['actionType'];
      historyDescriptionOverride?: string;
      isCCLayerSnapshot: boolean;
      isCCBrushSnapshot: boolean;
      overlayHasContent: boolean;
      finalizeTool: ReturnType<typeof resolveFinalizeGuardContext>['finalizeTool'];
      pendingEraserTool: PendingEraserTool | null;
    }
  | null => {
  const {
    options,
    skipSave,
    historyActionOverride,
    historyDescriptionOverride,
  } = resolveFinalizeOptions<CanvasSnapshot['actionType'], CaptureRegion>(skipSaveOrOptions);

  const {
    isCCLayerSnapshot,
    isCCBrushSnapshot,
    guardResult,
    overlayHasContent,
    finalizeTool,
  } = resolveFinalizeGuardContext({
    snapshot,
    hasCanvas,
    busy,
    project,
    isEraserV2,
    drawingCanvasHasContent,
  });

  if (!guardResult.shouldProceed) {
    endMaskHealingStroke();
    return null;
  }

  const pendingEraserTool =
    isEraserV2 && snapshot.tools.currentTool === 'eraser'
      ? eraserToolRef.current
      : null;

  return {
    options,
    skipSave,
    historyActionOverride,
    historyDescriptionOverride,
    isCCLayerSnapshot,
    isCCBrushSnapshot,
    overlayHasContent,
    finalizeTool,
    pendingEraserTool,
  };
};
