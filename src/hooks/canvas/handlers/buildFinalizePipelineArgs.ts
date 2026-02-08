import {
  createFinalizeAfterQueueDispatcher as createFinalizeAfterQueueDispatcherExternal,
} from '@/hooks/canvas/handlers/finalizeAfterQueue';
import {
  createFinalizeBrushFlowDeps as createFinalizeBrushFlowDepsExternal,
} from '@/hooks/canvas/handlers/finalizeBrushFlowDeps';
import { createFinalizeDrawingDispatcher } from '@/hooks/canvas/handlers/finalizeDrawingHandlers';
import { buildFinalizeDrawingCleanup } from '@/hooks/canvas/handlers/finalizeDrawingHandlers';

type FinalizeAfterQueueDispatcherArgs =
  Parameters<typeof createFinalizeAfterQueueDispatcherExternal>[0];
type FinalizeBrushFlowDepsArgs =
  Parameters<typeof createFinalizeBrushFlowDepsExternal>[0];
type FinalizeDrawingDispatcherArgs =
  Parameters<typeof createFinalizeDrawingDispatcher>[0];
type FinalizeDrawingCleanupDeps =
  Parameters<typeof buildFinalizeDrawingCleanup>[0];

export const buildFinalizeAfterQueueDispatcherArgs = (
  args: FinalizeAfterQueueDispatcherArgs
): FinalizeAfterQueueDispatcherArgs => args;

export const buildFinalizeBrushFlowDepsArgs = (
  args: FinalizeBrushFlowDepsArgs
): FinalizeBrushFlowDepsArgs => args;

export const buildFinalizeDrawingDispatcherArgs = ({
  finalizeDrawingCleanupDeps,
  ...rest
}: Omit<FinalizeDrawingDispatcherArgs, 'finalizeDrawingCleanup'> & {
  finalizeDrawingCleanupDeps: FinalizeDrawingCleanupDeps;
}): FinalizeDrawingDispatcherArgs => {
  return {
    ...rest,
    finalizeDrawingCleanup: buildFinalizeDrawingCleanup(finalizeDrawingCleanupDeps),
  };
};
