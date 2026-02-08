import { buildDrawingCanvasViewportRuntimeOptions } from './buildDrawingCanvasViewportRuntimeOptions';
import {
  useDrawingCanvasViewportRuntimeBridge,
  type DrawingCanvasViewportRuntimeOptions,
} from './useDrawingCanvasViewportRuntimeBridge';

interface UseDrawingCanvasViewportRuntimePropsOptions {
  styleOptions: DrawingCanvasViewportRuntimeOptions['styleOptions'];
  cursorModelOptions: DrawingCanvasViewportRuntimeOptions['cursorModelOptions'];
  viewportOptions: DrawingCanvasViewportRuntimeOptions['viewportOptions'];
}

export const useDrawingCanvasViewportRuntimeProps = ({
  styleOptions,
  cursorModelOptions,
  viewportOptions,
}: UseDrawingCanvasViewportRuntimePropsOptions) =>
  useDrawingCanvasViewportRuntimeBridge(
    buildDrawingCanvasViewportRuntimeOptions({
      styleOptions,
      cursorModelOptions,
      viewportOptions,
    })
  );
