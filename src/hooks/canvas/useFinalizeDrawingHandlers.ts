import { useEffect, useMemo, useRef } from 'react';
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
import { registerToolFlush, unregisterToolFlush } from '@/utils/toolFlushRegistry';

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
  const pendingFinalizeRef = useRef<Promise<void> | null>(null);
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

  const baseHandlers = useMemo(
    () => createFinalizeDrawingHandlers({ finalizeDrawingDispatcher }),
    [finalizeDrawingDispatcher]
  );

  const wrappedHandlers = useMemo(() => {
    const finalizeDrawing = (skipSaveOrOptions?: Parameters<typeof baseHandlers.finalizeDrawing>[0]) => {
      const run = baseHandlers.finalizeDrawing(skipSaveOrOptions);
      pendingFinalizeRef.current = run;
      return run.finally(() => {
        if (pendingFinalizeRef.current === run) {
          pendingFinalizeRef.current = null;
        }
      });
    };

    const finalizeStroke = () => {
      void finalizeDrawing(false);
    };

    return {
      ...baseHandlers,
      finalizeDrawing,
      finalizeStroke,
    };
  }, [baseHandlers]);

  useEffect(() => {
    const flushKey = 'drawing-handlers:finalize';
    registerToolFlush(flushKey, async () => {
      if (pendingFinalizeRef.current) {
        await pendingFinalizeRef.current;
      }
    });
    return () => {
      unregisterToolFlush(flushKey);
    };
  }, []);

  return wrappedHandlers;
};
