import type { useDrawingCanvasRuntimeOrchestration } from './useDrawingCanvasRuntimeOrchestration';
import type { useDrawingCanvasRuntimeViewportPropsFromOrchestration } from './useDrawingCanvasRuntimeViewportPropsFromOrchestration';
import type { DrawingCanvasRuntimeStateBundle } from './useDrawingCanvasRuntimeStateBundle';

type RuntimeOrchestration = ReturnType<typeof useDrawingCanvasRuntimeOrchestration>;
type RuntimeViewportArgs = Parameters<typeof useDrawingCanvasRuntimeViewportPropsFromOrchestration>[0];

interface BuildDrawingCanvasRuntimeViewportPropsFromOrchestrationArgsOptions {
  state: DrawingCanvasRuntimeStateBundle;
  orchestration: RuntimeOrchestration;
}

export const buildDrawingCanvasRuntimeViewportPropsFromOrchestrationArgs = ({
  state,
  orchestration,
}: BuildDrawingCanvasRuntimeViewportPropsFromOrchestrationArgsOptions): RuntimeViewportArgs => ({
  state: {
    tools: state.tools,
    globalBrushSize: state.globalBrushSize,
    showBrushCursor: state.showBrushCursor,
    project: state.project,
    floatingPaste: state.floatingPaste,
    canvasZoom: state.canvasZoom,
    displayProjectName: state.displayProjectName,
    displayMode: state.displayMode,
  },
  orchestration: {
    visualRuntime: orchestration.visualRuntime,
    interactionRuntime: orchestration.interactionRuntime,
    brushCursorHandleRef: orchestration.brushCursorHandleRef,
  },
});
