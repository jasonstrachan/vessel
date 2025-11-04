import type { AppState } from '@/stores/useAppStore';

export const selectFloatingPaste = (state: AppState) => state.floatingPaste;

export const selectSelectionRects = (state: AppState) => ({
  selectionStart: state.selectionStart,
  selectionEnd: state.selectionEnd,
});
