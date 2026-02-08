import {
  createFinalizeDrawingDispatcher as createFinalizeDrawingDispatcherExternal,
} from '@/hooks/canvas/handlers/finalizeExecution';
import {
  createFinalizeDrawingDispatcherDeps as createFinalizeDrawingDispatcherDepsExternal,
} from '@/hooks/canvas/handlers/finalizeExecutionDeps';
import {
  finalizeDrawingCleanup as finalizeDrawingCleanupExternal,
} from '@/hooks/canvas/handlers/finalizeCleanup';

type FinalizeDrawingDispatcherArgs = Parameters<typeof createFinalizeDrawingDispatcherDepsExternal>[0];
type FinalizeDrawingDispatcher = ReturnType<typeof createFinalizeDrawingDispatcherExternal>;

export const createFinalizeDrawingDispatcher = (
  args: FinalizeDrawingDispatcherArgs
): FinalizeDrawingDispatcher => {
  return createFinalizeDrawingDispatcherExternal(
    createFinalizeDrawingDispatcherDepsExternal(args)
  );
};

export const createFinalizeDrawingHandlers = ({
  finalizeDrawingDispatcher,
}: {
  finalizeDrawingDispatcher: FinalizeDrawingDispatcher;
}) => {
  const finalizeDrawing = (skipSaveOrOptions?: Parameters<FinalizeDrawingDispatcher>[0]) => {
    return finalizeDrawingDispatcher(skipSaveOrOptions);
  };

  const finalizeStroke = () => {
    void finalizeDrawing(false);
  };

  return {
    finalizeDrawing,
    finalizeStroke,
  };
};

export const buildFinalizeDrawingCleanup = (
  finalizeDrawingCleanupDeps: Parameters<typeof finalizeDrawingCleanupExternal>[0]
) => {
  return () => finalizeDrawingCleanupExternal(finalizeDrawingCleanupDeps);
};
