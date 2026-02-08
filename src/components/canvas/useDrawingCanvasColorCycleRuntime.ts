import { buildDrawingCanvasColorCycleRuntimeOptions } from './buildDrawingCanvasColorCycleRuntimeOptions';
import { useDrawingCanvasColorCycleRuntimeState } from './useDrawingCanvasColorCycleRuntimeState';

interface UseDrawingCanvasColorCycleRuntimeOptions {
  brushEngine: Parameters<typeof buildDrawingCanvasColorCycleRuntimeOptions>[0]['brushEngine'];
  setNeedsRedraw: Parameters<typeof buildDrawingCanvasColorCycleRuntimeOptions>[0]['setNeedsRedraw'];
}

export const useDrawingCanvasColorCycleRuntime = ({
  brushEngine,
  setNeedsRedraw,
}: UseDrawingCanvasColorCycleRuntimeOptions) =>
  useDrawingCanvasColorCycleRuntimeState(
    buildDrawingCanvasColorCycleRuntimeOptions({
      brushEngine,
      setNeedsRedraw,
    })
  );
