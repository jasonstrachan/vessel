import type { DrawingCanvasViewportRuntimeOptions } from './useDrawingCanvasViewportRuntimeBridge';

interface BuildDrawingCanvasViewportRuntimeOptionsArgs {
  styleOptions: DrawingCanvasViewportRuntimeOptions['styleOptions'];
  cursorModelOptions: DrawingCanvasViewportRuntimeOptions['cursorModelOptions'];
  viewportOptions: DrawingCanvasViewportRuntimeOptions['viewportOptions'];
}

export const buildDrawingCanvasViewportRuntimeOptions = ({
  styleOptions,
  cursorModelOptions,
  viewportOptions,
}: BuildDrawingCanvasViewportRuntimeOptionsArgs): DrawingCanvasViewportRuntimeOptions => ({
  styleOptions,
  cursorModelOptions,
  viewportOptions,
});
