import { useMemo } from 'react';
import {
  createFinalizeLayerCaptureContextDeps as createFinalizeLayerCaptureContextDepsExternal,
} from '@/hooks/canvas/handlers/finalizeLayerCaptureContextDeps';
import {
  createFinalizeLostEdgeDispatcher as createFinalizeLostEdgeDispatcherExternal,
} from '@/hooks/canvas/handlers/finalizeLostEdgeDeps';
import {
  createFinalizeBrushContextDeps as createFinalizeBrushContextDepsExternal,
} from '@/hooks/canvas/handlers/finalizeBrushContextDeps';
import {
  createFinalizeEraserStrokeDeps as createFinalizeEraserStrokeDepsExternal,
} from '@/hooks/canvas/handlers/eraserFinalize';
import {
  createFinalizeVisibleTimer as createFinalizeVisibleTimerExternal,
} from '@/hooks/canvas/handlers/finalizeVisibleTimer';
import {
  createFinalizeDrawingCleanupDeps as createFinalizeDrawingCleanupDepsExternal,
} from '@/hooks/canvas/handlers/finalizeCleanupDeps';
import {
  buildFinalizeLayerCaptureContextDepsArgs,
  buildFinalizeLostEdgeDispatcherArgs,
  buildFinalizeBrushContextDepsArgs,
  buildFinalizeEraserStrokeDepsArgs,
  buildFinalizeDrawingCleanupDepsArgs,
} from '@/hooks/canvas/handlers/buildFinalizeContextDepsArgs';

type FinalizeLayerCaptureContextDepsArgs = Parameters<
  typeof buildFinalizeLayerCaptureContextDepsArgs
>[0];
type FinalizeLostEdgeDispatcherArgs = Parameters<typeof buildFinalizeLostEdgeDispatcherArgs>[0];
type FinalizeBrushContextDepsArgs = Parameters<typeof buildFinalizeBrushContextDepsArgs>[0];
type FinalizeEraserStrokeDepsArgs = Parameters<typeof buildFinalizeEraserStrokeDepsArgs>[0];
type FinalizeVisibleTimerArgs = Parameters<typeof createFinalizeVisibleTimerExternal>[0];
type FinalizeDrawingCleanupDepsArgs = Omit<
  Parameters<typeof buildFinalizeDrawingCleanupDepsArgs>[0],
  'endFinalizeVisibleTimer'
>;

interface UseFinalizeContextDepsArgs {
  finalizeLayerCaptureContextDepsArgs: FinalizeLayerCaptureContextDepsArgs;
  finalizeLostEdgeDispatcherArgs: FinalizeLostEdgeDispatcherArgs;
  finalizeBrushContextDepsArgs: FinalizeBrushContextDepsArgs;
  finalizeEraserStrokeDepsArgs: FinalizeEraserStrokeDepsArgs;
  finalizeVisibleTimerArgs: FinalizeVisibleTimerArgs;
  finalizeDrawingCleanupDepsArgs: FinalizeDrawingCleanupDepsArgs;
}

export const useFinalizeContextDeps = ({
  finalizeLayerCaptureContextDepsArgs,
  finalizeLostEdgeDispatcherArgs,
  finalizeBrushContextDepsArgs,
  finalizeEraserStrokeDepsArgs,
  finalizeVisibleTimerArgs,
  finalizeDrawingCleanupDepsArgs,
}: UseFinalizeContextDepsArgs) => {
  const finalizeLayerCaptureContextDeps = useMemo(
    () =>
      createFinalizeLayerCaptureContextDepsExternal(
        buildFinalizeLayerCaptureContextDepsArgs(finalizeLayerCaptureContextDepsArgs)
      ),
    [finalizeLayerCaptureContextDepsArgs]
  );

  const { applyFinalizeLostEdge } = useMemo(
    () =>
      createFinalizeLostEdgeDispatcherExternal(
        buildFinalizeLostEdgeDispatcherArgs(finalizeLostEdgeDispatcherArgs)
      ),
    [finalizeLostEdgeDispatcherArgs]
  );

  const finalizeBrushContextDeps = useMemo(
    () =>
      createFinalizeBrushContextDepsExternal(
        buildFinalizeBrushContextDepsArgs(finalizeBrushContextDepsArgs)
      ),
    [finalizeBrushContextDepsArgs]
  );

  const finalizeEraserStrokeDeps = useMemo(
    () =>
      createFinalizeEraserStrokeDepsExternal(
        buildFinalizeEraserStrokeDepsArgs(finalizeEraserStrokeDepsArgs)
      ),
    [finalizeEraserStrokeDepsArgs]
  );

  const { startFinalizeVisibleTimer, endFinalizeVisibleTimer } = useMemo(
    () => createFinalizeVisibleTimerExternal(finalizeVisibleTimerArgs),
    [finalizeVisibleTimerArgs]
  );

  const finalizeDrawingCleanupDeps = useMemo(
    () =>
      createFinalizeDrawingCleanupDepsExternal(
        buildFinalizeDrawingCleanupDepsArgs({
          ...finalizeDrawingCleanupDepsArgs,
          endFinalizeVisibleTimer,
        })
      ),
    [finalizeDrawingCleanupDepsArgs, endFinalizeVisibleTimer]
  );

  return {
    finalizeLayerCaptureContextDeps,
    applyFinalizeLostEdge,
    finalizeBrushContextDeps,
    finalizeEraserStrokeDeps,
    startFinalizeVisibleTimer,
    endFinalizeVisibleTimer,
    finalizeDrawingCleanupDeps,
  };
};
