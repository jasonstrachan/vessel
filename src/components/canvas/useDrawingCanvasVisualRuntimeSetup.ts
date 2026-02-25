import { buildDrawingCanvasVisualSetupOptions } from './buildDrawingCanvasVisualSetupOptions';
import { useDrawingCanvasVisualSetupBridge } from './useDrawingCanvasVisualSetupBridge';

type UseDrawingCanvasVisualRuntimeSetupOptions = Parameters<
  typeof buildDrawingCanvasVisualSetupOptions
>[0];

export const useDrawingCanvasVisualRuntimeSetup = (
  options: UseDrawingCanvasVisualRuntimeSetupOptions
) => useDrawingCanvasVisualSetupBridge(buildDrawingCanvasVisualSetupOptions(options));
