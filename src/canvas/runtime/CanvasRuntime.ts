import { buildDrawingCanvasRuntimeEffectsFromOrchestrationArgs } from '@/components/canvas/buildDrawingCanvasRuntimeEffectsFromOrchestrationArgs';
import { buildDrawingCanvasRuntimeViewportPropsFromOrchestrationArgs } from '@/components/canvas/buildDrawingCanvasRuntimeViewportPropsFromOrchestrationArgs';
import { useDrawingCanvasRuntimeEffectsFromOrchestration } from '@/components/canvas/useDrawingCanvasRuntimeEffectsFromOrchestration';
import { useDrawingCanvasRuntimeOrchestration } from '@/components/canvas/useDrawingCanvasRuntimeOrchestration';
import { useDrawingCanvasRuntimeViewportPropsFromOrchestration } from '@/components/canvas/useDrawingCanvasRuntimeViewportPropsFromOrchestration';
import { useDrawingCanvasRuntimeStateBundle } from '@/components/canvas/useDrawingCanvasRuntimeStateBundle';
import { commitVesselCollaborationGesture } from '@/collaboration/commitVesselCollaborationGesture';
import { useVesselCollaborationBridge } from '@/collaboration/useVesselCollaborationBridge';
import { presentVesselMultiplayerFrame } from '@/collaboration/vesselMultiplayerPresentation';
import { getAppStoreState } from '@/stores/appStoreAccess';

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

  useVesselCollaborationBridge({
    canvasRef,
    compositeCanvasDirtyRef: stateBundle.compositeCanvasDirtyRef,
    commitGesture: (gesture) => commitVesselCollaborationGesture({
      gesture,
      handlers: orchestration.handlersRuntime.drawingHandlers,
    }),
    rebuildStaticComposite: orchestration.renderRuntime.rebuildStaticComposite,
    requestRedraw: () => stateBundle.setNeedsRedraw((value) => value + 1),
    presentFrame: () => presentVesselMultiplayerFrame({
      canvas: canvasRef.current,
      compositeSegmentsRef: stateBundle.compositeSegmentsRef,
      draw: orchestration.draw,
      layerMapRef: stateBundle.layerMapRef,
      state: getAppStoreState(),
      transform: orchestration.interactionRuntime.viewTransformRef.current,
    }),
    createMultiplayerCanvasSource: (targetCanvas, { tool }) => {
      const state = getAppStoreState();
      if (!state.project) return null;
      const activeLayer = state.layers.find((layer) => layer.id === state.activeLayerId);
      const drawingHandlers = orchestration.handlersRuntime.drawingHandlers;
      const liveCanvas = drawingHandlers.drawingCanvasHasContent.current
        ? drawingHandlers.drawingCanvasRef.current
        : null;
      const didComposite = state.compositeLayersToCanvasSync(targetCanvas, {
        ...(liveCanvas && activeLayer?.layerType === 'normal'
          ? {
              liveLayerOverlay: {
                layerId: activeLayer.id,
                canvas: liveCanvas,
                mode: tool === 'eraser' ? 'replace' as const : 'over' as const,
              },
            }
          : {}),
      });
      if (!didComposite) return null;
      return {
        canvas: targetCanvas,
        projectId: state.project.id,
        projectRevision: state.autosave.dirtyRevision,
      };
    },
    scheduleHistoryCommit: orchestration.handlersRuntime.drawingHandlers.scheduleHistoryCommit,
  });

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
