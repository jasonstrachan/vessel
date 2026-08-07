import { buildDrawingCanvasRuntimeEffectsFromOrchestrationArgs } from '@/components/canvas/buildDrawingCanvasRuntimeEffectsFromOrchestrationArgs';
import { buildDrawingCanvasRuntimeViewportPropsFromOrchestrationArgs } from '@/components/canvas/buildDrawingCanvasRuntimeViewportPropsFromOrchestrationArgs';
import { useDrawingCanvasRuntimeEffectsFromOrchestration } from '@/components/canvas/useDrawingCanvasRuntimeEffectsFromOrchestration';
import { useDrawingCanvasRuntimeOrchestration } from '@/components/canvas/useDrawingCanvasRuntimeOrchestration';
import { useDrawingCanvasRuntimeViewportPropsFromOrchestration } from '@/components/canvas/useDrawingCanvasRuntimeViewportPropsFromOrchestration';
import { useDrawingCanvasRuntimeStateBundle } from '@/components/canvas/useDrawingCanvasRuntimeStateBundle';
import { dispatchVesselCollaborationStroke } from '@/collaboration/dispatchVesselCollaborationStroke';
import { useVesselCollaborationBridge } from '@/collaboration/useVesselCollaborationBridge';

interface UseCanvasRuntimeOptions {
  showFeedback?: (message: string) => void;
}

export const useCanvasRuntime = ({ showFeedback }: UseCanvasRuntimeOptions) => {
  const stateBundle = useDrawingCanvasRuntimeStateBundle();
  const { canvasRef, wrapperRef, overlayCanvasRef } = stateBundle;

  const orchestration = useDrawingCanvasRuntimeOrchestration({
    state: stateBundle,
    showFeedback,
  });

  useVesselCollaborationBridge({
    canvasRef,
    compositeCanvasDirtyRef: stateBundle.compositeCanvasDirtyRef,
    dispatchStroke: async (points, { pointsPerFrame }) => {
      const canvas = canvasRef.current;
      if (!canvas) {
        throw new Error('Rendered Vessel canvas is unavailable');
      }
      await dispatchVesselCollaborationStroke({
        canvas,
        points,
        pointsPerFrame,
        zoom: stateBundle.canvasZoom || 1,
        worldToScreen: orchestration.interactionRuntime.pan.worldToScreen,
        isBusy: () => stateBundle.isBusyRef.current,
      });
    },
    rebuildStaticComposite: orchestration.renderRuntime.rebuildStaticComposite,
    requestRedraw: () => stateBundle.setNeedsRedraw((value) => value + 1),
  });

  const {
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
    handlePointerEnter,
    handlePointerLeave,
    handlePointerCancel,
    handleDoubleClick,
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
    handleDoubleClick,
    viewportProps,
  };
};

export type CanvasRuntime = ReturnType<typeof useCanvasRuntime>;
