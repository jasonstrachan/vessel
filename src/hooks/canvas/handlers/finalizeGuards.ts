import type { AppState } from '@/stores/useAppStore';
import type { Tool } from '@/types';
import { getColorCycleBrushFlags } from '@/hooks/canvas/utils/colorCycleBrushFlags';

export type FinalizeGuardResult = {
  shouldProceed: boolean;
  overlayHasContent: boolean;
  overlayOptional: boolean;
  allowEmptyOverlay: boolean;
};

export type FinalizeGuardContext = {
  isCCLayerSnapshot: boolean;
  isCCBrushSnapshot: boolean;
  guardResult: FinalizeGuardResult;
  overlayHasContent: boolean;
  finalizeTool: Tool | 'eraser';
};

export const evaluateFinalizeGuards = ({
  hasCanvas,
  busy,
  project,
  isCCLayerSnapshot,
  isCCBrushSnapshot,
  isEraserV2,
  isEraserTool,
  drawingCanvasHasContent,
}: {
  hasCanvas: boolean;
  busy: boolean;
  project: { width: number; height: number } | null;
  isCCLayerSnapshot: boolean;
  isCCBrushSnapshot: boolean;
  isEraserV2: boolean;
  isEraserTool: boolean;
  drawingCanvasHasContent: boolean;
}): FinalizeGuardResult => {
  const overlayHasContent = drawingCanvasHasContent;
  const overlayOptional = isCCLayerSnapshot && isCCBrushSnapshot;
  const allowEmptyOverlay = isEraserV2 && isEraserTool;
  const shouldProceed =
    !busy &&
    hasCanvas &&
    project != null &&
    (overlayHasContent || overlayOptional || allowEmptyOverlay);

  return {
    shouldProceed,
    overlayHasContent,
    overlayOptional,
    allowEmptyOverlay,
  };
};

export const resolveFinalizeGuardContext = ({
  snapshot,
  hasCanvas,
  busy,
  project,
  isEraserV2,
  drawingCanvasHasContent,
}: {
  snapshot: AppState;
  hasCanvas: boolean;
  busy: boolean;
  project: { width: number; height: number } | null;
  isEraserV2: boolean;
  drawingCanvasHasContent: boolean;
}): FinalizeGuardContext => {
  const activeLayerSnapshot = snapshot.layers.find((l) => l.id === snapshot.activeLayerId);
  const isCCLayerSnapshot = activeLayerSnapshot?.layerType === 'color-cycle';
  const isCCBrushSnapshot = getColorCycleBrushFlags(snapshot.tools.brushSettings).isAny;
  const guardResult = evaluateFinalizeGuards({
    hasCanvas,
    busy,
    project,
    isCCLayerSnapshot,
    isCCBrushSnapshot,
    isEraserV2,
    isEraserTool: snapshot.tools.currentTool === 'eraser',
    drawingCanvasHasContent,
  });

  return {
    isCCLayerSnapshot,
    isCCBrushSnapshot,
    guardResult,
    overlayHasContent: guardResult.overlayHasContent,
    finalizeTool: snapshot.tools.currentTool as Tool | 'eraser',
  };
};
