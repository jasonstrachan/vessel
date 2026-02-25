import { buildDrawingCanvasRuntimeEffectsFromOrchestrationArgs } from './buildDrawingCanvasRuntimeEffectsFromOrchestrationArgs';
import { buildDrawingCanvasRuntimeViewportPropsFromOrchestrationArgs } from './buildDrawingCanvasRuntimeViewportPropsFromOrchestrationArgs';
import { useDrawingCanvasRuntimeEffectsFromOrchestration } from './useDrawingCanvasRuntimeEffectsFromOrchestration';
import { useDrawingCanvasRuntimeOrchestration } from './useDrawingCanvasRuntimeOrchestration';
import { useDrawingCanvasRuntimeViewportPropsFromOrchestration } from './useDrawingCanvasRuntimeViewportPropsFromOrchestration';
import { useDrawingCanvasRuntimeStateBundle } from './useDrawingCanvasRuntimeStateBundle';

interface UseDrawingCanvasRuntimeOptions {
  showFeedback?: (message: string) => void;
}

export const useDrawingCanvasRuntime = ({ showFeedback }: UseDrawingCanvasRuntimeOptions) => {
  const stateBundle = useDrawingCanvasRuntimeStateBundle();
  const { canvasRef, wrapperRef, overlayCanvasRef } = stateBundle;

  const orchestration = useDrawingCanvasRuntimeOrchestration({
    state: stateBundle,
    showFeedback,
  });

  const {
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
    handlePointerEnter,
    handlePointerLeave,
    handlePointerCancel,
    handleBlur: eventHandleBlur,
  } = useDrawingCanvasRuntimeEffectsFromOrchestration(
    buildDrawingCanvasRuntimeEffectsFromOrchestrationArgs({
      state: stateBundle,
      orchestration,
      showFeedback,
    })
  );

  const viewportProps = useDrawingCanvasRuntimeViewportPropsFromOrchestration(
    buildDrawingCanvasRuntimeViewportPropsFromOrchestrationArgs({
      state: stateBundle,
      orchestration,
    })
  );

  return {
    wrapperRef,
    canvasRef,
    overlayCanvasRef,
    eventHandleBlur,
    handlePointerDown,
    handlePointerUp,
    handlePointerMove,
    handlePointerEnter,
    handlePointerLeave,
    handlePointerCancel,
    viewportProps,
  };
};
