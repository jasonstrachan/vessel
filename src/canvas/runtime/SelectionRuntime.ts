import {
  createSelectionHandlers,
  type SelectionHandlerDeps,
  type SelectionHandlers,
  type SelectionRuntimeDynamicDeps,
} from '@/hooks/canvas/handlers/selectionHandlers';

export const createSelectionRuntime = (
  deps: SelectionHandlerDeps,
  getDynamicDeps: () => SelectionRuntimeDynamicDeps
): SelectionHandlers => createSelectionHandlers(deps, getDynamicDeps);

export type SelectionRuntime = ReturnType<typeof createSelectionRuntime>;
