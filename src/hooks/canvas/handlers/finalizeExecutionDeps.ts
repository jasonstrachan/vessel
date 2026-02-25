import type { RunFinalizeAfterQueueDeps } from '@/hooks/canvas/handlers/finalizeAfterQueue';
import type { FinalizeDrawingDispatcherDeps } from '@/hooks/canvas/handlers/finalizeExecution';

export const createFinalizeAfterQueueDeps = (
  deps: RunFinalizeAfterQueueDeps
): RunFinalizeAfterQueueDeps => deps;

export const createFinalizeDrawingDispatcherDeps = (
  deps: FinalizeDrawingDispatcherDeps
): FinalizeDrawingDispatcherDeps => deps;
