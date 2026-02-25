import { CURSOR_FALLBACK_NONE } from './cursorFallbacks';

interface ResolveSpacePanCursorArgs {
  isSpaceActive: boolean;
  isPanning: boolean;
  defaultCursorStyle?: string;
  fallbackCursor?: string;
}

export const resolveSpacePanCursor = ({
  isSpaceActive,
  isPanning,
  defaultCursorStyle,
  fallbackCursor = CURSOR_FALLBACK_NONE,
}: ResolveSpacePanCursorArgs): string => {
  if (isPanning) {
    return 'grabbing';
  }
  if (isSpaceActive) {
    return 'grab';
  }
  return defaultCursorStyle ?? fallbackCursor;
};
