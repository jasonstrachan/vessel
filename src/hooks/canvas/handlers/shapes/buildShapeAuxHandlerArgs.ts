import { createShapeAuxHandlers } from '@/hooks/canvas/handlers/shapes/shapeAuxHandlers';

type ShapeAuxArgs = Parameters<typeof createShapeAuxHandlers>[0];

export type BuildShapeAuxHandlerArgs = ShapeAuxArgs['clearArgs'] &
  ShapeAuxArgs['coerceArgs'] &
  ShapeAuxArgs['snapshotArgs']['refs'] &
  ShapeAuxArgs['snapshotArgs']['deps'] & {
    eraserV2Enabled: ShapeAuxArgs['clearArgs']['eraserV2Enabled'];
  };

export const buildShapeAuxHandlerArgs = (
  args: BuildShapeAuxHandlerArgs
): ShapeAuxArgs => {
  const {
    drawingCtxRef,
    drawingCanvasRef,
    drawingCanvasHasContent,
    lastDrawPosRef,
    eraserV2Enabled,
    eraserToolRef,
    eraserRoiRef,
    endMaskHealingStroke,
    resetShapeDragRefs,
    shapeDragMovedRef,
    shapeDragStartRef,
    shapeDragLastRef,
    shapePointsRef,
    storeRef,
    seedManualStrokeBoundingBox,
    triggerSimpleShapePreview,
    shapeBeforeSnapshotCapturedRef,
    shapeBeforeImageRef,
    strokeCapturePaddingRef,
    project,
    roiPadding,
    captureRegionFromPoints,
    captureLayerRegionImageData,
  } = args;

  return {
    clearArgs: {
      drawingCtxRef,
      drawingCanvasRef,
      drawingCanvasHasContent,
      lastDrawPosRef,
      eraserV2Enabled,
      eraserToolRef,
      eraserRoiRef,
      endMaskHealingStroke,
      resetShapeDragRefs,
    },
    coerceArgs: {
      shapeDragMovedRef,
      shapeDragStartRef,
      shapeDragLastRef,
      shapePointsRef,
      storeRef,
      seedManualStrokeBoundingBox,
      triggerSimpleShapePreview,
    },
    snapshotArgs: {
      refs: {
        shapeBeforeSnapshotCapturedRef,
        shapeBeforeImageRef,
        storeRef,
        shapePointsRef,
        strokeCapturePaddingRef,
      },
      deps: {
        project,
        roiPadding,
        captureRegionFromPoints,
        captureLayerRegionImageData,
      },
    },
  };
};
