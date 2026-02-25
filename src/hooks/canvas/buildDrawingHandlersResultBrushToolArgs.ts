import type { UseDrawingHandlersResultArgsBridgeOptions } from '@/hooks/canvas/useDrawingHandlersResultArgsBridge.types';

interface BuildDrawingHandlersResultBrushToolArgsOptions {
  brushToolRuntime: UseDrawingHandlersResultArgsBridgeOptions['brushToolRuntime'];
}

export const buildDrawingHandlersResultBrushToolArgs = ({
  brushToolRuntime,
}: BuildDrawingHandlersResultBrushToolArgsOptions) => ({
  beginStrokeSession: brushToolRuntime.beginStrokeSession,
  endStrokeSession: brushToolRuntime.endStrokeSession,
  clearStrokeSession: brushToolRuntime.clearStrokeSession,
});
