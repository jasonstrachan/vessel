import { buildDrawingCanvasHandlersSetupOptions } from './buildDrawingCanvasHandlersSetupOptions';
import { useDrawingCanvasHandlersSetupBridge } from './useDrawingCanvasHandlersSetupBridge';

type UseDrawingCanvasHandlersRuntimeSetupOptions = Parameters<
  typeof buildDrawingCanvasHandlersSetupOptions
>[0];

export const useDrawingCanvasHandlersRuntimeSetup = (
  options: UseDrawingCanvasHandlersRuntimeSetupOptions
) => useDrawingCanvasHandlersSetupBridge(buildDrawingCanvasHandlersSetupOptions(options));
