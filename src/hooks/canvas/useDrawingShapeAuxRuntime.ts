import { useShapeAuxHandlers } from '@/hooks/canvas/handlers/shapes/useShapeAuxHandlers';
import type { useDrawingHandlerRefs } from '@/hooks/canvas/useDrawingHandlerRefs';
import { FF } from '@/config/ccFeatureFlags';
import { ROI_PADDING_PX } from '@/hooks/canvas/drawingHandlersConfig';
import { captureLayerRegionImageData } from '@/hooks/canvas/utils/snapshots';
import { captureRegionFromPoints } from '@/hooks/canvas/utils/captureRegions';

type DrawingHandlerRefs = ReturnType<typeof useDrawingHandlerRefs>;
type ShapeAuxArgs = Parameters<typeof useShapeAuxHandlers>[0];

type UseDrawingShapeAuxRuntimeArgs = {
  refs: DrawingHandlerRefs;
  endMaskHealingStroke: ShapeAuxArgs['endMaskHealingStroke'];
  resetShapeDragRefs: ShapeAuxArgs['resetShapeDragRefs'];
  storeRef: ShapeAuxArgs['storeRef'];
  seedManualStrokeBoundingBox: ShapeAuxArgs['seedManualStrokeBoundingBox'];
  triggerSimpleShapePreview: ShapeAuxArgs['triggerSimpleShapePreview'];
  project: ShapeAuxArgs['project'];
};

export const useDrawingShapeAuxRuntime = ({
  refs,
  endMaskHealingStroke,
  resetShapeDragRefs,
  storeRef,
  seedManualStrokeBoundingBox,
  triggerSimpleShapePreview,
  project,
}: UseDrawingShapeAuxRuntimeArgs) =>
  useShapeAuxHandlers({
    drawingCtxRef: refs.drawingCtxRef,
    drawingCanvasRef: refs.drawingCanvasRef,
    drawingCanvasHasContent: refs.drawingCanvasHasContent,
    lastDrawPosRef: refs.lastDrawPosRef,
    eraserV2Enabled: FF.ERASER_V2,
    eraserToolRef: refs.eraserToolRef,
    eraserRoiRef: refs.eraserRoiRef,
    endMaskHealingStroke,
    resetShapeDragRefs,
    shapeDragMovedRef: refs.shapeDragMovedRef,
    shapeDragStartRef: refs.shapeDragStartRef,
    shapeDragLastRef: refs.shapeDragLastRef,
    shapePointsRef: refs.shapePointsRef,
    storeRef,
    seedManualStrokeBoundingBox,
    triggerSimpleShapePreview,
    shapeBeforeSnapshotCapturedRef: refs.shapeBeforeSnapshotCapturedRef,
    shapeBeforeImageRef: refs.shapeBeforeImageRef,
    strokeCapturePaddingRef: refs.strokeCapturePaddingRef,
    project,
    roiPadding: ROI_PADDING_PX,
    captureRegionFromPoints,
    captureLayerRegionImageData,
  });
