import type { UseDrawingHandlersResultArgsBridgeOptions } from '@/hooks/canvas/useDrawingHandlersResultArgsBridge.types';

interface BuildDrawingHandlersResultRefsArgsOptions {
  refs: UseDrawingHandlersResultArgsBridgeOptions['refs'];
}

export const buildDrawingHandlersResultRefsArgs = ({
  refs,
}: BuildDrawingHandlersResultRefsArgsOptions) => ({
  drawingCanvasRef: refs.drawingCanvasRef,
  drawingCanvasHasContent: refs.drawingCanvasHasContent,
  isCapturing: refs.isCapturing,
  shapePointsRef: refs.shapePointsRef,
  isDrawingShapeRef: refs.isDrawingShapeRef,
  isSelectingDirectionRef: refs.isSelectingDirectionRef,
  ccShapePreviewCacheRef: refs.ccShapePreviewCacheRef,
});
