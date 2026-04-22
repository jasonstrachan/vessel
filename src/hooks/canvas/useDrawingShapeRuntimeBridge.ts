import { useMarkGradientLifecycle } from '@/hooks/canvas/useMarkGradientLifecycle';
import { useShapePreviewRuntime } from '@/hooks/canvas/useShapePreviewRuntime';
import { useShapePressureModel } from '@/hooks/canvas/useShapePressureModel';
import { useShapePressureResetEffects } from '@/hooks/canvas/useShapePressureResetEffects';
import { useStrokeBoundaryCallbacks } from '@/hooks/canvas/useStrokeBoundaryCallbacks';
import { useDrawingHandlerRefs } from '@/hooks/canvas/useDrawingHandlerRefs';

type DrawingHandlerRefs = ReturnType<typeof useDrawingHandlerRefs>;

interface UseDrawingShapeRuntimeBridgeOptions {
  refs: DrawingHandlerRefs;
  storeRef: Parameters<typeof useShapePressureModel>[0]['storeRef'];
}

export const useDrawingShapeRuntimeBridge = ({
  refs,
  storeRef,
}: UseDrawingShapeRuntimeBridgeOptions) => {
  const {
    isPointerDownRef,
    activeLayerIdRef,
    shapeDragStartRef,
    shapeDragLastRef,
    shapeDragMovedRef,
    lastShapePreviewTsRef,
    simpleShapePreviewRendererRef,
    strokeBoundingBoxRef,
    strokeCapturePaddingRef,
    shapePointsRef,
    isDrawingShapeRef,
    shapeInteractionPhaseRef,
  } = refs;

  const {
    latestShapePressureRef,
    lastNonZeroShapePressureRef,
    latestShapePixelSizeRef,
    shapeMaxPressureRef,
    hadValidShapePressureRef,
    lastStablePressureRef,
    resetShapePressureState,
    computeShapePixelSize,
    updateShapePressure,
  } = useShapePressureModel({ storeRef });

  useMarkGradientLifecycle({
    isPointerDownRef,
    activeLayerIdRef,
  });

  const {
    resetShapeDragRefs,
    triggerSimpleShapePreview,
    setSimpleShapePreviewRenderer,
  } = useShapePreviewRuntime({
    resetShapeDragRefsArgs: {
      shapeDragStartRef,
      shapeDragLastRef,
      shapeDragMovedRef,
    },
    shapePreviewDispatchersArgs: {
      lastPreviewTsRef: lastShapePreviewTsRef,
      rendererRef: simpleShapePreviewRendererRef,
    },
  });

  useShapePressureResetEffects({
    resetShapePressureState,
    resetShapeDragRefs,
    strokeBoundingBoxRef,
    strokeCapturePaddingRef,
    shapePointsRef,
    isDrawingShapeRef,
    shapeInteractionPhaseRef,
  });

  const { drawEraserSegment, seedManualStrokeBoundingBox } = useStrokeBoundaryCallbacks({
    storeRef,
    strokeBoundingBoxRef,
    strokeCapturePaddingRef,
  });

  return {
    latestShapePressureRef,
    lastNonZeroShapePressureRef,
    latestShapePixelSizeRef,
    shapeMaxPressureRef,
    hadValidShapePressureRef,
    lastStablePressureRef,
    resetShapePressureState,
    computeShapePixelSize,
    updateShapePressure,
    resetShapeDragRefs,
    triggerSimpleShapePreview,
    setSimpleShapePreviewRenderer,
    drawEraserSegment,
    seedManualStrokeBoundingBox,
  };
};
