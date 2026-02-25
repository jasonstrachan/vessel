import type React from 'react';
import { useEffect } from 'react';

interface UseDrawingCanvasCursorEffectsOptions {
  defaultCursorStyle: string;
  isDraggingFloatingPaste: boolean;
  setCursorStyle: React.Dispatch<React.SetStateAction<string>>;
  mode: string;
}

export const useDrawingCanvasCursorEffects = ({
  defaultCursorStyle,
  isDraggingFloatingPaste,
  setCursorStyle,
  mode,
}: UseDrawingCanvasCursorEffectsOptions) => {
  useEffect(() => {
    if (mode !== 'AWAITING_PAN' && mode !== 'PANNING' && !isDraggingFloatingPaste) {
      setCursorStyle(defaultCursorStyle);
    }
  }, [defaultCursorStyle, isDraggingFloatingPaste, mode, setCursorStyle]);
};
