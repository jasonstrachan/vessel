import { createClipboardHandlers } from '@/hooks/canvas/handlers/clipboardHandlers';
import { createKeyboardHandlers } from '@/hooks/canvas/handlers/keyboardHandlers';
import { createPointerHandlers } from '@/hooks/canvas/handlers/pointerHandlers';
import { createWheelHandlers } from '@/hooks/canvas/handlers/wheelHandlers';
import type { createAugmentedEventHandlerDeps } from '@/hooks/canvas/handlers/createAugmentedEventHandlerDeps';

type InputRuntimeDeps = ReturnType<typeof createAugmentedEventHandlerDeps>;

export const createInputRuntime = (deps: InputRuntimeDeps) => ({
  pointerHandlers: createPointerHandlers(deps),
  keyboardHandlers: createKeyboardHandlers(deps),
  wheelHandlers: createWheelHandlers(deps),
  clipboardHandlers: createClipboardHandlers(deps),
});

export type InputRuntime = ReturnType<typeof createInputRuntime>;
