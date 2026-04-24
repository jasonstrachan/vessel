import { buildDrawingCanvasRenderSetupOptions } from '@/components/canvas/buildDrawingCanvasRenderSetupOptions';
import { useDrawingCanvasRenderSetupBridge } from '@/components/canvas/useDrawingCanvasRenderSetupBridge';

type UseRenderRuntimeOptions = Parameters<typeof buildDrawingCanvasRenderSetupOptions>[0];

export const useRenderRuntime = (options: UseRenderRuntimeOptions) =>
  useDrawingCanvasRenderSetupBridge(buildDrawingCanvasRenderSetupOptions(options));

export type RenderRuntime = ReturnType<typeof useRenderRuntime>;
