import { buildDrawingCanvasRuntimeEffectsFromStateOptions } from './buildDrawingCanvasRuntimeEffectsFromStateOptions';
import { useDrawingCanvasRuntimeEffectsHandlers } from './useDrawingCanvasRuntimeEffectsHandlers';
import type { UseDrawingCanvasRuntimeEffectsFromStateOptions } from './useDrawingCanvasRuntimeEffectsFromState.types';

export const useDrawingCanvasRuntimeEffectsFromState = (
  options: UseDrawingCanvasRuntimeEffectsFromStateOptions
) => useDrawingCanvasRuntimeEffectsHandlers(buildDrawingCanvasRuntimeEffectsFromStateOptions(options));
