import type { useDrawingCanvasRuntimeOrchestration } from './useDrawingCanvasRuntimeOrchestration';
import type { useDrawingCanvasViewportRuntimeFromState } from './useDrawingCanvasViewportRuntimeFromState';
import type { DrawingCanvasRuntimeStateBundle } from './useDrawingCanvasRuntimeStateBundle';

type RuntimeOrchestration = ReturnType<typeof useDrawingCanvasRuntimeOrchestration>;
type ViewportRuntimeOptions = Parameters<typeof useDrawingCanvasViewportRuntimeFromState>[0];

interface BuildDrawingCanvasRuntimeViewportPropsFromOrchestrationOptionsArgs {
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
  >;
  orchestration: Pick<
    RuntimeOrchestration,
    'visualRuntime' | 'interactionRuntime' | 'brushCursorHandleRef'
  >;
}

export const buildDrawingCanvasRuntimeViewportPropsFromOrchestrationOptions = ({
  state,
  orchestration,
}: BuildDrawingCanvasRuntimeViewportPropsFromOrchestrationOptionsArgs): ViewportRuntimeOptions => ({
  styleOptions: {
    canvasZoom: state.canvasZoom,
    displayMode: state.displayMode,
    cursorStyle: orchestration.visualRuntime.cursorStyle,
    rotationEnabled: state.tools.brushSettings.rotationEnabled,
    antialiasing: state.tools.brushSettings.antialiasing,
    brushShape: state.tools.brushSettings.brushShape,
  },
  cursorModelOptions: {
    tools: state.tools,
    globalBrushSize: state.globalBrushSize,
    showBrushCursor: state.showBrushCursor,
    panIsPanning: orchestration.interactionRuntime.pan.panState.isPanning,
    isSpacePressedRef: orchestration.interactionRuntime.isSpacePressedRef,
    cursorStyle: orchestration.visualRuntime.cursorStyle,
  },
  viewportOptions: {
    cursorStyle: orchestration.visualRuntime.cursorStyle,
    project: state.project,
    floatingPaste: state.floatingPaste,
    canvasZoom: state.canvasZoom || 1,
    offsetX: orchestration.interactionRuntime.pan.panState.offsetX,
    offsetY: orchestration.interactionRuntime.pan.panState.offsetY,
    currentTool: state.tools.currentTool,
    isSpacePressed: orchestration.interactionRuntime.isSpacePressed,
    displayProjectName: state.displayProjectName,
    brushCursorHandleRef: orchestration.brushCursorHandleRef,
  },
});
