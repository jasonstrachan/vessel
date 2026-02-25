import { useMemo } from 'react';
import {
  createFinalizeAfterQueueDispatcher as createFinalizeAfterQueueDispatcherExternal,
} from '@/hooks/canvas/handlers/finalizeAfterQueue';
import {
  createFinalizeBrushFlowDeps as createFinalizeBrushFlowDepsExternal,
} from '@/hooks/canvas/handlers/finalizeBrushFlowDeps';
import {
  buildFinalizeAfterQueueDispatcherArgs,
  buildFinalizeBrushFlowDepsArgs,
} from '@/hooks/canvas/handlers/buildFinalizePipelineArgs';

type FinalizeAfterQueueDispatcherArgs = Parameters<typeof buildFinalizeAfterQueueDispatcherArgs>[0];
type FinalizeBrushFlowDepsArgs = Parameters<typeof buildFinalizeBrushFlowDepsArgs>[0];

interface UseFinalizeFlowDepsArgs {
  finalizeAfterQueueDispatcherArgs: FinalizeAfterQueueDispatcherArgs;
  finalizeBrushFlowDepsArgs: FinalizeBrushFlowDepsArgs;
}

export const useFinalizeFlowDeps = ({
  finalizeAfterQueueDispatcherArgs,
  finalizeBrushFlowDepsArgs,
}: UseFinalizeFlowDepsArgs) => {
  const finalizeAfterQueueDispatcher = useMemo(
    () =>
      createFinalizeAfterQueueDispatcherExternal(
        buildFinalizeAfterQueueDispatcherArgs(finalizeAfterQueueDispatcherArgs)
      ),
    [finalizeAfterQueueDispatcherArgs]
  );

  const { finalizeColorCycleBrushBaseDeps, colorCycleCommitDeps } = useMemo(
    () =>
      createFinalizeBrushFlowDepsExternal(
        buildFinalizeBrushFlowDepsArgs(finalizeBrushFlowDepsArgs)
      ),
    [finalizeBrushFlowDepsArgs]
  );

  return {
    finalizeAfterQueueDispatcher,
    finalizeColorCycleBrushBaseDeps,
    colorCycleCommitDeps,
  };
};
