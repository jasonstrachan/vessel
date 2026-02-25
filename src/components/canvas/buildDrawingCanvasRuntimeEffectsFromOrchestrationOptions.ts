import type { useDrawingCanvasRuntimeEffectsFromState } from './useDrawingCanvasRuntimeEffectsFromState';
import type { useDrawingCanvasRuntimeOrchestration } from './useDrawingCanvasRuntimeOrchestration';
import type { DrawingCanvasRuntimeStateBundle } from './useDrawingCanvasRuntimeStateBundle';

type RuntimeOrchestration = ReturnType<typeof useDrawingCanvasRuntimeOrchestration>;
type RuntimeEffectsFromStateOptions = Parameters<typeof useDrawingCanvasRuntimeEffectsFromState>[0];

interface BuildDrawingCanvasRuntimeEffectsFromOrchestrationOptionsArgs {
  state: DrawingCanvasRuntimeStateBundle;
  orchestration: RuntimeOrchestration;
  showFeedback?: (message: string) => void;
}

export const buildDrawingCanvasRuntimeEffectsFromOrchestrationOptions = ({
  state,
  orchestration,
  showFeedback,
}: BuildDrawingCanvasRuntimeEffectsFromOrchestrationOptionsArgs): RuntimeEffectsFromStateOptions => ({
  state,
  visualRuntime: {
    refreshColorCycleSegments: orchestration.visualRuntime.refreshColorCycleSegments,
    isPointerInsideCanvas: orchestration.visualRuntime.isPointerInsideCanvas,
    defaultCursorStyle: orchestration.visualRuntime.defaultCursorStyle,
  },
  renderRuntime: {
    layersHash: orchestration.renderRuntime.layersHash,
    lastSampleRef: orchestration.renderRuntime.lastSampleRef,
    sampleColorAtPosition: orchestration.renderRuntime.sampleColorAtPosition,
    sampleColorsAlongLine: orchestration.renderRuntime.sampleColorsAlongLine,
    renderSplitComposites: orchestration.renderRuntime.renderSplitComposites,
    rebuildStaticComposite: orchestration.renderRuntime.rebuildStaticComposite,
  },
  interactionRuntime: {
    interaction: orchestration.interactionRuntime.interaction,
    interactionDispatch: orchestration.interactionRuntime.interactionDispatch,
    stateMachine: orchestration.interactionRuntime.stateMachine,
    pan: orchestration.interactionRuntime.pan,
    setPan: orchestration.interactionRuntime.setPan,
    setCanvasStateMachineTool: orchestration.interactionRuntime.setCanvasStateMachineTool,
    forceCanvasIdle: orchestration.interactionRuntime.forceCanvasIdle,
    previousToolRef: orchestration.interactionRuntime.previousToolRef,
    lastStateMachineToolRef: orchestration.interactionRuntime.lastStateMachineToolRef,
    isSpacePressedRef: orchestration.interactionRuntime.isSpacePressedRef,
    suppressBootstrapUntilPointerUpRef:
      orchestration.interactionRuntime.suppressBootstrapUntilPointerUpRef,
    viewTransformRef: orchestration.interactionRuntime.viewTransformRef,
  },
  toolStateMachine: orchestration.handlersRuntime.toolStateMachine,
  drawingHandlers: orchestration.handlersRuntime.drawingHandlers,
  cancelActiveOperations: orchestration.handlersRuntime.cancelActiveOperations,
  finalizeActiveShape: orchestration.handlersRuntime.finalizeActiveShape,
  brushEngine: orchestration.brushEngine,
  animationRuntime: {
    wrappedStartAnimation: orchestration.animationRuntime.wrappedStartAnimation,
    pauseAnimationForPan: orchestration.animationRuntime.pauseAnimationForPan,
    resumeAnimationAfterPan: orchestration.animationRuntime.resumeAnimationAfterPan,
  },
  draw: orchestration.draw,
  cursorStyle: orchestration.visualRuntime.cursorStyle,
  setCursorStyle: orchestration.visualRuntime.setCursorStyle,
  showFeedback,
});
