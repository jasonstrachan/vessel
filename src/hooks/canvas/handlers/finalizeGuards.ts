export type FinalizeGuardResult = {
  shouldProceed: boolean;
  overlayHasContent: boolean;
  overlayOptional: boolean;
  allowEmptyOverlay: boolean;
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
