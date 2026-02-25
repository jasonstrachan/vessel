import { useDrawingFinalizeContextRuntime } from '@/hooks/canvas/useDrawingFinalizeContextRuntime';
import { useDrawingFinalizeRuntime } from '@/hooks/canvas/useDrawingFinalizeRuntime';
import { useDrawingHandlerRefs } from '@/hooks/canvas/useDrawingHandlerRefs';

type DrawingHandlerRefs = ReturnType<typeof useDrawingHandlerRefs>;

type FinalizeContextArgs = Parameters<typeof useDrawingFinalizeContextRuntime>[0];
type FinalizeRuntimeArgs = Parameters<typeof useDrawingFinalizeRuntime>[0];

interface UseDrawingFinalizeRuntimeBridgeOptions {
  refs: DrawingHandlerRefs;
  contextOptions: Omit<FinalizeContextArgs, 'refs'>;
  runtimeOptions: Omit<
    FinalizeRuntimeArgs,
    | 'refs'
    | 'baseFinalizeAfterQueueDepsArgs'
    | 'finalizeDrawingCleanupDeps'
    | 'applyFinalizeLostEdge'
    | 'startFinalizeVisibleTimer'
    | 'endFinalizeVisibleTimer'
  >;
}

export const useDrawingFinalizeRuntimeBridge = ({
  refs,
  contextOptions,
  runtimeOptions,
}: UseDrawingFinalizeRuntimeBridgeOptions) => {
  const {
    finalizeLayerCaptureContextDeps,
    applyFinalizeLostEdge,
    finalizeBrushContextDeps,
    finalizeEraserStrokeDeps,
    startFinalizeVisibleTimer,
    endFinalizeVisibleTimer,
    finalizeDrawingCleanupDeps,
  } = useDrawingFinalizeContextRuntime({
    refs,
    ...contextOptions,
  });

  return useDrawingFinalizeRuntime({
    refs,
    ...runtimeOptions,
    applyFinalizeLostEdge,
    startFinalizeVisibleTimer,
    endFinalizeVisibleTimer,
    baseFinalizeAfterQueueDepsArgs: {
      finalizeLayerCaptureContextDeps,
      finalizeEraserStrokeDeps,
      finalizeBrushContextDeps,
    },
    finalizeDrawingCleanupDeps,
  });
};
