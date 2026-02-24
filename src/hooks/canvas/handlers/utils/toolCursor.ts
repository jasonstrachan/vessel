import { CURSOR_FALLBACK_NONE } from './cursorFallbacks';

export interface ToolCursorState {
  cursorStyle: string;
  showBrushCursor: boolean;
}

interface ResolveToolCursorArgs {
  isDraggingFloatingPaste?: boolean;
  isColorPicker: boolean;
  useCrosshair: boolean;
  defaultCursorStyle?: string;
  fallbackCursor?: string;
}

export const resolveToolCursorState = ({
  isDraggingFloatingPaste = false,
  isColorPicker,
  useCrosshair,
  defaultCursorStyle,
  fallbackCursor = CURSOR_FALLBACK_NONE,
}: ResolveToolCursorArgs): ToolCursorState => {
  if (isDraggingFloatingPaste) {
    return {
      cursorStyle: 'move',
      showBrushCursor: false,
    };
  }

  if (isColorPicker || useCrosshair) {
    return {
      cursorStyle: 'crosshair',
      showBrushCursor: false,
    };
  }

  return {
    cursorStyle: defaultCursorStyle ?? fallbackCursor,
    showBrushCursor: true,
  };
};
