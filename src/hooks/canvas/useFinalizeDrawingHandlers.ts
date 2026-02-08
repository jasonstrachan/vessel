import { useMemo } from 'react';
import {
  createFinalizeExecutionDispatcher as createFinalizeExecutionDispatcherExternal,
} from '@/hooks/canvas/handlers/finalizeExecution';
import {
  createFinalizeAfterQueueDeps as createFinalizeAfterQueueDepsExternal,
} from '@/hooks/canvas/handlers/finalizeExecutionDeps';
import {
  createFinalizeDrawingDispatcher,
  createFinalizeDrawingHandlers,
} from '@/hooks/canvas/handlers/finalizeDrawingHandlers';
import { buildFinalizeDrawingDispatcherArgs } from '@/hooks/canvas/handlers/buildFinalizePipelineArgs';

type FinalizeAfterQueueDepsArgs = Parameters<typeof createFinalizeAfterQueueDepsExternal>[0];
type FinalizeExecutionDispatcherArgs = Parameters<typeof createFinalizeExecutionDispatcherExternal>[0];
type BuildFinalizeDrawingDispatcherArgs = Parameters<typeof buildFinalizeDrawingDispatcherArgs>[0];

interface UseFinalizeDrawingHandlersArgs {
  finalizeAfterQueueDepsArgs: FinalizeAfterQueueDepsArgs;
  finalizeAfterQueueDispatcher: FinalizeExecutionDispatcherArgs['finalizeAfterQueueDispatcher'];
  finalizeExecutionDispatcherArgs: Omit<FinalizeExecutionDispatcherArgs, 'finalizeAfterQueueDispatcher'>;
  finalizeDrawingDispatcherArgs: Omit<
    BuildFinalizeDrawingDispatcherArgs,
    'finalizeAfterQueueDeps' | 'finalizeExecutionDispatcher'
  >;
}

export const useFinalizeDrawingHandlers = ({
  finalizeAfterQueueDepsArgs,
  finalizeAfterQueueDispatcher,
  finalizeExecutionDispatcherArgs,
  finalizeDrawingDispatcherArgs,
}: UseFinalizeDrawingHandlersArgs) => {
  const finalizeAfterQueueDeps = useMemo(
    () => createFinalizeAfterQueueDepsExternal(finalizeAfterQueueDepsArgs),
    [finalizeAfterQueueDepsArgs]
  );

  const finalizeExecutionDispatcher = useMemo(
    () =>
      createFinalizeExecutionDispatcherExternal({
        ...finalizeExecutionDispatcherArgs,
        finalizeAfterQueueDispatcher,
      }),
    [finalizeExecutionDispatcherArgs, finalizeAfterQueueDispatcher]
  );

  const finalizeDrawingDispatcher = useMemo(
    () =>
      createFinalizeDrawingDispatcher(
        buildFinalizeDrawingDispatcherArgs({
          ...finalizeDrawingDispatcherArgs,
          finalizeAfterQueueDeps,
          finalizeExecutionDispatcher,
        })
      ),
    [finalizeDrawingDispatcherArgs, finalizeAfterQueueDeps, finalizeExecutionDispatcher]
  );

  return useMemo(
    () => createFinalizeDrawingHandlers({ finalizeDrawingDispatcher }),
    [finalizeDrawingDispatcher]
  );
};
