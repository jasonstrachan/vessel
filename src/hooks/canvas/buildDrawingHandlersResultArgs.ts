import type { useDrawingBrushToolRuntime } from '@/hooks/canvas/useDrawingBrushToolRuntime';
import type { useDrawingHandlersColorCycleBridge } from '@/hooks/canvas/useDrawingHandlersColorCycleBridge';
import type { useDrawingHandlersResultArgsBridge } from '@/hooks/canvas/useDrawingHandlersResultArgsBridge';
import type { useDrawingHandlerRefs } from '@/hooks/canvas/useDrawingHandlerRefs';
import type { useDrawingShapeRuntimeBridge } from '@/hooks/canvas/useDrawingShapeRuntimeBridge';
import type { useDrawingHandlersRuntimeSetupBridge } from '@/hooks/canvas/useDrawingHandlersRuntimeSetupBridge';

type DrawingHandlerRefs = ReturnType<typeof useDrawingHandlerRefs>;
type RuntimeSetupHandlers = ReturnType<typeof useDrawingHandlersRuntimeSetupBridge>;
type ResultArgs = Parameters<typeof useDrawingHandlersResultArgsBridge>[0];

interface BuildDrawingHandlersResultArgsOptions {
  refs: DrawingHandlerRefs;
  shapeRuntime: ReturnType<typeof useDrawingShapeRuntimeBridge>;
  brushToolRuntime: ReturnType<typeof useDrawingBrushToolRuntime>;
  colorCycleRuntime: ReturnType<typeof useDrawingHandlersColorCycleBridge>;
  runtimeHandlers: Pick<
    RuntimeSetupHandlers,
    | 'startDrawing'
    | 'continueDrawing'
    | 'finalizeDrawing'
    | 'finalizeStroke'
    | 'clearDrawingCanvas'
    | 'startShapeDrawing'
    | 'continueShapeDrawing'
    | 'finalizeShapeDrawing'
    | 'startContinuousColorCycleAnimation'
    | 'setFeedbackCallback'
    | 'coerceDragShapeToPolygon'
  >;
}

export const buildDrawingHandlersResultArgs = ({
  refs,
  shapeRuntime,
  brushToolRuntime,
  colorCycleRuntime,
  runtimeHandlers,
}: BuildDrawingHandlersResultArgsOptions): ResultArgs => ({
  refs: {
    drawingCanvasRef: refs.drawingCanvasRef,
    drawingCanvasHasContent: refs.drawingCanvasHasContent,
    isCapturing: refs.isCapturing,
    shapePointsRef: refs.shapePointsRef,
    isDrawingShapeRef: refs.isDrawingShapeRef,
    isSelectingDirectionRef: refs.isSelectingDirectionRef,
    ccShapePreviewCacheRef: refs.ccShapePreviewCacheRef,
  },
  shapeRuntime,
  brushToolRuntime,
  colorCycleRuntime,
  runtimeHandlers,
});
