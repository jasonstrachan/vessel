import type { DrawingCanvasViewportRuntimeOptions } from './useDrawingCanvasViewportRuntimeBridge';
import { useDrawingCanvasViewportRuntimeProps } from './useDrawingCanvasViewportRuntimeProps';

interface UseDrawingCanvasViewportRuntimeFromStateOptions {
  styleOptions: DrawingCanvasViewportRuntimeOptions['styleOptions'];
  cursorModelOptions: DrawingCanvasViewportRuntimeOptions['cursorModelOptions'];
  viewportOptions: DrawingCanvasViewportRuntimeOptions['viewportOptions'];
}

export const useDrawingCanvasViewportRuntimeFromState = ({
  styleOptions,
  cursorModelOptions,
  viewportOptions,
}: UseDrawingCanvasViewportRuntimeFromStateOptions) =>
  useDrawingCanvasViewportRuntimeProps({
    styleOptions,
    cursorModelOptions,
    viewportOptions,
  });
