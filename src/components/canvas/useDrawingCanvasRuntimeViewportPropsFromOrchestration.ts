import type { DrawingCanvasRuntimeStateBundle } from './useDrawingCanvasRuntimeStateBundle';
import type { useDrawingCanvasRuntimeOrchestration } from './useDrawingCanvasRuntimeOrchestration';
import { buildDrawingCanvasRuntimeViewportPropsFromOrchestrationOptions } from './buildDrawingCanvasRuntimeViewportPropsFromOrchestrationOptions';
import { useDrawingCanvasViewportRuntimeFromState } from './useDrawingCanvasViewportRuntimeFromState';

type RuntimeOrchestration = ReturnType<typeof useDrawingCanvasRuntimeOrchestration>;

interface UseDrawingCanvasRuntimeViewportPropsFromOrchestrationOptions {
  state: Pick<
    DrawingCanvasRuntimeStateBundle,
    | 'tools'
    | 'globalBrushSize'
    | 'showBrushCursor'
    | 'project'
    | 'floatingPaste'
    | 'canvasZoom'
    | 'displayProjectName'
    | 'displayMode'
    | 'temporaryCustomBrush'
    | 'getCustomBrushByIdUnsafe'
  >;
  orchestration: Pick<
    RuntimeOrchestration,
    'visualRuntime' | 'interactionRuntime' | 'brushCursorHandleRef'
  >;
}

export const useDrawingCanvasRuntimeViewportPropsFromOrchestration = ({
  state,
  orchestration,
}: UseDrawingCanvasRuntimeViewportPropsFromOrchestrationOptions) =>
  useDrawingCanvasViewportRuntimeFromState(
    buildDrawingCanvasRuntimeViewportPropsFromOrchestrationOptions({ state, orchestration })
  );
