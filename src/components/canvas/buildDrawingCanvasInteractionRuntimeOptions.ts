import type { UseDrawingCanvasInteractionRuntimeStateOptions } from './useDrawingCanvasInteractionRuntimeState';

interface BuildDrawingCanvasInteractionRuntimeOptionsArgs {
  viewport: Pick<
    UseDrawingCanvasInteractionRuntimeStateOptions,
    'canvasZoom' | 'canvasOffsetX' | 'canvasOffsetY' | 'currentTool'
  >;
  cursor: Pick<
    UseDrawingCanvasInteractionRuntimeStateOptions,
    'setCanvasOffset' | 'setCursorStyle' | 'setShowBrushCursor'
  >;
}

export const buildDrawingCanvasInteractionRuntimeOptions = ({
  viewport,
  cursor,
}: BuildDrawingCanvasInteractionRuntimeOptionsArgs): UseDrawingCanvasInteractionRuntimeStateOptions => ({
  ...viewport,
  ...cursor,
});
