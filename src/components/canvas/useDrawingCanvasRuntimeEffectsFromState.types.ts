import type { DrawingCanvasRuntimeStateBundle } from './useDrawingCanvasRuntimeStateBundle';
import type { useDrawingCanvasVisualRuntimeSetup } from './useDrawingCanvasVisualRuntimeSetup';
import type { useDrawingCanvasRenderRuntimeSetup } from './useDrawingCanvasRenderRuntimeSetup';
import type { useDrawingCanvasInteractionRuntime } from './useDrawingCanvasInteractionRuntime';
import type { useDrawingCanvasColorCycleAnimationFromState } from './useDrawingCanvasColorCycleAnimationFromState';
import type { UseDrawingCanvasRuntimeEffectsHandlersOptions } from './useDrawingCanvasRuntimeEffectsHandlers';

type InteractionRuntime = ReturnType<typeof useDrawingCanvasInteractionRuntime>;
type VisualRuntime = ReturnType<typeof useDrawingCanvasVisualRuntimeSetup>;
type RenderRuntime = ReturnType<typeof useDrawingCanvasRenderRuntimeSetup>;
type ColorCycleAnimationRuntime = ReturnType<typeof useDrawingCanvasColorCycleAnimationFromState>;
type RuntimeEffectsOptions = UseDrawingCanvasRuntimeEffectsHandlersOptions;

export interface UseDrawingCanvasRuntimeEffectsFromStateOptions {
  state: DrawingCanvasRuntimeStateBundle;
  visualRuntime: Pick<VisualRuntime, 'refreshColorCycleSegments' | 'isPointerInsideCanvas' | 'defaultCursorStyle'>;
  renderRuntime: Pick<
    RenderRuntime,
    | 'layersHash'
    | 'lastSampleRef'
    | 'sampleColorAtPosition'
    | 'sampleColorsAlongLine'
    | 'renderSplitComposites'
    | 'rebuildStaticComposite'
  >;
  interactionRuntime: Pick<
    InteractionRuntime,
    | 'interaction'
    | 'interactionDispatch'
    | 'stateMachine'
    | 'pan'
    | 'setPan'
    | 'setCanvasStateMachineTool'
    | 'forceCanvasIdle'
    | 'previousToolRef'
    | 'lastStateMachineToolRef'
    | 'isSpacePressedRef'
    | 'suppressBootstrapUntilPointerUpRef'
    | 'viewTransformRef'
  >;
  toolStateMachine: RuntimeEffectsOptions['inputHandlersArgs']['state']['toolStateMachine'];
  drawingHandlers: RuntimeEffectsOptions['inputHandlersArgs']['state']['drawingHandlers'];
  cancelActiveOperations: RuntimeEffectsOptions['keyboardArgs']['actions']['cancelActiveOperations'];
  finalizeActiveShape: RuntimeEffectsOptions['keyboardArgs']['actions']['finalizeActiveShape'];
  brushEngine: RuntimeEffectsOptions['inputHandlersArgs']['state']['brushEngine'];
  animationRuntime: Pick<
    ColorCycleAnimationRuntime,
    'wrappedStartAnimation' | 'pauseAnimationForPan' | 'resumeAnimationAfterPan'
  >;
  draw: RuntimeEffectsOptions['inputHandlersArgs']['actions']['draw'];
  cursorStyle: string;
  setCursorStyle: RuntimeEffectsOptions['inputHandlersArgs']['actions']['setCursorStyle'];
  showFeedback?: (message: string) => void;
}
