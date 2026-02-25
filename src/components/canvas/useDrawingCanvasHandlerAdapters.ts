import { useCallback, type MutableRefObject } from 'react';
import type { FloatingPaste as FloatingPasteState } from '@/hooks/canvas/utils/types';
import type { AppState } from '@/stores/useAppStore';
import type { BrushCursorHandle } from './BrushCursor';
import type { Tool } from '@/types';

interface UseDrawingCanvasHandlerAdaptersOptions {
  switchTool: (tool: Tool) => Promise<void> | void;
  setFloatingPaste: (paste: Parameters<AppState['setFloatingPaste']>[0]) => void;
  mousePositionRef: MutableRefObject<{ x: number; y: number }>;
  brushCursorHandleRef: MutableRefObject<BrushCursorHandle | null>;
}

export const useDrawingCanvasHandlerAdapters = ({
  switchTool,
  setFloatingPaste,
  mousePositionRef,
  brushCursorHandleRef,
}: UseDrawingCanvasHandlerAdaptersOptions) => {
  const setCurrentToolById = useCallback(
    (toolId: string) => {
      void switchTool(toolId as Tool);
    },
    [switchTool]
  );

  const setFloatingPasteFromHandlers = useCallback(
    (paste: FloatingPasteState | null) => {
      if (!paste || !paste.imageData) {
        setFloatingPaste(null);
        return;
      }

      setFloatingPaste({
        imageData: paste.imageData,
        position: paste.position,
        width: paste.width,
        height: paste.height,
        displayWidth: paste.displayWidth ?? paste.width,
        displayHeight: paste.displayHeight ?? paste.height,
        rotation: paste.rotation ?? 0,
        originalPosition: paste.originalPosition ?? paste.position,
        sourceLayerId: paste.sourceLayerId ?? null,
        colorCycleIndices: paste.colorCycleIndices ?? null,
      });
    },
    [setFloatingPaste]
  );

  const setCursorScreenPosition = useCallback(
    (screenX: number, screenY: number) => {
      mousePositionRef.current = { x: screenX, y: screenY };
      brushCursorHandleRef.current?.setPosition(screenX, screenY);
    },
    [brushCursorHandleRef, mousePositionRef]
  );

  return {
    setCurrentToolById,
    setFloatingPasteFromHandlers,
    setCursorScreenPosition,
  };
};
