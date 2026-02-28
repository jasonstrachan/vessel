import { useMemo } from 'react';
import { useFeatureFlag } from '@/config/featureFlags';
import { useCropState } from '@/hooks/useCropState';
import { detectColorCycleWorkerSupport } from '@/utils/colorCycleWorkerSupport';
import { getMaskManager } from '@/layers/MaskManager';
import { useToolSwitcher } from '@/utils/toolSwitch';
import { useDrawingCanvasHandlerAdapters } from './useDrawingCanvasHandlerAdapters';
import { useDrawingCanvasShapeEditorState } from './useDrawingCanvasShapeEditorState';
import { useDrawingCanvasToolsSnapshot } from './useDrawingCanvasToolsSnapshot';

type ToolSnapshotArgs = Parameters<typeof useDrawingCanvasToolsSnapshot>[0];
type ShapeEditorStateArgs = Parameters<typeof useDrawingCanvasShapeEditorState>[0];
type HandlerAdaptersArgs = Parameters<typeof useDrawingCanvasHandlerAdapters>[0];

export interface UseDrawingCanvasSetupBridgeOptions extends ToolSnapshotArgs, ShapeEditorStateArgs {
  projectFilename: string | null | undefined;
  setFloatingPaste: HandlerAdaptersArgs['setFloatingPaste'];
  mousePositionRef: HandlerAdaptersArgs['mousePositionRef'];
  brushCursorHandleRef: HandlerAdaptersArgs['brushCursorHandleRef'];
}

export const useDrawingCanvasSetupBridge = ({
  project,
  projectFilename,
  currentTool,
  selectionMode,
  brushSettings,
  fillSettings,
  wandSettings,
  eraserSettings,
  shapeMode,
  customBrushCapture,
  setFloatingPaste,
  mousePositionRef,
  brushCursorHandleRef,
}: UseDrawingCanvasSetupBridgeOptions) => {
  const maskManager = useMemo(() => getMaskManager(), []);
  const tools = useDrawingCanvasToolsSnapshot({
    currentTool,
    selectionMode,
    brushSettings,
    fillSettings,
    wandSettings,
    eraserSettings,
    shapeMode,
    customBrushCapture,
  });
  const { crop, commitCrop, cancelCrop } = useCropState();
  const displayProjectName = projectFilename ?? project?.name ?? 'Untitled';
  const { activeCanvasShape, canvasBounds, canvasShapeEditRef, freehandPointsRef } =
    useDrawingCanvasShapeEditorState({ project });
  const switchTool = useToolSwitcher();
  const {
    setCurrentToolById,
    setFloatingPasteFromHandlers,
    setCursorScreenPosition,
  } = useDrawingCanvasHandlerAdapters({
    switchTool,
    setFloatingPaste,
    mousePositionRef,
    brushCursorHandleRef,
  });
  const colorCycleWorkerEnabled = useFeatureFlag('useColorCycleWorker');
  const colorCycleWorkerSupport = useMemo(() => detectColorCycleWorkerSupport(), []);
  const shouldUseColorCycleWorker = colorCycleWorkerEnabled && colorCycleWorkerSupport.supported;

  return {
    maskManager,
    tools,
    crop,
    commitCrop,
    cancelCrop,
    displayProjectName,
    activeCanvasShape,
    canvasBounds,
    canvasShapeEditRef,
    freehandPointsRef,
    switchTool,
    setCurrentToolById,
    setFloatingPasteFromHandlers,
    setCursorScreenPosition,
    shouldUseColorCycleWorker,
  };
};
