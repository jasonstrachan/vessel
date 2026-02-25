import type { useDrawingCanvasRuntimeEffectsFromOrchestration } from './useDrawingCanvasRuntimeEffectsFromOrchestration';
import type { useDrawingCanvasRuntimeOrchestration } from './useDrawingCanvasRuntimeOrchestration';
import type { DrawingCanvasRuntimeStateBundle } from './useDrawingCanvasRuntimeStateBundle';

type RuntimeOrchestration = ReturnType<typeof useDrawingCanvasRuntimeOrchestration>;
type RuntimeEffectsArgs = Parameters<typeof useDrawingCanvasRuntimeEffectsFromOrchestration>[0];

interface BuildDrawingCanvasRuntimeEffectsFromOrchestrationArgsOptions {
  state: DrawingCanvasRuntimeStateBundle;
  orchestration: RuntimeOrchestration;
  showFeedback?: (message: string) => void;
}

export const buildDrawingCanvasRuntimeEffectsFromOrchestrationArgs = ({
  state,
  orchestration,
  showFeedback,
}: BuildDrawingCanvasRuntimeEffectsFromOrchestrationArgsOptions): RuntimeEffectsArgs => ({
  state,
  orchestration,
  showFeedback,
});
