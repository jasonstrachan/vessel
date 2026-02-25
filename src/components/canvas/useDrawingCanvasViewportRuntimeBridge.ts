import { useDrawingCanvasViewportProps } from './useDrawingCanvasViewportProps';

export type DrawingCanvasViewportRuntimeOptions = Parameters<typeof useDrawingCanvasViewportProps>[0];

export const useDrawingCanvasViewportRuntimeBridge = (
  options: DrawingCanvasViewportRuntimeOptions
) => useDrawingCanvasViewportProps(options);
