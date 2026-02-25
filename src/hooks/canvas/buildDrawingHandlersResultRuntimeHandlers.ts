import type { buildDrawingHandlersResultArgs } from '@/hooks/canvas/buildDrawingHandlersResultArgs';
import type { useDrawingHandlersRuntimeStages } from '@/hooks/canvas/useDrawingHandlersRuntimeStages';

type RuntimeStages = ReturnType<typeof useDrawingHandlersRuntimeStages>;
type RuntimeHandlers = RuntimeStages['runtimeHandlers'];
type ResultRuntimeHandlers = Parameters<typeof buildDrawingHandlersResultArgs>[0]['runtimeHandlers'];

interface BuildDrawingHandlersResultRuntimeHandlersOptions {
  runtimeHandlers: RuntimeHandlers;
}

export const buildDrawingHandlersResultRuntimeHandlers = ({
  runtimeHandlers,
}: BuildDrawingHandlersResultRuntimeHandlersOptions): ResultRuntimeHandlers => ({
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
