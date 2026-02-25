import { useCallback } from 'react';
import type React from 'react';
import { createClipboardHandlers } from './handlers/clipboardHandlers';
import { createKeyboardHandlers } from './handlers/keyboardHandlers';
import { createWheelHandlers } from './handlers/wheelHandlers';

interface UseCanvasEventHandlerCallbacksOptions {
  keyboardHandlers: ReturnType<typeof createKeyboardHandlers>;
  wheelHandlers: ReturnType<typeof createWheelHandlers>;
  clipboardHandlers: ReturnType<typeof createClipboardHandlers>;
}

export const useCanvasEventHandlerCallbacks = ({
  keyboardHandlers,
  wheelHandlers,
  clipboardHandlers,
}: UseCanvasEventHandlerCallbacksOptions) => {
  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => keyboardHandlers.handleKeyDown(event),
    [keyboardHandlers]
  );

  const handleKeyUp = useCallback(
    (event: KeyboardEvent) => keyboardHandlers.handleKeyUp(event),
    [keyboardHandlers]
  );

  const handleBlur = useCallback(
    (event: React.FocusEvent) => keyboardHandlers.handleBlur(event),
    [keyboardHandlers]
  );

  const handleWheel = useCallback(
    (event: WheelEvent) => wheelHandlers.handleWheel(event),
    [wheelHandlers]
  );

  const handlePaste = useCallback(
    async (event: ClipboardEvent) => clipboardHandlers.handlePaste(event),
    [clipboardHandlers]
  );

  return {
    handleKeyDown,
    handleKeyUp,
    handleBlur,
    handleWheel,
    handlePaste,
  };
};
