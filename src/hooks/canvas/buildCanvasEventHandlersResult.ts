import type { createPointerHandlers } from './handlers/pointerHandlers';
import type { useCanvasEventHandlerCallbacks } from './useCanvasEventHandlerCallbacks';
import type { EventHandlers } from './utils/types';

interface BuildCanvasEventHandlersResultOptions {
  pointerHandlers: ReturnType<typeof createPointerHandlers>;
  callbacks: ReturnType<typeof useCanvasEventHandlerCallbacks>;
}

export const buildCanvasEventHandlersResult = ({
  pointerHandlers,
  callbacks,
}: BuildCanvasEventHandlersResultOptions): EventHandlers => ({
  ...pointerHandlers,
  handleKeyDown: callbacks.handleKeyDown,
  handleKeyUp: callbacks.handleKeyUp,
  handleBlur: callbacks.handleBlur,
  handleWheel: callbacks.handleWheel,
  handlePaste: callbacks.handlePaste,
});
