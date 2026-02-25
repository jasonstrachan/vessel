import { buildDrawingCanvasInteractionRuntimeOptions } from './buildDrawingCanvasInteractionRuntimeOptions';
import { useDrawingCanvasInteractionRuntimeState } from './useDrawingCanvasInteractionRuntimeState';

type UseDrawingCanvasInteractionRuntimeOptions = Parameters<
  typeof buildDrawingCanvasInteractionRuntimeOptions
>[0];

export const useDrawingCanvasInteractionRuntime = (
  options: UseDrawingCanvasInteractionRuntimeOptions
) => useDrawingCanvasInteractionRuntimeState(buildDrawingCanvasInteractionRuntimeOptions(options));
