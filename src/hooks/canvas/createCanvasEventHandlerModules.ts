import { createClipboardHandlers } from './handlers/clipboardHandlers';
import { createKeyboardHandlers } from './handlers/keyboardHandlers';
import { createPointerHandlers } from './handlers/pointerHandlers';
import { createWheelHandlers } from './handlers/wheelHandlers';
import type { createAugmentedEventHandlerDeps } from './handlers/createAugmentedEventHandlerDeps';

type AugmentedDeps = ReturnType<typeof createAugmentedEventHandlerDeps>;

export const createCanvasEventHandlerModules = (deps: AugmentedDeps) => ({
  pointerHandlers: createPointerHandlers(deps),
  keyboardHandlers: createKeyboardHandlers(deps),
  wheelHandlers: createWheelHandlers(deps),
  clipboardHandlers: createClipboardHandlers(deps),
});
