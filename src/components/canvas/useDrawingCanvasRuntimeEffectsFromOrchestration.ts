import type { DrawingCanvasRuntimeStateBundle } from './useDrawingCanvasRuntimeStateBundle';
import type { useDrawingCanvasRuntimeOrchestration } from './useDrawingCanvasRuntimeOrchestration';
import { buildDrawingCanvasRuntimeEffectsFromOrchestrationOptions } from './buildDrawingCanvasRuntimeEffectsFromOrchestrationOptions';
import { useDrawingCanvasRuntimeEffectsFromState } from './useDrawingCanvasRuntimeEffectsFromState';

type RuntimeOrchestration = ReturnType<typeof useDrawingCanvasRuntimeOrchestration>;

interface UseDrawingCanvasRuntimeEffectsFromOrchestrationOptions {
  state: DrawingCanvasRuntimeStateBundle;
  orchestration: RuntimeOrchestration;
  showFeedback?: (message: string) => void;
}

export const useDrawingCanvasRuntimeEffectsFromOrchestration = ({
  state,
  orchestration,
  showFeedback,
}: UseDrawingCanvasRuntimeEffectsFromOrchestrationOptions) =>
  useDrawingCanvasRuntimeEffectsFromState(
    buildDrawingCanvasRuntimeEffectsFromOrchestrationOptions({
      state,
      orchestration,
      showFeedback,
    })
  );
