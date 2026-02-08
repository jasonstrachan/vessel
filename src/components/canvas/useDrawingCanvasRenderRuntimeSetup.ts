import { buildDrawingCanvasRenderSetupOptions } from './buildDrawingCanvasRenderSetupOptions';
import { useDrawingCanvasRenderSetupBridge } from './useDrawingCanvasRenderSetupBridge';

type UseDrawingCanvasRenderRuntimeSetupOptions = Parameters<
  typeof buildDrawingCanvasRenderSetupOptions
>[0];

export const useDrawingCanvasRenderRuntimeSetup = (
  options: UseDrawingCanvasRenderRuntimeSetupOptions
) => useDrawingCanvasRenderSetupBridge(buildDrawingCanvasRenderSetupOptions(options));
