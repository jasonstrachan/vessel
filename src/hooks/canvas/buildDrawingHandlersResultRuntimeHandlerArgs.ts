import type { UseDrawingHandlersResultArgsBridgeOptions } from '@/hooks/canvas/useDrawingHandlersResultArgsBridge.types';

interface BuildDrawingHandlersResultRuntimeHandlerArgsOptions {
  runtimeHandlers: UseDrawingHandlersResultArgsBridgeOptions['runtimeHandlers'];
}

export const buildDrawingHandlersResultRuntimeHandlerArgs = ({
  runtimeHandlers,
}: BuildDrawingHandlersResultRuntimeHandlerArgsOptions) => ({
  startDrawing: runtimeHandlers.startDrawing,
  continueDrawing: runtimeHandlers.continueDrawing,
  finalizeDrawing: runtimeHandlers.finalizeDrawing,
  finalizeStroke: runtimeHandlers.finalizeStroke,
  clearDrawingCanvas: runtimeHandlers.clearDrawingCanvas,
  startShapeDrawing: runtimeHandlers.startShapeDrawing,
  continueShapeDrawing: runtimeHandlers.continueShapeDrawing,
  finalizeShapeDrawing: runtimeHandlers.finalizeShapeDrawing,
  startContinuousColorCycleAnimation: runtimeHandlers.startContinuousColorCycleAnimation,
  setFeedbackCallback: runtimeHandlers.setFeedbackCallback,
  coerceDragShapeToPolygon: runtimeHandlers.coerceDragShapeToPolygon,
});
