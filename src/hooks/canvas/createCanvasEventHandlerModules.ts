import { createInputRuntime } from '@/canvas/runtime/InputRuntime';
import type { createAugmentedEventHandlerDeps } from './handlers/createAugmentedEventHandlerDeps';

type AugmentedDeps = ReturnType<typeof createAugmentedEventHandlerDeps>;

export const createCanvasEventHandlerModules = (deps: AugmentedDeps) =>
  createInputRuntime(deps);
