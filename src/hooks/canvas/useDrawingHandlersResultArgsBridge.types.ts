import type { useDrawingBrushToolRuntime } from '@/hooks/canvas/useDrawingBrushToolRuntime';
import type { useDrawingHandlersColorCycleBridge } from '@/hooks/canvas/useDrawingHandlersColorCycleBridge';
import type { useDrawingHandlerRefs } from '@/hooks/canvas/useDrawingHandlerRefs';
import type { useDrawingHandlersRuntimeSetupBridge } from '@/hooks/canvas/useDrawingHandlersRuntimeSetupBridge';
import type { useDrawingShapeRuntimeBridge } from '@/hooks/canvas/useDrawingShapeRuntimeBridge';

type DrawingHandlerRefs = ReturnType<typeof useDrawingHandlerRefs>;
type ShapeRuntime = ReturnType<typeof useDrawingShapeRuntimeBridge>;
type BrushToolRuntime = ReturnType<typeof useDrawingBrushToolRuntime>;
type ColorCycleRuntime = ReturnType<typeof useDrawingHandlersColorCycleBridge>;
type RuntimeHandlers = ReturnType<typeof useDrawingHandlersRuntimeSetupBridge>;

export interface UseDrawingHandlersResultArgsBridgeOptions {
  refs: {
    drawingCanvasRef: DrawingHandlerRefs['drawingCanvasRef'];
    drawingCanvasHasContent: DrawingHandlerRefs['drawingCanvasHasContent'];
    isCapturing: DrawingHandlerRefs['isCapturing'];
    shapePointsRef: DrawingHandlerRefs['shapePointsRef'];
    isDrawingShapeRef: DrawingHandlerRefs['isDrawingShapeRef'];
    isSelectingDirectionRef: DrawingHandlerRefs['isSelectingDirectionRef'];
    ccShapePreviewCacheRef: DrawingHandlerRefs['ccShapePreviewCacheRef'];
  };
  shapeRuntime: ShapeRuntime;
  brushToolRuntime: BrushToolRuntime;
  colorCycleRuntime: ColorCycleRuntime;
  runtimeHandlers: {
    startDrawing: RuntimeHandlers['startDrawing'];
    continueDrawing: RuntimeHandlers['continueDrawing'];
    finalizeDrawing: RuntimeHandlers['finalizeDrawing'];
    finalizeStroke: RuntimeHandlers['finalizeStroke'];
    clearDrawingCanvas: RuntimeHandlers['clearDrawingCanvas'];
    startShapeDrawing: RuntimeHandlers['startShapeDrawing'];
    continueShapeDrawing: RuntimeHandlers['continueShapeDrawing'];
    finalizeShapeDrawing: RuntimeHandlers['finalizeShapeDrawing'];
    startContinuousColorCycleAnimation: RuntimeHandlers['startContinuousColorCycleAnimation'];
    setFeedbackCallback: RuntimeHandlers['setFeedbackCallback'];
    coerceDragShapeToPolygon: RuntimeHandlers['coerceDragShapeToPolygon'];
  };
}
