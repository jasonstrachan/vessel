import type {
  EventHandlers,
} from './utils/types';
import {
  splitCanvasEventHandlerDeps,
  type EventHandlerDependenciesInput,
} from './canvasEventHandlerDeps';
import { buildCanvasEventHandlersResult } from './buildCanvasEventHandlersResult';
import { createCanvasEventHandlerModules } from './createCanvasEventHandlerModules';
import { useCanvasAugmentedEventHandlerDeps } from './useCanvasAugmentedEventHandlerDeps';
import { useCanvasEventHandlerCallbacks } from './useCanvasEventHandlerCallbacks';
import { useCanvasEventHandlerDynamicDepsRef } from './useCanvasEventHandlerDynamicDepsRef';
import { useCanvasEventHandlerRefs } from './useCanvasEventHandlerRefs';
/**
 * Main orchestrator hook for canvas event handlers
 * Consolidates all event handling logic into modular, testable functions
 */

export const useCanvasEventHandlers = (deps: EventHandlerDependenciesInput): EventHandlers => {
  const { staticDeps, dynamicDeps } = splitCanvasEventHandlerDeps(deps);
  const handlerRefs = useCanvasEventHandlerRefs();
  const dynamicDepsRef = useCanvasEventHandlerDynamicDepsRef(dynamicDeps);

  const augmentedDeps = useCanvasAugmentedEventHandlerDeps({
    staticDeps,
    dynamicDepsRef,
    refs: handlerRefs,
  });

  const { pointerHandlers, keyboardHandlers, wheelHandlers, clipboardHandlers } =
    createCanvasEventHandlerModules(augmentedDeps);

  const handlerCallbacks = useCanvasEventHandlerCallbacks({
    keyboardHandlers,
    wheelHandlers,
    clipboardHandlers,
  });

  return buildCanvasEventHandlersResult({
    pointerHandlers,
    callbacks: handlerCallbacks,
  });
};
